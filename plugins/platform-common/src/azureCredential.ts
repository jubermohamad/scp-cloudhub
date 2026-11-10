import { ClientSecretCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/identity';

export const CLOUDHUB_AZURE_CLIENT_ID = '73b2043b-6230-480a-8a9a-fd37f68af1b2';
export const CLOUDHUB_AZURE_TENANT_ID = 'd0fec9dd-9219-4514-a1d8-1a872244bf6e';

export interface AzureCredentialDiagnostic {
  [key: string]: string;
  credentialType: 'ClientSecretCredential';
  clientId: string;
  tenantId: string;
}

export type AzureCredentialLogger = (
  message: string,
  metadata: AzureCredentialDiagnostic,
) => void;

/**
 * Build CloudHub's sole Azure platform identity. This intentionally fails
 * closed instead of consulting DefaultAzureCredential, Azure CLI, or managed
 * identity so an unrelated identity cannot silently be selected.
 */
export function createCloudHubAzureCredential(
  logger?: AzureCredentialLogger,
  env: Readonly<Record<string, string | undefined>> = process.env,
): TokenCredential {
  const tenantId = env.AZURE_TENANT_ID?.trim();
  const clientId = env.AZURE_CLIENT_ID?.trim();
  const clientSecret = env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'CloudHub Azure credentials are incomplete; AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET are required.',
    );
  }
  if (clientId.toLowerCase() !== CLOUDHUB_AZURE_CLIENT_ID) {
    throw new Error(
      `CloudHub Azure integrations require AZURE_CLIENT_ID=${CLOUDHUB_AZURE_CLIENT_ID}.`,
    );
  }
  if (tenantId.toLowerCase() !== CLOUDHUB_AZURE_TENANT_ID) {
    throw new Error(
      `CloudHub Azure integrations require AZURE_TENANT_ID=${CLOUDHUB_AZURE_TENANT_ID}.`,
    );
  }

  logger?.('Azure credential selected', {
    credentialType: 'ClientSecretCredential',
    clientId,
    tenantId,
  });

  return new ClientSecretCredential(tenantId, clientId, clientSecret, {
    disableInstanceDiscovery: true,
  });
}
