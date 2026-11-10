import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  ClaimResponse,
  CompleteRequest,
  FailRequest,
  FailResponse,
  HeartbeatResponse,
  JobSpec,
  ProgressResponse,
} from '../agentProtocol';
import { PROTOCOL_VERSION } from '../agentProtocol';
import {
  AGENT_HEARTBEAT_SECONDS,
  AGENT_POLL_SECONDS,
  AGENT_SUBJECT_PREFIX,
  DESTINATION_CHECK_INTERVAL_MINUTES,
  DESTINATION_TYPES,
} from '../constants';
import type { DataExportDatabase } from '../db';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { DestinationRepository } from '../repositories/destinationRepository';
import { AgentRecord, FleetRepository } from '../repositories/fleetRepository';
import { JobRepository } from '../repositories/jobRepository';
import { ValidationError, bodyOf, isUuid } from '../validation';

const MAX_LOG_BYTES = 64 * 1024;
const MAX_CLAIM_ATTEMPTS = 10;

export interface AuthenticatedAgent extends AgentRecord {
  clusterRetired: boolean;
}

/** URL-safe, stable folder name for a profile: readable name plus a short id so renames never collide. */
export function profileSlug(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${base || 'export'}-${id.slice(0, 8)}`;
}

/** `tenant/<tenant>/exports/<profile>/<yyyy>/<mm>/<dd>/<jobId>` from the job's scheduled (UTC) date. */
export function outputPrefixes(
  tenantId: string,
  profileName: string,
  profileId: string,
  scheduled: Date,
  jobId: string,
  packageCode?: string | null,
) {
  const yyyy = String(scheduled.getUTCFullYear());
  const mm = String(scheduled.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(scheduled.getUTCDate()).padStart(2, '0');
  if (packageCode) {
    const pkgSlug = packageCode.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return {
      profilePrefix: `exports/${yyyy}/${mm}/${dd}/${pkgSlug}`,
      outputPrefix: `exports/${yyyy}/${mm}/${dd}/${pkgSlug}`,
    };
  }
  const profilePrefix = `tenant/${tenantId}/exports/${profileSlug(profileName, profileId)}`;
  return { profilePrefix, outputPrefix: `${profilePrefix}/${yyyy}/${mm}/${dd}/${jobId}` };
}

function str(body: Record<string, unknown>, key: string, max: number, errors: string[], required = true) {
  const value = body[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    errors.push(`${key} must be a non-empty string of at most ${max} characters`);
    return undefined;
  }
  return value.trim();
}

function nonNegative(body: Record<string, unknown>, key: string, errors: string[], required: boolean) {
  const value = body[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push(`${key} must be a non-negative number`);
    return undefined;
  }
  return Math.round(value);
}

function tail(logs: unknown): string | null {
  if (typeof logs !== 'string') return null;
  return logs.length > MAX_LOG_BYTES ? logs.slice(logs.length - MAX_LOG_BYTES) : logs;
}

/**
 * Server side of the agent protocol (services/data-export-agent/src/protocol.ts).
 * Agents authenticate with their workload identity; every operation is scoped
 * to the agent's own cluster and to jobs assigned to that agent.
 */
export class AgentGateway {
  private readonly fleet: FleetRepository;
  private readonly jobs: JobRepository;
  private readonly destinations: DestinationRepository;

  constructor(
    private readonly db: DataExportDatabase,
    private readonly logger: LoggerService,
  ) {
    this.fleet = new FleetRepository(db);
    this.jobs = new JobRepository(db);
    this.destinations = new DestinationRepository(db);
  }

  /** Maps a Backstage principal subject (`external:data-export-agent:<oid>`) to a registered agent. */
  async authenticate(subject: string): Promise<AuthenticatedAgent> {
    if (!subject.startsWith(AGENT_SUBJECT_PREFIX)) throw new ForbiddenError('Not an agent identity');
    const identity = subject.slice(AGENT_SUBJECT_PREFIX.length).toLowerCase();
    const agent = await this.fleet.findAgentBySubject(identity);
    if (!agent) throw new ForbiddenError(`No agent is registered for identity ${identity}`);
    if (agent.clusterRetired) throw new ForbiddenError(`Cluster ${agent.clusterName} is retired`);
    return agent;
  }

  async heartbeat(agent: AuthenticatedAgent, input: unknown): Promise<HeartbeatResponse> {
    const body = bodyOf(input);
    const errors: string[] = [];
    const agentName = str(body, 'agentName', 255, errors);
    const version = str(body, 'version', 50, errors);
    const status = body.status === 'ONLINE' || body.status === 'DEGRADED' ? body.status : undefined;
    if (!status) errors.push('status must be ONLINE or DEGRADED');
    const capabilities = body.capabilities ?? {};
    if (typeof capabilities !== 'object' || Array.isArray(capabilities) || JSON.stringify(capabilities).length > 8192) {
      errors.push('capabilities must be a JSON object of at most 8 KB');
    }
    if (body.protocolVersion !== undefined && body.protocolVersion !== PROTOCOL_VERSION) {
      errors.push(`protocolVersion ${String(body.protocolVersion)} is not supported; expected ${PROTOCOL_VERSION}`);
    }
    const checks = Array.isArray(body.destinationChecks) ? body.destinationChecks.slice(0, 50) : [];
    if (errors.length) throw new ValidationError(errors);

    await this.db.transaction(tx =>
      this.fleet.recordHeartbeat(
        agent.id,
        agent.clusterId,
        {
          agentName: agentName as string,
          version: version as string,
          status: status as string,
          capabilities: capabilities as Record<string, unknown>,
        },
        tx,
      ),
    );

    // Agents may only report on destinations their own cluster's exports use.
    for (const raw of checks) {
      const check = (raw ?? {}) as Record<string, unknown>;
      if (!isUuid(check.destinationId)) continue;
      if (check.status !== 'HEALTHY' && check.status !== 'FAILED') continue;
      if (!(await this.jobs.clusterUsesDestination(agent.clusterId, check.destinationId))) continue;
      const message = typeof check.message === 'string' ? check.message.slice(0, 1000) : '';
      await this.destinations.recordTest(
        check.destinationId,
        check.status,
        `Live check from ${agent.clusterName}: ${message || check.status}`,
      );
    }

    return {
      agentId: agent.id,
      clusterId: agent.clusterId,
      clusterName: agent.clusterName,
      tenantId: agent.tenantId,
      heartbeatIntervalSeconds: AGENT_HEARTBEAT_SECONDS,
      pollIntervalSeconds: AGENT_POLL_SECONDS,
      destinationsToCheck: await this.jobs.destinationsDueForCheck(agent.clusterId, DESTINATION_CHECK_INTERVAL_MINUTES),
    };
  }

  /**
   * Claims the next runnable job. A queued job can go stale (its dataset lost
   * its SQL, its export was disabled); such jobs are closed here with a reason
   * and the next one is tried, so one bad job never blocks a cluster's queue.
   */
  async claim(agent: AuthenticatedAgent): Promise<ClaimResponse | null> {
    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
      const claimed = await this.jobs.claim(agent.id, agent.clusterId);
      if (!claimed) return null;
      const { job, profile, dataset, destination } = claimed;
      const problem = !profile?.enabled
        ? 'The export was disabled after this job was queued'
        : !dataset?.enabled
          ? `Dataset ${dataset?.dataset_id} is disabled`
          : !dataset.sql_template
            ? `Dataset ${dataset.dataset_id} has no SQL template`
            : !destination?.enabled
              ? 'The destination is disabled'
              : !(DESTINATION_TYPES as readonly string[]).includes(destination.type)
                ? `Destination type ${destination.type} has no delivery provider`
                : profile.export_mode === 'INCREMENTAL' && !dataset.watermark_column
                  ? `Dataset ${dataset.dataset_id} has no watermark column for incremental export`
                  : null;
      if (problem) {
        await this.jobs.failClaimed(job.id, agent.id, problem);
        this.logger.warn(`[data-export-hub] Job ${job.id} not runnable: ${problem}`);
        continue;
      }
      const scheduled = new Date(job.scheduled_time);
      const prefixes = outputPrefixes(
        job.tenant_id,
        profile.name,
        profile.id,
        scheduled,
        job.id,
        profile.package_code,
      );

      let packageReports: JobSpec['packageReports'] = undefined;
      if (profile.package_code) {
        const pkgDatasets = await this.db.query<{
          id: string;
          dataset_id: string;
          sql_template: string;
          watermark_column: string | null;
          primary_keys: string[];
        }>(
          `SELECT d.id, d.dataset_id, d.sql_template, d.watermark_column, d.primary_keys
             FROM data_export.export_profile_datasets pd
             JOIN data_export.datasets d ON d.id = pd.dataset_id
            WHERE pd.profile_id = $1`,
          [profile.id],
        );
        if (pkgDatasets.rows.length > 0) {
          packageReports = pkgDatasets.rows.map(d => ({
            id: d.id,
            datasetId: d.dataset_id,
            sqlTemplate: d.sql_template,
            watermarkColumn: d.watermark_column,
            primaryKeys: Array.isArray(d.primary_keys) ? d.primary_keys : [],
          }));
        }
      }

      const spec: JobSpec = {
        jobId: job.id,
        attempt: job.retry_count + 1,
        tenantId: job.tenant_id,
        scheduledTime: scheduled.toISOString(),
        profile: {
          id: profile.id,
          name: profile.name,
          packageCode: profile.package_code ?? null,
          packageName: profile.package_name ?? null,
          customerName: profile.customer_name ?? null,
          exportMode: profile.export_mode,
          fileFormat: profile.file_format,
          compression: profile.compression,
          retentionDays: profile.retention_days,
          watermarkStrategy: profile.watermark_strategy,
          namespace: profile.namespace,
        },
        dataset: {
          id: dataset.id,
          datasetId: dataset.dataset_id,
          sqlTemplate: dataset.sql_template,
          watermarkColumn: dataset.watermark_column,
          primaryKeys: Array.isArray(dataset.primary_keys) ? dataset.primary_keys : [],
        },
        packageReports,
        watermark: { lastSuccessValue: profile.export_mode === 'INCREMENTAL' ? claimed.watermark : null },
        destination: { id: destination.id, type: destination.type, configuration: destination.configuration_json ?? {} },
        outputPrefix: prefixes.outputPrefix,
        profilePrefix: prefixes.profilePrefix,
      };
      this.logger.info(`[data-export-hub] Job ${job.id} assigned to agent ${agent.agentName ?? agent.id}`);
      return { job: spec };
    }
    return null;
  }

  private async assertOwnJob(agent: AuthenticatedAgent, jobId: string) {
    const job = isUuid(jobId) ? await this.jobs.findRaw(jobId) : null;
    if (!job || job.cluster_id !== agent.clusterId) throw new NotFoundError(`Job ${jobId} not found`);
    return job;
  }

  async progress(agent: AuthenticatedAgent, jobId: string, input: unknown): Promise<ProgressResponse> {
    const body = bodyOf(input);
    const errors: string[] = [];
    if (body.status !== 'RUNNING' && body.status !== 'UPLOADING') errors.push('status must be RUNNING or UPLOADING');
    const rowsExported = nonNegative(body, 'rowsExported', errors, false);
    const bytesExported = nonNegative(body, 'bytesExported', errors, false);
    if (errors.length) throw new ValidationError(errors);
    await this.assertOwnJob(agent, jobId);
    const updated = await this.jobs.progress(jobId, agent.id, {
      status: body.status as 'RUNNING' | 'UPLOADING',
      rowsExported,
      bytesExported,
    });
    if (updated) return { continue: true };
    const current = await this.jobs.findRaw(jobId);
    if (!current || current.assigned_agent_id !== agent.id || ['CANCELLED', 'FAILED', 'QUEUED'].includes(current.status)) {
      return { continue: false };
    }
    throw new ConflictError(`Cannot move job from ${current.status} to ${String(body.status)}`);
  }

  async complete(agent: AuthenticatedAgent, jobId: string, input: unknown): Promise<void> {
    const body = bodyOf(input) as Partial<CompleteRequest> & Record<string, unknown>;
    const errors: string[] = [];
    const rowsExported = nonNegative(body, 'rowsExported', errors, true);
    const bytesExported = nonNegative(body, 'bytesExported', errors, true);
    if (!Array.isArray(body.files) || body.files.length === 0 || body.files.length > 100) {
      errors.push('files must list between 1 and 100 delivered files');
    } else if (
      !body.files.every(
        file =>
          file &&
          typeof file.name === 'string' &&
          typeof file.path === 'string' &&
          typeof file.sha256 === 'string' &&
          /^[0-9a-f]{64}$/.test(file.sha256) &&
          typeof file.sizeBytes === 'number',
      )
    ) {
      errors.push('each file needs name, path, sizeBytes and a hex sha256');
    }
    if (!body.manifest || typeof body.manifest !== 'object' || JSON.stringify(body.manifest).length > 256 * 1024) {
      errors.push('manifest must be an object of at most 256 KB');
    }
    if (body.watermarkValue !== null && body.watermarkValue !== undefined && typeof body.watermarkValue !== 'string') {
      errors.push('watermarkValue must be a string or null');
    }
    if (errors.length) throw new ValidationError(errors);
    await this.assertOwnJob(agent, jobId);
    const completed = await this.db.transaction(tx =>
      this.jobs.complete(
        jobId,
        agent.id,
        {
          rowsExported: rowsExported as number,
          bytesExported: bytesExported as number,
          files: body.files as unknown[],
          manifest: body.manifest,
          watermarkValue: typeof body.watermarkValue === 'string' ? body.watermarkValue.slice(0, 1000) : null,
          logs: tail(body.logs),
        },
        tx,
      ),
    );
    if (!completed) throw new ConflictError('The job is no longer assigned to this agent or was cancelled');
  }

  async fail(agent: AuthenticatedAgent, jobId: string, input: unknown): Promise<FailResponse> {
    const body = bodyOf(input) as Partial<FailRequest> & Record<string, unknown>;
    const errors: string[] = [];
    const errorMessage = str(body, 'errorMessage', 4000, errors);
    if (typeof body.retryable !== 'boolean') errors.push('retryable must be a boolean');
    if (errors.length) throw new ValidationError(errors);
    await this.assertOwnJob(agent, jobId);
    const result = await this.jobs.fail(jobId, agent.id, {
      errorMessage: errorMessage as string,
      retryable: body.retryable as boolean,
      logs: tail(body.logs),
    });
    if (!result) throw new ConflictError('The job is no longer assigned to this agent or was cancelled');
    return result;
  }
}
