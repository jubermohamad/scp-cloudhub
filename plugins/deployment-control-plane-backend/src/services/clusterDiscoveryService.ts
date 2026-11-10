/**
 * Cluster Discovery Service
 *
 * Abstracts AKS cluster discovery with tag-based filtering.
 *
 * This service is designed as an intermediate step toward a Cluster Registry.
 * The tag-based eligibility check should eventually be replaceable with
 * ClusterRegistryService without requiring changes to consumers.
 */

import { LoggerService } from '@backstage/backend-plugin-api';
import type { DiscoveredCluster } from '../types';
import { ClusterTagValidator } from '../utils/clusterTagValidator';

/**
 * Cluster discovery service interface
 *
 * Allows for future implementation swaps (Azure -> Cluster Registry).
 */
export interface IClusterDiscoveryService {
  /**
   * Discover all deployable clusters (tag-filtered)
   */
  getDeployableClusters(input: {
    subscriptionId?: string;
    region?: string;
    environment?: string;
    resourceGroup?: string;
  }): Promise<DiscoveredCluster[]>;

  /**
   * Discover all clusters, including non-deployable (untagged/ineligible)
   */
  getAllClusters(input: {
    subscriptionId?: string;
    region?: string;
    environment?: string;
    resourceGroup?: string;
  }): Promise<DiscoveredCluster[]>;

  /**
   * Discover clusters by explicit tag filter
   */
  getClustersByTag(input: {
    subscriptionIds: string[];
    tagKey: string;
    tagValue: string;
  }): Promise<DiscoveredCluster[]>;

  /**
   * Get a single cluster (tag-filtered)
   */
  getDeployableCluster(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
  }): Promise<DiscoveredCluster | null>;
}

/**
 * Implementation of cluster discovery backed by Azure provider
 *
 * Wraps existing AzureProvider discovery methods and adds
 * tag-based filtering for CloudHub eligibility.
 */
export class ClusterDiscoveryService implements IClusterDiscoveryService {
  constructor(
    private readonly azureProvider: any, // AzureProvider instance
    private readonly logger: LoggerService,
  ) {}

  async getDeployableClusters(input: {
    subscriptionId?: string;
    region?: string;
    environment?: string;
    resourceGroup?: string;
  }): Promise<DiscoveredCluster[]> {
    // Require at least subscriptionId for safety
    if (!input.subscriptionId) {
      this.logger.warn(
        '[cluster-discovery] getDeployableClusters called without subscriptionId',
      );
      return [];
    }

    try {
      // Get all clusters from Azure
      const allClusters = await this.azureProvider.discoverClusters(input);

      // Filter to only deployable (tag-eligible) clusters
      const deployable = allClusters.filter((cluster: DiscoveredCluster) => {
        const eligible = ClusterTagValidator.isCloudHubEligible(cluster.tags);
        // Ensure tags are always an object
        if (!cluster.tags) {
          cluster.tags = {};
        }
        return eligible;
      });

      this.logger.info(
        `[cluster-discovery] Found ${deployable.length} deployable clusters (${allClusters.length} total) in subscription ${input.subscriptionId}`,
      );

      return deployable;
    } catch (error) {
      this.logger.error(
        `[cluster-discovery] Error discovering deployable clusters: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async getAllClusters(input: {
    subscriptionId?: string;
    region?: string;
    environment?: string;
    resourceGroup?: string;
  }): Promise<DiscoveredCluster[]> {
    if (!input.subscriptionId) {
      this.logger.warn(
        '[cluster-discovery] getAllClusters called without subscriptionId',
      );
      return [];
    }

    try {
      const clusters = await this.azureProvider.discoverClusters(input);

      this.logger.info(
        `[cluster-discovery] Found ${clusters.length} total clusters in subscription ${input.subscriptionId}`,
      );

      // Ensure all clusters have tags
      clusters.forEach((cluster: DiscoveredCluster) => {
        if (!cluster.tags) {
          cluster.tags = {};
        }
      });

      return clusters;
    } catch (error) {
      this.logger.error(
        `[cluster-discovery] Error discovering all clusters: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async getClustersByTag(input: {
    subscriptionIds: string[];
    tagKey: string;
    tagValue: string;
  }): Promise<DiscoveredCluster[]> {
    try {
      const clusters = await this.azureProvider.discoverClustersByCustomerTag(
        input,
      );

      this.logger.info(
        `[cluster-discovery] Found ${clusters.length} clusters with tag ${input.tagKey}=${input.tagValue}`,
      );

      // Ensure all clusters have tags
      clusters.forEach((cluster: DiscoveredCluster) => {
        if (!cluster.tags) {
          cluster.tags = {};
        }
      });

      return clusters;
    } catch (error) {
      this.logger.error(
        `[cluster-discovery] Error discovering clusters by tag: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async getDeployableCluster(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
  }): Promise<DiscoveredCluster | null> {
    try {
      // Try to find the specific cluster
      const clusters = await this.azureProvider.discoverClusters({
        subscriptionId: input.subscriptionId,
        resourceGroup: input.resourceGroup,
      });

      const found = clusters.find(
        (c: DiscoveredCluster) => c.clusterName === input.clusterName,
      );

      if (!found) {
        this.logger.warn(
          `[cluster-discovery] Cluster ${input.clusterName} not found in ${input.resourceGroup}`,
        );
        return null;
      }

      // Ensure tags are always an object
      if (!found.tags) {
        found.tags = {};
      }

      // Check eligibility
      const isEligible = ClusterTagValidator.isCloudHubEligible(found.tags);

      if (!isEligible) {
        this.logger.info(
          `[cluster-discovery] Cluster ${input.clusterName} exists but is not CloudHub eligible`,
        );
        return null;
      }

      return found;
    } catch (error) {
      this.logger.error(
        `[cluster-discovery] Error discovering specific cluster ${
          input.clusterName
        }: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
