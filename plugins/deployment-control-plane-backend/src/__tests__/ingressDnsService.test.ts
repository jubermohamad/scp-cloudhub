import {
  IngressDnsService,
  configuredIngressIps,
  parseKubeContext,
} from '../services/ingressDnsService';
import {
  DEFAULT_DEPLOYMENT_REPOSITORY,
  DEFAULT_DEPLOY_WORKFLOW_ID,
  deployWorkflowId,
  deploymentRepository,
} from '../services/deploymentPipeline';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as any;

const TARGET = {
  hostname: 'invhub-abanca-dev',
  zone: 'symphonyai.dev',
  fqdn: 'invhub-abanca-dev.symphonyai.dev',
  url: 'https://invhub-abanca-dev.symphonyai.dev',
};

function cloudflareResponse(result: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({
      success: ok,
      errors: ok ? [] : [{ code: 9109, message: 'Invalid access token' }],
      result,
    }),
  } as unknown as Response;
}

function buildService(fetchImpl: jest.Mock, resolve4 = jest.fn()) {
  return new IngressDnsService(logger, {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    resolve4,
    sleep: async () => undefined,
    propagationAttempts: 3,
  });
}

describe('IngressDnsService', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
    process.env.CLOUDHUB_CLUSTER_INGRESS_IPS = JSON.stringify({
      'uk-eng-dev': '51.12.84.190',
    });
    delete process.env.CLOUDFLARE_ZONE_ID_SYMPHONYAI_DEV;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('skips without calling Cloudflare when no API token is configured', async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    const fetchImpl = jest.fn();
    const result = await buildService(fetchImpl).ensureARecord({
      target: TARGET,
      clusterNames: ['uk-eng-dev'],
    });
    expect(result.status).toBe('SKIPPED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('creates the A record in the zone looked up by name, then waits for propagation', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        cloudflareResponse([{ id: 'zone-dev', name: 'symphonyai.dev' }]),
      )
      .mockResolvedValueOnce(cloudflareResponse([]))
      .mockResolvedValueOnce(cloudflareResponse({ id: 'rec-1' }));
    const resolve4 = jest
      .fn()
      .mockRejectedValueOnce(new Error('ENOTFOUND'))
      .mockResolvedValueOnce(['51.12.84.190']);

    const result = await buildService(fetchImpl, resolve4).ensureARecord({
      target: TARGET,
      clusterNames: [null, 'uk-eng-dev'],
    });

    expect(result).toMatchObject({
      status: 'CREATED',
      ip: '51.12.84.190',
      propagated: true,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.cloudflare.com/client/v4/zones?name=symphonyai.dev',
    );
    const [createUrl, createInit] = fetchImpl.mock.calls[2];
    expect(createUrl).toBe(
      'https://api.cloudflare.com/client/v4/zones/zone-dev/dns_records',
    );
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(createInit.body)).toEqual({
      type: 'A',
      name: 'invhub-abanca-dev.symphonyai.dev',
      content: '51.12.84.190',
      ttl: 300,
      proxied: false,
    });
  });

  it('updates a record pointing at a different IP and leaves a matching one alone', async () => {
    process.env.CLOUDFLARE_ZONE_ID_SYMPHONYAI_DEV = 'pinned-zone';
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        cloudflareResponse([{ id: 'rec-1', content: '10.0.0.1' }]),
      )
      .mockResolvedValueOnce(cloudflareResponse({ id: 'rec-1' }))
      .mockResolvedValueOnce(
        cloudflareResponse([{ id: 'rec-1', content: '51.12.84.190' }]),
      );
    const resolve4 = jest.fn().mockResolvedValue(['51.12.84.190']);
    const service = buildService(fetchImpl, resolve4);

    const updated = await service.ensureARecord({
      target: TARGET,
      clusterNames: ['uk-eng-dev'],
    });
    expect(updated.status).toBe('UPDATED');
    expect(fetchImpl.mock.calls[1][0]).toContain(
      '/zones/pinned-zone/dns_records/rec-1',
    );
    expect(fetchImpl.mock.calls[1][1].method).toBe('PUT');

    const unchanged = await service.ensureARecord({
      target: TARGET,
      clusterNames: ['uk-eng-dev'],
    });
    expect(unchanged.status).toBe('UNCHANGED');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('surfaces Cloudflare API errors instead of reporting success', async () => {
    process.env.CLOUDFLARE_ZONE_ID_SYMPHONYAI_DEV = 'pinned-zone';
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(cloudflareResponse(null, false, 403));
    await expect(
      buildService(fetchImpl).ensureARecord({
        target: TARGET,
        clusterNames: ['uk-eng-dev'],
      }),
    ).rejects.toThrow('Invalid access token');
  });

  it('refuses to guess an ingress IP for an unmapped cluster', async () => {
    const fetchImpl = jest.fn();
    await expect(
      buildService(fetchImpl).ensureARecord({
        target: TARGET,
        clusterNames: ['aks-unknown'],
      }),
    ).rejects.toThrow('No ingress IP is configured for cluster aks-unknown');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports not-propagated without failing when DNS never resolves', async () => {
    process.env.CLOUDFLARE_ZONE_ID_SYMPHONYAI_DEV = 'pinned-zone';
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(cloudflareResponse([]))
      .mockResolvedValueOnce(cloudflareResponse({ id: 'rec-1' }));
    const resolve4 = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const result = await buildService(fetchImpl, resolve4).ensureARecord({
      target: TARGET,
      clusterNames: ['uk-eng-dev'],
    });
    expect(result).toMatchObject({ status: 'CREATED', propagated: false });
    expect(resolve4).toHaveBeenCalledTimes(3);
  });

  it('probes health paths in order and stops at the first 200', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 302 })
      .mockResolvedValueOnce({ status: 200 });
    const result = await buildService(fetchImpl).probeHealth(TARGET);
    expect(result.healthy).toBe(true);
    expect(result.healthyPath).toBe('/actuator/health');
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([
      'https://invhub-abanca-dev.symphonyai.dev/health',
      'https://invhub-abanca-dev.symphonyai.dev/api/health',
      'https://invhub-abanca-dev.symphonyai.dev/actuator/health',
    ]);
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual');
    expect(result.attempts[1]).toEqual({
      path: '/api/health',
      statusCode: 302,
      error: null,
    });
  });
});

