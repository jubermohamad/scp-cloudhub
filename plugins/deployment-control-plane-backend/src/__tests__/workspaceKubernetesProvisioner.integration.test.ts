import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  KubernetesWorkspaceProvisioner,
  type ProvisionWorkspaceInput,
  type WorkspaceKubernetesResources,
} from '../services/workspaceKubernetesProvisioner';

const runIntegration = process.env.RUN_WORKSPACE_AKS_INTEGRATION === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

const mockLogger: LoggerService = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis() as any,
};

function buildResources(workspaceId: string): WorkspaceKubernetesResources {
  return KubernetesWorkspaceProvisioner.resourceNames(workspaceId);
}

function buildInput(workspaceId: string): ProvisionWorkspaceInput {
  return {
    workspaceId,
    componentId: 'sri-investigation-api',
    developmentProfileId: 'node-api',
    resourceProfile: {
      id: 'MEDIUM',
      displayName: 'Medium',
      description: 'Balanced shared-team workload',
      cpuRequest: '500m',
      cpuLimit: '1000m',
      memoryRequest: '1Gi',
      memoryLimit: '2Gi',
      storageQuota: '10Gi',
    },
    image:
      process.env.WORKSPACE_INTEGRATION_IMAGE ??
      'companyacr.azurecr.io/cloudhub/dev/node:1.0.0',
    resources: buildResources(workspaceId),
  };
}

describeIntegration('KubernetesWorkspaceProvisioner real AKS lifecycle', () => {
  jest.setTimeout(10 * 60 * 1000);

  it('creates, stops, starts, and deletes a workspace while reusing the same PVC', async () => {
    const provisioner = new KubernetesWorkspaceProvisioner(mockLogger);
    const workspaceId = `it-${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const input = buildInput(workspaceId);

    let pvcUidBeforeStop: string | null = null;

    try {
      await expect(provisioner.validatePlatform()).resolves.toBeDefined();

      await provisioner.createWorkspace(input);
      const createdStatus = await provisioner.getWorkspaceStatus(
        input.resources,
      );
      expect(createdStatus.pvcExists).toBe(true);
      expect(createdStatus.pvcPhase).toBe('Bound');
      expect(createdStatus.podExists).toBe(true);
      expect(createdStatus.podPhase).toBe('Running');
      expect(createdStatus.podReady).toBe(true);
      expect(createdStatus.serviceAccountExists).toBe(true);
      pvcUidBeforeStop = createdStatus.pvcUid;

      await provisioner.stopWorkspace(input.resources);
      const stoppedStatus = await provisioner.getWorkspaceStatus(
        input.resources,
      );
      expect(stoppedStatus.podExists).toBe(false);
      expect(stoppedStatus.pvcExists).toBe(true);
      expect(stoppedStatus.serviceAccountExists).toBe(true);
      expect(stoppedStatus.pvcUid).toBe(pvcUidBeforeStop);

      await provisioner.startWorkspace(input);
      const startedStatus = await provisioner.getWorkspaceStatus(
        input.resources,
      );
      expect(startedStatus.podExists).toBe(true);
      expect(startedStatus.podPhase).toBe('Running');
      expect(startedStatus.podReady).toBe(true);
      expect(startedStatus.pvcExists).toBe(true);
      expect(startedStatus.pvcUid).toBe(pvcUidBeforeStop);

      await provisioner.deleteWorkspace(input.resources);
      const deletedStatus = await provisioner.getWorkspaceStatus(
        input.resources,
      );
      expect(deletedStatus.podExists).toBe(false);
      expect(deletedStatus.pvcExists).toBe(false);
      expect(deletedStatus.serviceAccountExists).toBe(false);
    } finally {
      await provisioner.deleteWorkspace(input.resources);
    }
  });
});
