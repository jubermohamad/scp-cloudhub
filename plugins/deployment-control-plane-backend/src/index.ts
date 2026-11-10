import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { createControlPlaneRouter } from './router';
import { ControlPlaneService } from './services/controlPlaneService';
import { GitHubAuthorizationService } from './services/githubAuthorizationService';
import { GitHubRepositoryService } from './services/githubRepositoryService';

function githubTokenFromConfig(config?: {
  getOptionalConfigArray: (key: string) => Array<{
    getOptionalString: (key: string) => string | undefined;
    getString?: (key: string) => string;
  }> | undefined;
  getOptionalString: (key: string) => string | undefined;
}): string {
  const configToken =
    config
      ?.getOptionalConfigArray('integrations.github')
      ?.find((integration) => {
        const host = integration.getString?.('host');
        return host === 'github.com' || host === undefined;
      })
      ?.getOptionalString('token') ||
    process.env.GITHUB_PAT ||
    process.env.CLOUDHUB_GITHUB_TOKEN ||
    process.env.GITHUB_ACTIONS_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    '';

  return configToken;
}

function githubOrganizationFromConfig(config?: {
  getOptionalString: (key: string) => string | undefined;
}): string {
  return (
    config?.getOptionalString('github.organization') ||
    process.env.GITHUB_ORGANIZATION ||
    'SymphonySensa'
  );
}

const deploymentControlPlaneBackendPlugin = createBackendPlugin({
  pluginId: 'deployment-control-plane',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
      },
      async init({ httpRouter, httpAuth, userInfo, logger, config }) {
        const service = new ControlPlaneService(logger, config);
        await service.init();

        const gitHubAuthorizationService = new GitHubAuthorizationService({
          logger,
          config,
        });
        const gitHubRepositoryService = new GitHubRepositoryService({
          logger,
          token: githubTokenFromConfig(config),
          organization: githubOrganizationFromConfig(config),
          pool: service.getPool(),
        });

        const router = createControlPlaneRouter({
          logger,
          httpAuth,
          userInfo,
          service,
          gitHubAuthorizationService,
          gitHubRepositoryService,
        });

        httpRouter.use(
          router as unknown as Parameters<typeof httpRouter.use>[0],
        );
      },
    });
  },
});

export default deploymentControlPlaneBackendPlugin;

export {
  VmAuthorizationService,
  type VmAuthorizationResult,
} from './services/vmAuthorizationService';

export { GitHubRepositoryService } from './services/githubRepositoryService';
export {
  GitHubAuthorizationService,
  type GitHubAuthorizationResult,
} from './services/githubAuthorizationService';
