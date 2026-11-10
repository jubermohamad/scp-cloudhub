import { randomUUID } from 'crypto';
import { parseExpression } from 'cron-parser';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { Caller, canViewTenant, requireManage, visibleTenants } from '../access';
import { recordAudit } from '../audit';
import { DESTINATION_TYPES, JOB_MAX_RETRIES_DEFAULT, JOB_PRIORITY_MANUAL } from '../constants';
import type { DataExportDatabase } from '../db';
import { ConflictError, NotFoundError } from '../errors';
import { Page, pageOf, parseListQuery } from '../listQuery';
import { CatalogRepository } from '../repositories/catalogRepository';
import { DestinationRepository } from '../repositories/destinationRepository';
import { EXPORT_LIST, ExportRepository, ProfileRecord } from '../repositories/exportRepository';
import { FleetRepository } from '../repositories/fleetRepository';
import { JobRecord, JobRepository } from '../repositories/jobRepository';
import { ExportInput, ValidationError, isUuid, validateExportInput } from '../validation';
import { STANDARD_NETREVEAL_PACKAGES } from '../packages';
import { resolveStorageRuntimeConfig } from '../runtimeConfig';

export interface ExportView extends ProfileRecord {
  nextRunAt: string | null;
}

/** Next fire time of a cron expression after `from`, in UTC. */
export function nextRunAt(cronExpression: string, from: Date = new Date()): string | null {
  try {
    return parseExpression(cronExpression, { currentDate: from, utc: true }).next().toDate().toISOString();
  } catch {
    return null;
  }
}

export class ExportService {
  private readonly exports: ExportRepository;
  private readonly catalog: CatalogRepository;
  private readonly destinations: DestinationRepository;
  private readonly fleet: FleetRepository;
  private readonly jobs: JobRepository;

  constructor(
    private readonly db: DataExportDatabase,
    private readonly logger: LoggerService,
  ) {
    this.exports = new ExportRepository(db);
    this.catalog = new CatalogRepository(db);
    this.destinations = new DestinationRepository(db);
    this.fleet = new FleetRepository(db);
    this.jobs = new JobRepository(db);
  }

  private view(profile: ProfileRecord): ExportView {
    return { ...profile, nextRunAt: profile.enabled ? nextRunAt(profile.cronExpression) : null };
  }

  async list(query: Record<string, unknown>, caller: Caller): Promise<Page<ExportView>> {
    const request = parseListQuery(query, EXPORT_LIST, 'x.id');
    const { items, total } = await this.exports.list(request, visibleTenants(caller));
    return pageOf(items.map(item => this.view(item)), total, request);
  }

  async get(id: string, caller: Caller): Promise<ExportView> {
    const profile = isUuid(id) ? await this.exports.findById(id) : null;
    if (!profile || !canViewTenant(caller, profile.tenantId)) throw new NotFoundError(`Export ${id} not found`);
    return this.view(profile);
  }

  private async manageable(id: string, caller: Caller): Promise<ExportView> {
    const profile = await this.get(id, caller);
    requireManage(caller, profile.tenantId);
    return profile;
  }

  countConfigured(caller: Caller) {
    return this.exports.countEnabled(visibleTenants(caller));
  }

  owners(caller: Caller) {
    return this.exports.owners(visibleTenants(caller));
  }

  tenants() {
    return this.exports.tenants();
  }

