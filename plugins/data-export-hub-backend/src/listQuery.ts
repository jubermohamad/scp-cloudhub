import { ValidationError, isTenantId, isUuid } from './validation';

export interface ListSpec {
  /** API sort field → SQL expression. Only these may be used in ORDER BY. */
  sortable: Record<string, string>;
  defaultSort: { field: string; order: 'asc' | 'desc' };
  /** Filter names this list accepts. Others are ignored. */
  filters: readonly string[];
}

export interface ListRequest {
  page: number;
  pageSize: number;
  offset: number;
  /** SQL `ORDER BY` body, built only from whitelisted expressions. */
  orderBy: string;
  search?: string;
  filters: Record<string, string>;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 200;
const UUID_FILTERS = new Set(['clusterId', 'datasetId', 'exportId', 'profileId']);
const DATE_FILTERS = new Set(['from', 'to']);

function single(value: unknown): string | undefined {
  if (Array.isArray(value)) return single(value[0]);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Parses pagination, sorting, search and filters from a query string. Sort
 * fields are whitelisted per list so user input never reaches ORDER BY.
 * A stable tiebreaker (`id`) keeps pages consistent when sort values repeat.
 */
export function parseListQuery(query: Record<string, unknown>, spec: ListSpec, tiebreaker = 'id'): ListRequest {
  const errors: string[] = [];
  const page = single(query.page) === undefined ? 0 : Number(single(query.page));
  const pageSize = single(query.pageSize) === undefined ? 25 : Number(single(query.pageSize));
  if (!Number.isInteger(page) || page < 0 || page > 100000) errors.push('page must be a non-negative integer');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    errors.push(`pageSize must be between 1 and ${MAX_PAGE_SIZE}`);
  }

  const sortBy = single(query.sortBy) ?? spec.defaultSort.field;
  const sortOrder = (single(query.sortOrder) ?? (single(query.sortBy) ? 'asc' : spec.defaultSort.order)).toLowerCase();
  const sortExpression = spec.sortable[sortBy];
  if (!sortExpression) errors.push(`sortBy must be one of ${Object.keys(spec.sortable).join(', ')}`);
  if (sortOrder !== 'asc' && sortOrder !== 'desc') errors.push('sortOrder must be asc or desc');

  const search = single(query.search);
  if (search && search.length > 200) errors.push('search must be at most 200 characters');

  const filters: Record<string, string> = {};
  for (const name of spec.filters) {
    const value = single(query[name]);
    if (value === undefined) continue;
    if (UUID_FILTERS.has(name) && !isUuid(value)) errors.push(`${name} must be a UUID`);
    else if (name === 'tenantId' && !isTenantId(value)) errors.push('tenantId must be a tenant slug');
    else if (DATE_FILTERS.has(name) && Number.isNaN(Date.parse(value))) errors.push(`${name} must be an ISO date`);
    else if (value.length > 255) errors.push(`${name} is too long`);
    else filters[name] = value;
  }

  if (errors.length > 0) throw new ValidationError(errors);
  const direction = sortOrder === 'desc' ? 'DESC' : 'ASC';
  return {
    page,
    pageSize,
    offset: page * pageSize,
    orderBy: `${sortExpression} ${direction} NULLS LAST, ${tiebreaker} ${direction}`,
    search,
    filters,
  };
}

export function pageOf<T>(items: T[], total: number, request: ListRequest): Page<T> {
  return { items, total, page: request.page, pageSize: request.pageSize };
}
