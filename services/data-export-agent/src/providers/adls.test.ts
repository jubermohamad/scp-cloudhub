import { silentLogger } from '../logger';
import { AdlsFileSystemLike, AdlsGen2Provider } from './adls';
import { isExpired } from './types';

const credential = {
  getToken: async () => ({
    token: 't',
    expiresOnTimestamp: Date.now() + 3600_000,
  }),
};

/** In-memory hierarchical file system recording calls. */
function fakeService(dirs: string[] = [], opts: { exists?: boolean } = {}) {
  const uploads: Array<{ path: string; localPath?: string }> = [];
  const deletedFiles: string[] = [];
  const deletedDirs: string[] = [];
  const urls: string[] = [];
  const fsNames: string[] = [];
  const fsClient: AdlsFileSystemLike = {
    exists: async () => opts.exists ?? true,
    getFileClient: path => ({
      uploadFile: async localPath => {
        uploads.push({ path, localPath });
      },
      upload: async () => {
        uploads.push({ path });
      },
      delete: async () => {
        deletedFiles.push(path);
      },
    }),
    getDirectoryClient: path => ({
      delete: async recursive => {
        expect(recursive).toBe(true);
        deletedDirs.push(path);
      },
    }),
    listPaths: ({ path, recursive }) => {
      expect(recursive).toBe(false);
      const children = dirs
        .filter(
          d =>
            d.startsWith(`${path}/`) && !d.slice(path.length + 1).includes('/'),
        )
        .map(name => ({ name, isDirectory: true }));
      return (async function* gen() {
        if (children.length === 0 && !dirs.some(d => d.startsWith(path))) {
          throw Object.assign(new Error('not found'), { statusCode: 404 });
        }
        yield* children;
      })();
    },
  };
  return {
    uploads,
    deletedFiles,
    deletedDirs,
    urls,
    fsNames,
    factory: (url: string) => {
      urls.push(url);
      return {
        getFileSystemClient: (name: string) => {
          fsNames.push(name);
          return fsClient;
        },
      };
    },
  };
}

const file = (name: string) => ({
  name,
  localPath: `/work/${name}`,
  sizeBytes: 10,
  sha256: 'f'.repeat(64),
});

describe('AdlsGen2Provider', () => {
  it('validates config', () => {
    const p = new AdlsGen2Provider(credential);
    expect(p.validate({ accountName: 'acct01' })).toEqual([]);
    expect(p.validate({ accountName: 'Bad.Account' })).toHaveLength(1);
    expect(
      p.validate({ accountName: 'acct01', fileSystem: 'Bad_FS' }),
    ).toHaveLength(1);
    expect(p.validate({ accountName: 'acct01', path: 'a/../b' })).toHaveLength(
      1,
    );
  });

  it('uploads files in order under [path/]outputPrefix on the account dfs endpoint', async () => {
    const svc = fakeService();
    const p = new AdlsGen2Provider(credential, svc.factory);
    const delivered = await p.upload(
      [file('a.parquet'), file('checksum.sha256'), file('manifest.json')],
      {
        config: { accountName: 'acct01', path: '/exports/base/' },
        outputPrefix: 'tenant/t1/exports/p/2026/10/20/job-1',
        logger: silentLogger,
      },
    );
    expect(svc.urls).toEqual(['https://acct01.dfs.core.windows.net']);
    expect(svc.fsNames[0]).toBe('data-export-hub');
    expect(svc.uploads.map(u => u.path)).toEqual([
      'exports/base/tenant/t1/exports/p/2026/10/20/job-1/a.parquet',
      'exports/base/tenant/t1/exports/p/2026/10/20/job-1/checksum.sha256',
      'exports/base/tenant/t1/exports/p/2026/10/20/job-1/manifest.json',
    ]);
    expect(svc.uploads[0].localPath).toBe('/work/a.parquet');
    expect(delivered[2].path).toBe(
      'abfss://data-export-hub@acct01.dfs.core.windows.net/exports/base/tenant/t1/exports/p/2026/10/20/job-1/manifest.json',
    );
  });

  it('uses a custom file system and no base path', async () => {
    const svc = fakeService();
    const p = new AdlsGen2Provider(credential, svc.factory);
    await p.upload([file('x.csv')], {
      config: { accountName: 'acct01', fileSystem: 'exports' },
      outputPrefix: 'a/b',
      logger: silentLogger,
    });
    expect(svc.fsNames).toEqual(['exports']);
    expect(svc.uploads[0].path).toBe('a/b/x.csv');
  });

  it('health check writes and deletes a probe', async () => {
    const svc = fakeService();
    const p = new AdlsGen2Provider(
      credential,
      svc.factory,
      () => new Date(1000),
    );
    const res = await p.healthCheck({ accountName: 'acct01', path: 'base' });
    expect(res.status).toBe('HEALTHY');
    expect(svc.uploads[0].path).toBe('base/_health/probe-1000.txt');
    expect(svc.deletedFiles).toEqual(['base/_health/probe-1000.txt']);
  });

  it('health check fails when the file system is missing or config is invalid', async () => {
    const p = new AdlsGen2Provider(
      credential,
      fakeService([], { exists: false }).factory,
    );
    expect((await p.healthCheck({ accountName: 'acct01' })).status).toBe(
      'FAILED',
    );
    expect((await p.healthCheck({ accountName: 'NO' })).status).toBe('FAILED');
  });

  it('retention deletes only dated day directories older than the window', async () => {
    const root = 'base/tenant/t1/exports/p';
    const svc = fakeService([
      `${root}/2026`,
      `${root}/2026/09`,
      `${root}/2026/09/01`,
      `${root}/2026/09/30`,
      `${root}/2026/10`,
      `${root}/2026/10/10`,
      `${root}/2026/10/11`,
      `${root}/2026/10/20`,
      `${root}/2026/10/notadate`,
      `${root}/2025`,
      `${root}/2025/12`,
      `${root}/2025/12/31`,
    ]);
    const p = new AdlsGen2Provider(
      credential,
      svc.factory,
      () => new Date('2026-10-20T15:00:00Z'),
    );
    const removed = await p.applyRetention('tenant/t1/exports/p', 9, {
      accountName: 'acct01',
      path: 'base',
    });
    expect(svc.deletedDirs.sort()).toEqual([
      `${root}/2025/12/31`,
      `${root}/2026/09/01`,
      `${root}/2026/09/30`,
      `${root}/2026/10/10`,
    ]);
    expect(removed).toBe(4);
  });

  it('retention on a missing prefix is a no-op', async () => {
    const p = new AdlsGen2Provider(credential, fakeService().factory);
    await expect(
      p.applyRetention('tenant/none', 7, { accountName: 'acct01' }),
    ).resolves.toBe(0);
  });
});

describe('isExpired', () => {
  const now = new Date('2026-10-20T00:30:00Z');
  it('compares whole UTC days', () => {
    expect(isExpired('2026', '10', '13', 7, now)).toBe(false);
    expect(isExpired('2026', '10', '12', 7, now)).toBe(true);
    expect(isExpired('2026', '1', '12', 7, now)).toBe(false);
  });
});