  /**
   * The cluster must belong to the export's tenant and environment and be in
   * service; the destination must be shared or the tenant's own, enabled, and
   * have a delivery provider; every dataset must be enabled and runnable, and
   * support incremental export when the profile is INCREMENTAL.
   */
  private async assertReferences(input: ExportInput) {
    const problems: string[] = [];

    const cluster = await this.fleet.findCluster(input.clusterId);
    if (!cluster || cluster.tenantId !== input.tenantId) {
      problems.push(`clusterId ${input.clusterId} is not a registered cluster for tenant ${input.tenantId}`);
    } else if (cluster.isRetired) {
      problems.push(`Cluster ${cluster.clusterName} is retired`);
    } else if (cluster.environment !== input.environment) {
      problems.push(`Cluster ${cluster.clusterName} is registered as ${cluster.environment}, not ${input.environment}`);
    }

    const destination = await this.destinations.findById(input.destinationId);
    if (!destination || (destination.tenantId && destination.tenantId !== input.tenantId)) {
      problems.push(`destinationId ${input.destinationId} is not available to tenant ${input.tenantId}`);
    } else if (!destination.enabled) {
      problems.push(`Destination ${destination.name} is disabled`);
    } else if (!(DESTINATION_TYPES as readonly string[]).includes(destination.type)) {
      problems.push(`Destination ${destination.name} is ${destination.type}, which has no delivery provider`);
    }

    const datasets = await this.catalog.findByIds(input.datasetIds);
    const missing = input.datasetIds.filter(id => !datasets.some(dataset => dataset.id === id));
    if (missing.length) problems.push(`Unknown datasetIds: ${missing.join(', ')}`);
    const named = (filter: (d: (typeof datasets)[number]) => boolean) =>
      datasets.filter(filter).map(dataset => dataset.datasetId).join(', ');
    const disabled = named(dataset => !dataset.enabled);
    if (disabled) problems.push(`Disabled datasets cannot be exported: ${disabled}`);
    const noSql = named(dataset => !dataset.sqlTemplate);
    if (noSql) problems.push(`Datasets without a SQL template cannot be exported yet: ${noSql}`);
    if (input.exportMode === 'INCREMENTAL') {
      const notIncremental = named(dataset => !dataset.supportsIncremental || !dataset.watermarkColumn);
      if (notIncremental) problems.push(`Datasets that do not support incremental export: ${notIncremental}`);
    }

    if (problems.length) throw new ValidationError(problems);
  }

  private values(input: ExportInput) {
    const {
      datasetIds: _datasetIds,
      packageCodes: _packageCodes,
      ...values
    } = input;
    return values;
  }

  async ensureCustomerStorageDestination(tenantId: string): Promise<string> {
    const destName = `${tenantId}-azure-storage`;
    const existing = await this.destinations.findByName(destName);
    if (existing) {
      return existing.id;
    }
    const storage = resolveStorageRuntimeConfig();
    const id = randomUUID();
    await this.db.transaction(async tx => {
      await this.destinations.insert(
        {
          id,
          name: destName,
          type: 'ADLS_GEN2',
          configuration: {
            accountName: storage.accountName,
            fileSystem: tenantId,
            ...(storage.resourceId ? { resourceId: storage.resourceId } : {}),
            ...(storage.clientId ? { clientId: storage.clientId } : {}),
          },
          tenantId,
          owner: 'system',
          enabled: true,
        },
        tx,
      );
    });
    return id;
  }

  private async resolvePackageDatasets(
    packageCode: string,
  ): Promise<string[]> {
    const rows = await this.db.query<{
      dataset_ids: string[];
    }>(
      `SELECT dataset_ids
         FROM data_export.export_packages
        WHERE enabled = TRUE
          AND package_code = $1`,
      [packageCode],
    );
    const pkg = rows.rows[0];
    const fallback = STANDARD_NETREVEAL_PACKAGES.find(
      p => p.packageCode === packageCode,
    );
    const datasetIds = pkg?.dataset_ids ?? fallback?.datasetIds ?? [];
    if (datasetIds.length === 0) return [];
    const dbDatasets = await this.db.query<{ id: string }>(
      `SELECT id FROM data_export.datasets WHERE dataset_id = ANY($1::varchar[])`,
      [datasetIds],
    );
    return dbDatasets.rows.map(d => d.id);
  }

