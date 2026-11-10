/**
 * createCostAutomationRouter.ts
 *
 * Factory that returns a configured Express Router for the cost automation
 * plugin. Extracted from costAutomationPlugin.ts so it can be imported and
 * tested independently with supertest (no Backstage framework needed).
 */

import { Router, json as expressJson, type Request } from 'express';
import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  fetchClusterDetail,
  fetchNodePools,
  discoverClusters,
  triggerClusterLifecycle,
  patchNodePoolCount,
  assignClusterUserRole,
} from './aksDiscoveryService';
import { buildNodePodMap } from './aksKubernetesService';
import {
  looksLikeProduction,
  planLifecycleAction,
  heuristicValidationChecks,
  ALLOWED_ENVIRONMENTS,
  type ValidationCheck,
} from './costAutomationHelpers';
import type {
  AksAuthMode,
  AksEnvironment,
  LifecycleAction,
  LifecycleActionRequest,
  OnboardedCluster,
  OnboardingCapability,
  ClusterSchedule,
  RecordExecutionRequest,
  ScheduledAction,
  ExecutionResult,
} from './costAutomationTypes';
import type { ClusterStore } from './clusterStore';
import { TableStorageWriter } from './tableStorageWriter';
import { AzureVmService } from './azureVmService';
import { VmAuthorizationService } from '@internal/plugin-deployment-control-plane-backend';
import type {
  HttpAuthService,
  UserInfoService,
} from '@backstage/backend-plugin-api';

// ─── Module-level in-memory stores ─────────────────────────────────────────────────────
// Exported so tests can inspect / reset between runs.

export const onboardedClusters = new Map<string, OnboardedCluster>();
/** Daily schedules keyed by clusterName. Loaded from PostgreSQL on startup. */
export const clusterSchedules = new Map<string, ClusterSchedule>();

const ONBOARD_CAPABILITIES: OnboardingCapability[] = [
  'start',
  'stop',
  'downsize',
];

// ─── Router factory ───────────────────────────────────────────────────────────

export interface RouterDeps {
  logger: LoggerService;
  /** PostgreSQL-backed persistence. Omit in tests to stay fully in-memory. */
  store?: ClusterStore;
  /**
   * Write-only Azure Table Storage client. When configured, every schedule
   * mutation is mirrored to Table Storage so the Azure Function can read it.
   */
  tableStorageWriter?: TableStorageWriter;
  /** Injectable for testing: replace with mocks. */
  _fetchClusterDetail?: typeof fetchClusterDetail;
  _fetchNodePools?: typeof fetchNodePools;
  _discoverClusters?: typeof discoverClusters;
  _buildNodePodMap?: typeof buildNodePodMap;
  _triggerClusterLifecycle?: typeof triggerClusterLifecycle;
  _patchNodePoolCount?: typeof patchNodePoolCount;
  _assignClusterUserRole?: typeof assignClusterUserRole;
  /** Live Azure VM inventory/power control. Inject a fake in tests. */
  _azureVmService?: AzureVmService;
  /** Required for VM power control; without it those routes deny everyone. */
  httpAuth?: HttpAuthService;
  userInfo?: UserInfoService;
  _vmAuthorizationService?: VmAuthorizationService;
}

type CloudProvider = 'azure' | 'aws' | 'gcp';

interface AksClusterCostNodePool {
  name: string;
  mode: 'System' | 'User';
  vmSize: string;
  nodeCount: number;
  hourlyRateUsd: number;
  monthlyCostUsd: number;
  costModel: 'catalog' | 'default';
}

interface AksClusterCostRecord {
  clusterName: string;
  resourceGroup: string;
  location: string;
  powerState: 'Running' | 'Stopped' | 'Unknown';
  monthlyCostUsd: number;
  nodePools: AksClusterCostNodePool[];
  unavailableReason?: string;
}

const AZURE_VM_HOURLY_USD: Record<string, number> = {
  standard_d2s_v3: 0.096,
  standard_d4s_v3: 0.192,
  standard_d8s_v3: 0.384,
  standard_d2s_v5: 0.086,
  standard_d4s_v5: 0.172,
  standard_d8s_v5: 0.344,
  standard_e2s_v5: 0.126,
  standard_e4s_v5: 0.252,
  standard_e8s_v5: 0.504,
  standard_b2s: 0.0416,
  standard_b4ms: 0.166,
  standard_f4s_v2: 0.169,
};

const DEFAULT_AZURE_VM_HOURLY_USD = 0.2;
const MONTHLY_HOURS = 730;
const CLOUDHUB_ENABLED_TAG = 'cloudhub-enabled';
const CLOUDHUB_ONBOARDED_TAG = 'cloudhub-onboarded';

function normalizeTagMap(tags: Record<string, string> | undefined) {
  if (!tags) return {} as Record<string, string>;
  return Object.entries(tags).reduce<Record<string, string>>((acc, entry) => {
    const [rawKey, rawValue] = entry;
    acc[rawKey.trim().toLowerCase()] = String(rawValue ?? '').trim();
    return acc;
  }, {});
}

function isTrueLike(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}

function isCloudHubOnboardedCluster(tags: Record<string, string> | undefined) {
  const normalized = normalizeTagMap(tags);
  return (
    isTrueLike(normalized[CLOUDHUB_ENABLED_TAG]) &&
    isTrueLike(normalized[CLOUDHUB_ONBOARDED_TAG])
  );
}

function resolveAksVmHourlyRate(vmSize: string): {
  hourlyRateUsd: number;
  costModel: 'catalog' | 'default';
} {
  const normalized = vmSize.trim().toLowerCase();
  const hourlyRateUsd = AZURE_VM_HOURLY_USD[normalized];
  if (typeof hourlyRateUsd === 'number') {
    return { hourlyRateUsd, costModel: 'catalog' };
  }
  return { hourlyRateUsd: DEFAULT_AZURE_VM_HOURLY_USD, costModel: 'default' };
}

// ─── Error message helper ────────────────────────────────────────────────────

/**
 * Extract a human-readable message from Azure / network errors.
 * Azure AADSTS errors are very long; we pull just the core description.
 */
function extractAzureError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Azure Identity v4 MSAL format:
  //   "invalid_request: Error(s): 90002 - ... - Description: AADSTS90002: Tenant '...' not found. - Trace ID: ..."
  // The old regex used [^-\n] which incorrectly excluded hyphens present in tenant GUIDs.
  const descMatch = raw.match(
    /Description:\s*(AADSTS\d+:[^\r\n]+?)(?:\s*-\s*Trace\s+ID:|[\r\n]|$)/,
  );
  if (descMatch) return descMatch[1].trim();
  // Bare AADSTS code without a "Description:" prefix
  const directMatch = raw.match(/(AADSTS\d+:[^\r\n]{1,200})/);
  if (directMatch) return directMatch[1].trim();
  // Azure HTTP error from azureGet: "Azure API returned HTTP 4xx: ..."
  const httpMatch = raw.match(/^(Azure API returned HTTP \d+:[^\n]{0,120})/);
  if (httpMatch) return httpMatch[1].trim();
  return raw.length > 200 ? `${raw.substring(0, 200)}…` : raw;
}

