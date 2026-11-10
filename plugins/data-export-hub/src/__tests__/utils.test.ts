import {
  capabilitySummary,
  destinationStatusTone,
  formatBytes,
  formatCompact,
  formatCount,
  formatDuration,
  formatRelative,
  formatSeconds,
  hasActiveJobs,
  healthTone,
  isGuid,
  isoToLocalInput,
  isTerminalJob,
  jobStatusTone,
  localInputToIso,
  prettyJson,
} from '../utils';
import { JOB_STATUS_LABELS, labelFor, optionsFrom } from '../labels';
import type { JobStatus } from '../types';
import { queueDepthPaths } from '../components/dashboard/QueueDepthChart';
import { auditDetailsPreview } from '../components/administration/AuditLogGrid';
import { clusterFormProblem } from '../components/clusters/ClusterFormDialog';

describe('formatting helpers', () => {
  it('formats bytes in binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(3.25 * 1024 ** 4)).toBe('3.25 TB');
    expect(formatBytes(null)).toBe('—');
  });

  it('formats compact counts', () => {
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(1234)).toBe('1.2K');
    expect(formatCompact(3_400_000)).toBe('3.4M');
    expect(formatCompact(undefined)).toBe('—');
  });

  it('formats durations across seconds, minutes, hours and days', () => {
    expect(formatSeconds(45)).toBe('45s');
    expect(formatSeconds(125)).toBe('2m 5s');
    expect(formatSeconds(9000)).toBe('2h 30m');
    expect(formatSeconds(90000)).toBe('1d 1h');
    expect(formatSeconds(null)).toBe('—');
    expect(formatDuration('2026-10-20T00:00:00Z', '2026-10-20T00:02:05Z')).toBe(
      '2m 5s',
    );
    expect(formatDuration('2026-10-20T00:00:00Z', null)).toBe('—');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(formatRelative(null, now)).toBe('Never');
    expect(formatRelative('2026-10-20T11:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-10-20T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelative('2026-10-20T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-10-18T12:00:00Z', now)).toBe('2 d ago');
  });

  it('formats counts and JSON safely', () => {
    expect(formatCount(1234567)).toBe((1234567).toLocaleString());
    expect(formatCount(null)).toBe('—');
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(prettyJson(null)).toBe('');
  });

  it('round-trips datetime-local values', () => {
    const iso = localInputToIso('2026-10-20T08:30');
    expect(iso).toBeDefined();
    expect(isoToLocalInput(iso)).toBe('2026-10-20T08:30');
    expect(localInputToIso('')).toBeUndefined();
    expect(isoToLocalInput('not a date')).toBe('');
  });
});

describe('status helpers', () => {
  it('gives every job status a tone and a label', () => {
    const statuses = Object.keys(JOB_STATUS_LABELS) as JobStatus[];
    expect(statuses).toHaveLength(8);
    expect(jobStatusTone('COMPLETED')).toBe('success');
    expect(jobStatusTone('FAILED')).toBe('error');
    expect(jobStatusTone('RUNNING')).toBe('info');
    expect(jobStatusTone('UPLOADING')).toBe('info');
    expect(jobStatusTone('QUEUED')).toBe('warning');
    expect(jobStatusTone('CANCELLED')).toBe('default');
    expect(statuses.filter(isTerminalJob)).toEqual([
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ]);
  });

  it('polls only while a job is still moving', () => {
    expect(hasActiveJobs([{ status: 'COMPLETED' }, { status: 'FAILED' }])).toBe(
      false,
    );
    expect(hasActiveJobs([{ status: 'COMPLETED' }, { status: 'QUEUED' }])).toBe(
      true,
    );
    expect(hasActiveJobs([])).toBe(false);
  });

  it('maps health and destination status to tones', () => {
    expect(healthTone('HEALTHY')).toBe('success');
    expect(healthTone('WARNING')).toBe('warning');
    expect(healthTone('CRITICAL')).toBe('error');
    expect(healthTone('OFFLINE')).toBe('default');
    expect(destinationStatusTone('DEGRADED')).toBe('warning');
    expect(destinationStatusTone('UNKNOWN')).toBe('default');
  });

  it('falls back to the raw code for unknown labels', () => {
    expect(labelFor(JOB_STATUS_LABELS, 'RUNNING')).toBe('Running');
    expect(labelFor(JOB_STATUS_LABELS, 'PAUSED')).toBe('PAUSED');
    expect(labelFor(JOB_STATUS_LABELS, null)).toBe('—');
    expect(optionsFrom({ A: 'a', B: 'b' })).toEqual([
      { value: 'A', label: 'a' },
      { value: 'B', label: 'b' },
    ]);
  });
});

describe('cluster and agent helpers', () => {
  it('validates Entra object ids', () => {
    expect(isGuid('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);
    expect(isGuid(' 3F2504E0-4F89-11D3-9A0C-0305E82C3301 ')).toBe(true);
    expect(isGuid('not-a-guid')).toBe(false);
  });

  it('summarises capabilities as chip labels', () => {
    expect(
      capabilitySummary({
        formats: ['PARQUET', 'CSV'],
        compression: ['SNAPPY'],
        incremental: true,
        disabled: false,
        maxParallelJobs: 4,
        limits: { memory: '2Gi' },
      }),
    ).toEqual([
      'PARQUET',
      'CSV',
      'SNAPPY',
      'incremental',
      'maxParallelJobs: 4',
      'limits',
    ]);
    expect(capabilitySummary({})).toEqual([]);
  });

  it('validates the cluster form', () => {
    const base = {
      clusterName: 'aks-visa-prod',
      tenantId: 'visa',
      environment: 'PRODUCTION' as const,
      region: null,
      subscriptionId: null,
      resourceGroup: null,
    };
    expect(clusterFormProblem(base)).toBeNull();
    expect(clusterFormProblem({ ...base, clusterName: ' ' })).toMatch(
      /cluster name/,
    );
    expect(clusterFormProblem({ ...base, tenantId: 'Visa Corp' })).toMatch(
      /slug/,
    );
    expect(clusterFormProblem({ ...base, tenantId: 'VISA' })).toBeNull();
  });
});

describe('dashboard and audit helpers', () => {
  it('draws the queue depth line and area within the chart', () => {
    const { line, area, max, points } = queueDepthPaths(
      [
        { capturedAt: 'a', value: 0 },
        { capturedAt: 'b', value: 10 },
        { capturedAt: 'c', value: 5 },
      ],
      100,
      50,
    );
    expect(max).toBe(10);
    expect(points).toHaveLength(3);
    expect(line.startsWith('M')).toBe(true);
    expect(area.endsWith('Z')).toBe(true);
    // The peak sits at the top padding, zero on the baseline.
    expect(points[1].y).toBeLessThan(points[0].y);
    expect(queueDepthPaths([]).line).toBe('');
  });

  it('previews audit details on one line', () => {
    expect(auditDetailsPreview({})).toBe('—');
    expect(auditDetailsPreview({ field: 'enabled', to: false, ids: [1] })).toBe(
      'field=enabled, to=false, ids=[1]',
    );
  });
});