  private async packageNames(packageCodes: string[]): Promise<string[]> {
    const uniqueCodes = [...new Set(packageCodes)];
    if (uniqueCodes.length === 0) return [];
    const rows = await this.db.query<{
      package_name: string;
    }>(
      `SELECT package_name
         FROM data_export.export_packages
        WHERE enabled = TRUE
          AND package_code = ANY($1::varchar[])
        ORDER BY package_name ASC`,
      [uniqueCodes],
    );
    const names = rows.rows.map(row => row.package_name).filter(Boolean);
    if (names.length === uniqueCodes.length) return names;

    const fallbackByCode = new Map(
      STANDARD_NETREVEAL_PACKAGES.map(pkg => [pkg.packageCode, pkg.packageName]),
    );
    for (const code of uniqueCodes) {
      if (!names.some(name => name === fallbackByCode.get(code))) {
        const fallback = fallbackByCode.get(code);
        if (fallback) names.push(fallback);
      }
    }
    return names;
  }

  private async resolvePackageCodesDatasets(
    packageCodes: string[],
  ): Promise<string[]> {
    const uniqueCodes = [...new Set(packageCodes)];
    if (uniqueCodes.length === 0) return [];

    const dbPackages = await this.db.query<{
      package_code: string;
      package_name: string;
      dataset_ids: string[];
    }>(
      `SELECT package_code, package_name, dataset_ids
         FROM data_export.export_packages
        WHERE enabled = TRUE
          AND package_code = ANY($1::varchar[])`,
      [uniqueCodes],
    );

    const dbDatasetIds = dbPackages.rows.flatMap(pkg => pkg.dataset_ids ?? []);
    const fallbackDatasetIds = uniqueCodes
      .map(code =>
        STANDARD_NETREVEAL_PACKAGES.find(pkg => pkg.packageCode === code),
      )
      .filter((pkg): pkg is (typeof STANDARD_NETREVEAL_PACKAGES)[number] =>
        Boolean(pkg),
      )
      .flatMap(pkg => pkg.datasetIds);
    const datasetIds = [...new Set([...dbDatasetIds, ...fallbackDatasetIds])];
    if (datasetIds.length === 0) return [];

    const dbDatasets = await this.db.query<{ id: string }>(
      `SELECT id FROM data_export.datasets WHERE dataset_id = ANY($1::varchar[])`,
      [datasetIds],
    );
    return dbDatasets.rows.map(dataset => dataset.id);
  }

  async create(input: unknown, caller: Caller): Promise<ExportView> {
    const values = validateExportInput(input);
    requireManage(caller, values.tenantId);

    if (values.packageCodes && values.packageCodes.length > 0) {
      if (values.datasetIds.length === 0) {
        values.datasetIds = await this.resolvePackageCodesDatasets(
          values.packageCodes,
        );
      }
      const names = await this.packageNames(values.packageCodes);
      if (!values.packageName) {
        values.packageName = names.join(' + ') || null;
      }
      values.packageCode =
        values.packageCodes.length === 1 ? values.packageCodes[0] : null;
    }

    if (values.packageCode && values.datasetIds.length === 0) {
      values.datasetIds = await this.resolvePackageDatasets(
        values.packageCode,
      );
      if (!values.packageName) {
        const names = await this.packageNames([values.packageCode]);
        values.packageName = names[0] ?? null;
      }
    }

    if (!values.destinationId) {
      values.destinationId = await this.ensureCustomerStorageDestination(
        values.tenantId,
      );
    }

    await this.assertReferences(values);
    const id = randomUUID();
    await this.db.transaction(async tx => {
      await this.exports.insert(id, this.values(values), { ownerId: caller.actor, createdBy: caller.actor }, values.datasetIds, tx);
      await recordAudit(tx, {
        actor: caller.actor,
        action: 'export.created',
        entityType: 'export',
        entityId: id,
        tenantId: values.tenantId,
        details: { name: values.name, datasets: values.datasetIds.length, mode: values.exportMode },
      });
    });
    return this.get(id, caller);
  }

