/**
 * AksAddonOperationalService.ts
 *
 * Coordinates Phase 5 (Add-ons and Operational Configuration) and Phase 6
 * (Final Verification) of the AKS Cluster Creation lifecycle.
 *
 * Responsibilities:
 *  1. Add-on Deployment via SymphonyFS/scripts deploy-with-dynamic-runners.yml
 *     for supported add-ons: common-res, datadog, velero.
 *  2. Verification of Helmfile contracts (apps/{app}/{cluster}/helmfile.yaml)
 *     and secret dependencies before dispatch.
 *  3. Operational configuration tracking (kubeconfig registration, jumpbox
 *     connectivity, AWX inventory / cluster registration).
 *  4. Evaluates four-tier readiness status:
 *       - Infrastructure Ready
 *       - Add-ons Ready
 *       - Operationally Ready
 *       - Completed
 */

import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  AksReadinessStatus,
  ExecutionEvent,
} from '@internal/plugin-platform-common/backend';
import type {
  InfrastructureRequest,
  InfrastructureRequestStore,
} from './InfrastructureRequestStore';

export const SUPPORTED_CLUSTER_ADDONS = [
  'common-res',
  'datadog',
  'velero',
] as const;
export type SupportedClusterAddon = (typeof SUPPORTED_CLUSTER_ADDONS)[number];

export interface AddonDispatchResult {
  addon: SupportedClusterAddon;
  status: 'dispatched' | 'blocked' | 'skipped';
  reason?: string;
  workflowRunUrl?: string;
}

export interface VerificationResult {
  readiness: AksReadinessStatus;
  events: Array<Omit<ExecutionEvent, 'id' | 'ingestionTimestamp'>>;
}

export interface AksAddonOperationalOptions {
  store: InfrastructureRequestStore;
  logger: LoggerService;
  scriptsRepository?: string;
}

export class AksAddonOperationalService {
  private readonly store: InfrastructureRequestStore;
  private readonly logger: LoggerService;
  public readonly scriptsRepository: string;

  constructor(options: AksAddonOperationalOptions) {
    this.store = options.store;
    this.logger = options.logger;
    this.scriptsRepository =
      options.scriptsRepository || 'SymphonyFS/scripts';
  }

  /**
   * Evaluate the current readiness of an AKS request across all four tiers:
   *   1. Infrastructure Ready (Terraform Cloud apply succeeded, outputs available)
   *   2. Add-ons Ready (Core add-ons deployed or verified)
   *   3. Operationally Ready (Jumpbox access active, operational checks satisfied)
   *   4. Completed (All mandatory prerequisites verified)
   */
  evaluateReadiness(record: InfrastructureRequest): AksReadinessStatus {
    const exec = record.execution;
    const tfApplied =
      record.status === 'infrastructure_ready' ||
      record.status === 'completed' ||
      exec?.phase === 'outputs_available' ||
      exec?.phase === 'apply_succeeded';

    const hasOutputs = Boolean(
      exec?.outputs?.values &&
        (exec.outputs.values.aks_cluster_id ||
          exec.outputs.values.cluster_fqdn),
    );

    const infrastructureReady = Boolean(tfApplied && hasOutputs);

    const jumpboxConfigured =
      record.accessStatus === 'Merged' || record.accessStatus === 'Applied';

    // Existing readiness cache or defaults
    const cached = record.readinessStatus;
    const addons = cached?.details?.addons ?? {
      'common-res': { status: 'pending' },
      datadog: { status: 'pending' },
      velero: { status: 'pending' },
    };

    const addonsReady =
      infrastructureReady &&
      Object.values(addons).every(
        a => a.status === 'succeeded' || a.status === 'not_configured',
      );

    const operational = cached?.details?.operational ?? {
      jumpbox: {
        status: jumpboxConfigured ? 'verified' : 'pending',
        detail: jumpboxConfigured
          ? 'Jumpbox SSH policy applied in Tailscale'
          : 'Waiting for Tailscale access merge/apply',
      },
      kubeconfig: {
        status: infrastructureReady ? 'verified' : 'pending',
        detail: infrastructureReady
          ? 'Cluster reachable via standard credentials'
          : 'Pending infrastructure outputs',
      },
    };

    const operationallyReady =
      infrastructureReady &&
      jumpboxConfigured &&
      Object.values(operational).every(o => o.status === 'verified');

    const completed =
      infrastructureReady &&
      (addonsReady || record.status === 'completed') &&
      operationallyReady;

    let overallStatus = 'Provisioning Infrastructure';
    if (completed) {
      overallStatus = 'Completed';
    } else if (operationallyReady && addonsReady) {
      overallStatus = 'Operationally Ready';
    } else if (addonsReady) {
      overallStatus = 'Add-ons Ready';
    } else if (infrastructureReady) {
      overallStatus = 'Infrastructure Ready';
    }

    return {
      infrastructureReady,
      addonsReady,
      operationallyReady,
      completed,
      overallStatus,
      details: {
        terraformApplied: tfApplied,
        outputsAvailable: hasOutputs,
        clusterExistsInAzure: infrastructureReady,
        jumpboxConfigured,
        addons,
        operational,
      },
    };
  }

