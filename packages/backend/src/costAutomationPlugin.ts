/**
 * costAutomationPlugin.ts
 *
 * Backstage backend plugin: Cost Automation for Azure AKS
 * All route logic lives in createCostAutomationRouter.ts (testable).
 * This file only wires the router into the Backstage plugin framework.
 */

import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import {
  createCostAutomationRouter,
  onboardedClusters,
  clusterSchedules,
} from './createCostAutomationRouter';
import { ClusterStore } from './clusterStore';
import { TableStorageWriter } from './tableStorageWriter';

export const costAutomationPlugin = createBackendPlugin({
  pluginId: 'cost-automation',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, userInfo, logger }) {
        // Connect to PostgreSQL (if POSTGRES_HOST is set) and pre-populate
        // the in-memory maps so onboarded clusters and schedules survive restarts.
        const store = ClusterStore.fromEnv(logger);
        if (store) {
          await store.init();

          const persisted = await store.loadAll();
          for (const cluster of persisted) {
            onboardedClusters.set(cluster.clusterName, cluster);
          }
          logger.info(
            `[cost-automation] Loaded ${persisted.length} persisted cluster(s) from PostgreSQL`,
          );

          const persistedSchedules = await store.loadAllSchedules();
          for (const schedule of persistedSchedules) {
            clusterSchedules.set(schedule.clusterName, schedule);
          }
          logger.info(
            `[cost-automation] Loaded ${persistedSchedules.length} schedule(s) from PostgreSQL`,
          );
        }

        // ── IMPORTANT ──────────────────────────────────────────────────────────
        // Backstage is the schedule *configuration* layer, NOT the executor.
        // The actual AKS stop/start actions are performed by the external
        // Azure Function timer trigger in azure-functions/aks-scheduler/.
        // That function reads GET /api/cost-automation/azure/aks/schedules
        // and GET /api/cost-automation/azure/aks/managed every 5 minutes and
        // calls the Azure ARM API directly.  Never add a setInterval here.
        // ──────────────────────────────────────────────────────────────────────

        const router = createCostAutomationRouter({
          logger,
          store: store ?? undefined,
          tableStorageWriter: new TableStorageWriter(logger),
          httpAuth,
          userInfo,
        });
        // The external Azure Function (azure-functions/aks-scheduler) polls the
        // AKS schedule endpoints without a Backstage JWT, so those stay open.
        // Everything else — notably /cloud/vms, which deallocates real VMs —
        // requires a verified Backstage user identity.
        httpRouter.addAuthPolicy({
          path: '/azure/aks',
          allow: 'unauthenticated',
        });
        httpRouter.use(
          router as unknown as Parameters<typeof httpRouter.use>[0],
        );
      },
    });
  },
});
