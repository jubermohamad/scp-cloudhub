/**
 * index.ts — AKS Scheduler Azure Function
 *
 * Timer-triggered function that runs every 5 minutes and executes any
 * AKS stop/start actions that are due according to the schedules stored
 * in Backstage.
 *
 * Architecture:
 *   Backstage  ──(stores schedule)──►  PostgreSQL
 *   Azure Function  ◄──(reads)──  GET /api/cost-automation/azure/aks/schedules
 *   Azure Function  ◄──(reads)──  GET /api/cost-automation/azure/aks/managed
 *   Azure Function  ──(executes)──►  Azure ARM API (AKS stop / start)
 *
 * The function NEVER writes back to Backstage — it only reads.
 * Backstage is the control plane; this function is the execution plane.
 *
 * Timer: "0 *\/5 * * * *" = every 5 minutes
 */

import { app, InvocationContext, Timer } from '@azure/functions';

import {
  fetchSchedules,
  fetchManagedClusters,
  recordExecution,
  fetchLivePowerState,
} from '../lib/backstageClient';
import { isScheduleDue, describeEntry } from '../lib/scheduleUtils';
import { stopCluster, startCluster } from '../lib/aksClient';
import { checkGuardrails } from '../lib/guardrails';
import { ManagedCluster } from '../lib/types';

// ─── Dedup guard ──────────────────────────────────────────────────────────────
// Prevents the same action from firing more than once per scheduling window
// even if the function executes multiple times close together (e.g. retries).
// Key: "clusterName:action:YYYY-MM-DD HH:MM(scheduled, local)"
// Using the *scheduled* time (not current minute) prevents a double-fire when
// the function ticks twice inside the same ±windowMinutes window.
const executedThisTick = new Set<string>();
const TICK_TTL_MS = 6 * 60 * 1_000; // clear after 6 minutes

let lastTickClear = Date.now();

/**
 * Build a dedup key pinned to the *scheduled* HH:MM, not the current minute.
 * Falls back to current-minute key when no scheduled time is provided
 * (used for override actions that have no fixed schedule time).
 */
function dedupeKey(
  clusterName: string,
  action: string,
  timezone: string,
  now: Date,
  scheduledTime?: string, // "HH:MM"
): string {
  if (scheduledTime) {
    // Use the local date of `now` combined with the fixed scheduled HH:MM.
    const localDate = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now); // "YYYY-MM-DD"
    return `${clusterName}:${action}:${localDate} ${scheduledTime}`;
  }
  // Override / no scheduled time — floor to current minute.
  const localStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(now)
    .slice(0, 16);
  return `${clusterName}:${action}:${localStr}`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
