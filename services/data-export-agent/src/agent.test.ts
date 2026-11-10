import { Agent } from './agent';
import { FakeControlPlane, FakeProvider, makeJob } from './__fixtures__/fakes';
import type { JobOutcome } from './jobRunner';
import { silentLogger } from './logger';
import type { JobSpec } from './protocol';
import { ProviderRegistry } from './providers/registry';
import { tokenProviderFromCredential } from './auth';

const flush = () => new Promise(r => setImmediate(r));

function setup(runner?: {
  run: (job: JobSpec, signal?: AbortSignal) => Promise<JobOutcome>;
}) {
  const controlPlane = new FakeControlPlane();
  const sftp = new FakeProvider('SFTP');
  const agent = new Agent({
    controlPlane,
    runner: runner ?? {
      run: async () => ({
        status: 'COMPLETED',
        rows: 0,
        bytes: 0,
        watermarkValue: null,
      }),
    },
    providers: new ProviderRegistry([sftp, new FakeProvider('ADLS_GEN2')]),
    logger: silentLogger,
    agentName: 'aks-1-data-export-agent',
    version: '0.1.0',
    clusterInfo: async () => ({
      kubernetesVersion: 'v1.30.4',
      clusterUid: 'uid-123',
    }),
    shutdownGraceMs: 50,
    abortWaitMs: 50,
  });
  return { controlPlane, sftp, agent };
}

