import type { LoggerService } from '@backstage/backend-plugin-api';
import { AzureDiscoveryProvider } from './azureDiscoveryProvider';
import type { CloudDiscoveryProvider, CloudProvider } from '../types';

export function createDiscoveryProvider(
  cloudProvider: CloudProvider,
  logger: LoggerService,
): CloudDiscoveryProvider {
  if (cloudProvider === 'Azure') {
    return new AzureDiscoveryProvider(logger);
  }

  throw new Error(
    `Cloud provider ${cloudProvider} is not supported yet. Azure is currently enabled.`,
  );
}
