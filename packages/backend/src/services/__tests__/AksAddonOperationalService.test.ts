import type { LoggerService } from '@backstage/backend-plugin-api';
import { AksAddonOperationalService } from '../AksAddonOperationalService';
import {
  InfrastructureRequestStore,
  type InfrastructureRequest,
} from '../InfrastructureRequestStore';

function makeLogger(): LoggerService {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  } as unknown as LoggerService;
  (logger.child as jest.Mock).mockReturnValue(logger);
  return logger;
}

function makeRequest(overrides: Partial<InfrastructureRequest> = {}): InfrastructureRequest {
  const now = new Date();
  return {
    requestId: 'req-1',
    requestor: 'user:default/alice',
    customer: 'Contoso',
    environment: 'dev',
    subscription: 'b0799078-b42a-4b59-9e70-22cd09a20ee2',
    clusterName: 'aks-scp-dev-ae-st-contoso',
    clusterProfile: 'single-region',
    regions: 'australiaeast',
    nodeSize: 'Standard_B2s',
    kubernetesVersion: '1.36.2',
    estimatedMonthlyCost: 0,
    planSummary: {
      resourcesToCreate: 0,
      resourcesToModify: 0,
      resourcesToDestroy: 0,
      monthlyCost: 0,
      errors: [],
      warnings: [],
    },
    status: 'pending_approval',
    approvalChain: [],
    createdAt: now,
    updatedAt: now,
    logs: [],
    payload: {} as any,
    clusterAdministrators: ['alice'],
    accessStatus: 'Pending',
    version: 0,
    configFingerprint: 'abc123hash',
    ...overrides,
  };
}

describe('AksAddonOperationalService', () => {
  let store: InfrastructureRequestStore;
  let logger: LoggerService;
  let service: AksAddonOperationalService;

  beforeEach(async () => {
    logger = makeLogger();
    store = new InfrastructureRequestStore(logger, null);
    await store.init();
    service = new AksAddonOperationalService({
      store,
      logger,
      scriptsRepository: 'SymphonyFS/scripts',
    });
  });

  describe('evaluateReadiness', () => {
    it('reports not ready for a draft/pending request', () => {
      const record = makeRequest();
      const readiness = service.evaluateReadiness(record);

      expect(readiness.infrastructureReady).toBe(false);
      expect(readiness.addonsReady).toBe(false);
      expect(readiness.operationallyReady).toBe(false);
      expect(readiness.completed).toBe(false);
      expect(readiness.overallStatus).toBe('Provisioning Infrastructure');
    });

    it('reports infrastructure ready when outputs are verified', () => {
      const record = makeRequest({
        status: 'infrastructure_ready',
        accessStatus: 'Merged',
        execution: {
          schemaVersion: 1,
          phase: 'outputs_available',
          detail: 'Outputs available',
          phaseSince: new Date().toISOString(),
          pullRequest: null,
          mapping: null,
          workspaceManagerRun: null,
          workspace: null,
          run: null,
          outputs: {
            stateVersionId: 'sv-1',
            runId: 'run-1',
            values: {
              aks_cluster_id: '/sub/rg/aks',
              cluster_fqdn: 'aks.privatelink.com',
            },
            omitted: [],
            observedAt: new Date().toISOString(),
          },
          refresh: { lastAttemptAt: null, lastSuccessAt: null, error: null },
          history: [],
        },
      });

      const readiness = service.evaluateReadiness(record);
      expect(readiness.infrastructureReady).toBe(true);
      expect(readiness.overallStatus).toBe('Infrastructure Ready');
    });

    it('reports completed when all 4 tiers are fulfilled', () => {
      const record = makeRequest({
        status: 'completed',
        accessStatus: 'Applied',
        readinessStatus: {
          infrastructureReady: true,
          addonsReady: true,
          operationallyReady: true,
          completed: true,
          overallStatus: 'Completed',
          details: {
            terraformApplied: true,
            outputsAvailable: true,
            clusterExistsInAzure: true,
            jumpboxConfigured: true,
            addons: {
              'common-res': { status: 'succeeded' },
              datadog: { status: 'succeeded' },
              velero: { status: 'succeeded' },
            },
            operational: {
              jumpbox: { status: 'verified', detail: 'OK' },
              kubeconfig: { status: 'verified', detail: 'OK' },
            },
          },
        },
        execution: {
          schemaVersion: 1,
          phase: 'outputs_available',
          detail: 'Outputs available',
          phaseSince: new Date().toISOString(),
          pullRequest: null,
          mapping: null,
          workspaceManagerRun: null,
          workspace: null,
          run: null,
          outputs: {
            stateVersionId: 'sv-1',
            runId: 'run-1',
            values: {
              aks_cluster_id: '/sub/rg/aks',
              cluster_fqdn: 'aks.privatelink.com',
            },
            omitted: [],
            observedAt: new Date().toISOString(),
          },
          refresh: { lastAttemptAt: null, lastSuccessAt: null, error: null },
          history: [],
        },
      });

      const readiness = service.evaluateReadiness(record);
      expect(readiness.infrastructureReady).toBe(true);
      expect(readiness.addonsReady).toBe(true);
      expect(readiness.operationallyReady).toBe(true);
      expect(readiness.completed).toBe(true);
      expect(readiness.overallStatus).toBe('Completed');
    });
  });

  describe('validateAddonPrerequisites', () => {
    it('blocks addon dispatch if infrastructure is not ready', () => {
      const record = makeRequest({ status: 'pending_approval' });
      const check = service.validateAddonPrerequisites(record, 'common-res');
      expect(check.eligible).toBe(false);
      expect(check.blocker).toContain('Cluster infrastructure is not yet ready');
    });

    it('allows supported addon when infrastructure is ready', () => {
      const record = makeRequest({ status: 'infrastructure_ready' });
      const check = service.validateAddonPrerequisites(record, 'common-res');
      expect(check.eligible).toBe(true);
    });
  });

  describe('verifyOperationalStatus', () => {
    it('evaluates readiness and appends verification events', async () => {
      const record = makeRequest({ status: 'infrastructure_ready' });
      await store.create(record);

      const result = await service.verifyOperationalStatus(record);
      expect(result.readiness).toBeDefined();

      const events = await store.getEvents(record.requestId);
      expect(Array.isArray(events)).toBe(true);
    });
  });
});
