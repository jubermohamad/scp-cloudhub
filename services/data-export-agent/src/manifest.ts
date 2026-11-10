/**
 * The completion markers of an export folder: `checksum.sha256` (verifiable
 * with `sha256sum -c`) and `manifest.json`. Consumers must treat a folder as
 * complete only once manifest.json exists, which is why it is uploaded last.
 */
import fs from 'fs/promises';
import path from 'path';
import type { JobSpec, Manifest } from './protocol';
import { sha256Hex } from './writers/hashingSink';
import type { WrittenFile } from './writers/types';

export const CHECKSUM_FILE = 'checksum.sha256';
export const MANIFEST_FILE = 'manifest.json';

/** sha256sum text format: `<hex><space><space><name>` per line. */
export function checksumContent(
  files: Array<Pick<WrittenFile, 'name' | 'sha256'>>,
): string {
  return files.map(f => `${f.sha256}  ${f.name}\n`).join('');
}

/** Parses sha256sum text back into name → hex (used by tests and verification). */
export function parseChecksumContent(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.split('\n')) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (m) result.set(m[2], m[1]);
  }
  return result;
}

export interface ManifestInput {
  job: JobSpec;
  dataFiles: WrittenFile[];
  watermarkTo: string | null;
  startedAt: Date;
  completedAt: Date;
  agentName: string;
  agentVersion: string;
  clusterName: string;
}

/**
 * Builds the manifest. `files` lists the data files only (the checksum file
 * covers the same set, and the manifest cannot contain its own hash).
 * `watermark.to` is the new watermark, or the previous one when an
 * incremental run found no new rows.
 */
export function buildManifest(input: ManifestInput): Manifest {
  const { job, dataFiles } = input;
  const incremental = job.profile.exportMode === 'INCREMENTAL';
  const from = incremental ? job.watermark?.lastSuccessValue ?? null : null;
  const totalRecords = dataFiles.reduce((sum, f) => sum + (f.records ?? 0), 0);
  const totalBytes = dataFiles.reduce((sum, f) => sum + f.sizeBytes, 0);

  const base: Manifest = {
    manifestVersion: 1,
    tenant: job.tenantId,
    profile: job.profile.name,
    profileId: job.profile.id,
    dataset: job.dataset.datasetId,
    runId: job.jobId,
    attempt: job.attempt,
    status: 'COMPLETED',
    exportMode: job.profile.exportMode,
    format: job.profile.fileFormat,
    compression: job.profile.compression,
    records: totalRecords,
    bytes: totalBytes,
    watermark: {
      column: job.dataset.watermarkColumn ?? null,
      from,
      to: incremental ? input.watermarkTo ?? from : null,
    },
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    files: dataFiles.map(f => ({
      name: f.name,
      sha256: f.sha256,
      bytes: f.sizeBytes,
      ...(f.records !== undefined ? { records: f.records } : {}),
    })),
    generatedBy: {
      agent: input.agentName,
      version: input.agentVersion,
      cluster: input.clusterName,
    },
  };

  if (job.profile.packageCode) {
    base.customer = job.tenantId;
    base.cluster = input.clusterName;
    base.package = job.profile.packageCode;
    base.generatedAt = input.completedAt.toISOString();
  }

  return base;
}

async function writeSmallFile(
  dir: string,
  name: string,
  content: string,
): Promise<WrittenFile> {
  const localPath = path.join(dir, name);
  await fs.writeFile(localPath, content, { flag: 'wx', mode: 0o600 });
  return {
    name,
    localPath,
    sizeBytes: Buffer.byteLength(content),
    sha256: sha256Hex(content),
  };
}

/** Writes checksum.sha256 and manifest.json to the work dir. */
export async function writeCompletionFiles(
  dir: string,
  input: ManifestInput,
): Promise<{
  checksum: WrittenFile;
  manifest: WrittenFile;
  manifestBody: Manifest;
}> {
  const checksum = await writeSmallFile(
    dir,
    CHECKSUM_FILE,
    checksumContent(input.dataFiles),
  );
  const manifestBody = buildManifest(input);
  const manifest = await writeSmallFile(
    dir,
    MANIFEST_FILE,
    `${JSON.stringify(manifestBody, null, 2)}\n`,
  );
  return { checksum, manifest, manifestBody };
}
