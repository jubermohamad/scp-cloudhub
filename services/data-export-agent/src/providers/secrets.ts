/**
 * Resolves `kv://<vault>/<secret>` references at runtime with the agent's
 * workload identity. Secret values are held only in memory for the duration
 * of a connection and are never logged or written to disk.
 */
import { SecretClient } from '@azure/keyvault-secrets';
import type { TokenCredential } from '../auth';
import { NonRetryableError } from '../errors';

export interface SecretResolver {
  resolve(secretRef: string): Promise<string>;
}

const SECRET_REF =
  /^kv:\/\/([A-Za-z][A-Za-z0-9-]{1,22}[A-Za-z0-9])\/([A-Za-z0-9-]{1,127})$/;

export function isSecretRef(value: string | undefined): boolean {
  return !!value && SECRET_REF.test(value);
}

/** Splits a secret reference; the vault name is validated so it cannot redirect the request elsewhere. */
export function parseSecretRef(ref: string): {
  vaultName: string;
  secretName: string;
} {
  const m = SECRET_REF.exec(ref ?? '');
  if (!m) {
    throw new NonRetryableError(
      `Invalid secretRef "${ref}": expected kv://<vault-name>/<secret-name>`,
    );
  }
  return { vaultName: m[1], secretName: m[2] };
}

export interface SecretClientLike {
  getSecret(name: string): Promise<{ value?: string }>;
}

export class KeyVaultSecretResolver implements SecretResolver {
  private readonly clients = new Map<string, SecretClientLike>();

  constructor(
    private readonly credential: TokenCredential,
    private readonly clientFactory: (
      vaultUrl: string,
      credential: TokenCredential,
    ) => SecretClientLike = (url, cred) => new SecretClient(url, cred),
  ) {}

  async resolve(secretRef: string): Promise<string> {
    const { vaultName, secretName } = parseSecretRef(secretRef);
    const url = `https://${vaultName}.vault.azure.net`;
    let client = this.clients.get(url);
    if (!client) {
      client = this.clientFactory(url, this.credential);
      this.clients.set(url, client);
    }
    const secret = await client.getSecret(secretName);
    if (!secret.value) {
      throw new NonRetryableError(
        `Key Vault secret ${secretName} in ${vaultName} has no value`,
      );
    }
    return secret.value;
  }
}