export function createCostAutomationRouter(deps: RouterDeps): Router {
  const {
    logger,
    store,
    tableStorageWriter,
    _fetchClusterDetail: doFetchClusterDetail = fetchClusterDetail,
    _fetchNodePools: doFetchNodePools = fetchNodePools,
    _discoverClusters: doDiscoverClusters = discoverClusters,
    _buildNodePodMap: doBuildNodePodMap = buildNodePodMap,
    _triggerClusterLifecycle:
      doTriggerClusterLifecycle = triggerClusterLifecycle,
    _patchNodePoolCount: doPatchNodePoolCount = patchNodePoolCount,
    _assignClusterUserRole: doAssignClusterUserRole = assignClusterUserRole,
    _azureVmService,
    _vmAuthorizationService,
    httpAuth,
    userInfo,
  } = deps;

  const router = Router();
  router.use(expressJson());

  const azureVmService = _azureVmService ?? new AzureVmService(logger);
  const vmAuth = _vmAuthorizationService ?? new VmAuthorizationService(logger);

  function vmSubscriptionId(req: Request): string {
    return (
      String(req.query.subscriptionId ?? '').trim() ||
      String(process.env.AZURE_SUBSCRIPTION_ID ?? '').trim()
    );
  }

  function vmResourceGroupScope(req: Request): string {
    const queryValue = String(req.query.resourceGroup ?? '').trim();
    if (queryValue) {
      return queryValue;
    }
    return String(process.env.CLOUDHUB_VM_MANAGED_RESOURCE_GROUP ?? '').trim();
  }

  async function ensureCloudHubTaggedCluster(input: {
    subscriptionId: string;
    resourceGroup?: string;
    clusterName: string;
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        status: number;
        error: string;
      }
  > {
    try {
      const clusters = await doDiscoverClusters(
        input.subscriptionId,
        input.resourceGroup ?? null,
        logger,
      );
      const list = Array.isArray(clusters) ? clusters : [];
      const cluster = list.find(
        c => c.clusterName.toLowerCase() === input.clusterName.toLowerCase(),
      );

      if (!cluster) {
        return {
          ok: false,
          status: 404,
          error: input.resourceGroup
            ? `Cluster "${input.clusterName}" was not found in resource group "${input.resourceGroup}".`
            : `Cluster "${input.clusterName}" was not found in subscription "${input.subscriptionId}".`,
        };
      }

      if (!isCloudHubOnboardedCluster(cluster.tags)) {
        return {
          ok: false,
          status: 403,
          error:
            'Cluster is not onboarded for CloudHub. Required tags: cloudhub-enabled=true and cloudhub-onboarded=true.',
        };
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        status: 502,
        error: `CloudHub onboarding validation failed: ${extractAzureError(error)}`,
      };
    }
  }

  /**
   * Resolves the caller from the verified Backstage identity and checks Entra
   * group membership. Fails closed when identity services are unavailable.
   */
  async function resolveVmAccess(req: Request): Promise<{
    authorized: boolean;
    actorRef: string;
    reason?: string;
  }> {
    if (!httpAuth || !userInfo) {
      logger.warn(
        '[cost-automation] VM power control requested but identity services are not wired; denying',
      );
      return {
        authorized: false,
        actorRef: 'unknown',
        reason: 'Identity services unavailable',
      };
    }

    try {
      const credentials = await httpAuth.credentials(
        req as unknown as Parameters<typeof httpAuth.credentials>[0],
        { allow: ['user'] },
      );
      const info = await userInfo.getUserInfo(credentials);
      const result = await vmAuth.isVmOperator({
        groups: info.ownershipEntityRefs ?? [],
        actorRef: info.userEntityRef,
      });
      return { authorized: result.authorized, actorRef: info.userEntityRef };
    } catch (error) {
      return {
        authorized: false,
        actorRef: 'unknown',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── GET /cloud/vms/permissions ──────────────────────────────────────────
  // UI visibility derives from this so it can never diverge from the gate
  // actually enforced on the action route.
  router.get('/cloud/vms/permissions', async (req, res) => {
    const access = await resolveVmAccess(req);
    res.json({
      authorized: access.authorized,
      actorRef: access.actorRef,
    });
  });

  // ── GET /cloud/vms?provider=azure|aws|gcp ───────────────────────────────
  router.get('/cloud/vms', async (req, res) => {
    const providerRaw = String(req.query.provider ?? '').toLowerCase();
    if (!providerRaw || !['azure', 'aws', 'gcp'].includes(providerRaw)) {
      res.status(400).json({
        error: 'provider query param must be one of: azure, aws, gcp',
      });
      return;
    }

    const provider = providerRaw as CloudProvider;
    const rbac = {
      azureRequiredRole: 'VM-Operators',
      note: 'Azure VM start/stop operations require the custom VM-Operators RBAC role.',
    };

    // AWS/GCP are not wired up yet; report explicitly rather than pretending.
    if (provider !== 'azure') {
      res.json({
        provider,
        vms: [],
        supported: false,
        message: `${provider.toUpperCase()} VM inventory is not supported yet. Only Azure is implemented.`,
        rbac,
        fetchedAt: new Date().toISOString(),
      });
      return;
    }

    const subscriptionId = vmSubscriptionId(req);
    if (!subscriptionId) {
      res.status(400).json({
        error:
          'subscriptionId query param or AZURE_SUBSCRIPTION_ID must be set to list Azure VMs',
      });
      return;
    }

    try {
      const resourceGroupScope = vmResourceGroupScope(req);
      const useResourceGroupScope = provider === 'azure' && !!resourceGroupScope;
      const vms = (
        await azureVmService.listVms(subscriptionId, {
          resourceGroupName: resourceGroupScope || undefined,
          includeAllInResourceGroup: useResourceGroupScope,
        })
      ).map(vm => ({
        provider,
        ...vm,
      }));
      res.json({
        provider,
        vms,
        supported: true,
        inventoryMode: useResourceGroupScope
          ? 'resource-group'
          : 'environment-tag',
        resourceGroupScope: resourceGroupScope || null,
        environmentFilter: useResourceGroupScope
          ? null
          : process.env.CLOUDHUB_VM_ALLOWED_ENV || 'dev',
        rbac,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(
        `[cost-automation] Azure VM listing failed: ${extractAzureError(error)}`,
      );
      res.status(502).json({
        error: `Azure VM listing failed: ${extractAzureError(error)}`,
      });
    }
  });

  // ── POST /cloud/vms/:provider/:vmName/action ────────────────────────────
  router.post('/cloud/vms/:provider/:vmName/action', async (req, res) => {
    const providerRaw = String(req.params.provider ?? '').toLowerCase();
    const vmName = String(req.params.vmName ?? '');
    const actionRaw = String(req.body?.action ?? '').toLowerCase();

    if (!['azure', 'aws', 'gcp'].includes(providerRaw)) {
      res
        .status(400)
        .json({ error: 'provider must be one of: azure, aws, gcp' });
      return;
    }

    if (!['start', 'stop'].includes(actionRaw)) {
      res.status(400).json({ error: 'action must be one of: start, stop' });
      return;
    }

    const provider = providerRaw as CloudProvider;
    const action = actionRaw as 'start' | 'stop';

    if (provider !== 'azure') {
      res.status(501).json({
        error: `${provider.toUpperCase()} VM actions are not supported yet. Only Azure is implemented.`,
      });
      return;
    }

    // Azure guard: verified Backstage identity + Entra group membership.
    const access = await resolveVmAccess(req);
    if (!access.authorized) {
      res.status(403).json({
        error: 'VM_ACCESS_DENIED',
        message:
          'You are not authorized to control virtual machines. Please contact the Cloud Platform team for access.',
        ...(access.reason ? { reason: access.reason } : {}),
      });
      return;
    }

    const subscriptionId = vmSubscriptionId(req);
    if (!subscriptionId) {
      res.status(400).json({
        error:
          'subscriptionId query param or AZURE_SUBSCRIPTION_ID must be set to control Azure VMs',
      });
      return;
    }

    try {
      const resourceGroupScope = vmResourceGroupScope(req);
      const useResourceGroupScope = !!resourceGroupScope;
      const vms = await azureVmService.listVms(subscriptionId, {
        resourceGroupName: resourceGroupScope || undefined,
        includeAllInResourceGroup: useResourceGroupScope,
      });
      const vm = vms.find(v => v.vmName === vmName);

      if (!vm) {
        res.status(404).json({
          error: useResourceGroupScope
            ? `VM "${vmName}" was not found for provider "${provider}" in resource group "${resourceGroupScope}"`
            : `VM "${vmName}" was not found for provider "${provider}"`,
        });
        return;
      }

      if (action === 'start' && vm.currentState === 'Running') {
        res.status(409).json({ error: `VM "${vm.vmName}" is already running` });
        return;
      }
      if (action === 'stop' && vm.currentState === 'Stopped') {
        res.status(409).json({ error: `VM "${vm.vmName}" is already stopped` });
        return;
      }

      if (action === 'start') {
        await azureVmService.startVm(
          subscriptionId,
          vm.resourceGroupName,
          vm.vmName,
        );
      } else {
        await azureVmService.stopVm(
          subscriptionId,
          vm.resourceGroupName,
          vm.vmName,
        );
      }

      logger.info(
        `[cost-automation] [AUDIT] action=${action}-vm actor="${access.actorRef}" provider="${provider}" vm="${vm.vmName}" rg="${vm.resourceGroupName}"`,
      );

      // Azure start/deallocate are long-running; report the requested transition.
      res.json({
        message: `${action === 'start' ? 'Start' : 'Stop'} requested for VM "${vm.vmName}"`,
        vm: {
          provider,
          ...vm,
          currentState: action === 'start' ? 'Running' : 'Stopped',
        },
        executedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(
        `[cost-automation] Azure VM ${action} failed for "${vmName}": ${extractAzureError(error)}`,
      );
      res.status(502).json({
        error: `Azure VM ${action} failed: ${extractAzureError(error)}`,
      });
    }
  });

  // ── GET /azure/aks/cost ────────────────────────────────────────────────
  // Estimates monthly AKS compute cost from node pools:
  // monthly = sum(nodeCount * vmHourlyRateUsd * 730)
  router.get('/azure/aks/cost', async (req, res) => {
    const subscriptionId =
      String(req.query.subscriptionId ?? '').trim() ||
      String(process.env.AZURE_SUBSCRIPTION_ID ?? '').trim();
    const resourceGroup = String(req.query.resourceGroup ?? '').trim() || null;
    const clusterNameFilter = String(req.query.clusterName ?? '')
      .trim()
      .toLowerCase();

    if (!subscriptionId) {
      res.status(400).json({
        error:
          'subscriptionId is required (query param or AZURE_SUBSCRIPTION_ID env var)',
      });
      return;
    }

    try {
      const discovered = await doDiscoverClusters(
        subscriptionId,
        resourceGroup,
        logger,
      );
      const cloudHubClusters = discovered.filter(cluster =>
        isCloudHubOnboardedCluster(cluster.tags),
      );
      const targetClusters = clusterNameFilter
        ? cloudHubClusters.filter(
            c => c.clusterName.toLowerCase() === clusterNameFilter,
          )
        : cloudHubClusters;

      if (clusterNameFilter && targetClusters.length === 0) {
        res.status(404).json({
          error: `Cluster "${clusterNameFilter}" not found for the requested scope`,
        });
        return;
      }

      const clusterCosts: AksClusterCostRecord[] = await Promise.all(
        targetClusters.map(async cluster => {
          try {
            const nodePools = await doFetchNodePools(
              subscriptionId,
              cluster.resourceGroup,
              cluster.clusterName,
              logger,
            );

            const runningCluster = cluster.powerState === 'Running';
            const poolCosts: AksClusterCostNodePool[] = nodePools.map(pool => {
              const { hourlyRateUsd, costModel } = resolveAksVmHourlyRate(
                pool.vmSize,
              );
              const runningPool =
                pool.powerState === 'Running' || pool.powerState === 'Unknown';
              const effectiveNodeCount =
                runningCluster && runningPool ? Math.max(pool.count, 0) : 0;
              const monthlyCostUsd = Number(
                (effectiveNodeCount * hourlyRateUsd * MONTHLY_HOURS).toFixed(2),
              );

              return {
                name: pool.name,
                mode: pool.mode,
                vmSize: pool.vmSize,
                nodeCount: pool.count,
                hourlyRateUsd,
                monthlyCostUsd,
                costModel,
              };
            });

            const monthlyCostUsd = Number(
              poolCosts
                .reduce((sum, pool) => sum + pool.monthlyCostUsd, 0)
                .toFixed(2),
            );

            return {
              clusterName: cluster.clusterName,
              resourceGroup: cluster.resourceGroup,
              location: cluster.location,
              powerState: cluster.powerState,
              monthlyCostUsd,
              nodePools: poolCosts,
            } as AksClusterCostRecord;
          } catch (err: unknown) {
            const reason = extractAzureError(err);
            logger.warn(
              `[cost-automation] [cost] cluster="${cluster.clusterName}" node pool cost calculation failed: ${reason}`,
            );
            return {
              clusterName: cluster.clusterName,
              resourceGroup: cluster.resourceGroup,
              location: cluster.location,
              powerState: cluster.powerState,
              monthlyCostUsd: 0,
              nodePools: [],
              unavailableReason: reason,
            } as AksClusterCostRecord;
          }
        }),
      );

      const totalMonthlyCostUsd = Number(
        clusterCosts.reduce((sum, c) => sum + c.monthlyCostUsd, 0).toFixed(2),
      );
      const clustersUsingDefaultRates = clusterCosts
        .flatMap(c => c.nodePools)
        .some(pool => pool.costModel === 'default');

      res.json({
        subscriptionId,
        resourceGroup,
        clusterCount: clusterCosts.length,
        totalMonthlyCostUsd,
        currency: 'USD',
        model: {
          monthlyHours: MONTHLY_HOURS,
          defaultVmHourlyRateUsd: DEFAULT_AZURE_VM_HOURLY_USD,
          note: 'Estimated node compute only. Does not include network, storage, control plane add-ons, taxes, or enterprise discounts.',
          usedDefaultRateForUnknownVmSize: clustersUsingDefaultRates,
        },
        clusters: clusterCosts.sort((a, b) =>
          a.clusterName.localeCompare(b.clusterName),
        ),
        fetchedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[cost-automation] [cost] ${msg}`);
      res
        .status(502)
        .json({ error: 'AKS cost calculation failed', details: msg });
    }
  });

  // ── GET /azure/aks/validate ──────────────────────────────────────────────
  router.get('/azure/aks/validate', async (req, res) => {
    const { clusterName, environment, resourceGroup } = req.query as {
      clusterName?: string;
      environment?: string;
      resourceGroup?: string;
    };
    const subscriptionId =
      (req.query.subscriptionId as string | undefined) ??
      process.env.AZURE_SUBSCRIPTION_ID;

    if (!clusterName || !environment) {
      res
        .status(400)
        .json({ error: 'clusterName and environment are required' });
      return;
    }

    logger.info(
      `[cost-automation] [validate] cluster="${clusterName}" env="${environment}"`,
    );

    const hasCreds = !!process.env.AZURE_CLIENT_ID;

    let checks: ValidationCheck[];

    if (!hasCreds) {
      // No Azure credentials configured — use name/env heuristics only
      checks = heuristicValidationChecks(clusterName, environment);
      res.json({ checks });
      return;
    }

    const envAllowed = ALLOWED_ENVIRONMENTS.has(
      environment.toLowerCase() as AksEnvironment,
    );

    // Resolve effective resource group: use supplied value or auto-discover
    let effectiveRg = resourceGroup;
    if (!effectiveRg) {
      logger.info(
        `[cost-automation] [validate] No resourceGroup supplied — auto-discovering for cluster="${clusterName}"`,
      );
      try {
        const allClusters = await doDiscoverClusters(
          subscriptionId ?? '',
          null,
          logger,
        );
        const found = allClusters.find(
          c => c.clusterName.toLowerCase() === clusterName.toLowerCase(),
        );
        if (found) {
          effectiveRg = found.resourceGroup;
          logger.info(
            `[cost-automation] [validate] Auto-discovered resourceGroup="${effectiveRg}"`,
          );
        } else {
          // Cluster genuinely not in subscription
          res.json({
            checks: [
              {
                label: 'Cluster exists',
                passed: false,
                reason: `"${clusterName}" not found in subscription`,
              },
              {
                label: 'Environment allowed (Dev / QA only)',
                passed: envAllowed,
              },
              { label: 'System node pool found', passed: false },
              { label: 'User node pool found', passed: false },
              { label: 'System node pool lifecycle eligible', passed: false },
              { label: 'AKS auth mode supported', passed: false },
            ],
          });
          return;
        }
      } catch (err: unknown) {
        const azureErr = extractAzureError(err);
        logger.warn(
          `[cost-automation] [validate] Auto-discovery failed: ${azureErr}`,
        );
        res.json({
          checks: [
            {
              label: 'Cluster exists',
              passed: false,
              reason: `Azure error: ${azureErr}`,
            },
            {
              label: 'Environment allowed (Dev / QA only)',
              passed: envAllowed,
            },
            {
              label: 'System node pool found',
              passed: false,
              reason: 'Blocked by discovery failure',
            },
            {
              label: 'User node pool found',
              passed: false,
              reason: 'Blocked by discovery failure',
            },
            {
              label: 'System node pool lifecycle eligible',
              passed: false,
              reason: 'Blocked by discovery failure',
            },
            {
              label: 'AKS auth mode supported',
              passed: false,
              reason: 'Blocked by discovery failure',
            },
          ],
        });
        return;
      }
    }

    // Full live validation — we now have effectiveRg
    let powerState: 'Running' | 'Stopped' | 'Unknown' = 'Unknown';
    checks = [
      { label: 'Cluster exists', passed: false },
      { label: 'Environment allowed (Dev / QA only)', passed: envAllowed },
      { label: 'System node pool found', passed: false },
      { label: 'User node pool found', passed: false },
      { label: 'System node pool lifecycle eligible', passed: false },
      { label: 'AKS auth mode supported', passed: false },
    ];

    try {
      const detail = await doFetchClusterDetail(
        subscriptionId!,
        effectiveRg,
        clusterName,
        logger,
      );
      checks[0].passed = true;
      checks[2].passed = detail.nodePools.some(p => p.mode === 'System');
      checks[3].passed = detail.nodePools.some(p => p.mode === 'User');
      const systemPools = detail.nodePools.filter(p => p.mode === 'System');
      checks[4].passed =
        systemPools.length > 0 &&
        systemPools.every(p => Math.max(p.minCount ?? 1, 1) >= 1);
      checks[5].passed =
        detail.authMode === 'local' || detail.authMode === 'azureRBAC';
      logger.info(
        `[cost-automation] [validate] Detected AKS auth mode for "${clusterName}": ${detail.authMode}`,
      );
      powerState = detail.powerState;
    } catch (err: unknown) {
      const azureErr = extractAzureError(err);
      logger.warn(
        `[cost-automation] [validate] Live check failed: ${azureErr}`,
      );
      checks[0] = { label: 'Cluster exists', passed: false, reason: azureErr };
    }

    res.json({ checks, powerState });
  });

  // ── POST /azure/aks/onboard ────────────────────────────────────────────
  router.post('/azure/aks/onboard', async (req, res) => {
    const {
      clusterName,
      environment,
      resourceGroup = '',
      includeSystemNodePools = false,
    } = req.body as {
      clusterName?: string;
      environment?: string;
      resourceGroup?: string;
      includeSystemNodePools?: boolean;
    };
    const subscriptionId: string =
      (req.body as { subscriptionId?: string }).subscriptionId ??
      process.env.AZURE_SUBSCRIPTION_ID ??
      '';

    if (!clusterName || !environment) {
      res
        .status(400)
        .json({ message: 'clusterName and environment are required' });
      return;
    }

    const env = environment.toLowerCase() as AksEnvironment;

    if (!ALLOWED_ENVIRONMENTS.has(env)) {
      logger.warn(
        `[cost-automation] [BLOCKED] cluster="${clusterName}" env="${env}" — env not allowed`,
      );
      res.status(403).json({
        message: `Environment "${environment}" is not allowed. Only dev and qa clusters can be onboarded.`,
      });
      return;
    }

    if (looksLikeProduction(clusterName)) {
      logger.warn(
        `[cost-automation] [BLOCKED] cluster="${clusterName}" — name matches production pattern`,
      );
      res.status(403).json({
        message: `Cluster "${clusterName}" appears to be a production cluster. Production clusters cannot be onboarded.`,
      });
      return;
    }

    if (!subscriptionId) {
      res.status(400).json({
        message:
          'subscriptionId is required to validate CloudHub onboarding tags.',
      });
      return;
    }

    if (onboardedClusters.has(clusterName)) {
      res.status(409).json({
        message: `Cluster "${clusterName}" is already onboarded.`,
        cluster: onboardedClusters.get(clusterName),
      });
      return;
    }

    const gate = await ensureCloudHubTaggedCluster({
      subscriptionId,
      resourceGroup,
      clusterName,
    });
    if (!gate.ok) {
      res.status(gate.status).json({ message: gate.error });
      return;
    }

    logger.info(
      `[cost-automation] [onboard] Starting — cluster="${clusterName}" env="${env}"`,
    );

    // Detect auth mode and power state via live Azure call when subscriptionId and resourceGroup are available.
    // Falls back to defaults without failing the onboard if detection is not possible.
    let detectedAuthMode: AksAuthMode = 'local';
    let detectedPowerState: 'Running' | 'Stopped' | 'Unknown' = 'Unknown';
    if (subscriptionId && resourceGroup) {
      try {
        const detail = await doFetchClusterDetail(
          subscriptionId,
          resourceGroup,
          clusterName,
          logger,
        );
        detectedAuthMode = detail.authMode;
        detectedPowerState = detail.powerState;
        logger.info(
          `[cost-automation] [onboard] Detected auth mode="${detectedAuthMode}" powerState="${detectedPowerState}" for cluster="${clusterName}"`,
        );
      } catch {
        logger.warn(
          `[cost-automation] [onboard] Auth mode detection failed for cluster="${clusterName}" — defaulting to local`,
        );
      }
    }

    if (detectedAuthMode === 'azureRBAC') {
      logger.info(
        `[cost-automation] [onboard] Cluster "${clusterName}" uses Azure RBAC — skipping Kubernetes RBAC binding`,
      );
    } else {
      logger.info(
        `[cost-automation] [onboard] Cluster "${clusterName}" uses local RBAC — Kubernetes RBAC binding would be applied`,
      );
    }

    const record: OnboardedCluster = {
      clusterName,
      resourceGroup,
      subscriptionId,
      environment: env,
      includeSystemNodePools,
      authMode: detectedAuthMode,
      powerState: detectedPowerState,
      status: 'ONBOARDED',
      capabilities: [...ONBOARD_CAPABILITIES],
      onboardedAt: new Date().toISOString(),
    };

    onboardedClusters.set(clusterName, record);
    // Persist to PostgreSQL so the record survives container restarts.
    void store?.upsert(record);

    logger.info(
      `[cost-automation] [AUDIT] action=onboard cluster="${clusterName}" env="${env}" ` +
        `capabilities=${record.capabilities.join(',')} at=${
          record.onboardedAt
        }`,
    );

    // ── RBAC assignment step ────────────────────────────────────────────────
    // Assign "Azure Kubernetes Service Cluster User Role" to the backend SP on
    // this cluster so listClusterUserCredentials succeeds (enables pod/node map).
    type RbacResult = {
      assigned: boolean;
      alreadyExisted: boolean;
      skipped: boolean;
      error: string | null;
    };
    let rbacAssignment: RbacResult;
    const principalObjectId = process.env.AZURE_OBJECT_ID;

    if (principalObjectId && subscriptionId && resourceGroup) {
      try {
        const { alreadyExisted } = await doAssignClusterUserRole(
          subscriptionId,
          resourceGroup,
          clusterName,
          principalObjectId,
          logger,
        );
        rbacAssignment = {
          assigned: true,
          alreadyExisted,
          skipped: false,
          error: null,
        };
        logger.info(
          `[cost-automation] [onboard] RBAC assignment ${
            alreadyExisted ? 'already existed' : 'applied'
          } for cluster="${clusterName}"`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `[cost-automation] [onboard] RBAC assignment failed for cluster="${clusterName}": ${msg}`,
        );
        rbacAssignment = {
          assigned: false,
          alreadyExisted: false,
          skipped: false,
          error: msg,
        };
      }
    } else {
      let reason: string;
      if (!principalObjectId) {
        reason = 'AZURE_OBJECT_ID is not configured';
      } else if (!subscriptionId) {
        reason = 'subscriptionId not provided';
      } else {
        reason = 'resourceGroup not provided';
      }
      logger.info(
        `[cost-automation] [onboard] RBAC assignment skipped for cluster="${clusterName}": ${reason}`,
      );
      rbacAssignment = {
        assigned: false,
        alreadyExisted: false,
        skipped: true,
        error: null,
      };
    }

    res.status(201).json({
      message: `Cluster "${clusterName}" is now managed by the Cost Automation Engine.`,
      cluster: record,
      rbacAssignment,
    });
  });

  // ── GET /azure/aks/managed ───────────────────────────────────────────────
  router.get('/azure/aks/managed', async (_req, res) => {
    const clusters = Array.from(onboardedClusters.values());
    const eligible: OnboardedCluster[] = [];

    for (const cluster of clusters) {
      if (!cluster.subscriptionId || !cluster.resourceGroup) continue;
      const gate = await ensureCloudHubTaggedCluster({
        subscriptionId: cluster.subscriptionId,
        resourceGroup: cluster.resourceGroup,
        clusterName: cluster.clusterName,
      });
      if (gate.ok) {
        eligible.push(cluster);
      }
    }

    res.json({ clusters: eligible });
  });

  // ── DELETE /azure/aks/:clusterName/offboard ──────────────────────────────
  router.delete('/azure/aks/:clusterName/offboard', async (req, res) => {
    const { clusterName } = req.params;

    if (!onboardedClusters.has(clusterName)) {
      res.status(404).json({
        error: `Cluster "${clusterName}" is not onboarded.`,
      });
      return;
    }

    onboardedClusters.delete(clusterName);
    await store?.remove(clusterName);

    const offboardedAt = new Date().toISOString();
    logger.info(
      `[cost-automation] [AUDIT] action=offboard cluster="${clusterName}" at=${offboardedAt}`,
    );

    res.json({
      message: `Cluster "${clusterName}" has been offboarded and is no longer managed by the Cost Automation Engine.`,
      clusterName,
      offboardedAt,
    });
  });

  // ── GET /azure/aks/discover ──────────────────────────────────────────────
  router.get('/azure/aks/discover', async (req, res) => {
    const { subscriptionId, resourceGroup } = req.query as {
      subscriptionId?: string;
      resourceGroup?: string;
    };

    if (!subscriptionId) {
      res.status(400).json({ error: 'subscriptionId is required' });
      return;
    }

    try {
      const clusters = await doDiscoverClusters(
        subscriptionId,
        resourceGroup ?? null,
        logger,
      );
      const onboardedOnly = clusters.filter(cluster =>
        isCloudHubOnboardedCluster(cluster.tags),
      );
      res.json({
        subscriptionId,
        resourceGroup: resourceGroup ?? null,
        clusters: onboardedOnly,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[cost-automation] [discover] ${msg}`);
      res.status(502).json({ error: 'Azure discovery failed', details: msg });
    }
  });

  // ── GET /azure/aks/:clusterName/nodepools ────────────────────────────────
  router.get('/azure/aks/:clusterName/nodepools', async (req, res) => {
    const { clusterName } = req.params;
    const { subscriptionId, resourceGroup } = req.query as {
      subscriptionId?: string;
      resourceGroup?: string;
    };

    if (!subscriptionId || !resourceGroup) {
      res
        .status(400)
        .json({ error: 'subscriptionId and resourceGroup are required' });
      return;
    }

    try {
      const gate = await ensureCloudHubTaggedCluster({
        subscriptionId,
        resourceGroup,
        clusterName,
      });
      if (!gate.ok) {
        res.status(gate.status).json({ error: gate.error });
        return;
      }

      const nodePools = await doFetchNodePools(
        subscriptionId,
        resourceGroup,
        clusterName,
        logger,
      );
      res.json({ clusterName, nodePools, fetchedAt: new Date().toISOString() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        `[cost-automation] [nodepools] cluster="${clusterName}" ${msg}`,
      );
      res.status(502).json({ error: 'Node pool fetch failed', details: msg });
    }
  });

  // ── GET /azure/aks/:clusterName/pods ─────────────────────────────────────
  router.get('/azure/aks/:clusterName/pods', async (req, res) => {
    const { clusterName } = req.params;
    const { kubeConfigBase64, subscriptionId, resourceGroup } = req.query as {
      kubeConfigBase64?: string;
      subscriptionId?: string;
      resourceGroup?: string;
    };

    const onboarded = onboardedClusters.get(clusterName);
    const resolvedSubscriptionId =
      (subscriptionId && subscriptionId.trim()) ||
      (onboarded?.subscriptionId && onboarded.subscriptionId.trim()) ||
      process.env.AZURE_SUBSCRIPTION_ID;
    const resolvedResourceGroup =
      (resourceGroup && resourceGroup.trim()) ||
      (onboarded?.resourceGroup && onboarded.resourceGroup.trim());

    // When no kubeconfig is supplied, Azure credential lookup needs both values.
    if (
      !kubeConfigBase64 &&
      (!resolvedSubscriptionId || !resolvedResourceGroup)
    ) {
      res.status(400).json({
        error:
          'resourceGroup and subscriptionId are required when kubeConfigBase64 is not provided',
      });
      return;
    }

    try {
      if (!resolvedSubscriptionId || !resolvedResourceGroup) {
        res.status(400).json({
          error:
            'subscriptionId and resourceGroup are required for CloudHub onboarding validation',
        });
        return;
      }

      const gate = await ensureCloudHubTaggedCluster({
        subscriptionId: resolvedSubscriptionId,
        resourceGroup: resolvedResourceGroup,
        clusterName,
      });
      if (!gate.ok) {
        res.status(gate.status).json({ error: gate.error });
        return;
      }

      const map = await doBuildNodePodMap(
        clusterName,
        logger,
        kubeConfigBase64,
        resolvedSubscriptionId,
        resolvedResourceGroup,
      );
      res.json(map);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[cost-automation] [pods] cluster="${clusterName}" ${msg}`);
      let guidance: string | undefined;
      let code = 'NODE_MAP_FETCH_FAILED';

      if (
        /AuthorizationFailed|listClusterUserCredentials|listClusterAdminCredentials/i.test(
          msg,
        )
      ) {
        code = 'AKS_CREDENTIALS_RBAC_MISSING';
        guidance =
          'Backend identity is missing AKS credential-read permissions. Grant Azure Kubernetes Service Cluster User Role (or equivalent permissions for listClusterUserCredentials/listClusterAdminCredentials) on this AKS cluster or resource group.';
      } else if (
        /HTTP protocol is not allowed when skipTLSVerify is not set or false/i.test(
          msg,
        )
      ) {
        code = 'KUBECONFIG_HTTP_PROTOCOL_NOT_ALLOWED';
        guidance =
          'Fallback kubeconfig appears to use an HTTP API server endpoint. Configure a valid HTTPS kubeconfig (or KUBECONFIG) for this cluster, or enable Azure credential-based kubeconfig retrieval.';
      }

      res.status(502).json({
        error: 'Pod/node fetch failed',
        details: msg,
        guidance,
        code,
      });
    }
  });

  // ── POST /azure/aks/:clusterName/lifecycle ───────────────────────────────
  router.post('/azure/aks/:clusterName/lifecycle', async (req, res) => {
    const { clusterName } = req.params;
    const body = req.body as Partial<LifecycleActionRequest>;
    const { action, dryRun = false, target, includeSystemNodePools } = body;

    if (!action || !target?.subscriptionId || !target?.resourceGroup) {
      res.status(400).json({
        error:
          'action, target.subscriptionId and target.resourceGroup are required',
      });
      return;
    }

    const validActions: LifecycleAction[] = ['start', 'stop', 'downsize'];
    if (!validActions.includes(action)) {
      res
        .status(400)
        .json({ error: `action must be one of: ${validActions.join(', ')}` });
      return;
    }

    if (!onboardedClusters.has(clusterName)) {
      res.status(404).json({
        error: `Cluster "${clusterName}" is not onboarded. Run onboarding first.`,
      });
      return;
    }

    const gate = await ensureCloudHubTaggedCluster({
      subscriptionId: target.subscriptionId,
      resourceGroup: target.resourceGroup,
      clusterName,
    });
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.error });
      return;
    }

    logger.info(
      `[cost-automation] [lifecycle] action="${action}" cluster="${clusterName}" dryRun=${dryRun}`,
    );

    try {
      const executedAt = new Date().toISOString();

      if (action === 'start' || action === 'stop') {
        // ── Cluster-level start / stop via ARM LRO ───────────────────────────
        if (dryRun) {
          logger.info(
            `[cost-automation] [AUDIT] action=${action} cluster="${clusterName}" dryRun=true at=${executedAt}`,
          );
          res.json({
            clusterName,
            action,
            dryRun: true,
            applied: false,
            executedAt,
            nodePools: [],
            summary: `[DRY RUN] Would ${action} cluster "${clusterName}" via Azure ARM.`,
          });
          return;
        }
        await doTriggerClusterLifecycle(
          target.subscriptionId,
          target.resourceGroup,
          clusterName,
          action,
          logger,
        );
        // Optimistically update the in-memory powerState and persist it.
        const rec = onboardedClusters.get(clusterName);
        if (rec) {
          rec.powerState = action === 'start' ? 'Running' : 'Stopped';
          void store?.upsert(rec);
        }
        logger.info(
          `[cost-automation] [AUDIT] action=${action} cluster="${clusterName}" dryRun=false applied=true at=${executedAt}`,
        );
        res.json({
          clusterName,
          action,
          dryRun: false,
          applied: true,
          executedAt,
          nodePools: [],
          summary: `Cluster ${action} triggered for "${clusterName}". This is an async operation — use Refresh to track the new power state.`,
        });
      } else {
        // ── Downsize: scale user node pools to minCount via ARM PATCH ────────
        const nodePools = await doFetchNodePools(
          target.subscriptionId,
          target.resourceGroup,
          clusterName,
          logger,
        );
        const clusterRecord = onboardedClusters.get(clusterName);
        const includeSystemPools =
          includeSystemNodePools ??
          clusterRecord?.includeSystemNodePools ??
          false;
        const plan = planLifecycleAction(action, nodePools, includeSystemPools);
        const plannedPoolScope = includeSystemPools ? 'user + system' : 'user';

        if (dryRun) {
          logger.info(
            `[cost-automation] [AUDIT] action=${action} cluster="${clusterName}" ` +
              `dryRun=true at=${executedAt} pools=${plan
                .map(p => p.nodePoolName)
                .join(',')}`,
          );
          res.json({
            clusterName,
            action,
            dryRun: true,
            applied: false,
            executedAt,
            nodePools: plan,
            summary: `[DRY RUN] Would downsize ${plan.length} ${plannedPoolScope} node pool(s) on cluster "${clusterName}".`,
          });
          return;
        }

        // Live downsize: PATCH each pool that needs to change
        await Promise.all(
          plan
            .filter(p => p.targetCount !== p.previousCount)
            .map(p =>
              doPatchNodePoolCount(
                target.subscriptionId,
                target.resourceGroup,
                clusterName,
                p.nodePoolName,
                p.targetCount,
                logger,
              ),
            ),
        );
        const applied = plan.map(p => ({ ...p, applied: true }));
        logger.info(
          `[cost-automation] [AUDIT] action=downsize cluster="${clusterName}" ` +
            `dryRun=false applied=true at=${executedAt} ` +
            `pools=${applied
              .map(p => `${p.nodePoolName}:${p.previousCount}→${p.targetCount}`)
              .join(',')}`,
        );
        res.json({
          clusterName,
          action,
          dryRun: false,
          applied: true,
          executedAt,
          nodePools: applied,
          summary: `Downsize applied to ${applied.length} ${plannedPoolScope} node pool(s) on cluster "${clusterName}".`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        `[cost-automation] [lifecycle] cluster="${clusterName}" ${msg}`,
      );
      res.status(502).json({ error: 'Lifecycle action failed', details: msg });
    }
  });

  // ── POST /azure/aks/:clusterName/rbac-setup ──────────────────────────────
  // Assigns the "Azure Kubernetes Service Cluster User Role" to the backend
  // service principal (AZURE_OBJECT_ID) on the target cluster scope.
  // Useful for clusters that were onboarded before the platform SPN secret
  // was configured, or to re-try a failed RBAC assignment from onboarding.
  router.post('/azure/aks/:clusterName/rbac-setup', async (req, res) => {
    const { clusterName } = req.params;
    const onboarded = onboardedClusters.get(clusterName);
    if (!onboarded) {
      res
        .status(404)
        .json({ error: `Cluster "${clusterName}" is not onboarded.` });
      return;
    }

    const principalObjectId = process.env.AZURE_OBJECT_ID;
    if (!principalObjectId) {
      res.status(400).json({
        error:
          'AZURE_OBJECT_ID env var is not set; cannot determine principal to assign role to.',
      });
      return;
    }

    const { subscriptionId, resourceGroup } = onboarded;
    if (!subscriptionId || !resourceGroup) {
      res.status(400).json({
        error: 'Cluster record is missing subscriptionId or resourceGroup.',
      });
      return;
    }

    const gate = await ensureCloudHubTaggedCluster({
      subscriptionId,
      resourceGroup,
      clusterName,
    });
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.error });
      return;
    }

    logger.info(
      `[cost-automation] [rbac-setup] Assigning AKS Cluster User Role on cluster="${clusterName}" to principal="${principalObjectId}"`,
    );

    try {
      const { alreadyExisted } = await doAssignClusterUserRole(
        subscriptionId,
        resourceGroup,
        clusterName,
        principalObjectId,
        logger,
      );
      const message = alreadyExisted
        ? 'Azure Kubernetes Service Cluster User Role was already assigned.'
        : 'Azure Kubernetes Service Cluster User Role successfully assigned.';
      logger.info(
        `[cost-automation] [rbac-setup] cluster="${clusterName}" ${message}`,
      );
      res.json({ message, alreadyExisted });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        `[cost-automation] [rbac-setup] cluster="${clusterName}" ${msg}`,
      );
      res.status(502).json({ error: 'RBAC assignment failed', details: msg });
    }
  });

  // ── GET /azure/aks/schedules ─────────────────────────────────────────────
  // Returns all configured schedules. Consumed by the Azure Function scheduler
  // that executes the actual AKS stop/start operations on behalf of Backstage.
  router.get('/azure/aks/schedules', async (_req, res) => {
    const schedules = Array.from(clusterSchedules.values());
    const filtered: ClusterSchedule[] = [];

    for (const schedule of schedules) {
      const cluster = onboardedClusters.get(schedule.clusterName);
      if (!cluster?.subscriptionId || !cluster.resourceGroup) {
        continue;
      }

      const gate = await ensureCloudHubTaggedCluster({
        subscriptionId: cluster.subscriptionId,
        resourceGroup: cluster.resourceGroup,
        clusterName: schedule.clusterName,
      });

      if (gate.ok) {
        filtered.push(schedule);
      }
    }

    res.json({
      schedules: filtered,
      exportedAt: new Date().toISOString(),
    });
  });

  // ── GET /azure/aks/:clusterName/schedule ────────────────────────────────
  router.get('/azure/aks/:clusterName/schedule', async (_req, res) => {
    const { clusterName } = _req.params;
    if (!onboardedClusters.has(clusterName)) {
      res
        .status(404)
        .json({ error: `Cluster "${clusterName}" is not onboarded.` });
      return;
    }
    const onboarded = onboardedClusters.get(clusterName);
    if (!onboarded?.subscriptionId || !onboarded?.resourceGroup) {
      res.status(400).json({
        error: `Cluster "${clusterName}" is missing onboarding metadata required for tag validation.`,
      });
      return;
    }
    const gate = await ensureCloudHubTaggedCluster({
      subscriptionId: onboarded.subscriptionId,
      resourceGroup: onboarded.resourceGroup,
      clusterName,
    });
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.error });
      return;
    }
    const schedule = clusterSchedules.get(clusterName) ?? null;
    if (!schedule) {
      res
        .status(404)
        .json({ error: `No schedule configured for "${clusterName}".` });
      return;
    }
    res.json(schedule);
  });

  // ── POST /azure/aks/:clusterName/schedule ────────────────────────────────
  router.post('/azure/aks/:clusterName/schedule', async (req, res) => {
    const { clusterName } = req.params;
    if (!onboardedClusters.has(clusterName)) {
      res
        .status(404)
        .json({ error: `Cluster "${clusterName}" is not onboarded.` });
      return;
    }

    const onboarded = onboardedClusters.get(clusterName);
    if (!onboarded?.subscriptionId || !onboarded?.resourceGroup) {
      res.status(400).json({
        error: `Cluster "${clusterName}" is missing onboarding metadata required for tag validation.`,
      });
      return;
    }
    const gate = await ensureCloudHubTaggedCluster({
      subscriptionId: onboarded.subscriptionId,
      resourceGroup: onboarded.resourceGroup,
      clusterName,
    });
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.error });
      return;
    }

    const {
      timezone = 'UTC',
      stop,
      start,
      enabled = true,
      holidayCalendar = null,
    } = req.body as {
      timezone?: string;
      stop?: { dayOfWeek: number; time: string } | null;
      start?: { dayOfWeek: number; time: string } | null;
      enabled?: boolean;
      holidayCalendar?: string | null;
    };

    // ── Validate timezone ────────────────────────────────────────────────────
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      res.status(400).json({ error: `Invalid IANA timezone: "${timezone}".` });
      return;
    }

    // ── Validate and compute cron for each entry ─────────────────────────────
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

    const toEntry = (
      entry: { dayOfWeek: number; time: string } | null | undefined,
      field: 'stop' | 'start',
    ): { cron: string; dayOfWeek: number; time: string } | null | 'error' => {
      if (!entry) return null;
      const { dayOfWeek, time } = entry;
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        res.status(400).json({
          error: `${field}.dayOfWeek must be an integer 0–6 (0=Sun).`,
        });
        return 'error';
      }
      if (!timeRe.test(time)) {
        res
          .status(400)
          .json({ error: `${field}.time must be in HH:MM (24-hour) format.` });
        return 'error';
      }
      const [hh, mm] = time.split(':');
      return { cron: `${mm} ${hh} * * ${dayOfWeek}`, dayOfWeek, time };
    };

    const stopEntry = toEntry(stop, 'stop');
    const startEntry = toEntry(start, 'start');
    if (stopEntry === 'error' || startEntry === 'error') return;

    // Preserve existing pause/override fields if the schedule already exists
    const existing = clusterSchedules.get(clusterName);

    const schedule: ClusterSchedule = {
      clusterName,
      timezone,
      stop: stopEntry ?? null,
      start: startEntry ?? null,
      enabled,
      updatedAt: new Date().toISOString(),
      lastAction: existing?.lastAction ?? null,
      lastExecutedAt: existing?.lastExecutedAt ?? null,
      lastActionResult: existing?.lastActionResult ?? null,
      paused: existing?.paused ?? false,
      holidayCalendar: holidayCalendar ?? existing?.holidayCalendar ?? null,
      overrideAction: existing?.overrideAction ?? null,
      overrideExpiresAt: existing?.overrideExpiresAt ?? null,
    };

    clusterSchedules.set(clusterName, schedule);
    await store?.upsertSchedule(schedule);

    // Mirror to Azure Table Storage so the Azure Function can read it
    const clusterRecord = onboardedClusters.get(clusterName);
    if (clusterRecord) {
      void tableStorageWriter?.upsertSchedule(clusterRecord, schedule);
    }

    logger.info(
      `[cost-automation] [AUDIT] action=schedule-upsert cluster="${clusterName}" ` +
        `tz=${timezone} stop=${schedule.stop?.cron ?? 'none'} ` +
        `start=${schedule.start?.cron ?? 'none'} enabled=${enabled} at=${
          schedule.updatedAt
        }`,
    );

    res.status(200).json({
      message: `Schedule saved for cluster "${clusterName}".`,
      schedule,
    });
  });

  // ── DELETE /azure/aks/:clusterName/schedule ──────────────────────────────
  router.delete('/azure/aks/:clusterName/schedule', async (req, res) => {
    const { clusterName } = req.params;
    if (!clusterSchedules.has(clusterName)) {
      res
        .status(404)
        .json({ error: `No schedule configured for "${clusterName}".` });
      return;
    }
    clusterSchedules.delete(clusterName);
    await store?.removeSchedule(clusterName);

    // Remove from Table Storage so the Azure Function stops acting on it
    const clusterRecord = onboardedClusters.get(clusterName);
    if (clusterRecord) {
      void tableStorageWriter?.deleteEntity(
        clusterRecord.subscriptionId,
        clusterRecord.resourceGroup,
        clusterName,
      );
    }

    logger.info(
      `[cost-automation] [AUDIT] action=schedule-delete cluster="${clusterName}" at=${new Date().toISOString()}`,
    );
    res.status(204).send();
  });

  // ── PATCH /azure/aks/:clusterName/schedule/pause ─────────────────────────
  // Toggles the manual pause flag without modifying the schedule itself.
  // When paused=true the Azure Function skips this cluster until re-enabled.
  // Active overrides still fire even while paused.
  router.patch('/azure/aks/:clusterName/schedule/pause', async (req, res) => {
    const { clusterName } = req.params;

    if (!onboardedClusters.has(clusterName)) {
      res
        .status(404)
        .json({ error: `Cluster "${clusterName}" is not onboarded.` });
      return;
    }
    const schedule = clusterSchedules.get(clusterName);
    if (!schedule) {
      res.status(404).json({
        error: `No schedule configured for "${clusterName}". Create a schedule first.`,
      });
      return;
    }

    const { paused } = req.body as { paused?: boolean };
    if (typeof paused !== 'boolean') {
      res.status(400).json({ error: '"paused" must be a boolean.' });
      return;
    }

    const updatedAt = new Date().toISOString();
    schedule.paused = paused;
    schedule.updatedAt = updatedAt;

    await store?.upsertSchedule(schedule);

    const clusterRecord = onboardedClusters.get(clusterName)!;
    void tableStorageWriter?.upsertSchedule(clusterRecord, schedule);

    logger.info(
      `[cost-automation] [AUDIT] action=schedule-pause cluster="${clusterName}" paused=${paused} at=${updatedAt}`,
    );

    res.json({
      message: `Cluster "${clusterName}" automation is now ${
        paused ? 'paused' : 'resumed'
      }.`,
      clusterName,
      paused,
      updatedAt,
    });
  });

  // ── POST /azure/aks/:clusterName/schedule/override ───────────────────────
  // Sets an emergency action (START or STOP) that the Azure Function will
  // execute on its next tick, bypassing schedule, pause, and holiday checks.
  // The override clears automatically after one successful execution.
  router.post('/azure/aks/:clusterName/schedule/override', async (req, res) => {
    const { clusterName } = req.params;

    if (!onboardedClusters.has(clusterName)) {
      res
        .status(404)
        .json({ error: `Cluster "${clusterName}" is not onboarded.` });
      return;
    }
    const schedule = clusterSchedules.get(clusterName);
    if (!schedule) {
      res.status(404).json({
        error: `No schedule configured for "${clusterName}". Create a schedule first.`,
      });
      return;
    }

    const { action, durationMinutes = 60 } = req.body as {
      action?: string;
      durationMinutes?: number;
    };

    if (action !== 'START' && action !== 'STOP') {
      res.status(400).json({ error: '"action" must be "START" or "STOP".' });
      return;
    }
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 1440
    ) {
      res.status(400).json({
        error: '"durationMinutes" must be an integer between 1 and 1440.',
      });
      return;
    }

    const expiresAt = new Date(
      Date.now() + durationMinutes * 60 * 1000,
    ).toISOString();
    const updatedAt = new Date().toISOString();

    schedule.overrideAction = action;
    schedule.overrideExpiresAt = expiresAt;
    schedule.updatedAt = updatedAt;

    await store?.upsertSchedule(schedule);

    const clusterRecord = onboardedClusters.get(clusterName)!;
    void tableStorageWriter?.upsertSchedule(clusterRecord, schedule);

    logger.info(
      `[cost-automation] [AUDIT] action=override-set cluster="${clusterName}" ` +
        `overrideAction=${action} expiresAt=${expiresAt} at=${updatedAt}`,
    );

    res.status(201).json({
      message:
        `Emergency ${action} override set for cluster "${clusterName}". ` +
        `The Azure Function will execute it on the next timer tick (within ~5 minutes). ` +
        `Override expires at ${expiresAt}.`,
      clusterName,
      overrideAction: action,
      overrideExpiresAt: expiresAt,
    });
  });

  // ── DELETE /azure/aks/:clusterName/schedule/override ────────────────────
  // Cancels a pending override before the Azure Function executes it.
  router.delete(
    '/azure/aks/:clusterName/schedule/override',
    async (req, res) => {
      const { clusterName } = req.params;

      const schedule = clusterSchedules.get(clusterName);
      if (!schedule?.overrideAction) {
        res
          .status(404)
          .json({ error: `No active override for cluster "${clusterName}".` });
        return;
      }

      const previousAction = schedule.overrideAction;
      schedule.overrideAction = null;
      schedule.overrideExpiresAt = null;
      schedule.updatedAt = new Date().toISOString();

      await store?.upsertSchedule(schedule);

      const clusterRecord = onboardedClusters.get(clusterName);
      if (clusterRecord) {
        void tableStorageWriter?.upsertSchedule(clusterRecord, schedule);
      }

      logger.info(
        `[cost-automation] [AUDIT] action=override-cancel cluster="${clusterName}" ` +
          `cancelledAction=${previousAction} at=${schedule.updatedAt}`,
      );

      res.status(204).send();
    },
  );

  // ── GET /azure/aks/:clusterName/powerstate ───────────────────────────────────────────
  router.get('/azure/aks/:clusterName/powerstate', async (req, res) => {
    const { clusterName } = req.params;
    const record = onboardedClusters.get(clusterName);
    if (!record) {
      res
        .status(404)
        .json({ error: `Cluster "${clusterName}" is not managed` });
      return;
    }
    try {
      const detail = await doFetchClusterDetail(
        record.subscriptionId,
        record.resourceGroup,
        clusterName,
        logger,
      );
      record.powerState = detail.powerState;
      res.json({
        clusterName,
        powerState: detail.powerState,
        refreshedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[cost-automation] [powerstate] cluster="${clusterName}" ${msg}`,
      );
      res.status(502).json({ error: 'Power state fetch failed', details: msg });
    }
  });

  // ── POST /azure/aks/:clusterName/execution ───────────────────────────────
  // Called by the Azure Function after each stop/start attempt.
  // Requires the SCHEDULER_API_KEY env var to match the X-Scheduler-Key header.
  router.post('/azure/aks/:clusterName/execution', async (req, res) => {
    // ─ Validate shared-secret API key ────────────────────────────────────────
    const expectedKey = process.env.SCHEDULER_API_KEY;
    if (expectedKey) {
      const provided = req.headers['x-scheduler-key'];
      if (provided !== expectedKey) {
        res
          .status(401)
          .json({ error: 'Missing or invalid X-Scheduler-Key header.' });
        return;
      }
    }

    const { clusterName } = req.params;
    if (!onboardedClusters.has(clusterName)) {
      res
        .status(404)
        .json({ error: `Cluster "${clusterName}" is not onboarded.` });
      return;
    }

    const {
      action,
      result,
      cron,
      timezone,
      reason,
      errorMessage,
      initiatedBy = 'aks-scheduler-azure-function',
    } = req.body as RecordExecutionRequest;

    const validActions: ScheduledAction[] = ['STOP', 'START'];
    const validResults: ExecutionResult[] = ['SUCCESS', 'FAILURE'];

    if (!validActions.includes(action as ScheduledAction)) {
      res
        .status(400)
        .json({ error: `action must be one of: ${validActions.join(', ')}.` });
      return;
    }
    if (!validResults.includes(result as ExecutionResult)) {
      res
        .status(400)
        .json({ error: `result must be one of: ${validResults.join(', ')}.` });
      return;
    }

    const executedAt = new Date().toISOString();
    const entry = await store?.recordExecution({
      clusterName,
      action,
      result,
      cron,
      timezone,
      reason,
      errorMessage,
      initiatedBy,
      executedAt,
    });

    logger.info(
      `[cost-automation] [AUDIT] action=scheduler-execution-recorded cluster="${clusterName}" ` +
        `op=${action} result=${result} initiatedBy=${initiatedBy} at=${executedAt}`,
    );

    res.status(201).json({
      message: `Execution recorded for cluster "${clusterName}".`,
      entry: entry ?? {
        id: -1,
        clusterName,
        action,
        result,
        cron: cron ?? null,
        timezone: timezone ?? null,
        reason: reason ?? null,
        errorMessage: errorMessage ?? null,
        initiatedBy,
        executedAt,
      },
    });
  });

  // ── GET /azure/aks/:clusterName/execution-log ────────────────────────────
  // Returns recent execution history for the UI.
  router.get('/azure/aks/:clusterName/execution-log', async (req, res) => {
    const { clusterName } = req.params;
    if (!onboardedClusters.has(clusterName)) {
      res
        .status(404)
        .json({ error: `Cluster "${clusterName}" is not onboarded.` });
      return;
    }
    const limitRaw = req.query.limit;
    const limit = limitRaw
      ? Math.min(parseInt(String(limitRaw), 10) || 50, 200)
      : 50;
    const entries = (await store?.getExecutionLog(clusterName, limit)) ?? [];
    res.json({ clusterName, entries });
  });

  return router;
}
