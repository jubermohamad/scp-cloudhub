import type {
  AuthService,
  DiscoveryService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import type { Entity } from '@backstage/catalog-model';
import YAML from 'yaml';
import type { CatalogRegistrationResult, DiscoveredCluster } from '../types';

export class CatalogRegistrationService {
  private readonly logger: LoggerService;
  private readonly auth: AuthService;
  private readonly discovery: DiscoveryService;

  constructor(args: {
    logger: LoggerService;
    auth: AuthService;
    discovery: DiscoveryService;
  }) {
    this.logger = args.logger;
    this.auth = args.auth;
    this.discovery = args.discovery;
  }

  private buildEntity(cluster: DiscoveredCluster, tenantName: string): Entity {
    const env = cluster.environment ?? 'unknown';
    return {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: {
        name: cluster.clusterName.toLowerCase(),
        description: `${tenantName} ${env.toUpperCase()} AKS Cluster`,
        tags: [
          'kubernetes',
          'aks',
          `tenant:${tenantName.toLowerCase()}`,
          `environment:${env}`,
        ],
      },
      spec: {
        type: 'kubernetes-cluster',
        owner: 'group:default/platform-team',
        system: `${tenantName.toLowerCase()}-platform`,
      },
    };
  }

  async registerClusterEntity(
    cluster: DiscoveredCluster,
    tenantName: string,
  ): Promise<CatalogRegistrationResult> {
    const entity = this.buildEntity(cluster, tenantName);
    const entityRef = `resource:default/${entity.metadata.name}`;

    if (process.env.TENANT_REGISTRY_CATALOG_AUTO_REGISTER === 'false') {
      return {
        entity,
        entityRef,
        registrationStatus: 'skipped',
      };
    }

    try {
      const credentials = await this.auth.getOwnServiceCredentials();
      const { token } = await this.auth.getPluginRequestToken({
        onBehalfOf: credentials,
        targetPluginId: 'catalog',
      });

      const catalogClient = new CatalogClient({
        discoveryApi: {
          getBaseUrl: this.discovery.getBaseUrl.bind(this.discovery),
        },
        fetchApi: {
          fetch: (url, init) =>
            fetch(url, {
              ...init,
              headers: {
                ...(init?.headers ?? {}),
                Authorization: `Bearer ${token}`,
              },
            }),
        },
      });

      const yaml = YAML.stringify(entity);
      const locationTarget = `data:text/yaml,${encodeURIComponent(yaml)}`;
      await catalogClient.addLocation({
        type: 'url',
        target: locationTarget,
        onConflict: 'refresh',
      });

      return {
        entity,
        entityRef,
        registrationStatus: 'registered',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[tenant-registry] catalog registration failed: ${message}`,
      );

      return {
        entity,
        entityRef,
        registrationStatus: 'failed',
        error: message,
      };
    }
  }
}
