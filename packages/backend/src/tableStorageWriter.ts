/**
 * tableStorageWriter.ts
 *
 * Write-only Azure Table Storage client for the Backstage Cost Automation backend.
 *
 * Backstage is the control plane: it writes schedule intent to Table Storage.
 * The Azure Function is the executor:  it reads from Table Storage and acts.
 *
 * This module ONLY writes. It never reads from Table Storage — that is the
 * Azure Function's responsibility.
 *
 * Table: AksCostAutomation
 *   PartitionKey = subscriptionId
 *   RowKey       = `${resourceGroup}::${clusterName}`
 *
 * Authentication:
 *   - Azure (production): the canonical CloudHub AZURE_* service principal.
 *   - Override with COST_AUTOMATION_STORAGE_CONNECTION_STRING for local Azurite.
 */

import {
  TableClient,
  TableEntity,
} from '@azure/data-tables';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { ClusterSchedule, OnboardedCluster } from './costAutomationTypes';

// ─── Config ───────────────────────────────────────────────────────────────────

const TABLE_NAME =
  process.env.COST_AUTOMATION_TABLE_NAME ?? 'AksCostAutomation';

// ─── Table client factory ─────────────────────────────────────────────────────

function createTableClient(logger: LoggerService): TableClient | null {
  const connectionString =
    process.env.COST_AUTOMATION_STORAGE_CONNECTION_STRING;
  const accountName = process.env.COST_AUTOMATION_STORAGE_ACCOUNT_NAME;

  if (connectionString) {
    return TableClient.fromConnectionString(connectionString, TABLE_NAME);
  }
  if (accountName) {
    return new TableClient(
      `https://${accountName}.table.core.windows.net`,
      TABLE_NAME,
      createCloudHubAzureCredential((message, metadata) =>
        logger.info(message, metadata),
      ),
    );
  }
  // No storage config — writer is disabled (non-fatal; Backstage keeps running).
  return null;
}

// ─── Entity builder ───────────────────────────────────────────────────────────

/**
 * Converts Backstage's internal ClusterSchedule model + OnboardedCluster record
 * into the flat AksCostAutomation Table Storage entity.
 *
 * Backstage model:  stop: { dayOfWeek, time, cron } | null
 * Table entity:     stopDayOfWeek?: number, stopTime?: string  (flat, JS convention)
 */
function buildEntity(
  cluster: OnboardedCluster,
  schedule: ClusterSchedule,
): TableEntity<Record<string, unknown>> {
  return {
    partitionKey: cluster.subscriptionId,
    rowKey: `${cluster.resourceGroup}::${cluster.clusterName}`,

    clusterName: cluster.clusterName,
    resourceGroup: cluster.resourceGroup,
    subscriptionId: cluster.subscriptionId,
    environment: cluster.environment,

    onboarded: true,
    automationEnabled: schedule.enabled,

    timezone: schedule.timezone,

    // Stop schedule (flat, JS dayOfWeek: 0=Sun … 6=Sat)
    ...(schedule.stop
      ? { stopDayOfWeek: schedule.stop.dayOfWeek, stopTime: schedule.stop.time }
      : {}),

    // Start schedule
    ...(schedule.start
      ? {
          startDayOfWeek: schedule.start.dayOfWeek,
          startTime: schedule.start.time,
        }
      : {}),

    paused: schedule.paused,
    holidayCalendar: schedule.holidayCalendar ?? '',

    // Override fields: only set if present and not null
    ...(schedule.overrideAction
      ? {
          overrideAction: schedule.overrideAction,
          overrideExpiresAt: schedule.overrideExpiresAt ?? '',
        }
      : {
          overrideAction: '',
          overrideExpiresAt: '',
        }),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class TableStorageWriter {
  private client: TableClient | null;
  private logger: LoggerService;

  constructor(logger: LoggerService) {
    this.client = createTableClient(logger);
    this.logger = logger;
    if (!this.client) {
      this.logger.warn(
        '[table-storage-writer] No storage config found. ' +
          'Set COST_AUTOMATION_STORAGE_ACCOUNT_NAME or COST_AUTOMATION_STORAGE_CONNECTION_STRING ' +
          'to enable Table Storage sync.',
      );
    }
  }

  /** Returns true if Table Storage is configured (i.e. this writer is active). */
  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Upserts the full schedule entity for a cluster.
   * Called after schedule create/update, pause toggle, or override set/clear.
   */
  async upsertSchedule(
    cluster: OnboardedCluster,
    schedule: ClusterSchedule,
  ): Promise<void> {
    if (!this.client) return;
    try {
      const entity = buildEntity(cluster, schedule);
      await this.client.upsertEntity(entity, 'Merge');
      this.logger.info(
        `[table-storage-writer] Upserted entity for cluster="${cluster.clusterName}" ` +
          `(${cluster.subscriptionId}/${cluster.resourceGroup})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[table-storage-writer] Failed to upsert entity for cluster="${cluster.clusterName}": ${msg}`,
      );
      // Not rethrowing — Table Storage write failure must not block the Backstage API response.
    }
  }

  /**
   * Removes the Table Storage entity when a cluster is offboarded or
   * when automation is permanently disabled.
   */
  async deleteEntity(
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
  ): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.deleteEntity(
        subscriptionId,
        `${resourceGroup}::${clusterName}`,
      );
      this.logger.info(
        `[table-storage-writer] Deleted entity for cluster="${clusterName}"`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 is fine — entity may not have been written yet
      if (!msg.includes('ResourceNotFound') && !msg.includes('TableNotFound')) {
        this.logger.warn(
          `[table-storage-writer] Delete failed for cluster="${clusterName}": ${msg}`,
        );
      }
    }
  }
}