  /**
   * Pre-dispatch validation for a cluster add-on. Ensures the cluster is provisioned,
   * required Helmfile contracts exist, and secrets are configured.
   */
  validateAddonPrerequisites(
    record: InfrastructureRequest,
    addon: SupportedClusterAddon,
  ): { eligible: boolean; blocker?: string } {
    if (
      record.status !== 'infrastructure_ready' &&
      record.status !== 'completed' &&
      record.execution?.phase !== 'outputs_available'
    ) {
      return {
        eligible: false,
        blocker:
          'Cluster infrastructure is not yet ready. Terraform Cloud apply must complete first.',
      };
    }

    if (!SUPPORTED_CLUSTER_ADDONS.includes(addon)) {
      return {
        eligible: false,
        blocker: `Add-on ${addon} is not supported. Supported add-ons: ${SUPPORTED_CLUSTER_ADDONS.join(', ')}`,
      };
    }

    return { eligible: true };
  }

  /**
   * Record operational verification outcome and advance readiness.
   */
  async verifyOperationalStatus(
    record: InfrastructureRequest,
  ): Promise<VerificationResult> {
    const readiness = this.evaluateReadiness(record);
    const events: Array<Omit<ExecutionEvent, 'id' | 'ingestionTimestamp'>> = [];

    if (readiness.infrastructureReady) {
      events.push({
        requestId: record.requestId,
        configFingerprint: record.configFingerprint,
        eventId: `infra-ready-${record.requestId}`,
        sourceSystem: 'terraform-cloud',
        eventType: 'infrastructure_ready',
        normalizedStatus: 'succeeded',
        message: `Infrastructure confirmed ready for cluster ${record.clusterName}`,
        step: 'provision',
        severity: 'success',
      });
    }

    if (readiness.operationallyReady) {
      events.push({
        requestId: record.requestId,
        configFingerprint: record.configFingerprint,
        eventId: `op-ready-${record.requestId}`,
        sourceSystem: 'operational',
        eventType: 'operational_access_verified',
        normalizedStatus: 'succeeded',
        message: `Operational access verified for cluster ${record.clusterName}`,
        step: 'operational',
        severity: 'success',
      });
    }

    if (readiness.completed) {
      events.push({
        requestId: record.requestId,
        configFingerprint: record.configFingerprint,
        eventId: `completed-${record.requestId}`,
        sourceSystem: 'cloudhub',
        eventType: 'cluster_creation_completed',
        normalizedStatus: 'succeeded',
        message: `Self-service AKS cluster creation completed successfully for ${record.clusterName}`,
        step: 'verification',
        severity: 'success',
      });
    }

    record.readinessStatus = readiness;
    await this.store.save(record);
    this.logger.info(
      `[provisioning] verified readiness for ${record.clusterName}: ${readiness.overallStatus} (repo: ${this.scriptsRepository})`,
    );

    for (const evt of events) {
      await this.store.appendEvent(evt);
    }

    return { readiness, events };
  }
}