  async update(id: string, input: unknown, caller: Caller): Promise<ExportView> {
    const existing = await this.manageable(id, caller);
    const values = validateExportInput(input);
    // Moving an export to another tenant needs admin rights on both tenants.
    requireManage(caller, values.tenantId);

    if (values.packageCodes && values.packageCodes.length > 0) {
      if (values.datasetIds.length === 0) {
        values.datasetIds = await this.resolvePackageCodesDatasets(
          values.packageCodes,
        );
      }
      const names = await this.packageNames(values.packageCodes);
      if (!values.packageName) {
        values.packageName = names.join(' + ') || null;
      }
      values.packageCode =
        values.packageCodes.length === 1 ? values.packageCodes[0] : null;
    }

    if (values.packageCode && values.datasetIds.length === 0) {
      values.datasetIds = await this.resolvePackageDatasets(
        values.packageCode,
      );
      if (!values.packageName) {
        const names = await this.packageNames([values.packageCode]);
        values.packageName = names[0] ?? null;
      }
    }

    if (!values.destinationId) {
      values.destinationId =
        existing.destinationId ||
        (await this.ensureCustomerStorageDestination(values.tenantId));
    }

    await this.assertReferences(values);
    await this.db.transaction(async tx => {
      await this.exports.update(existing.id, this.values(values), values.datasetIds, tx);
      await recordAudit(tx, {
        actor: caller.actor,
        action: 'export.updated',
        entityType: 'export',
        entityId: existing.id,
        tenantId: values.tenantId,
        details: { name: values.name, previousTenant: existing.tenantId },
      });
    });
    return this.get(id, caller);
  }

  async remove(id: string, caller: Caller): Promise<void> {
    const existing = await this.manageable(id, caller);
    await this.db.transaction(async tx => {
      await this.exports.delete(existing.id, tx);
      await recordAudit(tx, {
        actor: caller.actor,
        action: 'export.deleted',
        entityType: 'export',
        entityId: existing.id,
        tenantId: existing.tenantId,
        details: { name: existing.name },
      });
    });
  }

  async setEnabled(id: string, enabled: boolean, caller: Caller): Promise<ExportView> {
    const existing = await this.manageable(id, caller);
    await this.db.transaction(async tx => {
      await this.exports.update(existing.id, { enabled }, undefined, tx);
      await recordAudit(tx, {
        actor: caller.actor,
        action: enabled ? 'export.enabled' : 'export.disabled',
        entityType: 'export',
        entityId: existing.id,
        tenantId: existing.tenantId,
        details: { name: existing.name },
      });
    });
    return this.get(id, caller);
  }

  /** Queues one high-priority job per dataset for immediate pickup by the cluster's agent. */
  async runNow(id: string, caller: Caller): Promise<JobRecord[]> {
    const profile = await this.manageable(id, caller);
    if (!profile.enabled) throw new ValidationError([`Export ${profile.name} is disabled`]);
    if (profile.datasets.length === 0) throw new ValidationError([`Export ${profile.name} has no datasets`]);
    const cluster = await this.fleet.findCluster(profile.clusterId);
    if (!cluster || cluster.isRetired) throw new ConflictError(`Cluster ${profile.clusterName} is retired`);
    const now = new Date();
    const jobs = profile.datasets.map(dataset => ({
      id: randomUUID(),
      profileId: profile.id,
      datasetId: dataset.id,
      clusterId: profile.clusterId,
      tenantId: profile.tenantId,
      status: 'QUEUED' as const,
      trigger: 'MANUAL' as const,
      priority: JOB_PRIORITY_MANUAL,
      scheduledTime: now,
      maxRetries: JOB_MAX_RETRIES_DEFAULT,
      requestedBy: caller.actor,
    }));
    await this.db.transaction(async tx => {
      await this.jobs.insertJobs(jobs, tx);
      await recordAudit(tx, {
        actor: caller.actor,
        action: 'export.run',
        entityType: 'export',
        entityId: profile.id,
        tenantId: profile.tenantId,
        details: { name: profile.name, jobs: jobs.length },
      });
    });
    this.logger.info(`[data-export-hub] ${caller.actor} queued ${jobs.length} job(s) for export ${profile.name}`);
    return this.jobs.findByIds(jobs.map(job => job.id));
  }
}
