import { randomUUID } from 'crypto';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { Caller, requirePlatformAdmin } from '../access';
import { recordAudit } from '../audit';
import type { DataExportDatabase } from '../db';
import { NotFoundError, mapUniqueViolation } from '../errors';
import { DATASET_LIST, CatalogRepository, DatasetRecord } from '../repositories/catalogRepository';
import { Page, pageOf, parseListQuery } from '../listQuery';
import {
  DatasetInput,
  ValidationError,
  catalogProblems,
  isUuid,
  validateDatasetInput,
  validateDatasetPatch,
} from '../validation';

/** The data catalog is shared by every tenant; only platform admins change it. */
export class CatalogService {
  private readonly repo: CatalogRepository;

  constructor(
    private readonly db: DataExportDatabase,
    private readonly logger: LoggerService,
  ) {
    this.repo = new CatalogRepository(db);
  }

  async list(query: Record<string, unknown>): Promise<Page<DatasetRecord>> {
    const request = parseListQuery(query, DATASET_LIST, 'd.id');
    const { items, total } = await this.repo.list(request);
    return pageOf(items, total, request);
  }

  async get(id: string): Promise<DatasetRecord> {
    const dataset = isUuid(id) ? await this.repo.findById(id) : null;
    if (!dataset) throw new NotFoundError(`Dataset ${id} not found`);
    return dataset;
  }

  async lineage(id: string) {
    await this.get(id);
    return this.repo.lineage(id);
  }

  options() {
    return this.repo.options();
  }

  countPublished() {
    return this.repo.countEnabled();
  }

  /** Every referenced dataset must exist, and the new edges must not create a cycle. */
  private async assertDependencies(id: string | null, dependsOn: string[]) {
    if (dependsOn.length === 0) return;
    const found = await this.repo.findByIds(dependsOn);
    const missing = dependsOn.filter(dep => !found.some(dataset => dataset.id === dep));
    if (missing.length) throw new ValidationError([`Unknown dependsOn datasets: ${missing.join(', ')}`]);
    if (id) {
      if (dependsOn.includes(id)) throw new ValidationError(['A dataset cannot depend on itself']);
      const downstream = new Set(await this.repo.downstreamIds(id));
      const cyclic = dependsOn.filter(dep => downstream.has(dep));
      if (cyclic.length) {
        throw new ValidationError([`dependsOn would create a cycle through: ${cyclic.join(', ')}`]);
      }
    }
  }

  async register(input: unknown, caller: Caller): Promise<DatasetRecord> {
    requirePlatformAdmin(caller);
    const values = validateDatasetInput(input);
    await this.assertDependencies(null, values.dependsOn);
    const id = randomUUID();
    try {
      await this.db.transaction(async tx => {
        await this.repo.insert(id, values, tx);
        await recordAudit(tx, {
          actor: caller.actor,
          action: 'dataset.registered',
          entityType: 'dataset',
          entityId: id,
          details: { datasetId: values.datasetId },
        });
      });
    } catch (error) {
      mapUniqueViolation(error, `Dataset ${values.datasetId} is already registered`);
    }
    this.logger.info(`[data-export-hub] ${caller.actor} registered dataset ${values.datasetId}`);
    return this.get(id);
  }

  async update(id: string, input: unknown, caller: Caller): Promise<DatasetRecord> {
    requirePlatformAdmin(caller);
    const existing = await this.get(id);
    const patch: Partial<DatasetInput> = validateDatasetPatch(input);
    const problems = catalogProblems({ ...existing, ...patch });
    if (problems.length) throw new ValidationError(problems);
    if (patch.dependsOn) await this.assertDependencies(existing.id, patch.dependsOn);
    await this.db.transaction(async tx => {
      await this.repo.update(existing.id, patch, tx);
      await recordAudit(tx, {
        actor: caller.actor,
        action: patch.enabled === false ? 'dataset.disabled' : patch.enabled === true ? 'dataset.enabled' : 'dataset.updated',
        entityType: 'dataset',
        entityId: existing.id,
        details: { datasetId: existing.datasetId, fields: Object.keys(patch) },
      });
    });
    return this.get(id);
  }
}
