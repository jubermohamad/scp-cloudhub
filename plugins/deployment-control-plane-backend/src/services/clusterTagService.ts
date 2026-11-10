/**
 * Cluster Tag Service
 *
 * Abstracts all Azure tag management operations for CloudHub cluster onboarding.
 * Ensures all tag updates go through a controlled interface with validation
 * and audit logging.
 */

import { LoggerService } from '@backstage/backend-plugin-api';
import { ContainerServiceClient } from '@azure/arm-containerservice';
import { ClusterTagValidator } from '../utils/clusterTagValidator';

/**
 * Service for managing Azure tags on AKS clusters
 */
export interface IClusterTagService {
  /**
   * Get current tags for a cluster
   */
  getTags(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
  }): Promise<Record<string, string> | null>;

  /**
   * Update tags for a cluster
   */
  updateTags(
    input: {
      subscriptionId: string;
      resourceGroup: string;
      clusterName: string;
    },
    tags: Record<string, string>,
  ): Promise<Record<string, string>>;

  /**
   * Onboard a cluster for CloudHub deployments
   */
  onboardCluster(
    input: {
      subscriptionId: string;
      resourceGroup: string;
      clusterName: string;
    },
    userId?: string,
  ): Promise<{
    clusterName: string;
    resourceGroup: string;
    subscriptionId: string;
    tags: Record<string, string>;
  }>;

  /**
   * Offboard a cluster from CloudHub deployments
   */
  offboardCluster(
    input: {
      subscriptionId: string;
      resourceGroup: string;
      clusterName: string;
    },
    userId?: string,
  ): Promise<{
    clusterName: string;
    resourceGroup: string;
    subscriptionId: string;
    tags: Record<string, string>;
  }>;

  /**
   * Enable a cluster for CloudHub (without onboarding it)
   */
  enableCluster(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
  }): Promise<Record<string, string>>;

  /**
   * Disable a cluster for CloudHub
   */
  disableCluster(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
  }): Promise<Record<string, string>>;
}

/**
 * Implementation backed by Azure Container Service API
 */
export class ClusterTagService implements IClusterTagService {
  private readonly containerClient: ContainerServiceClient;

  constructor(
    credential: any, // Azure credential
    subscriptionId: string,
    private readonly logger: LoggerService,
  ) {
    this.containerClient = new ContainerServiceClient(
      credential,
      subscriptionId,
    );
  }

