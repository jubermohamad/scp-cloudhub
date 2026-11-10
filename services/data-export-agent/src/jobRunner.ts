/**
 * Runs one claimed job end to end:
 *
 *   progress RUNNING -> guardrailed extract to a local file -> progress
 *   UPLOADING -> upload data, checksum.sha256, manifest.json (last) ->
 *   complete (with the new watermark) -> retention (best effort).
 *
 * A `continue: false` answer to any progress call means the job was cancelled
 * or reassigned: the runner stops, discards its output and reports nothing
 * more. Any other failure is reported with /fail, classified as retryable or
 * not. The job's work directory is always removed.
 */
import fs from 'fs/promises';
import path from 'path';
import type { ControlPlane } from './controlPlaneClient';
import {
  JobCancelledError,
  NonRetryableError,
  errorMessage,
  isRetryable,
} from './errors';
import { JobLog, Logger, teeLogger } from './logger';
import { writeCompletionFiles } from './manifest';
import { writeZipFile } from './zip';
import type { JobSpec, ProgressRequest } from './protocol';
import type { ProviderRegistry } from './providers/registry';
import { buildQuery, BuiltQuery } from './sql/queryBuilder';
import { SourceClient, streamFields, streamQuery } from './sql/source';
import {
  createRowWriter,
  RowWriter,
  validateFormat,
  WrittenFile,
} from './writers';

export interface JobRunnerDeps {
  controlPlane: ControlPlane;
  source: { connect(): Promise<SourceClient> };
  providers: ProviderRegistry;
  logger: Logger;
  workDir: string;
  agentName: string;
  agentVersion: string;
  clusterName: string;
  /** Minimum time between RUNNING progress updates during an extract. */
  progressIntervalMs?: number;
  now?: () => Date;
}

export type JobOutcome =
  | {
      status: 'COMPLETED';
      rows: number;
      bytes: number;
      watermarkValue: string | null;
    }
  | { status: 'CANCELLED' }
  | { status: 'FAILED'; retryable: boolean; error: string };

interface ExtractResult {
  file: WrittenFile;
  rows: number;
  watermark: string | null;
}

export class JobRunner {
  private readonly progressIntervalMs: number;
  private readonly now: () => Date;

