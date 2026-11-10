/**
 * The agent's two loops:
 *
 * - heartbeat: immediately at start, then every `heartbeatIntervalSeconds`
 *   (from the server); carries status, capabilities and the results of
 *   destination checks the previous response asked for.
 * - poll: claims a job every `pollIntervalSeconds` while idle and runs one job
 *   at a time. The heartbeat loop keeps running during long jobs.
 *
 * Shutdown stops claiming, lets the in-flight job finish within the grace
 * period, then aborts it (reported as a retryable failure).
 */
import type { ClusterInfo, ClusterInfoReader } from './clusterInfo';
import type { ControlPlane } from './controlPlaneClient';
import { errorMessage } from './errors';
import type { HealthState } from './healthServer';
import type { JobOutcome, JobRunner } from './jobRunner';
import type { Logger } from './logger';
import {
  AgentReportedStatus,
  DestinationCheckResult,
  DestinationDescriptor,
  ExportMode,
  HeartbeatResponse,
  JobSpec,
  PROTOCOL_VERSION,
} from './protocol';
import type { ProviderRegistry } from './providers/registry';
import { sleep as defaultSleep, withTimeout } from './retry';
import { SUPPORTED_FORMATS } from './writers';

export const EXPORT_MODES: readonly ExportMode[] = [
  'FULL',
  'INCREMENTAL',
  'SNAPSHOT',
];

export interface AgentOptions {
  controlPlane: ControlPlane;
  runner: Pick<JobRunner, 'run'>;
  providers: ProviderRegistry;
  logger: Logger;
  agentName: string;
  version: string;
  clusterInfo: ClusterInfoReader;
  shutdownGraceMs: number;
  /** Extra wait after aborting a job before giving up on it. */
  abortWaitMs?: number;
  destinationCheckTimeoutMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

interface RunningJob {
  job: JobSpec;
  abort: AbortController;
  done: Promise<JobOutcome>;
}

const clampSeconds = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

export class Agent implements HealthState {
  private heartbeatIntervalMs = 60_000;
  private pollIntervalMs = 15_000;
  private readonly stopController = new AbortController();
  private stopping = false;
  private loops: Promise<void>[] = [];
  private current?: RunningJob;
  private lastHeartbeatOkAt?: number;
  private resolveFirstHeartbeat!: () => void;
  private readonly firstHeartbeat = new Promise<void>(r => {
    this.resolveFirstHeartbeat = r;
  });
  private lastJobInfraError = false;
  private readonly destinationStatus = new Map<string, 'HEALTHY' | 'FAILED'>();
  private pendingChecks: DestinationCheckResult[] = [];
  private checksRunning = false;
  private clusterInfoCache: ClusterInfo = {};
  private clusterInfoReadAt = 0;
  private fatal = false;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: AgentOptions) {
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    this.options.logger.info('Data export agent starting', {
      agentName: this.options.agentName,
      version: this.options.version,
      providers: this.options.providers.types(),
    });
    this.loops = [this.heartbeatLoop(), this.pollLoop()].map(p =>
      p.catch(err => {
        this.fatal = true;
        this.options.logger.error('Agent loop crashed', { error: err });
      }),
    );
  }

