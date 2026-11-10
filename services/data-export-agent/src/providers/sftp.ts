/**
 * SFTP destination.
 *
 * - The private key is a PEM stored in Key Vault (`secretRef`), fetched at
 *   connect time with workload identity and kept only in memory.
 * - The server's host key MUST match `hostKeyFingerprint` (`SHA256:<base64>`,
 *   the format `ssh-keygen -lf` prints). Without a fingerprint the provider
 *   refuses to connect: trust-on-first-use would let anyone who can spoof DNS
 *   for the host collect a customer's export.
 * - Each file is uploaded as `<name>.part` and renamed once complete, so a
 *   consumer never picks up a half-written file.
 */
import { createHash, timingSafeEqual } from 'crypto';
import SftpClient from 'ssh2-sftp-client';
import { NonRetryableError } from '../errors';
import type { DeliveredFile } from '../protocol';
import type { WrittenFile } from '../writers/types';
import { SecretResolver, isSecretRef } from './secrets';
import {
  DestinationConfig,
  DestinationProvider,
  HealthCheckResult,
  UploadContext,
} from './types';

/** The subset of ssh2-sftp-client the provider uses. */
export interface SftpClientLike {
  connect(options: Record<string, unknown>): Promise<unknown>;
  mkdir(path: string, recursive?: boolean): Promise<unknown>;
  put(localPath: string, remotePath: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  exists(path: string): Promise<false | string>;
  delete(path: string, noErrorOK?: boolean): Promise<unknown>;
  stat(path: string): Promise<unknown>;
  end(): Promise<unknown>;
}

export type SftpClientFactory = () => SftpClientLike;

const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}=?$/;
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,252})$|^\[?[0-9A-Fa-f:.]+\]?$/;

