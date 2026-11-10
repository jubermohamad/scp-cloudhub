import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { SchedulerDatabase, poolFromEnv } from './db';
import { ExportScheduler } from './scheduler';

export { ExportScheduler } from './scheduler';
export { dueOccurrence } from './schedule';
export { SchedulerDatabase } from './db';

/**
 * Data Export Hub scheduler. Runs inside the CloudHub backend next to the
 * data-export-hub-backend plugin, which owns the data_export schema:
 *
 * - every minute: turn due schedules into jobs, queue them, reclaim jobs from
 *   lost agents, sample queue metrics;
 * - every 30 minutes: ask the hub to sync clusters from Platform Registry;
 * - every 6 hours: prune heartbeat history and metric samples.
 *
 * Tasks use Backstage's scheduler with global scope, so with several backend
 * replicas each task runs on one of them at a time.
 * Set DATA_EXPORT_SCHEDULER_ENABLED=false to disable (e.g. in a read-only replica).
 */
const dataExportSchedulerPlugin = createBackendPlugin({
  pluginId: 'data-export-scheduler',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
      },
      async init({ logger, scheduler, auth, discovery }) {
        if (process.env.DATA_EXPORT_SCHEDULER_ENABLED === 'false') {
          logger.info('[data-export-scheduler] disabled by DATA_EXPORT_SCHEDULER_ENABLED=false');
          return;
        }
        const pool = poolFromEnv(logger);
        if (!pool) return;
        const db = new SchedulerDatabase(pool);
        const exportScheduler = new ExportScheduler(db, logger);

        await scheduler.scheduleTask({
          id: 'data-export-scheduler:tick',
          frequency: { minutes: 1 },
          timeout: { seconds: 55 },
          scope: 'global',
          fn: async () => {
            if (!(await db.schemaReady())) {
              logger.info('[data-export-scheduler] waiting for the data_export schema migrations');
              return;
            }
            await exportScheduler.tick();
          },
        });

        await scheduler.scheduleTask({
          id: 'data-export-scheduler:cluster-sync',
          frequency: { minutes: 30 },
          timeout: { minutes: 5 },
          initialDelay: { minutes: 1 },
          scope: 'global',
          fn: async () => {
            const { token } = await auth.getPluginRequestToken({
              onBehalfOf: await auth.getOwnServiceCredentials(),
              targetPluginId: 'data-export',
            });
            const baseUrl = await discovery.getBaseUrl('data-export');
            const response = await fetch(`${baseUrl}/internal/clusters/sync`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            });
            if (!response.ok) {
              throw new Error(`Cluster sync failed with HTTP ${response.status}: ${await response.text()}`);
            }
            const result = (await response.json()) as Record<string, unknown>;
            logger.info(`[data-export-scheduler] cluster sync ${JSON.stringify(result)}`);
          },
        });

        await scheduler.scheduleTask({
          id: 'data-export-scheduler:housekeeping',
          frequency: { hours: 6 },
          timeout: { minutes: 15 },
          initialDelay: { minutes: 5 },
          scope: 'global',
          fn: async () => {
            if (!(await db.schemaReady())) return;
            const pruned = await exportScheduler.housekeeping();
            logger.info(`[data-export-scheduler] pruned ${pruned.heartbeats} heartbeats, ${pruned.metrics} metric samples`);
          },
        });
      },
    });
  },
});

export default dataExportSchedulerPlugin;
