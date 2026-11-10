import { NonRetryableError } from '../errors';
import { createDefaultRegistry, ProviderRegistry } from './registry';
import { KeyVaultSecretResolver, parseSecretRef } from './secrets';

const credential = {
  getToken: async () => ({
    token: 't',
    expiresOnTimestamp: Date.now() + 3600_000,
  }),
};

describe('ProviderRegistry', () => {
  it('registers ADLS_GEN2 and SFTP by default', () => {
    const registry = createDefaultRegistry({
      credential,
      secrets: { resolve: async () => 'k' },
    });
    expect(registry.types()).toEqual(['ADLS_GEN2', 'SFTP']);
    expect(registry.get('SFTP').type).toBe('SFTP');
  });

  it('fails unknown destination types as non-retryable', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.get('SNOWFLAKE')).toThrow(NonRetryableError);
    expect(() => registry.get('SNOWFLAKE')).toThrow(/not supported/);
  });
});

describe('secrets', () => {
  it('parses kv:// references', () => {
    expect(parseSecretRef('kv://my-vault/sftp-key')).toEqual({
      vaultName: 'my-vault',
      secretName: 'sftp-key',
    });
    expect(() => parseSecretRef('kv://evil.example.com/x')).toThrow(
      NonRetryableError,
    );
    expect(() => parseSecretRef('https://vault/x')).toThrow(NonRetryableError);
  });

  it('fetches the secret from the vault URL with the workload identity credential', async () => {
    const getSecret = jest.fn(async () => ({ value: 'PEM' }));
    const factory = jest.fn(() => ({ getSecret }));
    const resolver = new KeyVaultSecretResolver(credential, factory);
    expect(await resolver.resolve('kv://my-vault/sftp-key')).toBe('PEM');
    expect(await resolver.resolve('kv://my-vault/other')).toBe('PEM');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(
      'https://my-vault.vault.azure.net',
      credential,
    );
    expect(getSecret).toHaveBeenCalledWith('sftp-key');
  });

  it('rejects an empty secret', async () => {
    const resolver = new KeyVaultSecretResolver(credential, () => ({
      getSecret: async () => ({}),
    }));
    await expect(resolver.resolve('kv://my-vault/x')).rejects.toThrow(
      /has no value/,
    );
  });
});
