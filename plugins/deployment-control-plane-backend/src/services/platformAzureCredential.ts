import type { LoggerService } from '@backstage/backend-plugin-api';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';

/**
 * Azure credential for CloudHub control-plane operations.
 *
 * Uses the sole CloudHub platform service principal configured in AZURE_*.
 */
export function platformAzureCredential(logger?: LoggerService) {
  return createCloudHubAzureCredential(
    logger
      ? (message, metadata) => logger.info(message, metadata)
      : undefined,
  );
}
