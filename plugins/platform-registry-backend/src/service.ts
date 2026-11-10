import { randomUUID } from 'crypto';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';
import {
  DescribeClusterCommand,
  EKSClient,
  ListClustersCommand,
} from '@aws-sdk/client-eks';
import { GoogleAuth } from 'google-auth-library';
import { PlatformRegistryDatabase } from './db';
import type {
  Application,
  CloudAccount,
  CloudProvider,
  Cluster,
  CreateDeploymentInput,
  Deployment,
  DeploymentEvent,
  DeploymentStatus,
  DeploymentTarget,
  DiscoveredCluster,
  Environment,
  ImportClustersInput,
  Namespace,
  OnboardPlatformInput,
  OnboardPlatformResult,
  RegistrySummary,
  RollbackDeploymentInput,
  Platform,
  PlatformDetail,
  TransitionDeploymentInput,
} from './types';

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Allowed deployment status transitions. `active` and the terminal states are
 * reached through dedicated workflow logic (supersede / rollback) rather than a
 * free-form transition, so they are intentionally narrow here.
 */
const DEPLOYMENT_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  pending: ['in_progress', 'failed'],
  in_progress: ['active', 'failed'],
  active: ['rolled_back'],
  failed: ['in_progress'],
  superseded: ['active'],
  rolled_back: [],
};

interface ListOptions {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  provider?: string;
}

interface ClusterRow {
  id: string;
  platform_id: string;
  platform_name?: string;
  environment_id?: string | null;
  environment_name?: string;
  cloud_account_id?: string | null;
  account_identifier?: string | null;
  cloud_provider?: CloudProvider | null;
  cluster_name: string;
  cluster_type: string;
  provider: CloudProvider;
  region?: string | null;
  secondary_region?: string | null;
  resource_group?: string | null;
  account_scope?: string | null;
  cluster_endpoint?: string | null;
  kubernetes_version?: string | null;
  status: string;
  discovered_at?: string | null;
  last_synced_at?: string | null;
}

export interface DiscoveryPreflightCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DiscoveryPreflightResult {
  cloudAccountId: string;
  provider: CloudProvider;
  accountScope: string;
  ready: boolean;
  checks: DiscoveryPreflightCheck[];
}

const CLOUDHUB_ENABLED_TAG = 'cloudhub-enabled';
const CLOUDHUB_ONBOARDED_TAG = 'cloudhub-onboarded';
const CLOUDHUB_ENABLED_TAG_ALIASES = [
  CLOUDHUB_ENABLED_TAG,
  'cloudhub_enabled',
  'cloud_enabled',
];
const CLOUDHUB_ONBOARDED_TAG_ALIASES = [
  CLOUDHUB_ONBOARDED_TAG,
  'cloudhub_onboarded',
  'cloud_onboarded',
];
const AZURE_SUBSCRIPTION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_AWS_EKS_REGIONS = [
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'us-east-1',
  'us-east-2',
  'us-west-2',
  'ap-southeast-1',
  'ap-southeast-2',
];

function azureCredential(logger?: LoggerService) {
  return createCloudHubAzureCredential(
    logger
      ? (message, metadata) => logger.info(message, metadata)
      : undefined,
  );
}

function normalizedTagValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function parseNormalizedTagValues(tags: unknown): Record<string, string> {
  if (!tags) return {};

  let source: unknown = tags;
  if (typeof tags === 'string') {
    try {
      source = JSON.parse(tags);
    } catch {
      return {};
    }
  }

  const normalized: Record<string, string> = {};
  if (Array.isArray(source)) {
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      const key = String(
        (item as { key?: unknown; name?: unknown }).key ??
          (item as { name?: unknown }).name ??
          '',
      )
        .trim()
        .toLowerCase();
      const value = (item as { value?: unknown }).value;
      if (key) normalized[key] = normalizedTagValue(value);
    }
  } else if (typeof source === 'object') {
    for (const [rawKey, rawValue] of Object.entries(
      source as Record<string, unknown>,
    )) {
      normalized[rawKey.trim().toLowerCase()] = normalizedTagValue(rawValue);
    }
  }

  return normalized;
}

function hasCloudHubOnboardingTags(tags: unknown): boolean {
  const normalized = parseNormalizedTagValues(tags);
  return CLOUDHUB_ONBOARDED_TAG_ALIASES.some(
    key => normalized[key] === 'true',
  );
}

function isCloudHubEnabled(tags: unknown): boolean {
  const normalized = parseNormalizedTagValues(tags);
  const enabledKey = CLOUDHUB_ENABLED_TAG_ALIASES.find(
    key => key in normalized,
  );
  if (!enabledKey) {
    return true;
  }
  return normalized[enabledKey] === 'true';
}

function parseNormalizedTags(tags: unknown): Record<string, string> {
  if (!tags) return {};
  let source: unknown = tags;
  if (typeof tags === 'string') {
    try {
      source = JSON.parse(tags);
    } catch {
      return {};
    }
  }

  const result: Record<string, string> = {};
  if (Array.isArray(source)) {
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      const key = String(
        (item as { key?: unknown; name?: unknown }).key ??
          (item as { name?: unknown }).name ??
          '',
      )
        .trim()
        .toLowerCase();
      const value = String((item as { value?: unknown }).value ?? '').trim();
      if (key) result[key] = value;
    }
  } else if (typeof source === 'object' && source !== null) {
    for (const [rawKey, rawValue] of Object.entries(
      source as Record<string, unknown>,
    )) {
      result[rawKey.trim().toLowerCase()] = String(rawValue ?? '').trim();
    }
  }
  return result;
}

