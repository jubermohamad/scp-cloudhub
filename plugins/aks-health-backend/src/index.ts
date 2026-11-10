import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { AksHealthDatabase } from './database';
import { createAksHealthRouter } from './router';

export * from './types';
export * from './database';
export * from './router';
export * from './services/CertificationEngine';
export * from './services/HealthScoreService';
export * from './services/AzureClientFactory';
export * from './services/KubernetesClientFactory';
export * from './checks/ControlPlaneCheck';
export * from './checks/NodeCheck';
export * from './checks/CapacityCheck';
export * from './checks/SystemPodsCheck';
export * from './checks/NetworkingCheck';
export * from './checks/StorageCheck';
export * from './checks/WorkloadCheck';
export * from './checks/CloudNativePgCheck';
export * from './checks/EventsCheck';
export * from './checks/SecurityCheck';
export * from './checks/ObservabilityCheck';
export * from './checks/BackupCheck';

export const aksHealthBackendPlugin = createBackendPlugin({
  pluginId: 'aks-health',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      async init({ httpRouter, logger }) {
        const db = AksHealthDatabase.fromEnv(logger);
        await db.init();

        const router = createAksHealthRouter({
          logger,
          db,
        });

        httpRouter.use(
          router as unknown as Parameters<typeof httpRouter.use>[0],
        );
        logger.info('[aks-health] Backend plugin initialized and router registered at /api/aks-health');
      },
    });
  },
});

export default aksHealthBackendPlugin;
