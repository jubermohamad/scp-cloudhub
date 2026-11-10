import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { TenantRegistryDatabase } from './db';
import { createTenantRegistryRouter } from './router';

const tenantRegistryBackendPlugin = createBackendPlugin({
  pluginId: 'tenant-registry',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, userInfo, auth, discovery, logger }) {
        const db = TenantRegistryDatabase.fromEnv(logger);
        if (!db) {
          logger.warn(
            '[tenant-registry] Plugin not started because PostgreSQL environment variables are missing',
          );
          return;
        }

        await db.init();

        const router = createTenantRegistryRouter({
          logger,
          httpAuth,
          userInfo,
          auth,
          discovery,
          db,
        });

        httpRouter.use(
          router as unknown as Parameters<typeof httpRouter.use>[0],
        );
      },
    });
  },
});

export default tenantRegistryBackendPlugin;
