import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { createK8sHealthCheckRouter } from './createK8sHealthCheckRouter';

export const k8sHealthCheckPlugin = createBackendPlugin({
  pluginId: 'k8s-health-check',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      async init({ httpRouter, logger }) {
        const router = createK8sHealthCheckRouter({ logger });
        httpRouter.addAuthPolicy({
          path: '/api/k8s-health-check',
          allow: 'unauthenticated',
        });
        httpRouter.use(
          router as unknown as Parameters<typeof httpRouter.use>[0],
        );
        logger.info('[k8s-health-check] Router registered');
      },
    });
  },
});

export default k8sHealthCheckPlugin;
