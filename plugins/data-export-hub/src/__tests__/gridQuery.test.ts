import {
  buildListQuery,
  clampPageSize,
  DEFAULT_SORT,
  filtersFromSearchParams,
  filtersKey,
  resolveSort,
  SORTABLE,
} from '../gridQuery';

describe('resolveSort', () => {
  const fallback = DEFAULT_SORT.jobs;

  it('uses the grid sort when the endpoint allows it', () => {
    expect(
      resolveSort(
        [{ field: 'rowsExported', sort: 'asc' }],
        SORTABLE.jobs,
        fallback,
      ),
    ).toEqual({ field: 'rowsExported', sort: 'asc' });
  });

  it('falls back to the endpoint default for cleared or unknown sorts', () => {
    expect(resolveSort([], SORTABLE.jobs, fallback)).toEqual(fallback);
    expect(
      resolveSort(
        [{ field: 'rowsExported', sort: null }],
        SORTABLE.jobs,
        fallback,
      ),
    ).toEqual(fallback);
    expect(
      resolveSort(
        [{ field: 'clusterName', sort: 'asc' }],
        SORTABLE.jobs,
        fallback,
      ),
    ).toEqual(fallback);
  });

  it('maps grid fields to API sort fields', () => {
    expect(
      resolveSort(
        [{ field: 'exportLabel', sort: 'desc' }],
        SORTABLE.jobs,
        fallback,
        { exportLabel: 'exportName' },
      ),
    ).toEqual({ field: 'exportName', sort: 'desc' });
  });
});

describe('buildListQuery', () => {
  const options = {
    allowedSort: SORTABLE.exports,
    defaultSort: DEFAULT_SORT.exports,
  };

  it('maps paging, sorting, search and filters, dropping blanks', () => {
    expect(
      buildListQuery(
        {
          page: 3,
          pageSize: 50,
          sortModel: [{ field: 'lastRunAt', sort: 'desc' }],
          filters: {
            tenantId: 'visa',
            clusterId: '',
            status: undefined,
            includeRetired: false,
          },
          search: '  nightly ',
        },
        options,
      ),
    ).toEqual({
      page: 3,
      pageSize: 50,
      sortBy: 'lastRunAt',
      sortOrder: 'desc',
      search: 'nightly',
      tenantId: 'visa',
    });
  });

  it('applies fixed scope and the default sort', () => {
    expect(
      buildListQuery(
        { page: 0, pageSize: 25, sortModel: [], filters: {}, search: '' },
        { ...options, fixed: { exportId: 'e1' } },
      ),
    ).toEqual({
      exportId: 'e1',
      page: 0,
      pageSize: 25,
      sortBy: 'name',
      sortOrder: 'asc',
    });
  });

  it('never asks for more than 100 rows', () => {
    expect(clampPageSize(500)).toBe(100);
    expect(clampPageSize(0)).toBe(25);
    expect(clampPageSize(10)).toBe(10);
  });
});

describe('filter helpers', () => {
  it('produces a stable key that ignores blanks and order', () => {
    expect(filtersKey({ b: '2', a: '1', c: '' })).toBe(
      filtersKey({ a: '1', b: '2', d: undefined }),
    );
    expect(filtersKey({ a: '1' })).not.toBe(filtersKey({ a: '2' }));
  });

  it('reads known filters from the URL', () => {
    const params = new URLSearchParams(
      'status=FAILED&includeRetired=true&evil=1&tenantId=',
    );
    expect(
      filtersFromSearchParams(params, ['status', 'includeRetired', 'tenantId']),
    ).toEqual({ status: 'FAILED', includeRetired: true });
  });

  it('declares the backend sort whitelist for every endpoint', () => {
    for (const [endpoint, fields] of Object.entries(SORTABLE)) {
      const fallback = DEFAULT_SORT[endpoint as keyof typeof SORTABLE];
      expect(fields).toContain(fallback.field);
    }
  });
});
