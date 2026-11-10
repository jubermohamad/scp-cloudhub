import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { DataExportDatabase } from './db';
import { createDataExportRouter } from './router';
import { ClusterSyncService } from './services/clusterSync';

/**
 * Data Export Hub control plane. Phase 1 stores export metadata and records
 * run requests only; it does not execute SQL or contact clusters.
 *
 * Routes are served under /api/data-export (the plugin id is `data-export`).
 */
const dataExportBackendPlugin = createBackendPlugin({
  pluginId: 'data-export',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, userInfo, logger }) {
        const db = DataExportDatabase.fromEnv(logger);
        if (!db) return;

        await db.migrate();

        const router = createDataExportRouter({
          logger,
          httpAuth,
          userInfo,
          db,
        });
        httpRouter.use(
          router as unknown as Parameters<typeof httpRouter.use>[0],
        );

        setTimeout(() => {
          const clusterSync = new ClusterSyncService(db, logger);
          clusterSync.run('system:startup').catch(err => {
            logger.warn(
              `[data-export-hub] Startup cluster sync warning: ${err.message}`,
            );
          });
        }, 5000);
      },
    });
  },
});

export default dataExportBackendPlugin;

/** Exposed for the scheduler plugin's and end-to-end tests. */
export { MIGRATIONS } from './migrations';
export { DataExportDatabase } from './db';
export { ClusterSyncService } from './services/clusterSync';
export { createDataExportRouter } from './router';
