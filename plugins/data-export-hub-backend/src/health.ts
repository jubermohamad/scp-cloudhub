import { HEALTH_THRESHOLD_MINUTES, Health } from './constants';

/**
 * Health from heartbeat age (spec: < 5 min healthy, 5–10 warning, 10–15
 * critical, > 15 offline). An agent that reports DEGRADED is at best WARNING;
 * one that reports OFFLINE (graceful shutdown) is OFFLINE immediately.
 */
export function healthFromHeartbeat(lastSeen: string | Date | null, reportedStatus: string | null, now: Date): Health {
  if (!lastSeen || reportedStatus === 'OFFLINE') return 'OFFLINE';
  const minutes = (now.getTime() - new Date(lastSeen).getTime()) / 60000;
  if (minutes < HEALTH_THRESHOLD_MINUTES.warning) return reportedStatus === 'DEGRADED' ? 'WARNING' : 'HEALTHY';
  if (minutes < HEALTH_THRESHOLD_MINUTES.critical) return 'WARNING';
  if (minutes < HEALTH_THRESHOLD_MINUTES.offline) return 'CRITICAL';
  return 'OFFLINE';
}

/** SQL equivalent of healthFromHeartbeat, so lists can filter and sort by health in the database. */
export function healthSql(lastSeen: string, status: string): string {
  const { warning, critical, offline } = HEALTH_THRESHOLD_MINUTES;
  return `(CASE
    WHEN ${lastSeen} IS NULL OR ${status} = 'OFFLINE' THEN 'OFFLINE'
    WHEN ${lastSeen} > NOW() - INTERVAL '${warning} minutes'
      THEN CASE WHEN ${status} = 'DEGRADED' THEN 'WARNING' ELSE 'HEALTHY' END
    WHEN ${lastSeen} > NOW() - INTERVAL '${critical} minutes' THEN 'WARNING'
    WHEN ${lastSeen} > NOW() - INTERVAL '${offline} minutes' THEN 'CRITICAL'
    ELSE 'OFFLINE' END)`;
}

/** Orders health from best to worst when sorting. */
export function healthRankSql(healthExpression: string): string {
  return `(CASE ${healthExpression} WHEN 'HEALTHY' THEN 0 WHEN 'WARNING' THEN 1 WHEN 'CRITICAL' THEN 2 ELSE 3 END)`;
}
