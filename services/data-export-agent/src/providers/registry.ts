/**
 * Destination providers keyed by DestinationDescriptor.type.
 *
 * To add a destination (Snowflake, Databricks, S3, ...): implement
 * DestinationProvider in a new module under src/providers, register it in
 * `createDefaultRegistry`, add the type to protocol.ts on both sides, and
 * grant the agent identity whatever the destination needs (workload identity
 * federation, or a Key Vault secret reference resolved via SecretResolver).
 */
import type { TokenCredential } from '../auth';
import { NonRetryableError } from '../errors';
import { AdlsGen2Provider, AdlsServiceFactory } from './adls';
import { KeyVaultSecretResolver, SecretResolver } from './secrets';
import { SftpClientFactory, SftpProvider } from './sftp';
import type { DestinationProvider } from './types';

export class ProviderRegistry {
  private readonly providers = new Map<string, DestinationProvider>();

  constructor(providers: DestinationProvider[] = []) {
    providers.forEach(p => this.register(p));
  }

  register(provider: DestinationProvider): void {
    this.providers.set(provider.type, provider);
  }

  /** The provider for `type`; unknown types are a non-retryable job failure. */
  get(type: string): DestinationProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new NonRetryableError(
        `Destination type "${type}" is not supported by this agent (supported: ${this.types().join(
          ', ',
        )})`,
      );
    }
    return provider;
  }

  has(type: string): boolean {
    return this.providers.has(type);
  }

  types(): string[] {
    return [...this.providers.keys()].sort();
  }
}

export interface DefaultRegistryOptions {
  credential: TokenCredential;
  secrets?: SecretResolver;
  adlsServiceFactory?: AdlsServiceFactory;
  sftpClientFactory?: SftpClientFactory;
}

export function createDefaultRegistry(
  options: DefaultRegistryOptions,
): ProviderRegistry {
  const secrets =
    options.secrets ?? new KeyVaultSecretResolver(options.credential);
  return new ProviderRegistry([
    new AdlsGen2Provider(options.credential, options.adlsServiceFactory),
    new SftpProvider(secrets, options.sftpClientFactory),
  ]);
}
