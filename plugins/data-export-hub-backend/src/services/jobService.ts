import { Caller, canViewTenant, requireManage, visibleTenants } from '../access';
import { recordAudit } from '../audit';
import type { DataExportDatabase } from '../db';
import { ConflictError, NotFoundError } from '../errors';
import { Page, pageOf, parseListQuery } from '../listQuery';
import { JOB_LIST, JobDetailRecord, JobRecord, JobRepository } from '../repositories/jobRepository';
import { isUuid } from '../validation';

/** Strips the internal dataset UUID that the API exposes only as `datasetId` (the catalog code). */
function publicJob<T extends JobRecord>(job: T): Omit<T, 'datasetUuid' | 'assignedAgentId'> {
  const { datasetUuid: _datasetUuid, assignedAgentId: _assignedAgentId, ...rest } = job;
  return rest;
}

export class JobService {
  readonly repo: JobRepository;

  constructor(private readonly db: DataExportDatabase) {
    this.repo = new JobRepository(db);
  }

  async list(query: Record<string, unknown>, caller: Caller): Promise<Page<ReturnType<typeof publicJob>>> {
    const request = parseListQuery(query, JOB_LIST, 'j.id');
    const { items, total } = await this.repo.list(request, visibleTenants(caller));
    return pageOf(items.map(publicJob), total, request);
  }

  private async visible(id: string, caller: Caller): Promise<JobDetailRecord> {
    const job = isUuid(id) ? await this.repo.findById(id) : null;
    if (!job || !canViewTenant(caller, job.tenantId)) throw new NotFoundError(`Job ${id} not found`);
    return job;
  }

  async get(id: string, caller: Caller) {
    return publicJob(await this.visible(id, caller));
  }

  /** Re-queues a FAILED or CANCELLED job for another attempt. */
  async retry(id: string, caller: Caller) {
    const job = await this.visible(id, caller);
    requireManage(caller, job.tenantId);
    const retried = await this.db.transaction(async tx => {
      const ok = await this.repo.retry(job.id, tx);
      if (ok) {
        await recordAudit(tx, {
          actor: caller.actor,
          action: 'job.retried',
          entityType: 'job',
          entityId: job.id,
          tenantId: job.tenantId,
          details: { exportName: job.exportName, dataset: job.datasetId, previousStatus: job.status },
        });
      }
      return ok;
    });
    if (!retried) throw new ConflictError(`Only FAILED or CANCELLED jobs can be retried; this job is ${job.status}`);
    return this.get(id, caller);
  }

  /** Cancels a job that has not finished. A running agent learns of it on its next progress report. */
  async cancel(id: string, caller: Caller) {
    const job = await this.visible(id, caller);
    requireManage(caller, job.tenantId);
    const cancelled = await this.db.transaction(async tx => {
      const ok = await this.repo.cancel(job.id, `Cancelled by ${caller.actor}`, tx);
      if (ok) {
        await recordAudit(tx, {
          actor: caller.actor,
          action: 'job.cancelled',
          entityType: 'job',
          entityId: job.id,
          tenantId: job.tenantId,
          details: { exportName: job.exportName, dataset: job.datasetId, previousStatus: job.status },
        });
      }
      return ok;
    });
    if (!cancelled) throw new ConflictError(`This job is already ${job.status}`);
    return this.get(id, caller);
  }

  async manifest(id: string, caller: Caller) {
    const job = await this.visible(id, caller);
    if (!job.manifest) throw new NotFoundError('This job has no manifest; manifests are written on completion');
    return { job, manifest: job.manifest };
  }

  async logs(id: string, caller: Caller) {
    const job = await this.visible(id, caller);
    return { job, logs: job.logs ?? '' };
  }
}