  async getTags(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
  }): Promise<Record<string, string> | null> {
    try {
      this.logger.debug(
        `[cluster-tags] Getting tags for ${input.clusterName} in ${input.resourceGroup}`,
      );

      const cluster = await this.containerClient.managedClusters.get(
        input.resourceGroup,
        input.clusterName,
      );

      return cluster.tags ?? null;
    } catch (error: any) {
      if (error.statusCode === 404) {
        this.logger.warn(
          `[cluster-tags] Cluster ${input.clusterName} not found in ${input.resourceGroup}`,
        );
        return null;
      }
      this.logger.error(
        `[cluster-tags] Error getting tags for ${input.clusterName}: ${error.message}`,
      );
      throw error;
    }
  }

  async updateTags(
    input: {
      subscriptionId: string;
      resourceGroup: string;
      clusterName: string;
    },
    tags: Record<string, string>,
  ): Promise<Record<string, string>> {
    // Validate tag format
    const errors = ClusterTagValidator.validateTagFormat(tags);
    if (errors.length > 0) {
      this.logger.error(
        `[cluster-tags] Tag validation failed: ${errors.join(', ')}`,
      );
      throw new Error(`Invalid tags: ${errors.join(', ')}`);
    }

    try {
      this.logger.info(`[cluster-tags] Updating tags for ${input.clusterName}`);
      this.logger.debug(`[cluster-tags] New tags: ${JSON.stringify(tags)}`);

      // Get existing cluster
      const cluster = await this.containerClient.managedClusters.get(
        input.resourceGroup,
        input.clusterName,
      );

      if (!cluster) {
        throw new Error(
          `Cluster ${input.clusterName} not found in ${input.resourceGroup}`,
        );
      }

      // Merge tags
      const existingTags = cluster.tags ?? {};
      const mergedTags = ClusterTagValidator.mergeCloudHubTags(
        existingTags,
        tags,
      );

      // Update cluster with new tags
      const updatedCluster =
        await this.containerClient.managedClusters.beginCreateOrUpdateAndWait(
          input.resourceGroup,
          input.clusterName,
          {
            ...cluster,
            tags: mergedTags,
          },
        );

      this.logger.info(
        `[cluster-tags] Successfully updated tags for ${input.clusterName}`,
      );

      return updatedCluster.tags ?? mergedTags;
    } catch (error: any) {
      this.logger.error(
        `[cluster-tags] Error updating tags for ${input.clusterName}: ${error.message}`,
      );
      throw new Error(
        `Failed to update tags: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onboardCluster(
    input: {
      subscriptionId: string;
      resourceGroup: string;
      clusterName: string;
    },
    userId?: string,
  ): Promise<{
    clusterName: string;
    resourceGroup: string;
    subscriptionId: string;
    tags: Record<string, string>;
  }> {
    this.logger.info(
      `[cluster-tags] Onboarding cluster ${input.clusterName} ${
        userId ? `(by ${userId})` : ''
      }`,
    );

    try {
      // First verify cluster exists
      const existing = await this.getTags(input);
      if (!existing && existing !== null) {
        throw new Error(
          `Cluster ${input.clusterName} not found in ${input.resourceGroup}`,
        );
      }

      // Set both enabled and onboarded
      const tags = ClusterTagValidator.createCloudHubTags(true, true);
      const updated = await this.updateTags(input, tags);

      this.logger.info(
        `[cluster-tags] Cluster ${input.clusterName} onboarded successfully ${
          userId ? `by ${userId}` : ''
        }`,
      );

      return {
        clusterName: input.clusterName,
        resourceGroup: input.resourceGroup,
        subscriptionId: input.subscriptionId,
        tags: updated,
      };
    } catch (error) {
      this.logger.error(
        `[cluster-tags] Onboarding failed for ${input.clusterName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async offboardCluster(
    input: {
      subscriptionId: string;
      resourceGroup: string;
      clusterName: string;
    },
    userId?: string,
  ): Promise<{
    clusterName: string;
    resourceGroup: string;
    subscriptionId: string;
    tags: Record<string, string>;
  }> {
    this.logger.info(
      `[cluster-tags] Offboarding cluster ${input.clusterName} ${
        userId ? `(by ${userId})` : ''
      }`,
    );

    try {
      // Set onboarded to false (keep enabled state)
      const tags = {
        [ClusterTagValidator.REQUIRED_TAGS.ONBOARDED]: 'false',
      };
      const updated = await this.updateTags(input, tags);

      this.logger.info(
        `[cluster-tags] Cluster ${input.clusterName} offboarded successfully ${
          userId ? `by ${userId}` : ''
        }`,
      );

      return {
        clusterName: input.clusterName,
        resourceGroup: input.resourceGroup,
        subscriptionId: input.subscriptionId,
        tags: updated,
      };
    } catch (error) {
      this.logger.error(
        `[cluster-tags] Offboarding failed for ${input.clusterName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async enableCluster(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
  }): Promise<Record<string, string>> {
    this.logger.info(`[cluster-tags] Enabling cluster ${input.clusterName}`);

    try {
      const tags = {
        [ClusterTagValidator.REQUIRED_TAGS.ENABLED]: 'true',
      };
      const updated = await this.updateTags(input, tags);

      this.logger.info(
        `[cluster-tags] Cluster ${input.clusterName} enabled successfully`,
      );

      return updated;
    } catch (error) {
      this.logger.error(
        `[cluster-tags] Enable failed for ${input.clusterName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async disableCluster(input: {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
  }): Promise<Record<string, string>> {
    this.logger.info(`[cluster-tags] Disabling cluster ${input.clusterName}`);

    try {
      const tags = {
        [ClusterTagValidator.REQUIRED_TAGS.ENABLED]: 'false',
      };
      const updated = await this.updateTags(input, tags);

      this.logger.info(
        `[cluster-tags] Cluster ${input.clusterName} disabled successfully`,
      );

      return updated;
    } catch (error) {
      this.logger.error(
        `[cluster-tags] Disable failed for ${input.clusterName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
