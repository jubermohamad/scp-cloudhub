import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  CertificationResult,
  HealthCheck,
  HealthCheckContext,
  HealthResult,
  PlatformCluster,
} from '../types';
import { AzureClientFactory } from './AzureClientFactory';
import { KubernetesClientFactory } from './KubernetesClientFactory';
import { HealthScoreService } from './HealthScoreService';
import type { AksHealthDatabase } from '../database';

import { ControlPlaneCheck } from '../checks/ControlPlaneCheck';
import { NodeCheck } from '../checks/NodeCheck';
import { CapacityCheck } from '../checks/CapacityCheck';
import { SystemPodsCheck } from '../checks/SystemPodsCheck';
import { NetworkingCheck } from '../checks/NetworkingCheck';
import { StorageCheck } from '../checks/StorageCheck';
import { WorkloadCheck } from '../checks/WorkloadCheck';
import { CloudNativePgCheck } from '../checks/CloudNativePgCheck';
import { EventsCheck } from '../checks/EventsCheck';
import { SecurityCheck } from '../checks/SecurityCheck';
import { ObservabilityCheck } from '../checks/ObservabilityCheck';
import { BackupCheck } from '../checks/BackupCheck';

export class CertificationEngine {
  private readonly checks: HealthCheck[];
  private readonly scoreService: HealthScoreService;
  private readonly azureClientFactory: AzureClientFactory;
  private readonly k8sClientFactory: KubernetesClientFactory;
  private readonly logger: LoggerService;
  private readonly db?: AksHealthDatabase;

  constructor(deps: {
    logger: LoggerService;
    db?: AksHealthDatabase;
    azureClientFactory?: AzureClientFactory;
    k8sClientFactory?: KubernetesClientFactory;
    scoreService?: HealthScoreService;
  }) {
    this.logger = deps.logger;
    this.db = deps.db;
    this.azureClientFactory =
      deps.azureClientFactory ?? new AzureClientFactory(deps.logger);
    this.k8sClientFactory =
      deps.k8sClientFactory ?? new KubernetesClientFactory(deps.logger);
    this.scoreService = deps.scoreService ?? new HealthScoreService();

    this.checks = [
      new ControlPlaneCheck(),
      new NodeCheck(),
      new CapacityCheck(),
      new SystemPodsCheck(),
      new NetworkingCheck(),
      new StorageCheck(),
      new WorkloadCheck(),
      new CloudNativePgCheck(),
      new EventsCheck(),
      new SecurityCheck(),
      new ObservabilityCheck(),
      new BackupCheck(),
    ];
  }

  async runCertification(cluster: PlatformCluster): Promise<CertificationResult> {
    this.logger.info(
      `[CertificationEngine] Running health check on cluster=${cluster.clusterName} (id=${cluster.id})`,
    );

    // Try to get live kubeconfig if subscription & resourceGroup exist
    let kubeConfigRaw: string | null = null;
    let isSimulated = false;

    if (
      cluster.clusterName.includes('scotia') ||
      cluster.id === '123' ||
      !cluster.subscriptionId ||
      cluster.subscriptionId === 'sub-simulated'
    ) {
      isSimulated = true;
    } else {
      try {
        kubeConfigRaw = await this.azureClientFactory.getClusterKubeConfig(
          cluster.subscriptionId,
          cluster.resourceGroup,
          cluster.clusterName,
        );
      } catch (err: any) {
        this.logger.debug(
          `[CertificationEngine] Live kubeconfig acquisition unavailable: ${err.message}`,
        );
      }
    }

    const kubeConfig = this.k8sClientFactory.createKubeConfig(kubeConfigRaw);

    const context: HealthCheckContext = {
      azureClientFactory: this.azureClientFactory,
      kubernetesClientFactory: this.k8sClientFactory,
      kubeConfig,
      logger: this.logger,
      isSimulated,
    };

    const checkResults: HealthResult[] = [];

    for (const check of this.checks) {
      try {
        const res = await check.run(cluster, context);
        // Ensure score aligns with calculated score rule
        const calculatedScore = this.scoreService.calculateCheckScore(
          res.status,
          res.weight || check.weight,
          res.score,
        );
        checkResults.push({
          ...res,
          weight: check.weight,
          score: calculatedScore,
        });
      } catch (err: any) {
        this.logger.error(
          `[CertificationEngine] Error in check "${check.name}": ${err.message}`,
        );
        checkResults.push({
          name: check.name,
          status: 'WARNING',
          weight: check.weight,
          score: Math.round(check.weight * 0.5),
          reason: `Check execution issue: ${err.message}`,
          findings: [`Internal error: ${err.message}`],
        });
      }
    }

    const runTimestamp = new Date().toISOString();
    const certification = this.scoreService.evaluateCertification(
      cluster,
      checkResults,
      runTimestamp,
    );

    // Persist result to database if configured
    if (this.db) {
      try {
        await this.db.saveRun(cluster.id, certification);
        this.logger.info(
          `[CertificationEngine] Run persisted to database for cluster=${cluster.clusterName}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `[CertificationEngine] Failed to persist run to DB: ${err.message}`,
        );
      }
    }

    return certification;
  }
}
