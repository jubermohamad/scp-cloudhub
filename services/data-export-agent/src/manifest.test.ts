import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeJob } from './__fixtures__/fakes';
import {
  buildManifest,
  checksumContent,
  parseChecksumContent,
  writeCompletionFiles,
} from './manifest';

const dataFile = {
  name: 'accounts.csv',
  localPath: '/tmp/accounts.csv',
  sizeBytes: 120,
  sha256: 'a'.repeat(64),
  records: 3,
};

const input = (job = makeJob()) => ({
  job,
  dataFiles: [dataFile],
  watermarkTo: null,
  startedAt: new Date('2026-10-20T01:00:00Z'),
  completedAt: new Date('2026-10-20T01:05:00Z'),
  agentName: 'aks-1-data-export-agent',
  agentVersion: '0.1.0',
  clusterName: 'aks-1',
});

describe('checksum file', () => {
  it('uses sha256sum format', () => {
    const content = checksumContent([
      dataFile,
      { name: 'b.csv', sha256: 'b'.repeat(64) },
    ]);
    expect(content).toBe(
      `${'a'.repeat(64)}  accounts.csv\n${'b'.repeat(64)}  b.csv\n`,
    );
    expect(parseChecksumContent(content).get('b.csv')).toBe('b'.repeat(64));
  });
});

describe('buildManifest', () => {
  it('describes a FULL run', () => {
    expect(buildManifest(input())).toEqual({
      manifestVersion: 1,
      tenant: 'tenant-a',
      profile: 'Nightly',
      profileId: 'profile-1',
      dataset: 'accounts',
      runId: 'job-1',
      attempt: 1,
      status: 'COMPLETED',
      exportMode: 'FULL',
      format: 'CSV',
      compression: 'NONE',
      records: 3,
      bytes: 120,
      watermark: { column: null, from: null, to: null },
      startedAt: '2026-10-20T01:00:00.000Z',
      completedAt: '2026-10-20T01:05:00.000Z',
      files: [
        {
          name: 'accounts.csv',
          sha256: 'a'.repeat(64),
          bytes: 120,
          records: 3,
        },
      ],
      generatedBy: {
        agent: 'aks-1-data-export-agent',
        version: '0.1.0',
        cluster: 'aks-1',
      },
    });
  });

  it('records the watermark range of an INCREMENTAL run', () => {
    const job = makeJob({
      profile: { exportMode: 'INCREMENTAL' },
      dataset: { watermarkColumn: 'id' },
      watermark: { lastSuccessValue: '10' },
    });
    expect(
      buildManifest({ ...input(job), watermarkTo: '42' }).watermark,
    ).toEqual({ column: 'id', from: '10', to: '42' });
    // No new rows: the watermark stays where it was.
    expect(buildManifest(input(job)).watermark).toEqual({
      column: 'id',
      from: '10',
      to: '10',
    });
  });
});

describe('writeCompletionFiles', () => {
  it('writes checksum.sha256 and manifest.json with their own hashes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dxh-manifest-'));
    try {
      const { checksum, manifest, manifestBody } = await writeCompletionFiles(
        dir,
        input(),
      );
      expect(checksum.name).toBe('checksum.sha256');
      expect(manifest.name).toBe('manifest.json');
      for (const f of [checksum, manifest]) {
        const content = fs.readFileSync(f.localPath);
        expect(f.sizeBytes).toBe(content.length);
        expect(f.sha256).toBe(
          createHash('sha256').update(content).digest('hex'),
        );
      }
      expect(JSON.parse(fs.readFileSync(manifest.localPath, 'utf8'))).toEqual(
        manifestBody,
      );
      expect(fs.readFileSync(checksum.localPath, 'utf8')).toBe(
        `${'a'.repeat(64)}  accounts.csv\n`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
