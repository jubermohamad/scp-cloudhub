import type {
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';

export interface CloudHubNetworkConfig {
  subscriptionId: string;
  resourceGroup: string;
  vnetName: string;
  subnetName: string;
  region: string;
}

export interface CloudHubNetworksConfig {
  [profileName: string]: CloudHubNetworkConfig;
}

function normalizeProfileName(name: string): string {
  return name.trim().toLowerCase();
}

// Accepts both raw JSON (from CLOUDHUB_NETWORKS_JSON) and already-parsed
// profiles, since the constructor re-validates profiles sourced from
// app-config as well.
function parseRecord(
  profileName: string,
  value: CloudHubNetworkConfig | Record<string, unknown>,
): CloudHubNetworkConfig {
  const profile = normalizeProfileName(profileName);
  const network: CloudHubNetworkConfig = {
    subscriptionId: String(value.subscriptionId ?? '').trim(),
    resourceGroup: String(value.resourceGroup ?? '').trim(),
    vnetName: String(value.vnetName ?? '').trim(),
    subnetName: String(value.subnetName ?? '').trim(),
    region: String(value.region ?? '')
      .trim()
      .toLowerCase(),
  };

  const missing = Object.entries(network)
    .filter(([, field]) => !field)
    .map(([field]) => field);
  if (missing.length > 0) {
    throw new Error(
      `Network profile '${profile}' is invalid: missing ${missing.join(', ')}`,
    );
  }

  return network;
}

function buildFromConfig(
  config: RootConfigService | undefined,
): CloudHubNetworksConfig {
  if (!config) return {};
  const networksConfig = config.getOptionalConfig('cloudhub.networks');
  if (!networksConfig) return {};

  const profiles: CloudHubNetworksConfig = {};
  for (const profileName of networksConfig.keys()) {
    const profileConfig = networksConfig.getConfig(profileName);
    profiles[normalizeProfileName(profileName)] = {
      subscriptionId: profileConfig.getString('subscriptionId').trim(),
      resourceGroup: profileConfig.getString('resourceGroup').trim(),
      vnetName: profileConfig.getString('vnetName').trim(),
      subnetName: profileConfig.getString('subnetName').trim(),
      region: profileConfig.getString('region').trim().toLowerCase(),
    };
  }

  return profiles;
}

function buildFromEnv(
  logger: LoggerService,
  envName = 'CLOUDHUB_NETWORKS_JSON',
): CloudHubNetworksConfig {
  const raw = process.env[envName]?.trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object keyed by profile name');
    }

    const profiles: CloudHubNetworksConfig = {};
    for (const [profileName, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(
          `profile '${profileName}' must be an object with network fields`,
        );
      }
      profiles[normalizeProfileName(profileName)] = parseRecord(
        profileName,
        value as Record<string, unknown>,
      );
    }

    return profiles;
  } catch (error) {
    logger.error(
      `[cloudhub-networks] Invalid ${envName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw new Error(
      `Invalid ${envName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function buildSubnetId(network: CloudHubNetworkConfig): string {
  return [
    '/subscriptions',
    network.subscriptionId,
    'resourceGroups',
    network.resourceGroup,
    'providers',
    'Microsoft.Network',
    'virtualNetworks',
    network.vnetName,
    'subnets',
    network.subnetName,
  ].join('/');
}

export class CloudHubNetworksService {
  private readonly logger: LoggerService;
  private readonly profiles: CloudHubNetworksConfig;

  constructor(options: {
    logger: LoggerService;
    config?: RootConfigService;
    envName?: string;
  }) {
    this.logger = options.logger;

    const fromConfig = buildFromConfig(options.config);
    const fromEnv = buildFromEnv(
      this.logger,
      options.envName ?? 'CLOUDHUB_NETWORKS_JSON',
    );

    this.profiles = {
      ...fromEnv,
      ...fromConfig,
    };

    for (const [profileName, profile] of Object.entries(this.profiles)) {
      this.profiles[profileName] = parseRecord(profileName, profile);
    }
  }

  hasProfile(profileName: string): boolean {
    return Boolean(this.profiles[normalizeProfileName(profileName)]);
  }

  getNetworkProfile(profileName: string): CloudHubNetworkConfig {
    const profile = this.profiles[normalizeProfileName(profileName)];
    if (!profile) {
      throw new Error(
        `Network profile '${profileName}' is not configured under cloudhub.networks or CLOUDHUB_NETWORKS_JSON`,
      );
    }
    return profile;
  }

  subnetIdFor(profileName: string): string {
    return buildSubnetId(this.getNetworkProfile(profileName));
  }

  getAll(): CloudHubNetworksConfig {
    return { ...this.profiles };
  }

  listByPrefix(prefix: string): Array<{ name: string; network: CloudHubNetworkConfig }> {
    const normalizedPrefix = normalizeProfileName(prefix);
    return Object.entries(this.profiles)
      .filter(([name]) => name.startsWith(normalizedPrefix))
      .map(([name, network]) => ({ name, network }));
  }
}
