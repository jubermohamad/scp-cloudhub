/**
 * The destination extension point. A provider delivers a job's local files to
 * one kind of destination; the registry picks it by the destination `type`
 * the control plane sends with each job.
 */
import type { Logger } from '../logger';
import type { DeliveredFile } from '../protocol';
import type { WrittenFile } from '../writers/types';

export type DestinationConfig = Record<string, string>;

export interface HealthCheckResult {
  status: 'HEALTHY' | 'FAILED';
  message: string;
}

export interface UploadContext {
  /** Non-secret destination settings from the job's DestinationDescriptor. */
  config: DestinationConfig;
  /** Relative directory for this job's files (no leading/trailing slash). */
  outputPrefix: string;
  logger: Logger;
  /** Aborts an in-flight upload on shutdown. */
  signal?: AbortSignal;
}

export interface DestinationProvider {
  readonly type: string;
  /** Returns human-readable problems with the config; empty when valid. */
  validate(config: DestinationConfig): string[];
  /**
   * Uploads `files` strictly in the given order (data files, checksum,
   * manifest last) and returns where each one landed.
   */
  upload(
    files: WrittenFile[],
    context: UploadContext,
  ): Promise<DeliveredFile[]>;
  /** Live connectivity and permission check, reported in the next heartbeat. */
  healthCheck(config: DestinationConfig): Promise<HealthCheckResult>;
  /**
   * Deletes dated `yyyy/mm/dd` directories under `profilePrefix` older than
   * `retentionDays`. Returns the number of directories removed.
   */
  applyRetention?(
    profilePrefix: string,
    retentionDays: number,
    config: DestinationConfig,
  ): Promise<number>;
}

/**
 * Joins relative path segments with '/', dropping empty segments and
 * surrounding slashes. Refuses '.' and '..' so a crafted prefix cannot climb
 * out of the configured base path.
 */
export function joinPath(...segments: Array<string | undefined>): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (!segment) continue;
    for (const part of segment.split('/')) {
      if (!part) continue;
      if (part === '.' || part === '..') {
        throw new Error(
          `Path segment "${part}" is not allowed in "${segment}"`,
        );
      }
      parts.push(part);
    }
  }
  return parts.join('/');
}

/** Problems with a relative path setting: '..' segments or backslashes. */
export function pathProblems(
  name: string,
  value: string | undefined,
): string[] {
  if (!value) return [];
  if (value.includes('\\')) return [`${name} must use '/' separators`];
  if (value.split('/').some(p => p === '..' || p === '.')) {
    return [`${name} must not contain '.' or '..' segments`];
  }
  return [];
}

/**
 * True when the dated directory `yyyy/mm/dd` is older than the retention
 * window: its day starts before (today UTC - retentionDays).
 */
export function isExpired(
  year: string,
  month: string,
  day: string,
  retentionDays: number,
  now: Date = new Date(),
): boolean {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day))
    return false;
  const date = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date)) return false;
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return date < todayUtc - retentionDays * 86_400_000;
}