function firstTagValue(
  tags: Record<string, string>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = String(tags[key] ?? '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function resolveCustomerTag(tags: Record<string, string>): string {
  return firstTagValue(tags, [
    'customer',
    'cutomer',
    'customer_name',
    'customer-name',
    'cloudhub-customer',
    'cloudhub_customer',
    'platform',
    'platform_code',
    'platform-code',
    'tenant',
    'owner',
  ]);
}

function resolveEnvTag(tags: Record<string, string>): string {
  return firstTagValue(tags, [
    'env',
    'environment',
    'environment_name',
    'environment-name',
    'cloudhub-env',
    'cloudhub_env',
    'tier',
  ]);
}

function resolvePlatformAndEnvironmentFromTags(
  tags: Record<string, string>,
  clusterName: string,
): { platformCode: string; environmentName: string } {
  let platformCode = resolveCustomerTag(tags);

  let environmentName = resolveEnvTag(tags);

  if (!platformCode || !environmentName) {
    const parts = clusterName.toLowerCase().split('-');
    if (!environmentName) {
      const envMatch = parts.find(p =>
        /^(dev|development|qa|sit|test|stag|staging|stg|prod|production|live|perf)$/i.test(
          p,
        ),
      );
      if (envMatch) environmentName = envMatch;
    }
    if (!platformCode && parts.length > 2) {
      const candidate = parts[parts.length - 1];
      if (candidate && !/^(0[0-9]|[0-9]+|aks|eks|gke)$/i.test(candidate)) {
        platformCode = candidate;
      }
    }
  }

  return {
    platformCode: (platformCode || 'cms').toLowerCase(),
    environmentName: (environmentName || 'dev').toLowerCase(),
  };
}

function defaultAzureSubscriptionIds(): string[] {
  return [
    process.env.AZURE_SUBSCRIPTION_ID,
    process.env.CLOUDHUB_WORKSPACE_AKS_SUBSCRIPTION_ID,
  ]
    .map(value => String(value ?? '').trim())
    .filter(value => AZURE_SUBSCRIPTION_ID_RE.test(value));
}

function normalizeProviderFilter(provider?: string): CloudProvider | null {
  const value = String(provider ?? '')
    .trim()
    .toLowerCase();
  if (!value || value === 'all') return null;
  if (value === 'azure' || value === 'aks') return 'AZURE';
  if (value === 'aws' || value === 'eks') return 'AWS';
  if (value === 'gcp' || value === 'gke') return 'GCP';
  if (value === 'on-prem' || value === 'onprem' || value === 'on_prem') {
    return 'ONPREM';
  }
  return null;
}

function awsEksRegions(): string[] {
  const configured = String(process.env.CLOUDHUB_AWS_EKS_REGIONS ?? '').trim();
  if (!configured) return DEFAULT_AWS_EKS_REGIONS;
  return configured
    .split(',')
    .map(region => region.trim())
    .filter(Boolean);
}

class PlatformRegistryPolicyError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export class PlatformRegistryService {
  constructor(
    private readonly db: PlatformRegistryDatabase,
    private readonly logger?: LoggerService,
  ) {}

  private buildEligibilityKey(provider: CloudProvider, scope: string): string {
    return `${provider}:${scope.trim().toLowerCase()}`;
  }

  private buildClusterIdentity(
    provider: CloudProvider,
    scope: string,
    clusterName: string,
    resourceGroup?: string | null,
  ): string {
    return [
      provider,
      scope.trim().toLowerCase(),
      clusterName.trim().toLowerCase(),
      (resourceGroup ?? '').trim().toLowerCase(),
    ].join('|');
  }

  private findDiscoveredClusterMatch(
    discovered: Omit<DiscoveredCluster, 'alreadyRegistered'>[],
    provider: CloudProvider,
    clusterName: string,
    resourceGroup?: string | null,
  ): Omit<DiscoveredCluster, 'alreadyRegistered'> | undefined {
    const targetName = clusterName.trim().toLowerCase();
    const targetRg = (resourceGroup ?? '').trim().toLowerCase();

    return discovered.find(item => {
      if (item.clusterName.trim().toLowerCase() !== targetName) {
        return false;
      }
      if (provider !== 'AZURE') {
        return true;
      }
      if (!targetRg) {
        return true;
      }
      return (item.resourceGroup ?? '').trim().toLowerCase() === targetRg;
    });
  }

  private applyClusterSearch(items: Cluster[], search?: string): Cluster[] {
    const q = (search ?? '').trim().toLowerCase();
    if (!q) {
      return items;
    }

    return items.filter(item =>
      [
        item.clusterName,
        item.clusterType,
        item.provider,
        item.region,
        item.customerTag,
        item.envTag,
        item.platformName,
        item.environmentName,
        item.kubernetesVersion,
      ]
        .map(value => String(value ?? '').toLowerCase())
        .some(value => value.includes(q)),
    );
  }

  private sortClusters(items: Cluster[]): Cluster[] {
    return [...items].sort((a, b) =>
      a.clusterName.localeCompare(b.clusterName, undefined, {
        sensitivity: 'base',
      }),
    );
  }

  private async getCloudAccountOrThrow(cloudAccountId: string): Promise<any> {
    const accounts = await this.db.query<any>(
      'SELECT * FROM pr_cloud_accounts WHERE id = $1',
      [cloudAccountId],
    );
    const account = accounts[0];
    if (!account) {
      throw new PlatformRegistryPolicyError(
        `Cloud account '${cloudAccountId}' was not found.`,
        404,
      );
    }
    return account;
  }

  async runDiscoveryPreflight(
    cloudAccountId: string,
    provider: CloudProvider,
  ): Promise<DiscoveryPreflightResult> {
    const account = await this.getCloudAccountOrThrow(cloudAccountId);
    const effectiveProvider: CloudProvider = account.cloud_provider ?? provider;
    const accountScope = String(account.account_identifier ?? '').trim();

    const checks: DiscoveryPreflightCheck[] = [
      {
        id: 'account-exists',
        label: 'Cloud account exists',
        status: 'pass',
        detail: `Using ${effectiveProvider} account ${account.account_name}.`,
      },
      {
        id: 'account-scope',
        label: 'Account scope configured',
        status: accountScope ? 'pass' : 'fail',
        detail: accountScope
          ? `Account scope: ${accountScope}`
          : 'account_identifier is empty. Set subscription/account/project id.',
      },
      {
        id: 'tag-policy',
        label: 'CloudHub onboarding tag policy',
        status: 'pass',
        detail:
          'Only clusters tagged cloudhub-enabled=true and cloudhub-onboarded=true are eligible.',
      },
    ];

    if (!accountScope) {
      return {
        cloudAccountId,
        provider: effectiveProvider,
        accountScope,
        ready: false,
        checks,
      };
    }

    if (effectiveProvider === 'AZURE') {
      const hasCreds =
        Boolean(process.env.AZURE_TENANT_ID) &&
        Boolean(process.env.AZURE_CLIENT_ID) &&
        Boolean(process.env.AZURE_CLIENT_SECRET);
      checks.push({
        id: 'azure-env',
        label: 'Azure credentials configured',
        status: hasCreds ? 'pass' : 'warn',
        detail: hasCreds
          ? 'AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET found.'
          : 'AZURE_* platform service principal settings are incomplete; Azure discovery will fail closed.',
      });

      try {
        const graph = new ResourceGraphClient(azureCredential(this.logger));
        await graph.resources({
          subscriptions: [accountScope],
          query: 'Resources | where type =~ "microsoft.resources/subscriptions" | take 1',
          options: { resultFormat: 'objectArray' },
        });
        checks.push({
          id: 'azure-access',
          label: 'Azure Resource Graph access',
          status: 'pass',
          detail: 'Successfully queried Azure Resource Graph for this subscription.',
        });
      } catch (error) {
        checks.push({
          id: 'azure-access',
          label: 'Azure Resource Graph access',
          status: 'fail',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (effectiveProvider === 'AWS') {
      const regions = awsEksRegions();
      checks.push({
        id: 'aws-regions',
        label: 'AWS region scope',
        status: regions.length > 0 ? 'pass' : 'fail',
        detail:
          regions.length > 0
            ? `Will scan ${regions.length} region(s): ${regions.join(', ')}`
            : 'No regions configured for EKS discovery.',
      });

      if (regions.length > 0) {
        try {
          const eks = new EKSClient({ region: regions[0] });
          await eks.send(new ListClustersCommand({ maxResults: 1 }));
          checks.push({
            id: 'aws-access',
            label: 'AWS EKS API access',
            status: 'pass',
            detail: `Successfully listed clusters in ${regions[0]}.`,
          });
        } catch (error) {
          checks.push({
            id: 'aws-access',
            label: 'AWS EKS API access',
            status: 'fail',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else if (effectiveProvider === 'GCP') {
      const hasCredentialHint = Boolean(
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
          process.env.GOOGLE_CREDENTIALS,
      );
      checks.push({
        id: 'gcp-env',
        label: 'GCP credentials configured',
        status: hasCredentialHint ? 'pass' : 'warn',
        detail: hasCredentialHint
          ? 'GOOGLE_APPLICATION_CREDENTIALS/GOOGLE_CREDENTIALS configured.'
          : 'No explicit GCP credential env var detected; relying on default identity chain.',
      });

      try {
        const auth = new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });
        const client = await auth.getClient();
        const encodedProjectId = encodeURIComponent(accountScope);
        await client.request({
          method: 'GET',
          url: `https://container.googleapis.com/v1/projects/${encodedProjectId}/locations/-/clusters?pageSize=1`,
        });
        checks.push({
          id: 'gcp-access',
          label: 'GKE API access',
          status: 'pass',
          detail: `Successfully reached GKE API for project ${accountScope}.`,
        });
      } catch (error) {
        checks.push({
          id: 'gcp-access',
          label: 'GKE API access',
          status: 'fail',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      checks.push({
        id: 'provider-support',
        label: 'Provider support',
        status: 'fail',
        detail: `${effectiveProvider} is not supported for discovery.`,
      });
    }

    return {
      cloudAccountId,
      provider: effectiveProvider,
      accountScope,
      ready: checks.every(c => c.status !== 'fail'),
      checks,
    };
  }

  private async discoverOnboardedClustersByProvider(
    provider: CloudProvider,
    accountScope: string,
  ): Promise<Omit<DiscoveredCluster, 'alreadyRegistered'>[]> {
    if (provider === 'AZURE') {
      return this.discoverAzureOnboardedClusters(accountScope);
    }
    if (provider === 'AWS') {
      return this.discoverAwsOnboardedClusters(accountScope);
    }
    if (provider === 'GCP') {
      return this.discoverGcpOnboardedClusters(accountScope);
    }
    throw new PlatformRegistryPolicyError(
      `${provider} discovery is not supported by CloudHub onboarding policy.`,
      501,
    );
  }

  private async discoverAzureOnboardedClusters(
    subscriptionId: string,
  ): Promise<Omit<DiscoveredCluster, 'alreadyRegistered'>[]> {
    const safeSubscriptionId = subscriptionId.trim().replace(/'/g, "''");
    if (!safeSubscriptionId) {
      return [];
    }

    const graph = new ResourceGraphClient(azureCredential(this.logger));
    const result = await graph.resources({
      subscriptions: [safeSubscriptionId],
      query: `
        Resources
        | where type =~ 'microsoft.containerservice/managedclusters'
        | where subscriptionId == '${safeSubscriptionId}'
        | project
            clusterName = name,
            region = location,
            resourceGroup,
            accountScope = subscriptionId,
            kubernetesVersion = tostring(properties.kubernetesVersion),
            fqdn = tostring(properties.fqdn),
            properties,
            tags
      `,
      options: { resultFormat: 'objectArray' },
    });

    const rows = (result.data as Array<Record<string, any>>) ?? [];
    return rows
      .filter(row => hasCloudHubOnboardingTags(row.tags as Record<string, unknown>))
      .map(row => {
        const clusterName = String(row.clusterName ?? 'unknown-cluster');
        const region = String(row.region ?? 'unknown-region');
        const resourceGroup = String(row.resourceGroup ?? '');
        const fqdn = String(row.fqdn ?? '').trim();
        const nodePools = Array.isArray(row.properties?.agentPoolProfiles)
          ? row.properties.agentPoolProfiles.length
          : 0;
        const tags = parseNormalizedTags(row.tags);
        const { platformCode, environmentName } =
          resolvePlatformAndEnvironmentFromTags(tags, clusterName);
        const customerTag = resolveCustomerTag(tags);
        const envTag = resolveEnvTag(tags);
        const enabled = isCloudHubEnabled(row.tags as Record<string, unknown>);

        return {
          clusterName,
          clusterType: 'AKS' as const,
          provider: 'AZURE' as const,
          customerTag,
          envTag,
          region,
          resourceGroup: resourceGroup || null,
          accountScope: String(row.accountScope ?? safeSubscriptionId),
          clusterEndpoint: fqdn ? `https://${fqdn}` : `https://${clusterName}`,
          kubernetesVersion: String(row.kubernetesVersion ?? 'unknown-version'),
          nodeCount: nodePools,
          platformCode,
          environmentName,
          active: enabled,
          status: enabled ? 'active' : 'inactive',
        };
      });
  }

  private async discoverAwsOnboardedClusters(
    accountId: string,
  ): Promise<Omit<DiscoveredCluster, 'alreadyRegistered'>[]> {
    const expectedAccountId = accountId.trim();
    if (!expectedAccountId) {
      throw new PlatformRegistryPolicyError(
        'AWS account identifier is required for EKS discovery.',
        400,
      );
    }

    const clusters: Omit<DiscoveredCluster, 'alreadyRegistered'>[] = [];

    for (const region of awsEksRegions()) {
      const eks = new EKSClient({ region });
      let nextToken: string | undefined;

      do {
        const page = await eks.send(
          new ListClustersCommand({ nextToken, maxResults: 100 }),
        );

        for (const name of page.clusters ?? []) {
          const detail = await eks.send(new DescribeClusterCommand({ name }));
          const cluster = detail.cluster;
          if (!cluster?.name) continue;

          const arnParts = String(cluster.arn ?? '').split(':');
          const clusterAccountId = arnParts.length > 4 ? arnParts[4] : '';
          if (clusterAccountId && clusterAccountId !== expectedAccountId) {
            continue;
          }

          if (!hasCloudHubOnboardingTags(cluster.tags)) {
            continue;
          }

          const tags = parseNormalizedTags(cluster.tags);
          const { platformCode, environmentName } =
            resolvePlatformAndEnvironmentFromTags(tags, cluster.name);
          const customerTag = resolveCustomerTag(tags);
          const envTag = resolveEnvTag(tags);
          const enabled = isCloudHubEnabled(cluster.tags);

          clusters.push({
            clusterName: cluster.name,
            clusterType: 'EKS',
            provider: 'AWS',
            customerTag,
            envTag,
            region,
            resourceGroup: null,
            accountScope: expectedAccountId,
            clusterEndpoint: String(cluster.endpoint ?? ''),
            kubernetesVersion: String(cluster.version ?? 'unknown-version'),
            nodeCount: 0,
            platformCode,
            environmentName,
            active: enabled,
            status: enabled ? 'active' : 'inactive',
          });
        }

        nextToken = page.nextToken;
      } while (nextToken);
    }

    return clusters;
  }

  private async discoverGcpOnboardedClusters(
    projectId: string,
  ): Promise<Omit<DiscoveredCluster, 'alreadyRegistered'>[]> {
    const effectiveProjectId = projectId.trim();
    if (!effectiveProjectId) {
      throw new PlatformRegistryPolicyError(
        'GCP project identifier is required for GKE discovery.',
        400,
      );
    }

    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();

    const encodedProjectId = encodeURIComponent(effectiveProjectId);
    const response = await client.request<{ clusters?: Array<any> }>({
      method: 'GET',
      url: `https://container.googleapis.com/v1/projects/${encodedProjectId}/locations/-/clusters`,
    });

    const all = response.data?.clusters ?? [];
    return all
      .filter(cluster =>
        hasCloudHubOnboardingTags(
          (cluster?.resourceLabels as Record<string, unknown>) ?? {},
        ),
      )
      .map(cluster => {
        const endpoint = String(cluster.endpoint ?? '').trim();
        const nodeCount = Array.isArray(cluster.nodePools)
          ? cluster.nodePools.reduce(
              (sum: number, pool: any) =>
                sum + Number(pool?.initialNodeCount ?? 0),
              0,
            )
          : 0;
        const tags = parseNormalizedTags(cluster?.resourceLabels);
        const { platformCode, environmentName } =
          resolvePlatformAndEnvironmentFromTags(
            tags,
            String(cluster.name ?? ''),
          );
        const customerTag = resolveCustomerTag(tags);
        const envTag = resolveEnvTag(tags);
        const enabled = isCloudHubEnabled(
          (cluster?.resourceLabels as Record<string, unknown>) ?? {},
        );

        return {
          clusterName: String(cluster.name ?? 'unknown-cluster'),
          clusterType: 'GKE',
          provider: 'GCP' as const,
          customerTag,
          envTag,
          region: String(cluster.location ?? 'unknown-region'),
          resourceGroup: null,
          accountScope: effectiveProjectId,
          clusterEndpoint: endpoint ? `https://${endpoint}` : '',
          kubernetesVersion: String(
            cluster.currentMasterVersion ?? 'unknown-version',
          ),
          nodeCount,
          platformCode,
          environmentName,
          active: enabled,
          status: enabled ? 'active' : 'inactive',
        };
      });
  }

  // ---------------------------------------------------------------- Summary
  async getSummary(): Promise<RegistrySummary> {
    const rows = await this.db.query<{ entity: string; count: number }>(`
      SELECT 'platforms' AS entity, COUNT(*)::int AS count FROM pr_platforms
      UNION ALL SELECT 'cloudAccounts', COUNT(*)::int FROM pr_cloud_accounts
      UNION ALL SELECT 'environments', COUNT(*)::int FROM pr_environments
      UNION ALL SELECT 'clusters', COUNT(*)::int FROM pr_clusters
      UNION ALL SELECT 'namespaces', COUNT(*)::int FROM pr_namespaces
      UNION ALL SELECT 'deploymentTargets', COUNT(*)::int FROM pr_deployment_targets
      UNION ALL SELECT 'applications', COUNT(*)::int FROM pr_applications
      UNION ALL SELECT 'deployments', COUNT(*)::int FROM pr_deployments
    `);

    const summary: RegistrySummary = {
      platforms: 0,
      cloudAccounts: 0,
      environments: 0,
      clusters: 0,
      namespaces: 0,
      deploymentTargets: 0,
      applications: 0,
      deployments: 0,
    };
    for (const row of rows) {
      (summary as unknown as Record<string, number>)[row.entity] = row.count;
    }
    try {
      const liveClusters = await this.listLiveOnboardedClusters({
        page: 0,
        pageSize: 200,
      });
      summary.clusters = liveClusters.total;
    } catch {
      // Keep the persisted cluster count if live Azure discovery is unavailable.
    }
    return summary;
  }

  // ---------------------------------------------------------------- Platforms
  async listPlatforms(opts: ListOptions): Promise<ListResult<Platform>> {
    const { where, params } = this.buildSearch(opts.search, [
      'platform_code',
      'platform_name',
      'platform_type',
      'owner_email',
    ]);
    const sort = this.sortClause(
      opts.sortBy,
      opts.sortOrder,
      {
        platformName: 'platform_name',
        platformCode: 'platform_code',
        createdAt: 'created_at',
        status: 'status',
      },
      'created_at',
    );

    const total = await this.count('pr_platforms', where, params);
    const rows = await this.db.query<any>(
      `SELECT * FROM pr_platforms ${where} ${sort} LIMIT $${
        params.length + 1
      } OFFSET $${params.length + 2}`,
      [...params, opts.pageSize, opts.page * opts.pageSize],
    );
    return this.page(rows.map(this.mapPlatform), total, opts);
  }

  async getPlatform(id: string): Promise<Platform | null> {
    const rows = await this.db.query<any>(
      'SELECT * FROM pr_platforms WHERE id = $1',
      [id],
    );
    return rows[0] ? this.mapPlatform(rows[0]) : null;
  }

  /**
   * Resolve a platform together with every entity that hangs off it, so the UI
   * can render the full relationship tree in a single drill-down view.
   */
  async getPlatformDetail(id: string): Promise<PlatformDetail | null> {
    const platform = await this.getPlatform(id);
    if (!platform) {
      return null;
    }

    const cloudAccounts = (
      await this.db.query<any>(
        `SELECT ca.*, t.platform_name FROM pr_cloud_accounts ca
         LEFT JOIN pr_platforms t ON t.id = ca.platform_id
         WHERE ca.platform_id = $1 ORDER BY ca.account_name ASC`,
        [id],
      )
    ).map(this.mapCloudAccount);

    const environments = (
      await this.db.query<any>(
        `SELECT e.*, t.platform_name FROM pr_environments e
         LEFT JOIN pr_platforms t ON t.id = e.platform_id
         WHERE e.platform_id = $1 ORDER BY e.environment_name ASC`,
        [id],
      )
    ).map(this.mapEnvironment);

    const clusters = (
      await this.db.query<any>(
        `SELECT c.*, t.platform_name, e.environment_name FROM pr_clusters c
         LEFT JOIN pr_platforms t ON t.id = c.platform_id
         LEFT JOIN pr_environments e ON e.id = c.environment_id
         WHERE c.platform_id = $1 ORDER BY c.cluster_name ASC`,
        [id],
      )
    ).map(this.mapCluster);

    const namespaces = (
      await this.db.query<any>(
        `SELECT n.*, c.cluster_name FROM pr_namespaces n
         INNER JOIN pr_clusters c ON c.id = n.cluster_id
         WHERE c.platform_id = $1 ORDER BY c.cluster_name ASC, n.namespace_name ASC`,
        [id],
      )
    ).map(this.mapNamespace);

    const deploymentTargets = (
      await this.db.query<any>(
        `SELECT dt.*, t.platform_name, e.environment_name, c.cluster_name, n.namespace_name
         FROM pr_deployment_targets dt
         LEFT JOIN pr_platforms t ON t.id = dt.platform_id
         LEFT JOIN pr_environments e ON e.id = dt.environment_id
         LEFT JOIN pr_clusters c ON c.id = dt.cluster_id
         LEFT JOIN pr_namespaces n ON n.id = dt.namespace_id
         WHERE dt.platform_id = $1 ORDER BY dt.target_name ASC`,
        [id],
      )
    ).map(this.mapDeploymentTarget);

    const deployments = (
      await this.db.query<any>(
        `SELECT d.*, dt.target_name, a.application_name FROM pr_deployments d
         INNER JOIN pr_deployment_targets dt ON dt.id = d.deployment_target_id
         LEFT JOIN pr_applications a ON a.id = d.application_id
         WHERE dt.platform_id = $1 ORDER BY d.deployed_at DESC`,
        [id],
      )
    ).map(this.mapDeployment);

    return {
      platform,
      cloudAccounts,
      environments,
      clusters,
      namespaces,
      deploymentTargets,
      deployments,
    };
  }

  async createPlatform(input: Partial<Platform>): Promise<Platform> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO pr_platforms (id, platform_code, platform_name, platform_type, status, owner_email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        input.platformCode,
        input.platformName,
        input.platformType ?? null,
        input.status ?? 'active',
        input.ownerEmail ?? null,
      ],
    );
    return (await this.getPlatform(id))!;
  }

  async deletePlatform(id: string): Promise<void> {
    await this.db.query('DELETE FROM pr_platforms WHERE id = $1', [id]);
  }

  // ---------------------------------------------------------- Cloud accounts
  async listCloudAccounts(
    opts: ListOptions,
  ): Promise<ListResult<CloudAccount>> {
    const { where, params } = this.buildSearch(
      opts.search,
      ['account_name', 'account_identifier', 'cloud_provider'],
      'ca',
    );
    const total = await this.count('pr_cloud_accounts ca', where, params);
    const rows = await this.db.query<any>(
      `SELECT ca.*, t.platform_name FROM pr_cloud_accounts ca
       LEFT JOIN pr_platforms t ON t.id = ca.platform_id
       ${where} ORDER BY ca.account_name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.pageSize, opts.page * opts.pageSize],
    );
    return this.page(rows.map(this.mapCloudAccount), total, opts);
  }

  async createCloudAccount(
    input: Partial<CloudAccount>,
  ): Promise<CloudAccount> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO pr_cloud_accounts (id, platform_id, cloud_provider, account_name, account_identifier, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        input.platformId ?? null,
        input.cloudProvider,
        input.accountName,
        input.accountIdentifier,
        input.status ?? 'active',
      ],
    );
    const rows = await this.db.query<any>(
      `SELECT ca.*, t.platform_name FROM pr_cloud_accounts ca
       LEFT JOIN pr_platforms t ON t.id = ca.platform_id WHERE ca.id = $1`,
      [id],
    );
    return this.mapCloudAccount(rows[0]);
  }

  async deleteCloudAccount(id: string): Promise<void> {
    await this.db.query('DELETE FROM pr_cloud_accounts WHERE id = $1', [id]);
  }

  // ------------------------------------------------------------ Environments
  async listEnvironments(opts: ListOptions): Promise<ListResult<Environment>> {
    const { where, params } = this.buildSearch(
      opts.search,
      ['environment_name', 'environment_type'],
      'e',
    );
    const total = await this.count('pr_environments e', where, params);
    const rows = await this.db.query<any>(
      `SELECT e.*, t.platform_name FROM pr_environments e
       LEFT JOIN pr_platforms t ON t.id = e.platform_id
       ${where} ORDER BY t.platform_name ASC, e.environment_name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.pageSize, opts.page * opts.pageSize],
    );
    return this.page(rows.map(this.mapEnvironment), total, opts);
  }

  async createEnvironment(input: Partial<Environment>): Promise<Environment> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO pr_environments (id, platform_id, environment_name, environment_type, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        input.platformId,
        input.environmentName,
        input.environmentType ?? null,
        input.status ?? 'active',
      ],
    );
    const rows = await this.db.query<any>(
      `SELECT e.*, t.platform_name FROM pr_environments e
       LEFT JOIN pr_platforms t ON t.id = e.platform_id WHERE e.id = $1`,
      [id],
    );
    return this.mapEnvironment(rows[0]);
  }

  async deleteEnvironment(id: string): Promise<void> {
    await this.db.query('DELETE FROM pr_environments WHERE id = $1', [id]);
  }

  // --------------------------------------------------------------- Clusters
  async syncLiveOnboardedClusters(): Promise<{ synced: number }> {
    const defaultSubscriptionIds = defaultAzureSubscriptionIds();
    let accounts: any[] = [];
    try {
      accounts = await this.db.query<any>(
        `SELECT ca.id, ca.platform_id, ca.cloud_provider, ca.account_identifier, t.platform_name, t.platform_code
           FROM pr_cloud_accounts ca
           LEFT JOIN pr_platforms t ON t.id = ca.platform_id
          WHERE ca.status = 'active'`,
      );
    } catch {
      accounts = [];
    }

    const scopes = new Map<
      string,
      { provider: CloudProvider; scope: string; account?: any }
    >();

    for (const account of accounts) {
      const provider = account.cloud_provider as CloudProvider;
      const scope = String(account.account_identifier ?? '').trim();
      if (provider && scope) {
        scopes.set(this.buildEligibilityKey(provider, scope), {
          provider,
          scope,
          account,
        });
      }
    }

    for (const subscriptionId of defaultSubscriptionIds) {
      const key = this.buildEligibilityKey('AZURE', subscriptionId);
      if (!scopes.has(key)) {
        scopes.set(key, {
          provider: 'AZURE',
          scope: subscriptionId,
        });
      }
    }

    let synced = 0;
    for (const { provider, scope, account } of scopes.values()) {
      let discovered: Omit<DiscoveredCluster, 'alreadyRegistered'>[] = [];
      try {
        discovered = await this.discoverOnboardedClustersByProvider(
          provider,
          scope,
        );
      } catch (err) {
        if (this.logger) {
          this.logger.warn(
            `[platform-registry] Live cluster discovery failed for ${provider} ${scope}: ${err}`,
          );
        }
        continue;
      }

      for (const item of discovered) {
        const platformCode = (
          item.customerTag ||
          item.platformCode ||
          account?.platform_code ||
          'cms'
        ).toLowerCase();
        const platformName = (
          account?.platform_name || platformCode.toUpperCase()
        );
        const envName = (item.environmentName || 'dev').toLowerCase();
        const envType = ['prod', 'production', 'live'].includes(envName)
          ? 'prod'
          : 'non-prod';

        try {
          // 1. Ensure platform exists
          let platformId = account?.platform_id;
          if (!platformId) {
            const platRows = await this.db.query<{ id: string }>(
              'SELECT id FROM pr_platforms WHERE LOWER(platform_code) = $1',
              [platformCode],
            );
            if (platRows[0]?.id) {
              platformId = platRows[0].id;
            } else {
              const newPlatId = randomUUID();
              await this.db.query(
                `INSERT INTO pr_platforms (id, platform_code, platform_name, platform_type, status)
                 VALUES ($1, $2, $3, 'enterprise', 'active')
                 ON CONFLICT (platform_code) DO NOTHING`,
                [newPlatId, platformCode, platformName],
              );
              const refetch = await this.db.query<{ id: string }>(
                'SELECT id FROM pr_platforms WHERE LOWER(platform_code) = $1',
                [platformCode],
              );
              platformId = refetch[0]?.id ?? newPlatId;
            }
          }

          // 2. Ensure cloud account exists
          let cloudAccountId = account?.id;
          if (!cloudAccountId && platformId) {
            const caRows = await this.db.query<{ id: string }>(
              'SELECT id FROM pr_cloud_accounts WHERE cloud_provider = $1 AND account_identifier = $2',
              [provider, scope],
            );
            if (caRows[0]?.id) {
              cloudAccountId = caRows[0].id;
            } else {
              const newCaId = randomUUID();
              await this.db.query(
                `INSERT INTO pr_cloud_accounts (id, platform_id, cloud_provider, account_name, account_identifier, status)
                 VALUES ($1, $2, $3, $4, $5, 'active')
                 ON CONFLICT (cloud_provider, account_identifier) DO NOTHING`,
                [newCaId, platformId, provider, `${provider.toLowerCase()}-account`, scope],
              );
              const refetchCa = await this.db.query<{ id: string }>(
                'SELECT id FROM pr_cloud_accounts WHERE cloud_provider = $1 AND account_identifier = $2',
                [provider, scope],
              );
              cloudAccountId = refetchCa[0]?.id ?? newCaId;
            }
          }

          // 3. Ensure environment exists
          let environmentId = null;
          if (platformId) {
            const envRows = await this.db.query<{ id: string }>(
              'SELECT id FROM pr_environments WHERE platform_id = $1 AND LOWER(environment_name) = $2',
              [platformId, envName],
            );
            if (envRows[0]?.id) {
              environmentId = envRows[0].id;
            } else {
              const newEnvId = randomUUID();
              await this.db.query(
                `INSERT INTO pr_environments (id, platform_id, environment_name, environment_type, status)
                 VALUES ($1, $2, $3, $4, 'active')
                 ON CONFLICT (platform_id, environment_name) DO NOTHING`,
                [newEnvId, platformId, envName, envType],
              );
              const refetchEnv = await this.db.query<{ id: string }>(
                'SELECT id FROM pr_environments WHERE platform_id = $1 AND LOWER(environment_name) = $2',
                [platformId, envName],
              );
              environmentId = refetchEnv[0]?.id ?? newEnvId;
            }
          }

          // 4. Upsert cluster in pr_clusters
          if (platformId) {
            const existingCluster = await this.db.query<{ id: string }>(
              'SELECT id FROM pr_clusters WHERE cluster_name = $1 AND platform_id = $2',
              [item.clusterName, platformId],
            );
            if (existingCluster.length > 0) {
              await this.db.query(
                `UPDATE pr_clusters SET
                   environment_id = COALESCE($1, environment_id),
                   cloud_account_id = COALESCE($2, cloud_account_id),
                   region = $3,
                   resource_group = $4,
                   account_scope = $5,
                   cluster_endpoint = $6,
                   kubernetes_version = $7,
                   active = $8,
                   status = $9,
                   last_synced_at = NOW()
                 WHERE id = $10`,
                [
                  environmentId,
                  cloudAccountId,
                  item.region ?? null,
                  item.resourceGroup ?? null,
                  scope,
                  item.clusterEndpoint ?? null,
                  item.kubernetesVersion ?? null,
                  item.active ?? true,
                  item.status ?? 'active',
                  existingCluster[0].id,
                ],
              );
            } else {
              const newClusterId = randomUUID();
              await this.db.query(
                `INSERT INTO pr_clusters (
                   id, platform_id, environment_id, cloud_account_id, cluster_name, cluster_type,
                   provider, region, resource_group, account_scope, cluster_endpoint,
                   kubernetes_version, active, status, discovered_at, last_synced_at
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
                 ON CONFLICT (cluster_name, platform_id) DO UPDATE SET
                   environment_id = COALESCE(EXCLUDED.environment_id, pr_clusters.environment_id),
                   cloud_account_id = COALESCE(EXCLUDED.cloud_account_id, pr_clusters.cloud_account_id),
                   region = EXCLUDED.region,
                   resource_group = EXCLUDED.resource_group,
                   account_scope = EXCLUDED.account_scope,
                   cluster_endpoint = EXCLUDED.cluster_endpoint,
                   kubernetes_version = EXCLUDED.kubernetes_version,
                   active = EXCLUDED.active,
                   status = EXCLUDED.status,
                   last_synced_at = NOW()`,
                [
                  newClusterId,
                  platformId,
                  environmentId,
                  cloudAccountId,
                  item.clusterName,
                  item.clusterType,
                  provider,
                  item.region ?? null,
                  item.resourceGroup ?? null,
                  scope,
                  item.clusterEndpoint ?? null,
                  item.kubernetesVersion ?? null,
                  item.active ?? true,
                  item.status ?? 'active',
                ],
              );
            }
            synced++;
          }
        } catch (dbErr) {
          if (this.logger) {
            this.logger.warn(
              `[platform-registry] Failed to persist cluster ${item.clusterName}: ${dbErr}`,
            );
          }
        }
      }
    }
    return { synced };
  }

  private async listLiveOnboardedClusters(
    opts: ListOptions,
  ): Promise<ListResult<Cluster>> {
    try {
      await this.syncLiveOnboardedClusters();
    } catch (err) {
      if (this.logger) {
        this.logger.warn(
          `[platform-registry] Live cluster sync prior to list failed: ${err}`,
        );
      }
    }
    const providerFilter = normalizeProviderFilter(opts.provider);
    const accounts = await this.db.query<any>(
      `SELECT ca.id,
              ca.platform_id,
              ca.cloud_provider,
              ca.account_identifier,
              t.platform_name
       FROM pr_cloud_accounts ca
       LEFT JOIN pr_platforms t ON t.id = ca.platform_id
       WHERE ca.status = 'active'`,
    );

    const registeredRows = await this.db.query<ClusterRow>(
      `SELECT c.*, t.platform_name, e.environment_name,
              ca.account_identifier, ca.cloud_provider
       FROM pr_clusters c
       LEFT JOIN pr_platforms t ON t.id = c.platform_id
       LEFT JOIN pr_environments e ON e.id = c.environment_id
       LEFT JOIN pr_cloud_accounts ca ON ca.id = c.cloud_account_id`,
    );

    const registeredByIdentity = new Map<string, Cluster>();
    for (const row of registeredRows) {
      const mapped = this.mapCluster(row);
      const provider = mapped.provider;
      const scope = String(
        mapped.accountScope ?? row.account_identifier ?? '',
      ).trim();
      if (!provider || !scope) {
        continue;
      }
      const key = this.buildClusterIdentity(
        provider,
        scope,
        mapped.clusterName,
        mapped.resourceGroup,
      );
      registeredByIdentity.set(key, mapped);
    }

    const scopes = new Map<
      string,
      { provider: CloudProvider; scope: string; account?: any }
    >();

    for (const account of accounts) {
      const provider = account.cloud_provider as CloudProvider;
      const scope = String(account.account_identifier ?? '').trim();
      if (!provider || !scope) {
        continue;
      }
      if (providerFilter && provider !== providerFilter) {
        continue;
      }
      scopes.set(this.buildEligibilityKey(provider, scope), {
        provider,
        scope,
        account,
      });
    }

    if (!providerFilter || providerFilter === 'AZURE') {
      for (const subscriptionId of defaultAzureSubscriptionIds()) {
        const key = this.buildEligibilityKey('AZURE', subscriptionId);
        if (!scopes.has(key)) {
          scopes.set(key, {
            provider: 'AZURE',
            scope: subscriptionId,
          });
        }
      }
    }

    const live: Cluster[] = [];
    const seen = new Set<string>();
    const discoveryErrors: string[] = [];
    for (const { provider, scope, account } of scopes.values()) {
      const safeSubscriptionId = String(scope ?? '').trim().replace(/'/g, "''");
      let discovered: Omit<DiscoveredCluster, 'alreadyRegistered'>[] = [];
      try {
        discovered = await this.discoverOnboardedClustersByProvider(
          provider,
          scope,
        );
      } catch (error) {
        discoveryErrors.push(
          error instanceof Error ? error.message : String(error),
        );
        discovered = [];
      }

      for (const item of discovered) {
        const identity = this.buildClusterIdentity(
          provider,
          scope,
          item.clusterName,
          item.resourceGroup,
        );
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        const registered = registeredByIdentity.get(identity);

        live.push({
          id:
            registered?.id ??
            `discovered:${provider}:${scope}:${item.clusterName}:${item.resourceGroup ?? ''}`,
          platformId: registered?.platformId ?? account?.platform_id ?? '',
          platformName:
            registered?.platformName ?? account?.platform_name ?? undefined,
          customerTag:
            item.customerTag ??
            registered?.customerTag ??
            (item.platformCode ? item.platformCode.toUpperCase() : undefined),
          envTag:
            registered?.envTag ??
            item.envTag ??
            (item.environmentName
              ? item.environmentName.toUpperCase()
              : undefined),
          customerId:
            registered?.customerId ??
            registered?.platformId ??
            account?.platform_id ??
            undefined,
          customerName:
            item.customerTag ??
            registered?.customerName ??
            registered?.platformName ??
            account?.platform_name ??
            (item.platformCode ? item.platformCode.toUpperCase() : undefined),
          environment:
            registered?.environment ??
            registered?.environmentName ??
            (item.environmentName ? item.environmentName.toUpperCase() : 'PROD'),
          environmentId: registered?.environmentId ?? null,
          environmentName: registered?.environmentName ?? undefined,
          cloudAccountId: registered?.cloudAccountId ?? account?.id ?? null,
          clusterName: item.clusterName,
          clusterType: item.clusterType,
          provider: item.provider,
          subscriptionId:
            registered?.subscriptionId ??
            item.accountScope ??
            safeSubscriptionId,
          region: item.region,
          secondaryRegion: registered?.secondaryRegion ?? null,
          resourceGroup: item.resourceGroup,
          accountScope: item.accountScope,
          clusterEndpoint: item.clusterEndpoint,
          kubernetesVersion: item.kubernetesVersion,
          netrevealVersion: registered?.netrevealVersion ?? 'v9.6',
          postgresReportingService:
            registered?.postgresReportingService ?? 'postgres-ro',
          postgresReportingNamespace:
            registered?.postgresReportingNamespace ?? 'nrod',
          active: registered?.active ?? item.active ?? true,
          status: registered?.status ?? item.status ?? 'active',
          discoveredAt: registered?.discoveredAt ?? null,
          lastSyncedAt: registered?.lastSyncedAt ?? null,
        });
      }
    }

    if (live.length === 0 && discoveryErrors.length > 0) {
      throw new PlatformRegistryPolicyError(
        `Failed to load CloudHub-tagged Kubernetes clusters: ${discoveryErrors[0]}`,
        502,
      );
    }

    const searched = this.applyClusterSearch(live, opts.search);
    const sorted = this.sortClusters(searched);
    const total = sorted.length;
    const start = opts.page * opts.pageSize;
    const end = start + opts.pageSize;
    return this.page(sorted.slice(start, end), total, opts);
  }

  async listClusters(opts: ListOptions): Promise<ListResult<Cluster>> {
    return this.listLiveOnboardedClusters(opts);
  }

  async listOnboardedClusters(opts: ListOptions): Promise<ListResult<Cluster>> {
    return this.listLiveOnboardedClusters(opts);
  }

  async listCustomers(): Promise<Array<{ customerName: string; customerId?: string; platformCode?: string }>> {
    const clusters = await this.listClusters({ page: 0, pageSize: 500 });
    const unique = new Map<
      string,
      { customerName: string; customerId?: string; platformCode?: string }
    >();

    for (const cluster of clusters.items) {
      const customerName =
        (cluster.customerName || cluster.customerTag || cluster.platformName || '')
          .trim();
      if (!customerName) continue;

      const key = customerName.toLowerCase().replace(/\s+/g, '');
      if (!unique.has(key)) {
        unique.set(key, {
          customerName,
          customerId: cluster.customerId ?? cluster.platformId,
          platformCode: cluster.customerTag || undefined,
        });
      }
    }

    return Array.from(unique.values()).sort((a, b) =>
      a.customerName.localeCompare(b.customerName, undefined, {
        sensitivity: 'base',
      }),
    );
  }

  async listCustomerClusters(
    customer: string,
    environmentFilter?: string,
  ): Promise<Array<Partial<Cluster> & { clusterName: string; environment: string }>> {
    const target = customer.trim().toLowerCase();
    const targetCompact = target.replace(/\s+/g, '');
    const clusters = await this.listClusters({ page: 0, pageSize: 200 });
    const matched = clusters.items.filter(c => {
      const tagCustomer = (c.customerTag ?? '').toLowerCase();
      const pId = (c.platformId ?? '').toLowerCase();
      const pName = (c.platformName ?? '').toLowerCase();
      const cName = (c.customerName ?? '').toLowerCase();
      return (
        tagCustomer === target ||
        tagCustomer.replace(/\s+/g, '') === targetCompact ||
        pId === target ||
        pName === target ||
        pName.replace(/\s+/g, '') === targetCompact ||
        cName === target ||
        cName.replace(/\s+/g, '') === targetCompact
      );
    });

    const envTarget = (environmentFilter || 'PROD').trim().toUpperCase();
    const filtered = matched.filter(c => {
      if ((c.status ?? 'active').toLowerCase() !== 'active') return false;
      const env = (c.environment ?? c.environmentName ?? 'PROD').toUpperCase();
      return env === envTarget || env.startsWith(envTarget);
    });

    return filtered.map(c => ({
      clusterName: c.clusterName,
      environment: c.environment ?? c.environmentName ?? 'PROD',
      customerTag: c.customerTag,
      envTag: c.envTag,
      customerId: c.customerId ?? c.platformId,
      customerName: c.customerName ?? c.platformName,
      region: c.region,
      resourceGroup: c.resourceGroup,
      subscriptionId: c.subscriptionId ?? c.accountScope,
      netrevealVersion: c.netrevealVersion ?? 'v9.6',
      postgresReportingService: c.postgresReportingService ?? 'postgres-ro',
      postgresReportingNamespace: c.postgresReportingNamespace ?? 'nrod',
      active: c.active ?? true,
      status: c.status,
    }));
  }

  async getCluster(id: string): Promise<Cluster | null> {
    const rows = await this.db.query<any>(
      `SELECT c.*, t.platform_name, e.environment_name FROM pr_clusters c
       LEFT JOIN pr_platforms t ON t.id = c.platform_id
       LEFT JOIN pr_environments e ON e.id = c.environment_id WHERE c.id = $1`,
      [id],
    );
    return rows[0] ? this.mapCluster(rows[0]) : null;
  }

  async createCluster(input: Partial<Cluster>): Promise<Cluster> {
    if (!input.cloudAccountId) {
      throw new PlatformRegistryPolicyError(
        'cloudAccountId is required. Manual cluster registration must be validated against an onboarded cloud account.',
        400,
      );
    }

    const account = await this.getCloudAccountOrThrow(input.cloudAccountId);
    const effectiveProvider = (account.cloud_provider ?? input.provider) as
      | CloudProvider
      | undefined;
    const scope = String(
      input.accountScope ?? account.account_identifier ?? '',
    ).trim();

    if (!effectiveProvider || !scope) {
      throw new PlatformRegistryPolicyError(
        'Unable to resolve provider/account scope for onboarding-tag verification.',
        400,
      );
    }

    const discovered = await this.discoverOnboardedClustersByProvider(
      effectiveProvider,
      scope,
    );
    const match = this.findDiscoveredClusterMatch(
      discovered,
      effectiveProvider,
      String(input.clusterName ?? ''),
      input.resourceGroup ?? null,
    );
    if (!match) {
      throw new PlatformRegistryPolicyError(
        `Cluster '${String(input.clusterName ?? '')}' is not currently onboarded for CloudHub. Required tags: cloudhub-onboarded=true. Use cloudhub-enabled=false to keep it registered but inactive.`,
        403,
      );
    }

    const id = randomUUID();
    await this.db.query(
      `INSERT INTO pr_clusters
        (id, platform_id, environment_id, cloud_account_id, cluster_name, cluster_type, provider,
         region, secondary_region, resource_group, account_scope, cluster_endpoint,
         kubernetes_version, status, discovered_at, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW(), NOW())`,
      [
        id,
        input.platformId,
        input.environmentId ?? null,
        input.cloudAccountId,
        input.clusterName,
        input.clusterType ?? match.clusterType,
        effectiveProvider,
        input.region ?? match.region ?? null,
        input.secondaryRegion ?? null,
        input.resourceGroup ?? match.resourceGroup ?? null,
        scope,
        input.clusterEndpoint ?? match.clusterEndpoint ?? null,
        input.kubernetesVersion ?? match.kubernetesVersion ?? null,
        input.status ?? 'active',
      ],
    );
    return (await this.getCluster(id))!;
  }

  async deleteCluster(id: string): Promise<void> {
    await this.db.query('DELETE FROM pr_clusters WHERE id = $1', [id]);
  }

  // ------------------------------------------------------------- Namespaces
  async listNamespaces(opts: ListOptions): Promise<ListResult<Namespace>> {
    const { where, params } = this.buildSearch(
      opts.search,
      ['namespace_name', 'owner', 'purpose'],
      'n',
    );
    const total = await this.count('pr_namespaces n', where, params);
    const rows = await this.db.query<any>(
      `SELECT n.*, c.cluster_name FROM pr_namespaces n
       LEFT JOIN pr_clusters c ON c.id = n.cluster_id
       ${where} ORDER BY c.cluster_name ASC, n.namespace_name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.pageSize, opts.page * opts.pageSize],
    );
    return this.page(rows.map(this.mapNamespace), total, opts);
  }

  async createNamespace(input: Partial<Namespace>): Promise<Namespace> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO pr_namespaces (id, cluster_id, namespace_name, owner, purpose, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        input.clusterId,
        input.namespaceName,
        input.owner ?? null,
        input.purpose ?? null,
        input.status ?? 'active',
      ],
    );
    const rows = await this.db.query<any>(
      `SELECT n.*, c.cluster_name FROM pr_namespaces n
       LEFT JOIN pr_clusters c ON c.id = n.cluster_id WHERE n.id = $1`,
      [id],
    );
    return this.mapNamespace(rows[0]);
  }

  async deleteNamespace(id: string): Promise<void> {
    await this.db.query('DELETE FROM pr_namespaces WHERE id = $1', [id]);
  }

  // ------------------------------------------------------- Deployment targets
  async listDeploymentTargets(
    opts: ListOptions,
  ): Promise<ListResult<DeploymentTarget>> {
    const { where, params } = this.buildSearch(
      opts.search,
      ['target_name', 'deployment_type'],
      'dt',
    );
    const total = await this.count('pr_deployment_targets dt', where, params);
    const rows = await this.db.query<any>(
      `SELECT dt.*, t.platform_name, e.environment_name, c.cluster_name, n.namespace_name
       FROM pr_deployment_targets dt
       LEFT JOIN pr_platforms t ON t.id = dt.platform_id
       LEFT JOIN pr_environments e ON e.id = dt.environment_id
       LEFT JOIN pr_clusters c ON c.id = dt.cluster_id
       LEFT JOIN pr_namespaces n ON n.id = dt.namespace_id
       ${where} ORDER BY dt.target_name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.pageSize, opts.page * opts.pageSize],
    );
    return this.page(rows.map(this.mapDeploymentTarget), total, opts);
  }

  async createDeploymentTarget(
    input: Partial<DeploymentTarget>,
  ): Promise<DeploymentTarget> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO pr_deployment_targets
        (id, platform_id, environment_id, cluster_id, namespace_id, target_name, deployment_type, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        input.platformId,
        input.environmentId ?? null,
        input.clusterId ?? null,
        input.namespaceId ?? null,
        input.targetName,
        input.deploymentType ?? null,
        input.status ?? 'active',
      ],
    );
    const rows = await this.db.query<any>(
      `SELECT dt.*, t.platform_name, e.environment_name, c.cluster_name, n.namespace_name
       FROM pr_deployment_targets dt
       LEFT JOIN pr_platforms t ON t.id = dt.platform_id
       LEFT JOIN pr_environments e ON e.id = dt.environment_id
       LEFT JOIN pr_clusters c ON c.id = dt.cluster_id
       LEFT JOIN pr_namespaces n ON n.id = dt.namespace_id WHERE dt.id = $1`,
      [id],
    );
    return this.mapDeploymentTarget(rows[0]);
  }

  async deleteDeploymentTarget(id: string): Promise<void> {
    await this.db.query('DELETE FROM pr_deployment_targets WHERE id = $1', [
      id,
    ]);
  }

  // ------------------------------------------------------------ Applications
  async listApplications(opts: ListOptions): Promise<ListResult<Application>> {
    const { where, params } = this.buildSearch(opts.search, [
      'application_name',
      'application_type',
      'helm_chart',
    ]);
    const total = await this.count('pr_applications', where, params);
    const rows = await this.db.query<any>(
      `SELECT * FROM pr_applications ${where} ORDER BY application_name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.pageSize, opts.page * opts.pageSize],
    );
    return this.page(rows.map(this.mapApplication), total, opts);
  }

  async createApplication(input: Partial<Application>): Promise<Application> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO pr_applications
        (id, application_name, application_type, helm_chart, repository, default_namespace, supported_platforms)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        input.applicationName,
        input.applicationType ?? null,
        input.helmChart ?? null,
        input.repository ?? null,
        input.defaultNamespace ?? null,
        input.supportedPlatforms ?? [],
      ],
    );
    const rows = await this.db.query<any>(
      'SELECT * FROM pr_applications WHERE id = $1',
      [id],
    );
    return this.mapApplication(rows[0]);
  }

  async deleteApplication(id: string): Promise<void> {
    await this.db.query('DELETE FROM pr_applications WHERE id = $1', [id]);
  }

  // ------------------------------------------------------------- Deployments
  async listDeployments(opts: ListOptions): Promise<ListResult<Deployment>> {
    const { where, params } = this.buildSearch(
      opts.search,
      ['version', 'deployed_by'],
      'd',
    );
    const total = await this.count('pr_deployments d', where, params);
    const rows = await this.db.query<any>(
      `SELECT d.*, dt.target_name, a.application_name FROM pr_deployments d
       LEFT JOIN pr_deployment_targets dt ON dt.id = d.deployment_target_id
       LEFT JOIN pr_applications a ON a.id = d.application_id
       ${where} ORDER BY d.deployed_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.pageSize, opts.page * opts.pageSize],
    );
    return this.page(rows.map(this.mapDeployment), total, opts);
  }

  async createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
    if (!input.deploymentTargetId || !input.applicationId) {
      throw new Error('deploymentTargetId and applicationId are required');
    }
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO pr_deployments
        (id, deployment_target_id, application_id, version, status, deployed_by, deployed_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
      [
        id,
        input.deploymentTargetId,
        input.applicationId,
        input.version ?? null,
        input.deployedBy ?? null,
      ],
    );
    await this.recordEvent(
      id,
      'created',
      null,
      'pending',
      null,
      input.deployedBy ?? null,
    );
    return this.getDeployment(id);
  }

  async getDeployment(id: string): Promise<Deployment> {
    const rows = await this.db.query<any>(
      `SELECT d.*, dt.target_name, a.application_name FROM pr_deployments d
       LEFT JOIN pr_deployment_targets dt ON dt.id = d.deployment_target_id
       LEFT JOIN pr_applications a ON a.id = d.application_id WHERE d.id = $1`,
      [id],
    );
    if (rows.length === 0) {
      throw new Error('Deployment not found');
    }
    return this.mapDeployment(rows[0]);
  }

  /**
   * Advance a deployment to the next lifecycle state. Promoting to `active`
   * supersedes any other active deployment of the same application on the same
   * target so the registry always reflects a single live version.
   */
  async transitionDeployment(
    id: string,
    input: TransitionDeploymentInput,
  ): Promise<Deployment> {
    const current = await this.getDeployment(id);
    const allowed = DEPLOYMENT_TRANSITIONS[current.status] ?? [];
    if (current.status === input.status) {
      return current;
    }
    if (!allowed.includes(input.status)) {
      throw new Error(
        `Invalid transition: ${current.status} → ${input.status}`,
      );
    }

    if (input.status === 'active') {
      await this.supersedeActiveDeployments(
        current.deploymentTargetId,
        current.applicationId,
        id,
        input.actor ?? null,
      );
    }

    await this.db.query('UPDATE pr_deployments SET status = $1 WHERE id = $2', [
      input.status,
      id,
    ]);
    await this.recordEvent(
      id,
      'status_changed',
      current.status,
      input.status,
      input.note ?? null,
      input.actor ?? null,
    );
    return this.getDeployment(id);
  }

  /**
   * Roll back an active (or failed) deployment. The most recently superseded
   * deployment of the same application/target is reactivated so the previous
   * known-good version becomes live again.
   */
  async rollbackDeployment(
    id: string,
    input: RollbackDeploymentInput,
  ): Promise<Deployment> {
    const current = await this.getDeployment(id);
    if (current.status !== 'active' && current.status !== 'failed') {
      throw new Error(
        `Only active or failed deployments can be rolled back (current: ${current.status})`,
      );
    }

    await this.db.query('UPDATE pr_deployments SET status = $1 WHERE id = $2', [
      'rolled_back',
      id,
    ]);
    await this.recordEvent(
      id,
      'rolled_back',
      current.status,
      'rolled_back',
      input.note ?? null,
      input.actor ?? null,
    );

    const previous = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM pr_deployments
       WHERE deployment_target_id = $1 AND application_id = $2
         AND id <> $3 AND status = 'superseded'
       ORDER BY deployed_at DESC LIMIT 1`,
      [current.deploymentTargetId, current.applicationId, id],
    );
    if (previous.length > 0) {
      const prevId = previous[0].id;
      await this.db.query(
        'UPDATE pr_deployments SET status = $1 WHERE id = $2',
        ['active', prevId],
      );
      await this.recordEvent(
        prevId,
        'status_changed',
        'superseded',
        'active',
        `Reactivated by rollback of ${id}`,
        input.actor ?? null,
      );
    }

    return this.getDeployment(id);
  }

  async listDeploymentEvents(deploymentId: string): Promise<DeploymentEvent[]> {
    const rows = await this.db.query<any>(
      `SELECT * FROM pr_deployment_events
       WHERE deployment_id = $1 ORDER BY created_at DESC`,
      [deploymentId],
    );
    return rows.map(this.mapDeploymentEvent);
  }

  private async supersedeActiveDeployments(
    targetId: string,
    applicationId: string,
    exceptId: string,
    actor: string | null,
  ): Promise<void> {
    const active = await this.db.query<{ id: string }>(
      `SELECT id FROM pr_deployments
       WHERE deployment_target_id = $1 AND application_id = $2
         AND id <> $3 AND status = 'active'`,
      [targetId, applicationId, exceptId],
    );
    for (const row of active) {
      await this.db.query(
        'UPDATE pr_deployments SET status = $1 WHERE id = $2',
        ['superseded', row.id],
      );
      await this.recordEvent(
        row.id,
        'status_changed',
        'active',
        'superseded',
        `Superseded by ${exceptId}`,
        actor,
      );
    }
  }

  private async recordEvent(
    deploymentId: string,
    eventType: string,
    fromStatus: DeploymentStatus | null,
    toStatus: DeploymentStatus,
    note: string | null,
    actor: string | null,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO pr_deployment_events
        (id, deployment_id, event_type, from_status, to_status, note, actor, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        randomUUID(),
        deploymentId,
        eventType,
        fromStatus,
        toStatus,
        note,
        actor,
      ],
    );
  }

  // -------------------------------------------------------------- Onboarding
  async onboardPlatform(
    input: OnboardPlatformInput,
  ): Promise<OnboardPlatformResult> {
    const platform = await this.createPlatform({
      platformCode: input.platform.platformCode,
      platformName: input.platform.platformName,
      platformType: input.platform.platformType ?? null,
      ownerEmail: input.platform.ownerEmail ?? null,
    });

    let cloudAccount: CloudAccount | null = null;
    if (input.cloudAccount) {
      cloudAccount = await this.createCloudAccount({
        platformId: input.cloudAccount.platformId ?? null,
        cloudProvider: input.cloudAccount.cloudProvider,
        accountName: input.cloudAccount.accountName,
        accountIdentifier: input.cloudAccount.accountIdentifier,
      });
    }

    const environments: Environment[] = [];
    for (const name of input.environments ?? []) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      environments.push(
        await this.createEnvironment({
          platformId: platform.id,
          environmentName: trimmed,
          environmentType: ['prod', 'production'].includes(
            trimmed.toLowerCase(),
          )
            ? 'prod'
            : 'non-prod',
        }),
      );
    }

    return { platform, cloudAccount, environments };
  }

  // --------------------------------------------------------------- Discovery
  async discoverClusters(
    cloudAccountId: string,
    provider: CloudProvider,
  ): Promise<DiscoveredCluster[]> {
    const account = await this.getCloudAccountOrThrow(cloudAccountId);

    const scope = account?.account_identifier ?? 'unknown-account';
    const effectiveProvider: CloudProvider =
      account?.cloud_provider ?? provider;

    const existing = await this.db.query<{ cluster_name: string }>(
      'SELECT cluster_name FROM pr_clusters',
    );
    const existingNames = new Set(existing.map(r => r.cluster_name));

    const discovered = await this.discoverOnboardedClustersByProvider(
      effectiveProvider,
      scope,
    );
    return discovered.map(c => ({
      ...c,
      alreadyRegistered: existingNames.has(c.clusterName),
    }));
  }

  async importClusters(
    input: ImportClustersInput,
  ): Promise<{ imported: number }> {
    const eligibilityCache = new Map<string, Set<string>>();

    let imported = 0;
    for (const c of input.clusters) {
      const scope = String(c.accountScope ?? '').trim();
      if (!scope) {
        throw new PlatformRegistryPolicyError(
          `Cluster '${c.clusterName}' cannot be imported because account scope is missing for provider ${c.provider}.`,
          400,
        );
      }

      const cacheKey = `${c.provider}:${scope}`;
      if (!eligibilityCache.has(cacheKey)) {
        const eligible = await this.discoverOnboardedClustersByProvider(
          c.provider,
          scope,
        );
        eligibilityCache.set(
          cacheKey,
          new Set(eligible.map(item => item.clusterName.toLowerCase())),
        );
      }

      const eligibleNames = eligibilityCache.get(cacheKey)!;
      if (!eligibleNames.has(c.clusterName.toLowerCase())) {
        throw new PlatformRegistryPolicyError(
          `Cluster '${c.clusterName}' is not onboarded for CloudHub in ${c.provider}. Required tags: cloudhub-onboarded=true. Use cloudhub-enabled=false to keep it registered but inactive.`,
          403,
        );
      }

      const existing = await this.db.query<{ id: string }>(
        'SELECT id FROM pr_clusters WHERE cluster_name = $1 AND platform_id = $2',
        [c.clusterName, input.platformId],
      );
      if (existing.length > 0) continue;
      await this.createCluster({
        platformId: input.platformId,
        environmentId: input.environmentId ?? null,
        cloudAccountId: input.cloudAccountId ?? null,
        clusterName: c.clusterName,
        clusterType: c.clusterType,
        provider: c.provider,
        region: c.region,
        resourceGroup: c.resourceGroup ?? null,
        accountScope: c.accountScope ?? null,
        clusterEndpoint: c.clusterEndpoint,
        kubernetesVersion: c.kubernetesVersion,
      });
      imported += 1;
    }
    return { imported };
  }

  private buildSearch(
    search: string | undefined,
    columns: string[],
    alias?: string,
  ): { where: string; params: unknown[] } {
    if (!search) {
      return { where: '', params: [] };
    }
    const prefix = alias ? `${alias}.` : '';
    const clauses = columns.map(col => `${prefix}${col} ILIKE $1`).join(' OR ');
    return { where: `WHERE (${clauses})`, params: [`%${search}%`] };
  }

  private sortClause(
    sortBy: string | undefined,
    sortOrder: 'asc' | 'desc' | undefined,
    allowed: Record<string, string>,
    fallback: string,
  ): string {
    const column = (sortBy && allowed[sortBy]) || fallback;
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';
    return `ORDER BY ${column} ${order}`;
  }

  private async count(
    table: string,
    where: string,
    params: unknown[],
  ): Promise<number> {
    const rows = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${table} ${where}`,
      params,
    );
    return rows[0]?.count ?? 0;
  }

  private page<T>(items: T[], total: number, opts: ListOptions): ListResult<T> {
    return { items, total, page: opts.page, pageSize: opts.pageSize };
  }

  // ----------------------------------------------------------------- Mappers
  private mapPlatform = (r: any): Platform => ({
    id: r.id,
    platformCode: r.platform_code,
    platformName: r.platform_name,
    platformType: r.platform_type,
    status: r.status,
    ownerEmail: r.owner_email,
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at),
    updatedAt: r.updated_at?.toISOString?.() ?? String(r.updated_at),
  });

  private mapCloudAccount = (r: any): CloudAccount => ({
    id: r.id,
    platformId: r.platform_id ?? null,
    platformName: r.platform_name ?? undefined,
    cloudProvider: r.cloud_provider,
    accountName: r.account_name,
    accountIdentifier: r.account_identifier,
    status: r.status,
  });

  private mapEnvironment = (r: any): Environment => ({
    id: r.id,
    platformId: r.platform_id,
    platformName: r.platform_name ?? undefined,
    environmentName: r.environment_name,
    environmentType: r.environment_type,
    status: r.status,
  });

  private mapCluster = (r: any): Cluster => ({
    id: r.id,
    platformId: r.platform_id,
    platformName: r.platform_name ?? undefined,
    customerTag: r.customer_tag ?? r.customer_name ?? r.platform_name ?? undefined,
    envTag: r.env_tag ?? r.environment ?? r.environment_name ?? undefined,
    customerId: r.customer_id ?? r.platform_id ?? undefined,
    customerName: r.customer_name ?? r.platform_name ?? undefined,
    environment: r.environment ?? r.environment_name ?? 'PROD',
    environmentId: r.environment_id,
    environmentName: r.environment_name ?? undefined,
    cloudAccountId: r.cloud_account_id,
    clusterName: r.cluster_name,
    clusterType: r.cluster_type,
    provider: r.provider,
    subscriptionId: r.subscription_id ?? r.account_scope ?? undefined,
    region: r.region,
    secondaryRegion: r.secondary_region,
    resourceGroup: r.resource_group,
    accountScope: r.account_scope,
    clusterEndpoint: r.cluster_endpoint,
    kubernetesVersion: r.kubernetes_version,
    netrevealVersion: r.netreveal_version ?? 'v9.6',
    postgresReportingService: r.postgres_reporting_service ?? 'postgres-ro',
    postgresReportingNamespace: r.postgres_reporting_namespace ?? 'nrod',
    active: r.active ?? (r.status === 'active'),
    status: r.status,
    discoveredAt:
      r.discovered_at?.toISOString?.() ??
      (r.discovered_at ? String(r.discovered_at) : null),
    lastSyncedAt:
      r.last_synced_at?.toISOString?.() ??
      (r.last_synced_at ? String(r.last_synced_at) : null),
  });

  private mapNamespace = (r: any): Namespace => ({
    id: r.id,
    clusterId: r.cluster_id,
    clusterName: r.cluster_name ?? undefined,
    namespaceName: r.namespace_name,
    owner: r.owner,
    purpose: r.purpose,
    status: r.status,
  });

  private mapDeploymentTarget = (r: any): DeploymentTarget => ({
    id: r.id,
    platformId: r.platform_id,
    platformName: r.platform_name ?? undefined,
    environmentId: r.environment_id,
    environmentName: r.environment_name ?? undefined,
    clusterId: r.cluster_id,
    clusterName: r.cluster_name ?? undefined,
    namespaceId: r.namespace_id,
    namespaceName: r.namespace_name ?? undefined,
    targetName: r.target_name,
    deploymentType: r.deployment_type,
    status: r.status,
  });

  private mapApplication = (r: any): Application => ({
    id: r.id,
    applicationName: r.application_name,
    applicationType: r.application_type,
    helmChart: r.helm_chart,
    repository: r.repository,
    defaultNamespace: r.default_namespace,
    supportedPlatforms: r.supported_platforms ?? [],
  });

  private mapDeployment = (r: any): Deployment => ({
    id: r.id,
    deploymentTargetId: r.deployment_target_id,
    targetName: r.target_name ?? undefined,
    applicationId: r.application_id,
    applicationName: r.application_name ?? undefined,
    version: r.version,
    status: r.status,
    deployedBy: r.deployed_by,
    deployedAt: r.deployed_at?.toISOString?.() ?? String(r.deployed_at),
  });

  private mapDeploymentEvent = (r: any): DeploymentEvent => ({
    id: r.id,
    deploymentId: r.deployment_id,
    eventType: r.event_type,
    fromStatus: r.from_status ?? null,
    toStatus: r.to_status,
    note: r.note ?? null,
    actor: r.actor ?? null,
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at),
  });
}