  constructor(private readonly deps: JobRunnerDeps) {
    this.progressIntervalMs = deps.progressIntervalMs ?? 30_000;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Runs the job. Never throws: the outcome says what happened and the
   * control plane has already been told. `signal` aborts the job on shutdown,
   * which is reported as a retryable failure.
   */
  async run(job: JobSpec, signal?: AbortSignal): Promise<JobOutcome> {
    const jobLog = new JobLog();
    const log = teeLogger(
      this.deps.logger.child({ jobId: job.jobId, attempt: job.attempt }),
      jobLog,
    );
    const startedAt = this.now();
    const jobDir = path.join(
      this.deps.workDir,
      `${job.jobId.replace(/[^A-Za-z0-9_-]/g, '_')}-${job.attempt}`,
    );

    try {
      log.info('Job claimed', {
        profile: job.profile.name,
        dataset: job.dataset.datasetId,
        mode: job.profile.exportMode,
        format: job.profile.fileFormat,
        destination: job.destination.type,
      });
      await this.progress(job, {
        status: 'RUNNING',
        message: 'Extract starting',
      });

      // Validate everything that does not need the database first, so a bad
      // definition fails fast without touching the replica.
      validateFormat(job.profile.fileFormat, job.profile.compression);
      const provider = this.deps.providers.get(job.destination.type);
      const problems = provider.validate(job.destination.configuration ?? {});
      if (problems.length > 0) {
        throw new NonRetryableError(
          `Invalid ${job.destination.type} destination: ${problems.join('; ')}`,
        );
      }
      if (job.profile.exportMode === 'INCREMENTAL') {
        log.info('Incremental export', {
          watermarkColumn: job.dataset.watermarkColumn,
          from: job.watermark?.lastSuccessValue ?? null,
        });
      }

      await fs.rm(jobDir, { recursive: true, force: true });
      await fs.mkdir(jobDir, { recursive: true, mode: 0o700 });

      const client = await this.deps.source.connect();
      log.info('Connected to source with read-only guardrails');

      const dataFiles: WrittenFile[] = [];
      let totalRows = 0;
      let totalBytes = 0;
      let watermarkValue: string | null = null;

      try {
        if (job.packageReports && job.packageReports.length > 0) {
          for (const report of job.packageReports) {
            const reportQuery = buildQuery(job, report);
            const extract = await this.extractReport(
              job,
              reportQuery,
              jobDir,
              log,
              client,
              signal,
              report.datasetId,
            );
            dataFiles.push(extract.file);
            totalRows += extract.rows;
            totalBytes += extract.file.sizeBytes;
            if (extract.watermark) watermarkValue = extract.watermark;
          }
        } else {
          const query = buildQuery(job);
          const extract = await this.extractReport(
            job,
            query,
            jobDir,
            log,
            client,
            signal,
            job.dataset.datasetId,
          );
          dataFiles.push(extract.file);
          totalRows = extract.rows;
          totalBytes = extract.file.sizeBytes;
          if (job.profile.exportMode === 'INCREMENTAL') {
            watermarkValue = extract.watermark;
          }
        }
      } finally {
        await client.end().catch(() => {});
      }

      log.info('Extract finished', {
        reports: dataFiles.length,
        rows: totalRows,
        bytes: totalBytes,
      });

      await this.progress(job, {
        status: 'UPLOADING',
        rowsExported: totalRows,
        bytesExported: totalBytes,
        message: `Uploading to ${job.destination.type}`,
      });

      const { checksum, manifest, manifestBody } = await writeCompletionFiles(
        jobDir,
        {
          job,
          dataFiles,
          watermarkTo: watermarkValue,
          startedAt,
          completedAt: this.now(),
          agentName: this.deps.agentName,
          agentVersion: this.deps.agentVersion,
          clusterName: this.deps.clusterName,
        },
      );

      // Create ZIP package containing all reports, manifest.json and checksums.sha256
      const zipEntries = [];
      for (const df of dataFiles) {
        zipEntries.push({
          name: df.name,
          content: await fs.readFile(df.localPath),
        });
      }
      zipEntries.push({
        name: 'manifest.json',
        content: await fs.readFile(manifest.localPath),
      });
      zipEntries.push({
        name: 'checksums.sha256',
        content: await fs.readFile(checksum.localPath),
      });

      const zipPath = path.join(jobDir, 'export.zip');
      const zipStat = await writeZipFile(zipPath, zipEntries);
      const zipFile: WrittenFile = {
        name: 'export.zip',
        localPath: zipPath,
        sizeBytes: zipStat.sizeBytes,
        sha256: zipStat.sha256,
      };

      const filesToDeliver = job.profile.packageCode
        ? [zipFile, manifest]
        : [...dataFiles, checksum, manifest];

      const delivered = await provider.upload(
        filesToDeliver,
        {
          config: job.destination.configuration ?? {},
          outputPrefix: job.outputPrefix,
          logger: log,
          signal,
        },
      );
      log.info('Delivery complete', { files: delivered.map(f => f.path) });

      await this.deps.controlPlane.complete(job.jobId, {
        rowsExported: totalRows,
        bytesExported: totalBytes,
        files: delivered,
        manifest: manifestBody,
        watermarkValue,
        logs: jobLog.toString(),
      });

      await this.retention(job, log);
      return {
        status: 'COMPLETED',
        rows: totalRows,
        bytes: totalBytes,
        watermarkValue,
      };
    } catch (err) {
      if (err instanceof JobCancelledError) {
        log.warn(
          'Job cancelled or reassigned by the control plane; output discarded',
        );
        return { status: 'CANCELLED' };
      }
      const aborted = signal?.aborted === true;
      const retryable = aborted || isRetryable(err);
      const message = aborted
        ? `Agent shutting down before the job finished: ${errorMessage(err)}`
        : errorMessage(err);
      log.error('Job failed', { error: message, retryable });
      try {
        const res = await this.deps.controlPlane.fail(job.jobId, {
          errorMessage: message.slice(0, 4000),
          retryable,
          logs: jobLog.toString(),
        });
        log.info('Failure reported', { willRetry: res.willRetry });
      } catch (reportErr) {
        this.deps.logger.error(
          'Could not report job failure to the control plane',
          {
            jobId: job.jobId,
            error: reportErr,
          },
        );
      }
      return { status: 'FAILED', retryable, error: message };
    } finally {
      await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async progress(job: JobSpec, body: ProgressRequest): Promise<void> {
    const res = await this.deps.controlPlane.progress(job.jobId, body);
    if (!res.continue) throw new JobCancelledError();
  }

  private async extractReport(
    job: JobSpec,
    query: BuiltQuery,
    dir: string,
    log: Logger,
    client: SourceClient,
    signal?: AbortSignal,
    datasetIdOverride?: string,
  ): Promise<ExtractResult> {
    signal?.throwIfAborted();
    let writer: RowWriter | undefined;
    let stream: ReturnType<typeof streamQuery> | undefined;
    const onAbort = () => stream?.destroy(new Error('Extract aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (query.snapshot) {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        log.info('Snapshot transaction started (REPEATABLE READ READ ONLY)');
      }
      stream = streamQuery(client, query.text, query.values);
      const s = stream;
      const format = job.profile.packageCode ? 'TSV' : job.profile.fileFormat;
      const compression = job.profile.packageCode
        ? 'NONE'
        : job.profile.compression;
      const datasetId = datasetIdOverride ?? job.dataset.datasetId;
      const openWriter = () => {
        const fields = (streamFields(s) ?? []).filter(
          f => f.name !== query.watermarkField,
        );
        return createRowWriter({
          format,
          compression,
          datasetId,
          dir,
          fields,
        });
      };

      let rows = 0;
      let watermark: string | null = null;
      let lastProgress = Date.now();
      for await (const row of stream as AsyncIterable<
        Record<string, unknown>
      >) {
        if (!writer) writer = await openWriter();
        if (query.watermarkField) {
          // Rows arrive ORDER BY the watermark column, so the last non-null value is the max.
          const value = row[query.watermarkField];
          if (value !== null && value !== undefined) watermark = String(value);
        }
        await writer.write(row);
        rows += 1;
        if (Date.now() - lastProgress >= this.progressIntervalMs) {
          lastProgress = Date.now();
          await this.progress(job, {
            status: 'RUNNING',
            rowsExported: rows,
            bytesExported: writer.bytesWritten,
          });
        }
      }
      signal?.throwIfAborted();
      if (!writer) writer = await openWriter();
      const file = await writer.finish();
      if (query.snapshot) await client.query('COMMIT');
      return { file, rows, watermark };
    } catch (err) {
      await writer?.abort().catch(() => {});
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private async retention(job: JobSpec, log: Logger): Promise<void> {
    const days = job.profile.retentionDays;
    if (!days || days <= 0) return;
    const provider = this.deps.providers.get(job.destination.type);
    if (!provider.applyRetention) return;
    try {
      const removed = await provider.applyRetention(
        job.profilePrefix,
        days,
        job.destination.configuration ?? {},
      );
      log.info('Retention applied', {
        retentionDays: days,
        directoriesRemoved: removed,
      });
    } catch (err) {
      log.warn('Retention failed (export itself succeeded)', { error: err });
    }
  }
}