  /** Stops claiming, waits for the in-flight job within the grace period, then aborts it. */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.stopController.abort();
    const running = this.current;
    if (running) {
      this.options.logger.info(
        'Shutdown requested; waiting for the running job',
        {
          jobId: running.job.jobId,
          graceMs: this.options.shutdownGraceMs,
        },
      );
      const finished = await this.settlesWithin(
        running.done,
        this.options.shutdownGraceMs,
      );
      if (!finished) {
        this.options.logger.warn(
          'Grace period over; aborting the running job',
          { jobId: running.job.jobId },
        );
        running.abort.abort();
        const aborted = await this.settlesWithin(
          running.done,
          this.options.abortWaitMs ?? 20_000,
        );
        if (!aborted) {
          // The runner is stuck (e.g. a hung socket); report on its behalf.
          await this.options.controlPlane
            .fail(running.job.jobId, {
              errorMessage: 'Agent shut down before the job finished',
              retryable: true,
            })
            .catch(err =>
              this.options.logger.error('Could not report the aborted job', {
                error: err,
              }),
            );
        }
      }
    }
    await withTimeout(
      Promise.all(this.loops).then(() => undefined),
      Math.min(5_000, this.options.abortWaitMs ?? 5_000),
      () => undefined,
    );
    this.options.logger.info('Data export agent stopped');
  }

  isLive(): boolean {
    return !this.fatal;
  }

  isReady(): boolean {
    if (this.lastHeartbeatOkAt === undefined) return false;
    return (
      this.now() - this.lastHeartbeatOkAt <=
      3 * this.heartbeatIntervalMs + 60_000
    );
  }

  /** ONLINE, or DEGRADED after an infrastructure job failure or a failed destination check. */
  status(): AgentReportedStatus {
    const failedCheck = [...this.destinationStatus.values()].includes('FAILED');
    return this.lastJobInfraError || failedCheck ? 'DEGRADED' : 'ONLINE';
  }

  /** Sends one heartbeat; exposed for tests. */
  async heartbeatOnce(): Promise<HeartbeatResponse> {
    const checks = this.pendingChecks;
    const res = await this.options.controlPlane.heartbeat({
      protocolVersion: PROTOCOL_VERSION,
      agentName: this.options.agentName,
      version: this.options.version,
      status: this.status(),
      capabilities: await this.capabilities(),
      ...(checks.length ? { destinationChecks: checks } : {}),
    });
    // Only drop results the server has now seen; checks finishing meanwhile stay queued.
    this.pendingChecks = this.pendingChecks.filter(c => !checks.includes(c));
    this.lastHeartbeatOkAt = this.now();
    this.heartbeatIntervalMs =
      clampSeconds(res?.heartbeatIntervalSeconds, 60, 5, 3600) * 1000;
    this.pollIntervalMs =
      clampSeconds(res?.pollIntervalSeconds, 15, 1, 3600) * 1000;
    this.resolveFirstHeartbeat();
    if (res?.destinationsToCheck?.length)
      void this.runDestinationChecks(res.destinationsToCheck);
    return res;
  }

  /** Runs live checks one at a time; results go out with the next heartbeat. */
  async runDestinationChecks(
    destinations: DestinationDescriptor[],
  ): Promise<void> {
    if (this.checksRunning) return;
    this.checksRunning = true;
    try {
      for (const destination of destinations) {
        const result = await this.checkDestination(destination);
        this.destinationStatus.set(destination.id, result.status);
        this.pendingChecks.push(result);
        this.options.logger.info('Destination check finished', {
          destinationId: destination.id,
          type: destination.type,
          status: result.status,
          message: result.message,
        });
      }
    } finally {
      this.checksRunning = false;
    }
  }

  private async checkDestination(
    destination: DestinationDescriptor,
  ): Promise<DestinationCheckResult> {
    const base = { destinationId: destination.id };
    let result: { status: 'HEALTHY' | 'FAILED'; message: string };
    try {
      const provider = this.options.providers.get(destination.type);
      const timeoutMs = this.options.destinationCheckTimeoutMs ?? 60_000;
      result = await withTimeout(
        provider.healthCheck(destination.configuration ?? {}),
        timeoutMs,
        () => ({
          status: 'FAILED' as const,
          message: `Check timed out after ${Math.round(timeoutMs / 1000)}s`,
        }),
      );
    } catch (err) {
      result = { status: 'FAILED', message: errorMessage(err) };
    }
    return {
      ...base,
      ...result,
      message: result.message.slice(0, 1000),
      checkedAt: new Date(this.now()).toISOString(),
    };
  }

  private async capabilities(): Promise<Record<string, unknown>> {
    const stale = this.now() - this.clusterInfoReadAt > 10 * 60_000;
    const incomplete =
      !this.clusterInfoCache.kubernetesVersion ||
      !this.clusterInfoCache.clusterUid;
    if (this.clusterInfoReadAt === 0 || (incomplete && stale)) {
      this.clusterInfoReadAt = this.now();
      this.clusterInfoCache = await this.options
        .clusterInfo()
        .catch(() => ({}));
    }
    return {
      formats: [...SUPPORTED_FORMATS],
      providers: this.options.providers.types(),
      exportModes: [...EXPORT_MODES],
      ...(this.clusterInfoCache.kubernetesVersion
        ? { kubernetesVersion: this.clusterInfoCache.kubernetesVersion }
        : {}),
      ...(this.clusterInfoCache.clusterUid
        ? { clusterUid: this.clusterInfoCache.clusterUid }
        : {}),
    };
  }

  private async heartbeatLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.heartbeatOnce();
      } catch (err) {
        this.options.logger.warn('Heartbeat failed', { error: err });
      }
      await this.sleep(this.heartbeatIntervalMs, this.stopController.signal);
    }
  }

  private async pollLoop(): Promise<void> {
    // The first heartbeat registers the agent and supplies the poll interval.
    await Promise.race([
      this.firstHeartbeat,
      new Promise<void>(r =>
        this.stopController.signal.addEventListener('abort', () => r(), {
          once: true,
        }),
      ),
    ]);
    while (!this.stopping) {
      let job: JobSpec | null = null;
      try {
        job = await this.options.controlPlane.claim();
      } catch (err) {
        this.options.logger.warn('Claim failed', { error: err });
      }
      if (job) {
        // A claimed job is assigned to us; run it even if shutdown began meanwhile.
        await this.runJob(job);
        continue;
      }
      await this.sleep(this.pollIntervalMs, this.stopController.signal);
    }
  }

  private async runJob(job: JobSpec): Promise<void> {
    const abort = new AbortController();
    if (this.stopping && this.options.shutdownGraceMs === 0) abort.abort();
    const done = this.options.runner.run(job, abort.signal);
    this.current = { job, abort, done };
    try {
      const outcome = await done;
      if (outcome.status === 'FAILED')
        this.lastJobInfraError = outcome.retryable;
      else if (outcome.status === 'COMPLETED') this.lastJobInfraError = false;
    } finally {
      this.current = undefined;
    }
  }

  private settlesWithin(
    promise: Promise<unknown>,
    ms: number,
  ): Promise<boolean> {
    return withTimeout(
      promise.then(
        () => true,
        () => true,
      ),
      ms,
      () => false,
    );
  }
}