/** OpenSSH-style fingerprint of a raw host key blob: `SHA256:` + unpadded base64 of its sha256. */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256')
    .update(key)
    .digest('base64')
    .replace(/=+$/, '')}`;
}

/** Accepted fingerprints; a comma-separated list allows host key rotation. */
export function parseFingerprints(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function fingerprintMatches(actual: string, expected: string[]): boolean {
  const a = Buffer.from(actual.replace(/=+$/, ''));
  return expected.some(e => {
    const b = Buffer.from(e.replace(/=+$/, ''));
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** Joins remote POSIX path pieces, keeping a leading slash on the base. */
export function remoteJoin(base: string, ...parts: string[]): string {
  const absolute = base.startsWith('/');
  const segments = [base, ...parts].flatMap(p => p.split('/')).filter(Boolean);
  if (segments.some(s => s === '..' || s === '.')) {
    throw new Error('Remote path must not contain "." or ".." segments');
  }
  return `${absolute ? '/' : ''}${segments.join('/')}`;
}

interface SftpSettings {
  host: string;
  port: number;
  username: string;
  remotePath: string;
  secretRef: string;
  fingerprints: string[];
}

function settings(config: DestinationConfig): SftpSettings {
  return {
    host: (config.host ?? '').trim(),
    port: config.port ? Number(config.port) : 22,
    username: (config.username ?? '').trim(),
    remotePath: (config.remotePath ?? '').trim(),
    secretRef: (config.secretRef ?? '').trim(),
    fingerprints: parseFingerprints(config.hostKeyFingerprint),
  };
}

export class SftpProvider implements DestinationProvider {
  readonly type = 'SFTP';

  constructor(
    private readonly secrets: SecretResolver,
    private readonly clientFactory: SftpClientFactory = () =>
      // Errors surface through the rejected promises; the library's default
      // global callbacks would only console.log.
      new SftpClient('data-export-agent', {
        error: () => {},
        end: () => {},
        close: () => {},
      }) as unknown as SftpClientLike,
    private readonly readyTimeoutMs = 30_000,
  ) {}

  validate(config: DestinationConfig): string[] {
    const s = settings(config);
    const problems: string[] = [];
    if (!s.host || !HOST.test(s.host))
      problems.push('host is required and must be a hostname or IP address');
    if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535)
      problems.push('port must be 1-65535');
    if (!s.username) problems.push('username is required');
    if (!s.remotePath) problems.push('remotePath is required');
    if (s.remotePath.split('/').some(p => p === '..' || p === '.')) {
      problems.push('remotePath must not contain "." or ".." segments');
    }
    if (!isSecretRef(s.secretRef))
      problems.push('secretRef must be kv://<vault-name>/<secret-name>');
    if (s.fingerprints.length === 0) {
      problems.push(
        'hostKeyFingerprint is required (SHA256:<base64>, as printed by ssh-keygen -lf)',
      );
    } else if (!s.fingerprints.every(f => FINGERPRINT.test(f))) {
      problems.push(
        'hostKeyFingerprint must look like SHA256:<43 base64 characters>',
      );
    }
    return problems;
  }

  async upload(
    files: WrittenFile[],
    context: UploadContext,
  ): Promise<DeliveredFile[]> {
    const s = settings(context.config);
    const dir = remoteJoin(s.remotePath, context.outputPrefix);
    return this.withClient(s, async client => {
      const abort = () => {
        client.end().catch(() => {});
      };
      context.signal?.addEventListener('abort', abort, { once: true });
      try {
        await client.mkdir(dir, true);
        const delivered: DeliveredFile[] = [];
        for (const file of files) {
          context.signal?.throwIfAborted();
          const target = remoteJoin(dir, file.name);
          const part = `${target}.part`;
          await client.put(file.localPath, part);
          // SFTP v3 rename fails if the target exists (e.g. a previous attempt of this job).
          if (await client.exists(target)) await client.delete(target);
          await client.rename(part, target);
          context.logger.info('Uploaded file over SFTP', {
            file: file.name,
            bytes: file.sizeBytes,
          });
          delivered.push({
            name: file.name,
            path: target,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
            ...(file.records !== undefined ? { records: file.records } : {}),
          });
        }
        return delivered;
      } finally {
        context.signal?.removeEventListener('abort', abort);
      }
    });
  }

  async healthCheck(config: DestinationConfig): Promise<HealthCheckResult> {
    const problems = this.validate(config);
    if (problems.length)
      return { status: 'FAILED', message: problems.join('; ') };
    const s = settings(config);
    try {
      await this.withClient(s, client => client.stat(s.remotePath));
      return {
        status: 'HEALTHY',
        message: `Connected to ${s.host}:${s.port} (host key verified) and found ${s.remotePath}`,
      };
    } catch (err) {
      return {
        status: 'FAILED',
        message: `SFTP check failed: ${(err as Error)?.message ?? String(err)}`,
      };
    }
  }

  private async withClient<T>(
    s: SftpSettings,
    fn: (client: SftpClientLike) => Promise<T>,
  ): Promise<T> {
    if (s.fingerprints.length === 0) {
      throw new NonRetryableError(
        'Refusing to connect over SFTP without hostKeyFingerprint',
      );
    }
    const privateKey = await this.secrets.resolve(s.secretRef);
    const client = this.clientFactory();
    let presented: string | undefined;
    try {
      await client.connect({
        host: s.host,
        port: s.port,
        username: s.username,
        privateKey,
        readyTimeout: this.readyTimeoutMs,
        // No in-library reconnect loop (it waits 25s by default); a failed job
        // is retried by the control plane instead.
        retries: 0,
        // Raw host key blob (no hostHash set); compare its SHA256 fingerprint.
        hostVerifier: (key: Buffer) => {
          presented = hostKeyFingerprint(key);
          return fingerprintMatches(presented, s.fingerprints);
        },
      });
    } catch (err) {
      await client.end().catch(() => {});
      if (presented && !fingerprintMatches(presented, s.fingerprints)) {
        throw new NonRetryableError(
          `SFTP host key verification failed for ${s.host}:${s.port}: server presented ${presented}`,
          { cause: err },
        );
      }
      throw err;
    }
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  }
}
