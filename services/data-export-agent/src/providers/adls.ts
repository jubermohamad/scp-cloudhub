/**
 * ADLS Gen2 destination. Authenticates with the agent's workload identity
 * (the identity needs Storage Blob Data Contributor on the account); no
 * account keys or SAS tokens.
 *
 * Layout: `abfss://<fileSystem>@<account>.dfs.core.windows.net/[<path>/]<outputPrefix>/<name>`.
 * Hierarchical namespace accounts create parent directories implicitly.
 */
import { DataLakeServiceClient } from '@azure/storage-file-datalake';
import type { TokenCredential } from '../auth';
import type { DeliveredFile } from '../protocol';
import type { WrittenFile } from '../writers/types';
import {
  DestinationConfig,
  DestinationProvider,
  HealthCheckResult,
  UploadContext,
  isExpired,
  joinPath,
  pathProblems,
} from './types';

export const ADLS_DEFAULT_FILE_SYSTEM = 'data-export-hub';

/* Minimal views of the SDK clients, so tests can pass fakes. */
export interface AdlsFileClientLike {
  uploadFile(
    localPath: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
  upload(data: Buffer): Promise<unknown>;
  delete(): Promise<unknown>;
}
export interface AdlsDirectoryClientLike {
  delete(recursive: boolean): Promise<unknown>;
}
export interface AdlsFileSystemLike {
  exists(): Promise<boolean>;
  getFileClient(path: string): AdlsFileClientLike;
  getDirectoryClient(path: string): AdlsDirectoryClientLike;
  listPaths(options: { path: string; recursive: boolean }): AsyncIterable<{
    name?: string;
    isDirectory?: boolean;
  }>;
}
export interface AdlsServiceLike {
  getFileSystemClient(name: string): AdlsFileSystemLike;
}

export type AdlsServiceFactory = (
  accountUrl: string,
  credential: TokenCredential,
) => AdlsServiceLike;

const ACCOUNT_NAME = /^[a-z0-9]{3,24}$/;
const FILE_SYSTEM = /^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/;

interface AdlsSettings {
  accountName: string;
  fileSystem: string;
  basePath: string;
}

function settings(config: DestinationConfig): AdlsSettings {
  return {
    accountName: (config.accountName ?? '').trim(),
    fileSystem: (config.fileSystem ?? '').trim() || ADLS_DEFAULT_FILE_SYSTEM,
    basePath: joinPath(config.path),
  };
}

function isNotFound(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string };
  return (
    e?.statusCode === 404 ||
    e?.code === 'PathNotFound' ||
    e?.code === 'FilesystemNotFound'
  );
}

export class AdlsGen2Provider implements DestinationProvider {
  readonly type = 'ADLS_GEN2';
  private readonly services = new Map<string, AdlsServiceLike>();

  constructor(
    private readonly credential: TokenCredential,
    private readonly serviceFactory: AdlsServiceFactory = (url, cred) =>
      new DataLakeServiceClient(url, cred) as unknown as AdlsServiceLike,
    private readonly now: () => Date = () => new Date(),
  ) {}

  validate(config: DestinationConfig): string[] {
    const problems: string[] = [];
    const s = settings({ ...config, path: '' });
    if (!ACCOUNT_NAME.test(s.accountName)) {
      problems.push('accountName must be 3-24 lowercase letters or digits');
    }
    if (!FILE_SYSTEM.test(s.fileSystem)) {
      problems.push(
        `fileSystem "${s.fileSystem}" is not a valid ADLS file system name`,
      );
    }
    problems.push(...pathProblems('path', config.path));
    return problems;
  }

  async upload(
    files: WrittenFile[],
    context: UploadContext,
  ): Promise<DeliveredFile[]> {
    const s = settings(context.config);
    const fs = this.fileSystem(s);
    const delivered: DeliveredFile[] = [];
    for (const file of files) {
      context.signal?.throwIfAborted();
      const relPath = joinPath(s.basePath, context.outputPrefix, file.name);
      await fs
        .getFileClient(relPath)
        .uploadFile(file.localPath, { abortSignal: context.signal });
      context.logger.info('Uploaded file to ADLS', {
        file: file.name,
        bytes: file.sizeBytes,
      });
      delivered.push({
        name: file.name,
        path: `abfss://${s.fileSystem}@${s.accountName}.dfs.core.windows.net/${relPath}`,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        ...(file.records !== undefined ? { records: file.records } : {}),
      });
    }
    return delivered;
  }

  async healthCheck(config: DestinationConfig): Promise<HealthCheckResult> {
    const problems = this.validate(config);
    if (problems.length)
      return { status: 'FAILED', message: problems.join('; ') };
    const s = settings(config);
    try {
      const fs = this.fileSystem(s);
      if (!(await fs.exists())) {
        return {
          status: 'FAILED',
          message: `File system ${s.fileSystem} does not exist in ${s.accountName}`,
        };
      }
      const probe = joinPath(
        s.basePath,
        '_health',
        `probe-${this.now().getTime()}.txt`,
      );
      const client = fs.getFileClient(probe);
      await client.upload(Buffer.from('data-export-agent health probe\n'));
      await client.delete();
      return {
        status: 'HEALTHY',
        message: `Wrote and deleted a probe file in ${s.accountName}/${s.fileSystem}`,
      };
    } catch (err) {
      return {
        status: 'FAILED',
        message: `ADLS check failed: ${(err as Error)?.message ?? String(err)}`,
      };
    }
  }

  async applyRetention(
    profilePrefix: string,
    retentionDays: number,
    config: DestinationConfig,
  ): Promise<number> {
    const s = settings(config);
    const fs = this.fileSystem(s);
    const root = joinPath(s.basePath, profilePrefix);
    const now = this.now();
    let deleted = 0;
    for (const year of await this.listDirs(fs, root)) {
      for (const month of await this.listDirs(fs, joinPath(root, year))) {
        for (const day of await this.listDirs(
          fs,
          joinPath(root, year, month),
        )) {
          if (isExpired(year, month, day, retentionDays, now)) {
            await fs
              .getDirectoryClient(joinPath(root, year, month, day))
              .delete(true);
            deleted += 1;
          }
        }
      }
    }
    return deleted;
  }

  private async listDirs(
    fs: AdlsFileSystemLike,
    dir: string,
  ): Promise<string[]> {
    const names: string[] = [];
    try {
      for await (const p of fs.listPaths({ path: dir, recursive: false })) {
        if (p.isDirectory && p.name) names.push(p.name.split('/').pop()!);
      }
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    return names.sort();
  }

  private fileSystem(s: AdlsSettings): AdlsFileSystemLike {
    if (!ACCOUNT_NAME.test(s.accountName)) {
      throw new Error('ADLS accountName is invalid');
    }
    const url = `https://${s.accountName}.dfs.core.windows.net`;
    let service = this.services.get(url);
    if (!service) {
      service = this.serviceFactory(url, this.credential);
      this.services.set(url, service);
    }
    return service.getFileSystemClient(s.fileSystem);
  }
}
