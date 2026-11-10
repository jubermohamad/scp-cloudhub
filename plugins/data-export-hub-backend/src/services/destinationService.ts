import { randomUUID } from 'crypto';
import { Caller, canManageDestination, canViewTenant, visibleTenants } from '../access';
import { recordAudit } from '../audit';
import { DESTINATION_TYPES } from '../constants';
import type { DataExportDatabase } from '../db';
import { ForbiddenError, NotFoundError, mapUniqueViolation } from '../errors';
import { Page, pageOf, parseListQuery } from '../listQuery';
import {
  DESTINATION_LIST,
  DestinationRecord,
  DestinationRepository,
} from '../repositories/destinationRepository';
import { ValidationError, destinationConfigProblems, isUuid, validateDestinationInput } from '../validation';

export interface DestinationTestResult {
  destinationId: string | null;
  status: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  message: string;
  checkedAt: string;
}

export class DestinationService {
  readonly repo: DestinationRepository;

  constructor(private readonly db: DataExportDatabase) {
    this.repo = new DestinationRepository(db);
  }

  async list(query: Record<string, unknown>, caller: Caller): Promise<Page<DestinationRecord>> {
    const request = parseListQuery(query, DESTINATION_LIST, 'd.id');
    const { items, total } = await this.repo.list(request, visibleTenants(caller));
    return pageOf(items, total, request);
  }

  async get(id: string, caller: Caller): Promise<DestinationRecord> {
    const destination = isUuid(id) ? await this.repo.findById(id) : null;
    if (!destination || (destination.tenantId && !canViewTenant(caller, destination.tenantId))) {
      throw new NotFoundError(`Destination ${id} not found`);
    }
    return destination;
  }

  countConfigured(caller: Caller) {
    return this.repo.countEnabled(visibleTenants(caller));
  }

  async create(input: unknown, caller: Caller): Promise<DestinationRecord> {
    const values = validateDestinationInput(input);
    if (!canManageDestination(caller, values)) {
      throw new ForbiddenError(
        values.tenantId
          ? `Requires tenant admin for ${values.tenantId}`
          : 'Shared destinations require CloudHub.DataExport.Admin',
      );
    }
    const id = randomUUID();
    try {
      await this.db.transaction(async tx => {
        await this.repo.insert({ id, ...values, owner: values.owner ?? caller.actor }, tx);
        await recordAudit(tx, {
          actor: caller.actor,
          action: 'destination.created',
          entityType: 'destination',
          entityId: id,
          tenantId: values.tenantId,
          details: { name: values.name, type: values.type },
        });
      });
    } catch (error) {
      mapUniqueViolation(error, `A destination named "${values.name}" already exists`);
    }
    return this.get(id, caller);
  }

  async update(id: string, input: unknown, caller: Caller): Promise<DestinationRecord> {
    const existing = await this.get(id, caller);
    if (!canManageDestination(caller, existing)) {
      throw new ForbiddenError(`You cannot manage destination ${existing.name}`);
    }
    const body = (input ?? {}) as Record<string, unknown>;
    const patch: { name?: string; enabled?: boolean; owner?: string | null } = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.owner !== undefined) patch.owner = typeof body.owner === 'string' ? body.owner : null;
    try {
      await this.db.transaction(async tx => {
        await this.repo.update(existing.id, patch, tx);
        await recordAudit(tx, {
          actor: caller.actor,
          action:
            patch.enabled === false ? 'destination.disabled' : patch.enabled === true ? 'destination.enabled' : 'destination.updated',
          entityType: 'destination',
          entityId: existing.id,
          tenantId: existing.tenantId,
          details: { fields: Object.keys(patch) },
        });
      });
    } catch (error) {
      mapUniqueViolation(error, `A destination named "${patch.name}" already exists`);
    }
    return this.get(id, caller);
  }

  /**
   * Validates configuration here. Connectivity is checked by agents, which
   * reach destinations from inside each cluster's network: a stored
   * destination shows its last live result in `status`.
   */
  async test(input: unknown, caller: Caller): Promise<DestinationTestResult> {
    const body = (input ?? {}) as Record<string, unknown>;
    const checkedAt = new Date().toISOString();
    if (typeof body.id === 'string') {
      const stored = await this.get(body.id, caller);
      if (!canManageDestination(caller, stored)) {
        throw new ForbiddenError(`You cannot test destination ${stored.name}`);
      }
      const problems = destinationConfigProblems(stored.type, stored.configuration);
      if (problems.length) return { destinationId: stored.id, status: 'FAILED', message: problems.join('; '), checkedAt };
      if (stored.status === 'HEALTHY' || stored.status === 'FAILED') {
        return {
          destinationId: stored.id,
          status: stored.status,
          message: `Configuration is valid. Last live check: ${stored.lastTestMessage ?? stored.status}`,
          checkedAt: stored.lastTestAt ?? checkedAt,
        };
      }
      return {
        destinationId: stored.id,
        status: 'DEGRADED',
        message: 'Configuration is valid. An agent runs a live check within 15 minutes of an export using it.',
        checkedAt,
      };
    }
    if (!(DESTINATION_TYPES as readonly string[]).includes(body.type as string)) {
      throw new ValidationError([`type must be one of ${DESTINATION_TYPES.join(', ')}`]);
    }
    if (!body.configuration || typeof body.configuration !== 'object' || Array.isArray(body.configuration)) {
      throw new ValidationError(['configuration must be an object']);
    }
    const problems = destinationConfigProblems(body.type as string, body.configuration as Record<string, unknown>);
    return problems.length
      ? { destinationId: null, status: 'FAILED', message: problems.join('; '), checkedAt }
      : {
          destinationId: null,
          status: 'DEGRADED',
          message: 'Configuration is valid. Connectivity is verified by the cluster agent once the destination is in use.',
          checkedAt,
        };
  }
}
