import { ScriptsApplicationCatalogService } from '../services/scriptsApplicationCatalogService';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;

function encoded(value: string) {
  return { type: 'file', encoding: 'base64', content: Buffer.from(value).toString('base64') };
}

describe('ScriptsApplicationCatalogService remote source', () => {
  const originalFetch = global.fetch;
  const originalEnv = { repository: process.env.SYMPHONYFS_SCRIPTS_REPOSITORY, token: process.env.GITHUB_TOKEN };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SYMPHONYFS_SCRIPTS_REPOSITORY = originalEnv.repository;
    process.env.GITHUB_TOKEN = originalEnv.token;
    jest.restoreAllMocks();
  });

  it('reads APP_LIST and instances through GitHub without local task.bash access', async () => {
    process.env.SYMPHONYFS_SCRIPTS_REPOSITORY = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'test-token';
    const task = `APP_LIST=(\nai-store\ndetectionhub\n)\n`;
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/contents/task.bash')) return new Response(JSON.stringify(encoded(task)), { status: 200 });
      if (url.includes('/contents/apps/detectionhub?')) return new Response(JSON.stringify([{ type: 'dir', name: 'dt-absa-dev', path: 'apps/detectionhub/dt-absa-dev' }]), { status: 200 });
      if (url.includes('/contents/apps/detectionhub/dt-absa-dev/helmfile.yaml')) return new Response(JSON.stringify(encoded('namespace: dt-absa-dev\nenvType: dev\n')), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const service = new ScriptsApplicationCatalogService(logger);
    expect((await service.listApplications()).map(item => item.appName)).toEqual(['ai-store', 'detectionhub']);
    expect(await service.listInstances('detectionhub')).toEqual([{ appName: 'detectionhub', appInstance: 'dt-absa-dev', helmfilePath: 'apps/detectionhub/dt-absa-dev/helmfile.yaml', metadata: { namespace: 'dt-absa-dev', envType: 'dev' } }]);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('normalizes the SRI Investigation label to the invhub repository app', async () => {
    process.env.SYMPHONYFS_SCRIPTS_REPOSITORY = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'test-token';
    const task = `APP_LIST=(\ninvhub\n)\n`;
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/contents/task.bash')) return new Response(JSON.stringify(encoded(task)), { status: 200 });
      if (url.includes('/contents/apps/invhub?')) return new Response(JSON.stringify([{ type: 'dir', name: 'ih-sri-dev', path: 'apps/invhub/ih-sri-dev' }]), { status: 200 });
      if (url.includes('/contents/apps/invhub/ih-sri-dev/helmfile.yaml')) return new Response(JSON.stringify(encoded('namespace: ih-sri-dev\nkubeContext: aks-dev\nenvType: dev\n')), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const service = new ScriptsApplicationCatalogService(logger);
    const application = 'SRI Investigation'.toLowerCase().replace(/\s+/g, '-');
    const normalizedApplication = application === 'sri-investigation' ? 'invhub' : application;
    expect(normalizedApplication).toBe('invhub');
    expect(await service.listInstances(normalizedApplication)).toEqual([
      { appName: 'invhub', appInstance: 'ih-sri-dev', helmfilePath: 'apps/invhub/ih-sri-dev/helmfile.yaml', metadata: { namespace: 'ih-sri-dev', kubeContext: 'aks-dev', envType: 'dev' } },
    ]);
    expect(await service.listInstances('invhub')).not.toContainEqual(expect.objectContaining({ appInstance: 'juber' }));
  });

  it('falls back to apps directory discovery when task.bash is missing', async () => {
    process.env.SYMPHONYFS_SCRIPTS_REPOSITORY = 'jubermohamad/platform_cloudhub';
    process.env.GITHUB_TOKEN = 'test-token';
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/contents/task.bash')) return new Response('not found', { status: 404 });
      if (url.includes('/contents/apps?')) {
        return new Response(
          JSON.stringify([
            { type: 'dir', name: 'common-res', path: 'apps/common-res' },
            { type: 'dir', name: 'detectionhub', path: 'apps/detectionhub' },
            { type: 'dir', name: 'invhub', path: 'apps/invhub' },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/contents/apps/invhub?')) {
        return new Response(
          JSON.stringify([{ type: 'dir', name: 'ih-sri-dev', path: 'apps/invhub/ih-sri-dev' }]),
          { status: 200 },
        );
      }
      if (url.includes('/contents/apps/invhub/ih-sri-dev/helmfile.yaml')) {
        return new Response(
          JSON.stringify(encoded('namespace: ih-sri-dev\nenvType: dev\n')),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const service = new ScriptsApplicationCatalogService(logger);
    expect((await service.listApplications()).map(item => item.appName)).toEqual([
      'common-res',
      'detectionhub',
      'invhub',
    ]);
    expect(await service.listInstances('invhub')).toEqual([
      {
        appName: 'invhub',
        appInstance: 'ih-sri-dev',
        helmfilePath: 'apps/invhub/ih-sri-dev/helmfile.yaml',
        metadata: { namespace: 'ih-sri-dev', envType: 'dev' },
      },
    ]);
  });

  it('discovers scp/apps applications alongside apps/ and exposes catalogued chart versions', async () => {
    process.env.SYMPHONYFS_SCRIPTS_REPOSITORY = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'test-token';
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/contents/task.bash')) return new Response('not found', { status: 404 });
      if (url.includes('/contents/apps?')) {
        return new Response(JSON.stringify([{ type: 'dir', name: 'invhub', path: 'apps/invhub' }]), { status: 200 });
      }
      if (url.includes('/contents/scp/apps?')) {
        return new Response(
          JSON.stringify([
            { type: 'dir', name: 'invhub', path: 'scp/apps/invhub' },
            { type: 'dir', name: 'dxv', path: 'scp/apps/dxv' },
            { type: 'file', name: 'README.md', path: 'scp/apps/README.md' },
          ]),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const service = new ScriptsApplicationCatalogService(logger);
    const apps = await service.listApplications();
    expect(apps.map(app => app.appName)).toEqual(['invhub', 'dxv']);
    expect(apps.find(app => app.appName === 'invhub')?.chartVersions).toEqual(['1.415.0', '1.411.0', '1.408.0']);
    expect(await service.listInstances('dxv')).toEqual([]);
  });

  it('fails with a clear message when repository has neither task.bash nor valid apps directory', async () => {
    process.env.SYMPHONYFS_SCRIPTS_REPOSITORY = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'test-token';
    global.fetch = jest.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
    await expect(new ScriptsApplicationCatalogService(logger).listInstances('invhub')).rejects.toThrow(/has no usable deployment catalog/);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('api.github.com/repos/SymphonyFS/scripts'), expect.any(Object));
  });
});
