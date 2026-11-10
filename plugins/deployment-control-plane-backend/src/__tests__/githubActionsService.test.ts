import type { LoggerService } from '@backstage/backend-plugin-api';
import { GitHubActionsService } from '../services/githubActionsService';

function makeLogger(): LoggerService {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  } as unknown as LoggerService;
  (logger.child as jest.Mock).mockReturnValue(logger);
  return logger;
}

describe('GitHubActionsService', () => {
  const originalEnv = {
    GITHUB_PAT: process.env.GITHUB_PAT,
    GITHUB_ACTIONS_TOKEN: process.env.GITHUB_ACTIONS_TOKEN,
    CLOUDHUB_GITHUB_TOKEN: process.env.CLOUDHUB_GITHUB_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    SRI_PIPELINE_REPO: process.env.SRI_PIPELINE_REPO,
  };

  const originalFetch = global.fetch;

  function restoreEnv(key: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  afterEach(() => {
    restoreEnv('GITHUB_PAT', originalEnv.GITHUB_PAT);
    restoreEnv('GITHUB_ACTIONS_TOKEN', originalEnv.GITHUB_ACTIONS_TOKEN);
    restoreEnv('CLOUDHUB_GITHUB_TOKEN', originalEnv.CLOUDHUB_GITHUB_TOKEN);
    restoreEnv('GITHUB_TOKEN', originalEnv.GITHUB_TOKEN);
    restoreEnv('SRI_PIPELINE_REPO', originalEnv.SRI_PIPELINE_REPO);
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('prefers GITHUB_PAT over other configured tokens', async () => {
    process.env.SRI_PIPELINE_REPO = 'acme/platform';
    process.env.GITHUB_PAT = 'preferred-pat';
    process.env.GITHUB_ACTIONS_TOKEN = 'actions-token';
    process.env.CLOUDHUB_GITHUB_TOKEN = 'cloudhub-token';
    process.env.GITHUB_TOKEN = 'generic-token';

    const authHeaders: string[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const auth = String(
        (init?.headers as Record<string, string>)?.Authorization ?? '',
      );
      authHeaders.push(auth);

      if (url.includes('/dispatches')) {
        return new Response(null, { status: 204 });
      }

      if (url.includes('/runs?')) {
        return new Response(JSON.stringify({ workflow_runs: [] }), {
          status: 200,
        });
      }

      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const service = new GitHubActionsService(makeLogger());
    await service.dispatch({
      serviceId: 'detectionhub',
      workflowId: 'stage-2-deploy-component.yml',
      ref: 'main',
      inputs: {
        appName: 'detectionhub',
        appInstance: 'dt-test',
      },
    });

    expect(authHeaders[0]).toBe('Bearer preferred-pat');
  }, 10000);

  it('prefers CLOUDHUB_GITHUB_TOKEN over GITHUB_TOKEN when actions token is unset', async () => {
    process.env.SRI_PIPELINE_REPO = 'acme/platform';
    delete process.env.GITHUB_ACTIONS_TOKEN;
    process.env.CLOUDHUB_GITHUB_TOKEN = 'cloudhub-token';
    process.env.GITHUB_TOKEN = 'generic-token';

    const authHeaders: string[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const auth = String(
        (init?.headers as Record<string, string>)?.Authorization ?? '',
      );
      authHeaders.push(auth);

      if (url.includes('/dispatches')) {
        return new Response(null, { status: 204 });
      }

      if (url.includes('/runs?')) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 123,
                name: '[detectionhub]/[dt-test]',
                display_title: '[detectionhub]/[dt-test]',
                status: 'queued',
                conclusion: null,
                html_url: 'https://github.com/acme/platform/actions/runs/123',
                created_at: new Date().toISOString(),
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const service = new GitHubActionsService(makeLogger());
    const result = await service.dispatch({
      serviceId: 'detectionhub',
      workflowId: 'stage-2-deploy-component.yml',
      ref: 'main',
      inputs: {
        appName: 'detectionhub',
        appInstance: 'dt-test',
      },
    });

    expect(result.mode).toBe('github-api');
    expect(result.runId).toBe('123');
    expect(authHeaders[0]).toBe('Bearer cloudhub-token');
  });

  it('falls back to the next configured token after a 403 token-access failure', async () => {
    process.env.SRI_PIPELINE_REPO = 'acme/platform';
    process.env.GITHUB_ACTIONS_TOKEN = 'bad-actions-token';
    process.env.CLOUDHUB_GITHUB_TOKEN = 'good-cloudhub-token';
    process.env.GITHUB_TOKEN = 'generic-token';

    const dispatchAuthHeaders: string[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const auth = String(
        (init?.headers as Record<string, string>)?.Authorization ?? '',
      );
      if (url.includes('/dispatches')) {
        dispatchAuthHeaders.push(auth);
        if (auth === 'Bearer bad-actions-token') {
          return new Response(
            JSON.stringify({
              message: 'Resource not accessible by personal access token',
            }),
            { status: 403 },
          );
        }
        return new Response(null, { status: 204 });
      }

      if (url.includes('/runs?')) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 456,
                name: '[detectionhub]/[dt-test]',
                display_title: '[detectionhub]/[dt-test]',
                status: 'queued',
                conclusion: null,
                html_url: 'https://github.com/acme/platform/actions/runs/456',
                created_at: new Date().toISOString(),
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const service = new GitHubActionsService(makeLogger());
    const result = await service.dispatch({
      serviceId: 'detectionhub',
      workflowId: 'stage-2-deploy-component.yml',
      ref: 'main',
      inputs: {
        appName: 'detectionhub',
        appInstance: 'dt-test',
      },
    });

    expect(result.runId).toBe('456');
    expect(dispatchAuthHeaders).toEqual([
      'Bearer bad-actions-token',
      'Bearer good-cloudhub-token',
    ]);
  });

  it('falls back to simulated mode when the GitHub token is not configured', async () => {
    process.env.SRI_PIPELINE_REPO = 'acme/platform';
    delete process.env.GITHUB_ACTIONS_TOKEN;
    delete process.env.CLOUDHUB_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    const service = new GitHubActionsService(makeLogger());

    const result = await service.dispatch({
      serviceId: 'detectionhub',
      workflowId: 'stage-2-deploy-component.yml',
      ref: 'main',
      inputs: {
        component: 'detectionhub',
        instance: 'dt-test',
        cluster: 'aks-scp-dev-sdc-st-cms',
        environment: 'dev',
      },
    });

    expect(result.mode).toBe('simulated');
    expect(result.runId).toMatch(/^sim-/);
    expect(result.status).toBe('queued');
    expect(result.repository).toBe('acme/platform');
  });

  it('logs the exact target and token source for workflow dispatch 404s', async () => {
    process.env.GITHUB_ACTIONS_TOKEN = 'private-actions-token';
    delete process.env.GITHUB_PAT;
    delete process.env.CLOUDHUB_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    const logger = makeLogger();
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
    ) as unknown as typeof fetch;

    const service = new GitHubActionsService(logger);
    await expect(
      service.dispatch({
        serviceId: 'invhub',
        repository: 'SymphonyFS/pipeline-internal',
        workflowId: 'github-actions-diff-manual.yml',
        ref: 'main',
        inputs: {
          appName: 'invhub',
          appInstance: 'dt-test',
          apiToken: 'do-not-log-this-value',
        },
      }),
    ).rejects.toThrow(
      'https://api.github.com/repos/SymphonyFS/pipeline-internal/actions/workflows/github-actions-diff-manual.yml/dispatches',
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('tokenSource=GITHUB_ACTIONS_TOKEN'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('ref=main'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'inputs={"appName":"invhub","appInstance":"dt-test","apiToken":"[REDACTED]"}',
      ),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('status=404'),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('body={"message":"Not Found"}'),
    );
    expect(
      (logger.error as jest.Mock).mock.calls.flat().join(' '),
    ).not.toContain('private-actions-token');
    expect(
      (logger.error as jest.Mock).mock.calls.flat().join(' '),
    ).not.toContain('do-not-log-this-value');
  });

  it('returns an actionable message for PAT permission failures', async () => {
    process.env.SRI_PIPELINE_REPO = 'acme/platform';
    delete process.env.GITHUB_ACTIONS_TOKEN;
    delete process.env.CLOUDHUB_GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'bad-token';

    global.fetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          message: 'Resource not accessible by personal access token',
        }),
        { status: 403 },
      );
    }) as unknown as typeof fetch;

    const service = new GitHubActionsService(makeLogger());

    await expect(
      service.dispatch({
        serviceId: 'detectionhub',
        workflowId: 'stage-2-deploy-component.yml',
        ref: 'main',
        inputs: { app_name: 'detectionhub', instance_name: 'dt-test' },
      }),
    ).rejects.toThrow('classic PAT scopes `repo` + `workflow`');
  });

  it('correlates concurrent runs by application and instance, not recency', async () => {
    process.env.SRI_PIPELINE_REPO = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'token';
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 11,
                name: '[A]/[A1]',
                display_title: '[A]/[A1]',
                head_branch: 'main',
                created_at: '2026-09-09T10:00:01Z',
                status: 'queued',
                conclusion: null,
                html_url: 'run-a',
              },
              {
                id: 12,
                name: '[B]/[B1]',
                display_title: '[B]/[B1]',
                head_branch: 'main',
                created_at: '2026-09-09T10:00:02Z',
                status: 'queued',
                conclusion: null,
                html_url: 'run-b',
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const service = new GitHubActionsService(makeLogger());
    const runA = await service.findWorkflowRun({
      repository: 'SymphonyFS/scripts',
      workflowId: 'deploy-with-dynamic-runners.yml',
      ref: 'main',
      inputs: { appName: 'A', appInstance: 'A1' },
      dispatchInitiatedAt: '2026-09-09T10:00:00Z',
    });
    const runB = await service.findWorkflowRun({
      repository: 'SymphonyFS/scripts',
      workflowId: 'deploy-with-dynamic-runners.yml',
      ref: 'main',
      inputs: { appName: 'B', appInstance: 'B1' },
      dispatchInitiatedAt: '2026-09-09T10:00:00Z',
    });
    expect(runA.run?.id).toBe('11');
    expect(runB.run?.id).toBe('12');
  });

  it('fails closed when identical inputs produce multiple candidates', async () => {
    process.env.GITHUB_TOKEN = 'token';
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 21,
                name: '[X]/[X1]',
                display_title: '[X]/[X1]',
                head_branch: 'main',
                created_at: '2026-09-09T10:00:01Z',
              },
              {
                id: 22,
                name: '[X]/[X1]',
                display_title: '[X]/[X1]',
                head_branch: 'main',
                created_at: '2026-09-09T10:00:02Z',
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const result = await new GitHubActionsService(makeLogger()).findWorkflowRun(
      {
        repository: 'SymphonyFS/scripts',
        workflowId: 'deploy-with-dynamic-runners.yml',
        ref: 'main',
        inputs: { appName: 'X', appInstance: 'X1' },
        dispatchInitiatedAt: '2026-09-09T10:00:00Z',
      },
    );
    expect(result.status).toBe('ambiguous');
    expect(result.run).toBeUndefined();
  });

  it('returns none when the run is not visible yet', async () => {
    process.env.GITHUB_TOKEN = 'token';
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await new GitHubActionsService(makeLogger()).findWorkflowRun(
      {
        repository: 'SymphonyFS/scripts',
        workflowId: 'deploy-with-dynamic-runners.yml',
        ref: 'main',
        inputs: { appName: 'X', appInstance: 'X1' },
        dispatchInitiatedAt: '2026-09-09T10:00:00Z',
      },
    );
    expect(result.status).toBe('none');
  });

  it('correlates runs dispatched with application/instanceName-style inputs', async () => {
    process.env.GITHUB_TOKEN = 'token';
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 55,
                name: '[detectionhub]/[dt-test]',
                display_title: '[detectionhub]/[dt-test]',
                head_branch: 'main',
                created_at: '2026-09-09T10:00:01Z',
                status: 'queued',
                conclusion: null,
                html_url: 'run-55',
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const result = await new GitHubActionsService(makeLogger()).findWorkflowRun(
      {
        repository: 'SymphonyFS/scripts',
        workflowId: 'onepassword-readiness.yml',
        ref: 'main',
        inputs: {
          application: 'detectionhub',
          instanceName: 'dt-test',
          customer: 'sri',
        },
        dispatchInitiatedAt: '2026-09-09T10:00:00Z',
      },
    );
    expect(result.run?.id).toBe('55');
  });

  it('retries correlation when the dispatched run is not immediately visible', async () => {
    process.env.SRI_PIPELINE_REPO = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'token';
    let runsCall = 0;
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/dispatches')) {
        return new Response(null, { status: 204 });
      }
      if (url.includes('/runs?')) {
        runsCall += 1;
        if (runsCall < 3) {
          return new Response(JSON.stringify({ workflow_runs: [] }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 99,
                name: '[detectionhub]/[dt-test]',
                display_title: '[detectionhub]/[dt-test]',
                head_branch: 'main',
                created_at: new Date().toISOString(),
                status: 'queued',
                conclusion: null,
                html_url: 'run-99',
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const service = new GitHubActionsService(makeLogger());
    const result = await service.dispatch({
      serviceId: 'detectionhub',
      workflowId: 'onepassword-readiness.yml',
      ref: 'main',
      inputs: {
        application: 'detectionhub',
        instanceName: 'dt-test',
        customer: 'sri',
      },
    });

    expect(result.runId).toBe('99');
    expect(runsCall).toBe(3);
  });

  it('retries dispatch without unsupported inputs when workflow rejects them', async () => {
    process.env.SRI_PIPELINE_REPO = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'token';

    const dispatchBodies: Array<Record<string, unknown>> = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/dispatches')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<
          string,
          unknown
        >;
        dispatchBodies.push(body);
        const inputs = (body.inputs ?? {}) as Record<string, string>;
        if (Object.prototype.hasOwnProperty.call(inputs, 'instanceMode')) {
          return new Response(
            JSON.stringify({
              message: 'Unexpected inputs provided: ["instanceMode"]',
            }),
            { status: 422 },
          );
        }
        return new Response(null, { status: 204 });
      }

      if (url.includes('/runs?')) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 321,
                name: '[detectionhub]/[dt-test]',
                display_title: '[detectionhub]/[dt-test]',
                status: 'queued',
                conclusion: null,
                html_url:
                  'https://github.com/SymphonyFS/scripts/actions/runs/321',
                created_at: new Date().toISOString(),
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const service = new GitHubActionsService(makeLogger());
    const result = await service.dispatch({
      serviceId: 'detectionhub',
      workflowId: 'deploy-with-dynamic-runners.yml',
      ref: 'main',
      inputs: {
        appName: 'detectionhub',
        appInstance: 'dt-test',
        instanceMode: 'auto',
      },
    });

    expect(result.runId).toBe('321');
    expect(dispatchBodies).toHaveLength(2);
    expect(
      (dispatchBodies[0].inputs as Record<string, string>).instanceMode,
    ).toBe('auto');
    expect(
      (dispatchBodies[1].inputs as Record<string, string>).instanceMode,
    ).toBeUndefined();
    expect(result.inputs?.instanceMode).toBeUndefined();
  });

  it('verifies an app instance helmfile exists on the target branch', async () => {
    process.env.SRI_PIPELINE_REPO = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'token';

    const requestedUrls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url.includes('/contents/apps/detectionhub/dt-test/helmfile.yaml')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const service = new GitHubActionsService(makeLogger());
    await expect(
      service.verifyAppInstanceExists('detectionhub', 'dt-test', 'main'),
    ).resolves.toBe(true);

    expect(requestedUrls[0]).toContain(
      '/repos/SymphonyFS/scripts/contents/apps/detectionhub/dt-test/helmfile.yaml?ref=main',
    );
  });

  it('returns false when an app instance helmfile is missing', async () => {
    process.env.SRI_PIPELINE_REPO = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'token';

    global.fetch = jest.fn(
      async () => new Response('{}', { status: 404 }),
    ) as unknown as typeof fetch;

    const service = new GitHubActionsService(makeLogger());
    await expect(
      service.verifyAppInstanceExists('detectionhub', 'dt-missing', 'main'),
    ).resolves.toBe(false);
  });

  it('returns workflow jobs with detailed step progression', async () => {
    process.env.SRI_PIPELINE_REPO = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'token';

    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/actions/runs/777/jobs')) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 101,
                name: 'Helmfile Template & Lint',
                status: 'completed',
                conclusion: 'success',
                started_at: '2026-09-17T10:00:00Z',
                completed_at: '2026-09-17T10:00:10Z',
                steps: [
                  {
                    number: 1,
                    name: 'Checkout',
                    status: 'completed',
                    conclusion: 'success',
                    started_at: '2026-09-17T10:00:00Z',
                    completed_at: '2026-09-17T10:00:01Z',
                  },
                  {
                    number: 2,
                    name: 'Render Helmfile',
                    status: 'completed',
                    conclusion: 'success',
                    started_at: '2026-09-17T10:00:01Z',
                    completed_at: '2026-09-17T10:00:09Z',
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          id: 777,
          name: '[detectionhub]/[dt-test]',
          status: 'in_progress',
          conclusion: null,
          html_url: 'https://github.com/SymphonyFS/scripts/actions/runs/777',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const status = await new GitHubActionsService(makeLogger()).runStatus(
      '777',
      'SymphonyFS/scripts',
    );

    expect(status.runId).toBe('777');
    expect(status.status).toBe('in_progress');
    expect(status.jobs).toHaveLength(1);
    expect(status.jobs[0].steps).toHaveLength(2);
    expect(status.jobs[0].steps[1]).toMatchObject({
      name: 'Render Helmfile',
      status: 'completed',
      conclusion: 'success',
      number: 2,
    });
  });

  it('verifies an app instance helmfile exists on the target branch (ref validation)', async () => {
    process.env.SRI_PIPELINE_REPO = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'token';

    const requestedUrls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url.includes('/contents/apps/detectionhub/dt-test/helmfile.yaml')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const service = new GitHubActionsService(makeLogger());
    await expect(
      service.verifyAppInstanceExists('detectionhub', 'dt-test', 'main'),
    ).resolves.toBe(true);

    expect(requestedUrls[0]).toContain(
      '/repos/SymphonyFS/scripts/contents/apps/detectionhub/dt-test/helmfile.yaml?ref=main',
    );
  });

  it('returns false when an app instance helmfile is missing (ref validation)', async () => {
    process.env.SRI_PIPELINE_REPO = 'SymphonyFS/scripts';
    process.env.GITHUB_TOKEN = 'token';

    global.fetch = jest.fn(
      async () => new Response('{}', { status: 404 }),
    ) as unknown as typeof fetch;

    const service = new GitHubActionsService(makeLogger());
    await expect(
      service.verifyAppInstanceExists('detectionhub', 'dt-missing', 'main'),
    ).resolves.toBe(false);
  });
});
