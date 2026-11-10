/**
 * aksClient.ts
 *
 * Thin wrapper around the Azure ARM ContainerService SDK.
 * Provides beginStopAndWait / beginStartAndWait with structured logging.
 *
 * Authentication uses only CloudHub's canonical platform service principal
 * from AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET.
 */

import { ClientSecretCredential } from '@azure/identity';
import { ContainerServiceClient } from '@azure/arm-containerservice';

const PLATFORM_CLIENT_ID = '73b2043b-6230-480a-8a9a-fd37f68af1b2';
const PLATFORM_TENANT_ID = 'd0fec9dd-9219-4514-a1d8-1a872244bf6e';
const credentialCache = new Map<string, ClientSecretCredential>();

function getCredential(): ClientSecretCredential {
  if (!credentialCache.has('platform')) {
    const tenantId = process.env.AZURE_TENANT_ID?.trim();
    const clientId = process.env.AZURE_CLIENT_ID?.trim();
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        'AKS scheduler requires AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET.',
      );
    }
    if (
      clientId.toLowerCase() !== PLATFORM_CLIENT_ID ||
      tenantId.toLowerCase() !== PLATFORM_TENANT_ID
    ) {
      throw new Error(
        'AKS scheduler requires the configured CloudHub platform service principal and tenant.',
      );
    }

    console.info('Azure credential selected', {
      credentialType: 'ClientSecretCredential',
      clientId,
      tenantId,
    });
    credentialCache.set(
      'platform',
      new ClientSecretCredential(tenantId, clientId, clientSecret, {
        disableInstanceDiscovery: true,
      }),
    );
  }
  return credentialCache.get('platform')!;
}

/**
 * Stop an AKS cluster (pauses control plane billing + deallocates nodes).
 * This is a long-running operation — the method waits for completion.
 */
export async function stopCluster(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
): Promise<void> {
  const client = new ContainerServiceClient(getCredential(), subscriptionId);
  await client.managedClusters.beginStopAndWait(resourceGroup, clusterName);
}

/**
 * Start a previously stopped AKS cluster.
 * This is a long-running operation — the method waits for completion.
 */
export async function startCluster(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
): Promise<void> {
  const client = new ContainerServiceClient(getCredential(), subscriptionId);
  await client.managedClusters.beginStartAndWait(resourceGroup, clusterName);
}
