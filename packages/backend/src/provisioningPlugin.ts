/**
 * provisioningPlugin.ts
 *
 * Backstage backend plugin for AKS cluster provisioning.
 * Registers the provisioning router endpoints with the Backstage framework.
 */

import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { createProvisioningRouter } from './createProvisioningRouter';
import { InfrastructureRequestStore } from './services/InfrastructureRequestStore';
import {
  BASE_BRANCH,
  INFRA_REPOSITORY,
  InfrastructureProvisioningService,
  WORKSPACES_FILE,
} from './services/InfrastructureProvisioningService';
import { AksExecutionTracker } from './services/AksExecutionTracker';
import {
  RepositoryAddressInventory,
  evaluateSubmissionGates,
} from './services/aksSubmissionGates';
import { buildReadOnlyIntegrations } from './services/aksReadOnlyIntegrations';
import {
  JumpboxAccessProvisioningService,
  type JumpboxAccessConfig,
} from './services/JumpboxAccessProvisioningService';
import { PlatformRegistryUpdater } from './services/PlatformRegistryUpdater';
import {
  aksApproveCloudArchitectPermission,
  aksApproveOperationsPermission,
  jumpboxApprovePermission,
} from './permissions';

export const provisioningPlugin = createBackendPlugin({
  pluginId: 'provisioning',
  register(env) {
    env.registerInit({
      deps: {
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        permissions: coreServices.permissions,
        permissionsRegistry: coreServices.permissionsRegistry,
        scheduler: coreServices.scheduler,
      },
      async init({
        httpRouter,
        httpAuth,
        logger,
        config,
        permissions,
        permissionsRegistry,
        scheduler,
      }) {
        logger.info('[provisioning] Initializing provisioning plugin');

        permissionsRegistry.addPermissions([
          jumpboxApprovePermission,
          aksApproveCloudArchitectPermission,
          aksApproveOperationsPermission,
        ]);

        // Persist CloudHub Infrastructure Requests so pending approvals and
        // provisioning state survive backend restarts. Falls back to an
        // in-memory store when POSTGRES_HOST is not configured.
        const store = InfrastructureRequestStore.fromEnv(logger);
        await store.init();

        // Tailscale policy repository is configuration-driven (app-config:
        // provisioning.tailscale) with env/defaults as fallback.
        const tsConfig = config.getOptionalConfig('provisioning.tailscale');
        const jumpboxConfig: Partial<JumpboxAccessConfig> = {
          owner: tsConfig?.getOptionalString('owner'),
          repo: tsConfig?.getOptionalString('repo'),
          baseBranch: tsConfig?.getOptionalString('baseBranch'),
          policyPath: tsConfig?.getOptionalString('policyPath'),
          commitAuthorName: tsConfig?.getOptionalString('commitAuthor.name'),
          commitAuthorEmail: tsConfig?.getOptionalString('commitAuthor.email'),
          autoMergeEnabled: config.getOptionalBoolean(
            'provisioning.github.autoMerge.enabled',
          ),
          autoMergeMethod: config.getOptionalString(
            'provisioning.github.autoMerge.method',
          ),
        };
        const jumpboxService = new JumpboxAccessProvisioningService(
          logger,
          jumpboxConfig,
        );
        const registry = PlatformRegistryUpdater.fromEnv(logger);
        // No auto-merge configuration is passed: the infrastructure PR is
        // merged only by a maintainer (provisioning.github.autoMerge applies to
        // the Tailscale policy PR alone).
        const infrastructureService = new InfrastructureProvisioningService(
          logger,
        );

        // ── Read-only integrations (execution tracking + submission gates) ──
        // Credentials are selected in aksReadOnlyIntegrations.ts: read tokens
        // only, never the write-capable GitHub / TFC tokens.
        const integrations = buildReadOnlyIntegrations();
        const githubReader = integrations.github;
        const tfcReader = integrations.tfc;
        const azureReader = integrations.azure;
        for (const problem of integrations.problems) {
          logger.warn(`[provisioning] ${problem}`);
        }
        logger.info(
          `[provisioning] read-only integrations: github=${
            githubReader ? 'configured' : 'missing'
          } tfc=${tfcReader ? 'configured' : 'missing'} azure=${
            azureReader ? 'configured' : 'missing'
          }`,
        );

        const inventory = githubReader
          ? new RepositoryAddressInventory(
              githubReader,
              INFRA_REPOSITORY,
              BASE_BRANCH,
            )
          : null;
        const productionSubmissionsEnabled =
          config.getOptionalBoolean(
            'provisioning.aks.productionSubmissions.enabled',
          ) ?? false;
        const tailscaleRepository = `${jumpboxService.repo.owner}/${jumpboxService.repo.repo}`;

        const tracker = new AksExecutionTracker({
          store,
          logger,
          github: githubReader,
          tfc: tfcReader,
          infraRepository: INFRA_REPOSITORY,
          workspacesFile: WORKSPACES_FILE,
          baseBranch: BASE_BRANCH,
        });

        const router = createProvisioningRouter({
          logger,
          httpAuth,
          store,
          service: infrastructureService,
          jumpboxService,
          registry,
          permissions,
          tracker,
          submissionGates: (request, approvalChain) =>
            evaluateSubmissionGates(request, approvalChain, {
              github: githubReader,
              githubWriteProbes: integrations.githubWriteProbes,
              azure: azureReader,
              inventory,
              repositories: {
                infra: INFRA_REPOSITORY,
                tailscale: tailscaleRepository,
              },
              baseBranch: BASE_BRANCH,
              productionSubmissionsEnabled,
              azureManagementGroup: integrations.azureManagementGroup,
            }),
        });

        // Resume tracking after restarts: every request in a tracked status is
        // re-observed from its persisted state. Global scope means one backend
        // instance runs it at a time.
        await scheduler.scheduleTask({
          id: 'provisioning-aks-execution-tracking',
          frequency: { seconds: 60 },
          timeout: { minutes: 5 },
          initialDelay: { seconds: 30 },
          scope: 'global',
          fn: async () => {
            const summary = await tracker.refreshAll();
            if (summary.checked > 0) {
              logger.info(
                `[provisioning] execution tracking: ${summary.checked} tracked, ${summary.refreshed} refreshed, ${summary.errors} with errors`,
              );
            }
          },
        });

        // Default Backstage auth policy applies: every route requires a user or
        // service token, and mutating routes additionally resolve the calling
        // user (and the jumpbox.approve permission for decisions) themselves.
        httpRouter.use(
          router as unknown as Parameters<typeof httpRouter.use>[0],
        );

        logger.info('[provisioning] Provisioning router registered');
      },
    });
  },
});

export default provisioningPlugin;
