/**
 * Azure Workload Identity plumbing.
 *
 * Every credential the agent uses comes from one `TokenCredential`: in the pod
 * the workload identity webhook injects AZURE_CLIENT_ID, AZURE_TENANT_ID and
 * AZURE_FEDERATED_TOKEN_FILE, and `WorkloadIdentityCredential` exchanges the
 * projected service account token for Entra access tokens. Nothing secret is
 * stored in env, values or images.
 *
 * Tests substitute a fake `TokenCredential` (or `TokenProvider`) here; the
 * production code path is the same apart from what is injected.
 */
import {
  DefaultAzureCredential,
  WorkloadIdentityCredential,
  type AccessToken,
  type TokenCredential,
} from '@azure/identity';

export type { TokenCredential };

/** Entra scope for Azure Database for PostgreSQL flexible server AAD auth. */
export const POSTGRES_AAD_SCOPE =
  'https://ossrdbms-aad.database.windows.net/.default';

/** Obtains bearer tokens for a scope. */
export interface TokenProvider {
  getToken(scope: string): Promise<string>;
}

/**
 * Builds the production credential. Prefers `WorkloadIdentityCredential` when
 * the webhook's variables are present (the only supported mode in a cluster),
 * otherwise falls back to `DefaultAzureCredential` so a developer can run the
 * agent locally with `az login`.
 */
export function createAzureCredential(
  env: Record<string, string | undefined> = process.env,
): TokenCredential {
  if (
    env.AZURE_FEDERATED_TOKEN_FILE &&
    env.AZURE_CLIENT_ID &&
    env.AZURE_TENANT_ID
  ) {
    return new WorkloadIdentityCredential({
      clientId: env.AZURE_CLIENT_ID,
      tenantId: env.AZURE_TENANT_ID,
      tokenFilePath: env.AZURE_FEDERATED_TOKEN_FILE,
    });
  }
  return new DefaultAzureCredential();
}

/**
 * Adapts a TokenCredential to a TokenProvider. The SDK credentials already
 * cache tokens; the small cache here avoids even the async hop on every
 * control plane call and refreshes five minutes before expiry.
 */
export function tokenProviderFromCredential(
  credential: TokenCredential,
  now: () => number = Date.now,
): TokenProvider {
  const cache = new Map<string, AccessToken>();
  const refreshMarginMs = 5 * 60 * 1000;
  return {
    async getToken(scope: string): Promise<string> {
      const cached = cache.get(scope);
      if (cached && cached.expiresOnTimestamp - refreshMarginMs > now()) {
        return cached.token;
      }
      const token = await credential.getToken(scope);
      if (!token)
        throw new Error(`No access token returned for scope ${scope}`);
      cache.set(scope, token);
      return token.token;
    },
  };
}
