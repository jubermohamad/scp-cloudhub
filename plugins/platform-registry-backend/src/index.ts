import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { PlatformRegistryDatabase } from './db';
import { createPlatformRegistryRouter } from './router';

const platformRegistryBackendPlugin = createBackendPlugin({
  pluginId: 'platform-registry',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, userInfo, logger }) {
        const db = PlatformRegistryDatabase.fromEnv(logger);
        if (!db) {
          logger.warn(
            '[platform-registry] Plugin not started because PostgreSQL environment variables are missing',
          );
          return;
        }

        await db.init();

        const router = createPlatformRegistryRouter({
          logger,
          httpAuth,
          userInfo,
          db,
        });

        httpRouter.use(
          router as unknown as Parameters<typeof httpRouter.use>[0],
        );
      },
    });
  },
});

export default platformRegistryBackendPlugin;