describe('ingress helpers', () => {
  it('parses the first literal kubeContext from a helmfile', () => {
    expect(
      parseKubeContext(
        'helmDefaults:\n  kubeContext: "{{ .Values.ctx }}"\n  kubeContext: uk-eng-dev # primary\n',
      ),
    ).toBe('uk-eng-dev');
    expect(parseKubeContext('releases: []\n')).toBeNull();
  });

  it('validates CLOUDHUB_CLUSTER_INGRESS_IPS', () => {
    expect(configuredIngressIps('{"a":"1.2.3.4"}')).toEqual({ a: '1.2.3.4' });
    expect(configuredIngressIps(undefined)).toEqual({});
    expect(() => configuredIngressIps('{"a":"999.1.1.1"}')).toThrow(
      'invalid IPv4',
    );
    expect(() => configuredIngressIps('[]')).toThrow('JSON object');
  });
});

describe('deployment pipeline defaults', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('defaults to the enterprise pipeline-internal deploy workflow', () => {
    delete process.env.SYMPHONYFS_SCRIPTS_REPOSITORY;
    delete process.env.SYMPHONYFS_WORKFLOW_ID;
    expect(DEFAULT_DEPLOYMENT_REPOSITORY).toBe('SymphonyFS/pipeline-internal');
    expect(deploymentRepository()).toBe('SymphonyFS/pipeline-internal');
    expect(deployWorkflowId()).toBe(DEFAULT_DEPLOY_WORKFLOW_ID);
    expect(DEFAULT_DEPLOY_WORKFLOW_ID).toBe('deploy-with-dynamic-runners.yml');
  });

  it('rejects a malformed repository override', () => {
    process.env.SYMPHONYFS_SCRIPTS_REPOSITORY = 'not a repo';
    expect(() => deploymentRepository()).toThrow('owner/repo');
  });
});