async function aksSchedulerHandler(
  timer: Timer,
  context: InvocationContext,
): Promise<void> {
  const now = new Date();
  context.log(
    `[aks-scheduler] tick at ${now.toISOString()} (isPastDue=${
      timer.isPastDue
    })`,
  );

  // Clear the dedup set after one tick window has passed.
  if (Date.now() - lastTickClear > TICK_TTL_MS) {
    executedThisTick.clear();
    lastTickClear = Date.now();
  }

  // ── 1. Fetch configuration from Backstage ─────────────────────────────────
  let schedules;
  let clusterMap: Map<string, ManagedCluster>;

  try {
    [schedules, clusterMap] = await Promise.all([
      fetchSchedules().then(s => s),
      fetchManagedClusters().then(
        cs => new Map(cs.map(c => [c.clusterName, c])),
      ),
    ]);
  } catch (err) {
    context.error(
      `[aks-scheduler] Failed to fetch data from Backstage: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return; // Do not execute any actions if we cannot read the current state.
  }

  context.log(
    `[aks-scheduler] ${schedules.length} schedule(s), ${clusterMap.size} managed cluster(s)`,
  );

  const windowMinutes = parseInt(
    process.env.SCHEDULE_WINDOW_MINUTES ?? '4',
    10,
  );
  const actions: Array<() => Promise<void>> = [];

  // ── 2. Evaluate each schedule ─────────────────────────────────────────────
  for (const schedule of schedules) {
    if (!schedule.enabled) continue;

    const cluster = clusterMap.get(schedule.clusterName);
    if (!cluster) {
      context.warn(
        `[aks-scheduler] Schedule references unknown cluster "${schedule.clusterName}" — skipping`,
      );
      continue;
    }

    // ── Override: emergency action that bypasses schedule and pause ───────────
    if (schedule.overrideAction) {
      const expiry = schedule.overrideExpiresAt
        ? new Date(schedule.overrideExpiresAt)
        : null;
      if (expiry && expiry < now) {
        context.log(
          `[aks-scheduler] Override for "${cluster.clusterName}" has expired (${schedule.overrideExpiresAt}) — skipping`,
        );
      } else {
        const overrideAction = schedule.overrideAction.toLowerCase() as
          | 'stop'
          | 'start';
        const key = dedupeKey(
          cluster.clusterName,
          overrideAction,
          schedule.timezone,
          now,
        );
        if (!executedThisTick.has(key)) {
          // Refresh power state from ARM before guardrail check to avoid stale-cache skips.
          const livePowerState = await fetchLivePowerState(
            cluster.clusterName,
            cluster.subscriptionId,
            cluster.resourceGroup,
          );
          if (livePowerState)
            cluster.powerState = livePowerState as ManagedCluster['powerState'];
          const guard = checkGuardrails(cluster, overrideAction);
          if (guard.allowed) {
            executedThisTick.add(key);
            const clusterName = cluster.clusterName;
            const resourceGroup = cluster.resourceGroup;
            const subscriptionId = cluster.subscriptionId;
            actions.push(async () => {
              const auditBase = {
                timestamp: now.toISOString(),
                cluster: clusterName,
                action: schedule.overrideAction as 'STOP' | 'START',
                reason: `Emergency override`,
                initiator: 'aks-scheduler-azure-function',
                cron: null,
                timezone: schedule.timezone,
              };
              context.log(
                `[aks-scheduler] [AUDIT][OVERRIDE] ${JSON.stringify(
                  auditBase,
                )}`,
              );
              try {
                if (overrideAction === 'stop') {
                  await stopCluster(subscriptionId, resourceGroup, clusterName);
                } else {
                  await startCluster(
                    subscriptionId,
                    resourceGroup,
                    clusterName,
                  );
                }
                context.log(
                  `[aks-scheduler] [AUDIT][OVERRIDE] ${JSON.stringify({
                    ...auditBase,
                    result: 'SUCCESS',
                  })}`,
                );
                try {
                  await recordExecution(clusterName, {
                    action: auditBase.action,
                    result: 'SUCCESS',
                    reason: auditBase.reason,
                    initiatedBy: auditBase.initiator,
                  });
                } catch {
                  /* non-fatal */
                }
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : String(err);
                context.error(
                  `[aks-scheduler] [AUDIT][OVERRIDE] ${JSON.stringify({
                    ...auditBase,
                    result: 'FAILURE',
                    error: message,
                  })}`,
                );
                try {
                  await recordExecution(clusterName, {
                    action: auditBase.action,
                    result: 'FAILURE',
                    reason: auditBase.reason,
                    errorMessage: message,
                    initiatedBy: auditBase.initiator,
                  });
                } catch {
                  /* non-fatal */
                }
                throw err;
              }
            });
          } else {
            context.log(`[aks-scheduler] Override guardrail: ${guard.reason}`);
          }
        }
      }
      // Do not process regular schedule entries when an override is pending.
      continue;
    }

    // ── Pause: skip regular schedule entries when manually paused ────────────
    if (schedule.paused) {
      context.log(
        `[aks-scheduler] Schedule for "${cluster.clusterName}" is paused — skipping`,
      );
      continue;
    }

    for (const [entry, action] of [
      [schedule.stop, 'stop'] as const,
      [schedule.start, 'start'] as const,
    ]) {
      if (!entry) continue;

      if (!isScheduleDue(entry, schedule.timezone, now, windowMinutes))
        continue;

      const key = dedupeKey(
        cluster.clusterName,
        action,
        schedule.timezone,
        now,
        entry.time,
      );
      if (executedThisTick.has(key)) {
        context.log(
          `[aks-scheduler] Dedup: "${cluster.clusterName}" ${action} already executed this tick`,
        );
        continue;
      }

      // Refresh power state from ARM before guardrail check to avoid stale-cache skips.
      const livePowerState = await fetchLivePowerState(
        cluster.clusterName,
        cluster.subscriptionId,
        cluster.resourceGroup,
      );
      if (livePowerState)
        cluster.powerState = livePowerState as ManagedCluster['powerState'];

      const guard = checkGuardrails(cluster, action);
      if (!guard.allowed) {
        context.log(`[aks-scheduler] ${guard.reason}`);
        continue;
      }

      // Mark as executed before the async call to prevent concurrent re-entry.
      executedThisTick.add(key);

      const clusterName = cluster.clusterName;
      const resourceGroup = cluster.resourceGroup;
      const subscriptionId = cluster.subscriptionId;
      const scheduleDesc = describeEntry(entry, schedule.timezone);

      actions.push(async () => {
        const auditBase = {
          timestamp: now.toISOString(),
          cluster: clusterName,
          action: action.toUpperCase() as 'STOP' | 'START',
          reason: `Scheduled ${action} (${scheduleDesc})`,
          initiator: 'aks-scheduler-azure-function',
          cron: entry.cron,
          timezone: schedule.timezone,
        };

        context.log(`[aks-scheduler] [AUDIT] ${JSON.stringify(auditBase)}`);

        try {
          if (action === 'stop') {
            await stopCluster(subscriptionId, resourceGroup, clusterName);
          } else {
            await startCluster(subscriptionId, resourceGroup, clusterName);
          }
          context.log(
            `[aks-scheduler] [AUDIT] ${JSON.stringify({
              ...auditBase,
              result: 'SUCCESS',
            })}`,
          );

          // Write result back to Backstage for UX feedback (best-effort).
          try {
            await recordExecution(clusterName, {
              action: auditBase.action,
              result: 'SUCCESS',
              cron: auditBase.cron,
              timezone: auditBase.timezone,
              reason: auditBase.reason,
              initiatedBy: auditBase.initiator,
            });
          } catch (writeErr) {
            context.warn(
              `[aks-scheduler] recordExecution write-back failed (non-fatal): ${
                writeErr instanceof Error ? writeErr.message : String(writeErr)
              }`,
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          context.error(
            `[aks-scheduler] [AUDIT] ${JSON.stringify({
              ...auditBase,
              result: 'FAILURE',
              error: message,
            })}`,
          );

          // Write failure result back to Backstage (best-effort).
          try {
            await recordExecution(clusterName, {
              action: auditBase.action,
              result: 'FAILURE',
              cron: auditBase.cron,
              timezone: auditBase.timezone,
              reason: auditBase.reason,
              errorMessage: message,
              initiatedBy: auditBase.initiator,
            });
          } catch (writeErr) {
            context.warn(
              `[aks-scheduler] recordExecution write-back failed (non-fatal): ${
                writeErr instanceof Error ? writeErr.message : String(writeErr)
              }`,
            );
          }

          // Re-throw so the function invocation is marked as failed in Azure Monitor.
          throw err;
        }
      });
    }
  }

  // ── 3. Execute all due actions (sequentially to avoid ARM rate limits) ────
  context.log(`[aks-scheduler] ${actions.length} action(s) to execute`);
  for (const run of actions) {
    await run();
  }
}

// ── Register the function with Azure Functions v4 programming model ──────────
app.timer('aksScheduler', {
  // Every 5 minutes.  Adjust CRON_EXPRESSION app setting to change frequency.
  schedule: process.env.SCHEDULER_CRON ?? '0 */5 * * * *',
  handler: aksSchedulerHandler,
  runOnStartup: false,
});