describe('Agent', () => {
  it('heartbeats with status, version and capabilities, and adopts server intervals', async () => {
    const { agent, controlPlane } = setup();
    controlPlane.heartbeatResponse.heartbeatIntervalSeconds = 30;
    expect(agent.isReady()).toBe(false);
    await agent.heartbeatOnce();
    expect(agent.isReady()).toBe(true);
    const hb = controlPlane.last('heartbeat')!.body;
    expect(hb).toEqual({
      protocolVersion: 1,
      agentName: 'aks-1-data-export-agent',
      version: '0.1.0',
      status: 'ONLINE',
      capabilities: {
        formats: ['PARQUET', 'CSV', 'TSV', 'JSON'],
        providers: ['ADLS_GEN2', 'SFTP'],
        exportModes: ['FULL', 'INCREMENTAL', 'SNAPSHOT'],
        kubernetesVersion: 'v1.30.4',
        clusterUid: 'uid-123',
      },
    });
  });

  it('omits cluster fields when the Kubernetes API is unavailable', async () => {
    const controlPlane = new FakeControlPlane();
    const agent = new Agent({
      controlPlane,
      runner: { run: async () => ({ status: 'CANCELLED' }) },
      providers: new ProviderRegistry([]),
      logger: silentLogger,
      agentName: 'a',
      version: '0',
      clusterInfo: async () => {
        throw new Error('forbidden');
      },
      shutdownGraceMs: 0,
    });
    await agent.heartbeatOnce();
    const caps = controlPlane.last('heartbeat')!.body.capabilities;
    expect(caps).not.toHaveProperty('kubernetesVersion');
    expect(caps).not.toHaveProperty('clusterUid');
  });

  it('runs requested destination checks and reports them in the next heartbeat, DEGRADED on failure', async () => {
    const { agent, controlPlane, sftp } = setup();
    sftp.health = { status: 'FAILED', message: 'host key mismatch' };
    controlPlane.heartbeatResponse.destinationsToCheck = [
      { id: 'd-sftp', type: 'SFTP', configuration: {} },
      { id: 'd-s3', type: 'S3' as any, configuration: {} },
    ];
    await agent.heartbeatOnce();
    await flush();
    controlPlane.heartbeatResponse.destinationsToCheck = [];
    await agent.heartbeatOnce();
    const hb = controlPlane.last('heartbeat')!.body;
    expect(hb.status).toBe('DEGRADED');
    expect(hb.destinationChecks).toEqual([
      {
        destinationId: 'd-sftp',
        status: 'FAILED',
        message: 'host key mismatch',
        checkedAt: expect.any(String),
      },
      {
        destinationId: 'd-s3',
        status: 'FAILED',
        message: expect.stringMatching(/not supported/),
        checkedAt: expect.any(String),
      },
    ]);
    // Reported once only.
    await agent.heartbeatOnce();
    expect(
      controlPlane.last('heartbeat')!.body.destinationChecks,
    ).toBeUndefined();

    // A later healthy check clears DEGRADED.
    sftp.health = { status: 'HEALTHY', message: 'ok' };
    await agent.runDestinationChecks([
      { id: 'd-sftp', type: 'SFTP', configuration: {} },
    ]);
    await agent.runDestinationChecks([
      { id: 'd-s3', type: 'SFTP', configuration: {} },
    ]);
    expect(agent.status()).toBe('ONLINE');
  });

  it('claims and runs jobs one at a time, goes DEGRADED after an infrastructure failure', async () => {
    let running = 0;
    let maxRunning = 0;
    const ran: string[] = [];
    const { agent, controlPlane } = setup({
      run: async job => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise(r => setTimeout(r, 5));
        running -= 1;
        ran.push(job.jobId);
        return job.jobId === 'j2'
          ? { status: 'FAILED', retryable: true, error: 'ECONNRESET' }
          : { status: 'COMPLETED', rows: 1, bytes: 1, watermarkValue: null };
      },
    });
    controlPlane.jobs = [makeJob({ jobId: 'j1' }), makeJob({ jobId: 'j2' })];
    agent.start();
    await new Promise(r => setTimeout(r, 50));
    expect(ran).toEqual(['j1', 'j2']);
    expect(maxRunning).toBe(1);
    expect(agent.status()).toBe('DEGRADED');
    expect(controlPlane.ops()[0]).toBe('heartbeat');
    await agent.stop();
  });

  it('waits for the running job on shutdown within the grace period', async () => {
    let finished = false;
    const { agent, controlPlane } = setup({
      run: async () => {
        await new Promise(r => setTimeout(r, 20));
        finished = true;
        return { status: 'COMPLETED', rows: 0, bytes: 0, watermarkValue: null };
      },
    });
    controlPlane.jobs = [makeJob()];
    agent.start();
    await new Promise(r => setTimeout(r, 5));
    await agent.stop();
    expect(finished).toBe(true);
    expect(controlPlane.ops()).not.toContain('fail');
    const claims = controlPlane.ops().filter(o => o === 'claim').length;
    await new Promise(r => setTimeout(r, 20));
    expect(controlPlane.ops().filter(o => o === 'claim').length).toBe(claims);
  });

  it('aborts the running job after the grace period', async () => {
    let sawAbort = false;
    const { agent, controlPlane } = setup({
      run: (_job, signal) =>
        new Promise(resolve => {
          signal!.addEventListener('abort', () => {
            sawAbort = true;
            resolve({ status: 'FAILED', retryable: true, error: 'aborted' });
          });
        }),
    });
    controlPlane.jobs = [makeJob()];
    agent.start();
    await new Promise(r => setTimeout(r, 5));
    await agent.stop();
    expect(sawAbort).toBe(true);
  });

  it('reports the job as failed (retryable) itself when the runner ignores the abort', async () => {
    const { agent, controlPlane } = setup({ run: () => new Promise(() => {}) });
    controlPlane.jobs = [makeJob({ jobId: 'stuck' })];
    agent.start();
    await new Promise(r => setTimeout(r, 5));
    await agent.stop();
    expect(controlPlane.last('fail')).toMatchObject({
      jobId: 'stuck',
      body: { retryable: true },
    });
  });

  it('keeps going when heartbeats fail and is not ready', async () => {
    const { agent, controlPlane } = setup();
    controlPlane.failHeartbeat = new Error('down');
    await expect(agent.heartbeatOnce()).rejects.toThrow('down');
    expect(agent.isReady()).toBe(false);
    expect(agent.isLive()).toBe(true);
  });
});

describe('tokenProviderFromCredential', () => {
  it('caches tokens until shortly before expiry', async () => {
    let now = 0;
    let issued = 0;
    const getToken = jest.fn(async () => {
      issued += 1;
      return { token: `t${issued}`, expiresOnTimestamp: now + 3600_000 };
    });
    const tokens = tokenProviderFromCredential({ getToken }, () => now);
    expect(await tokens.getToken('s')).toBe('t1');
    expect(await tokens.getToken('s')).toBe('t1');
    now += 3600_000 - 60_000;
    expect(await tokens.getToken('s')).toBe('t2');
    expect(getToken).toHaveBeenCalledTimes(2);
  });
});
