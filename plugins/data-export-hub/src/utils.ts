import type { DestinationStatus, Health, Job, JobStatus, Me } from './types';

/* ---------- formatting ---------- */

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString();
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Binary (1024) byte sizes, e.g. 1536 → "1.5 KB". */
export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  if (value < 1024) return `${Math.max(0, Math.round(value))} B`;
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${Number(size.toFixed(digits))} ${BYTE_UNITS[unit]}`;
}

/** Compact counts for KPI tiles: 1234 → "1.2K", 3_400_000 → "3.4M". */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const abs = Math.abs(value);
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = value / size;
      return `${Number(scaled.toFixed(scaled >= 100 ? 0 : 1))}${suffix}`;
    }
  }
  return value.toLocaleString();
}

/** Human-readable duration from a number of seconds. */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return '—';
  }
  if (seconds < 0) return '—';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Human-readable duration between two ISO timestamps, or an em dash when unfinished. */
export function formatDuration(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return formatSeconds(ms / 1000);
}

/** "5 min ago" style relative time; falls back to the absolute time beyond a week. */
export function formatRelative(
  value: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!value) return 'Never';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 0) return formatDateTime(value);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDateTime(value);
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Pretty JSON for display; never throws. */
export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/* ---------- status tones ---------- */

export type ChipTone = 'success' | 'error' | 'warning' | 'info' | 'default';

export function jobStatusTone(status: JobStatus | null | undefined): ChipTone {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'error';
    case 'RUNNING':
    case 'UPLOADING':
    case 'ASSIGNED':
      return 'info';
    case 'QUEUED':
    case 'CREATED':
      return 'warning';
    default:
      return 'default';
  }
}

export function healthTone(health: Health | null | undefined): ChipTone {
  switch (health) {
    case 'HEALTHY':
      return 'success';
    case 'WARNING':
      return 'warning';
    case 'CRITICAL':
      return 'error';
    default:
      return 'default';
  }
}

export function destinationStatusTone(
  status: DestinationStatus | string,
): ChipTone {
  switch (status) {
    case 'HEALTHY':
      return 'success';
    case 'DEGRADED':
      return 'warning';
    case 'FAILED':
      return 'error';
    default:
      return 'default';
  }
}

/* ---------- job lifecycle ---------- */

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];
export const CANCELLABLE_JOB_STATUSES: readonly JobStatus[] = [
  'CREATED',
  'QUEUED',
  'ASSIGNED',
  'RUNNING',
  'UPLOADING',
];
export const RETRYABLE_JOB_STATUSES: readonly JobStatus[] = [
  'FAILED',
  'CANCELLED',
];

export function isTerminalJob(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/** True when any job is still moving, so the view should keep polling. */
export function hasActiveJobs(jobs: Array<Pick<Job, 'status'>>): boolean {
  return jobs.some(job => !isTerminalJob(job.status));
}

/* ---------- permissions ---------- */

/**
 * Mirrors the backend rule so the UI only offers actions the caller may take.
 * A null tenant is a shared resource, which only platform admins manage.
 * The backend enforces the rule regardless of what the UI shows.
 */
export function canManageTenant(
  me: Me | undefined,
  tenantId: string | null,
): boolean {
  if (!me) return false;
  if (me.isPlatformAdmin) return true;
  return tenantId !== null && me.tenantAdminOf.includes(tenantId);
}

/** Tenants the caller can create exports and destinations for. Platform admins can use any visible tenant. */
export function manageableTenants(
  me: Me | undefined,
  visibleTenants: string[],
): string[] {
  if (!me) return [];
  const tenants = me.isPlatformAdmin ? visibleTenants : me.tenantAdminOf;
  return [...new Set(tenants)].sort();
}

/** Whether the caller administers at least one tenant (or everything). */
export function canCreateInAnyTenant(me: Me | undefined): boolean {
  return Boolean(me && (me.isPlatformAdmin || me.tenantAdminOf.length > 0));
}

export function canRetryJob(
  me: Me | undefined,
  job: Pick<Job, 'status' | 'tenantId'>,
): boolean {
  return (
    RETRYABLE_JOB_STATUSES.includes(job.status) &&
    canManageTenant(me, job.tenantId)
  );
}

export function canCancelJob(
  me: Me | undefined,
  job: Pick<Job, 'status' | 'tenantId'>,
): boolean {
  return (
    CANCELLABLE_JOB_STATUSES.includes(job.status) &&
    canManageTenant(me, job.tenantId)
  );
}

/** Callers without any tenant membership and without platform admin see nothing. */
export function hasNoAccess(me: Me | undefined): boolean {
  return Boolean(
    me &&
      !me.isPlatformAdmin &&
      me.tenantMemberOf.length === 0 &&
      me.tenantAdminOf.length === 0,
  );
}

/* ---------- dates for filters ---------- */

/** Converts a `datetime-local` input value to an ISO string (or undefined when blank/invalid). */
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Converts an ISO string to the `YYYY-MM-DDTHH:mm` form a `datetime-local` input expects. */
export function isoToLocalInput(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local midnight today as ISO, used for "today" drill-downs from the dashboard. */
export function startOfTodayIso(now: Date = new Date()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/** Triggers a browser download of text content. */
export function downloadText(
  filename: string,
  content: string,
  mimeType = 'text/plain',
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Entra object ids are GUIDs. */
export function isGuid(value: string): boolean {
  return GUID_PATTERN.test(value.trim());
}

/**
 * Flattens an agent's capability document into short chip labels:
 * arrays list their values, `true` flags show their key, scalars show
 * `key: value`, and nested objects show their key.
 */
export function capabilitySummary(
  capabilities: Record<string, unknown>,
): string[] {
  const labels: string[] = [];
  for (const [key, value] of Object.entries(capabilities ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && typeof item !== 'object')
          labels.push(String(item));
      }
    } else if (value === true) {
      labels.push(key);
    } else if (typeof value === 'string' || typeof value === 'number') {
      labels.push(`${key}: ${value}`);
    } else if (value && typeof value === 'object') {
      labels.push(key);
    }
  }
  return [...new Set(labels)];
}
