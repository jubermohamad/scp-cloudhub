import type { ListQuery } from './types';

/** DataGrid only allows up to 100 rows per page in the MIT edition. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

export type SortOrder = 'asc' | 'desc';

export interface SortSpec {
  field: string;
  sort: SortOrder;
}

/** Shape of MUI DataGrid's sort model items, kept local so helpers stay framework-free. */
export interface SortModelItem {
  field: string;
  sort?: 'asc' | 'desc' | null;
}

/** Filter values held by a grid. Blank values are dropped before calling the API. */
export type GridFilters = Record<string, string | number | boolean | undefined>;

export interface GridState {
  page: number;
  pageSize: number;
  sortModel: readonly SortModelItem[];
  filters: GridFilters;
  search: string;
}

/**
 * Picks the active sort. Only fields the endpoint accepts are sent (others
 * would be rejected with 400); an empty or unknown sort falls back to the
 * endpoint default.
 */
export function resolveSort(
  sortModel: readonly SortModelItem[],
  allowed: readonly string[],
  fallback: SortSpec,
  fieldMap: Record<string, string> = {},
): SortSpec {
  const first = sortModel.find(item => item.sort);
  if (!first || !first.sort) return fallback;
  const field = fieldMap[first.field] ?? first.field;
  if (!allowed.includes(field)) return fallback;
  return { field, sort: first.sort };
}

export function clampPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(100, Math.round(pageSize));
}

/** Maps grid state to the query accepted by every list endpoint. */
export function buildListQuery(
  state: GridState,
  options: {
    allowedSort: readonly string[];
    defaultSort: SortSpec;
    fieldMap?: Record<string, string>;
    fixed?: ListQuery;
  },
): ListQuery {
  const sort = resolveSort(
    state.sortModel,
    options.allowedSort,
    options.defaultSort,
    options.fieldMap,
  );
  const query: ListQuery = {
    ...(options.fixed ?? {}),
    page: Math.max(0, Math.floor(state.page)),
    pageSize: clampPageSize(state.pageSize),
    sortBy: sort.field,
    sortOrder: sort.sort,
  };
  const search = state.search.trim();
  if (search) query.search = search;
  for (const [key, value] of Object.entries(state.filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (value === false) continue;
    query[key] = value;
  }
  return query;
}

/** Stable key for a filter object, used to decide when a refetch (and page reset) is needed. */
export function filtersKey(filters: GridFilters): string {
  return JSON.stringify(
    Object.keys(filters)
      .sort()
      .filter(key => {
        const value = filters[key];
        return value !== undefined && value !== '' && value !== false;
      })
      .map(key => [key, filters[key]]),
  );
}

/** Reads initial filter values from a URL query string, keeping only known keys. */
export function filtersFromSearchParams(
  params: URLSearchParams,
  keys: readonly string[],
): GridFilters {
  const filters: GridFilters = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value === null || value === '') continue;
    filters[key] = value === 'true' ? true : value;
  }
  return filters;
}

/** Allowed `sortBy` per endpoint; mirrors the backend. */
export const SORTABLE = {
  exports: [
    'name',
    'tenantId',
    'environment',
    'exportMode',
    'fileFormat',
    'enabled',
    'lastRunAt',
    'createdAt',
    'updatedAt',
  ],
  jobs: [
    'createdAt',
    'scheduledTime',
    'startedTime',
    'completedTime',
    'status',
    'rowsExported',
    'bytesExported',
    'durationSeconds',
    'exportName',
    'tenantId',
  ],
  datasets: [
    'datasetId',
    'displayName',
    'sourceProduct',
    'category',
    'classification',
    'updatedAt',
  ],
  clusters: [
    'clusterName',
    'tenantId',
    'environment',
    'region',
    'health',
    'lastHeartbeat',
  ],
  agents: [
    'clusterName',
    'agentName',
    'tenantId',
    'agentVersion',
    'lastSeen',
    'health',
  ],
  destinations: ['name', 'type', 'tenantId', 'status', 'lastTestAt'],
  audit: ['occurredAt', 'action', 'actor'],
} as const;

export const DEFAULT_SORT: Record<keyof typeof SORTABLE, SortSpec> = {
  exports: { field: 'name', sort: 'asc' },
  jobs: { field: 'createdAt', sort: 'desc' },
  datasets: { field: 'datasetId', sort: 'asc' },
  clusters: { field: 'clusterName', sort: 'asc' },
  agents: { field: 'clusterName', sort: 'asc' },
  destinations: { field: 'name', sort: 'asc' },
  audit: { field: 'occurredAt', sort: 'desc' },
};
