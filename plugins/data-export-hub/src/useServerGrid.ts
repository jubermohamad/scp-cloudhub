import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GridPaginationModel, GridSortModel } from '@mui/x-data-grid';
import {
  buildListQuery,
  DEFAULT_PAGE_SIZE,
  filtersKey,
  GridFilters,
  SortSpec,
} from './gridQuery';
import { useDebouncedValue, useInterval } from './hooks';
import type { ListQuery, Page } from './types';
import { errorMessage } from './utils';

export interface ServerGridOptions<T> {
  allowedSort: readonly string[];
  defaultSort: SortSpec;
  /** Grid column field → API sortBy, where they differ. */
  fieldMap?: Record<string, string>;
  defaultPageSize?: number;
  initialFilters?: GridFilters;
  /** Always sent, e.g. an exportId scope from the URL. Changing it refetches. */
  fixedQuery?: ListQuery;
  /** Poll interval while `shouldPoll(rows)` is true (silent refresh). */
  pollMs?: number;
  shouldPoll?: (rows: T[]) => boolean;
}

export interface ServerGrid<T> {
  rows: T[];
  rowCount: number;
  loading: boolean;
  error: string | null;
  query: ListQuery;
  filters: GridFilters;
  searchInput: string;
  setSearchInput: (value: string) => void;
  setFilter: (key: string, value: GridFilters[string]) => void;
  setFilters: (filters: GridFilters) => void;
  clearFilters: () => void;
  reload: (options?: { silent?: boolean }) => void;
  /** Spread onto `<DataGrid>` (or `<ServerDataGrid>`). */
  gridProps: {
    rows: T[];
    rowCount: number;
    loading: boolean;
    paginationMode: 'server';
    sortingMode: 'server';
    filterMode: 'server';
    paginationModel: GridPaginationModel;
    onPaginationModelChange: (model: GridPaginationModel) => void;
    sortModel: GridSortModel;
    onSortModelChange: (model: GridSortModel) => void;
  };
}

/**
 * Owns page, page size, sort, search and filters for a server-side DataGrid.
 * Search is debounced, filter or search changes return to the first page,
 * and responses for superseded requests are dropped.
 */
export function useServerGrid<T>(
  fetchPage: (query: ListQuery) => Promise<Page<T>>,
  options: ServerGridOptions<T>,
): ServerGrid<T> {
  const {
    allowedSort,
    defaultSort,
    fieldMap,
    defaultPageSize = DEFAULT_PAGE_SIZE,
    initialFilters = {},
    fixedQuery,
    pollMs,
    shouldPoll,
  } = options;

  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: defaultPageSize,
  });
  const [sortModel, setSortModel] = useState<GridSortModel>([
    { field: defaultSort.field, sort: defaultSort.sort },
  ]);
  const [filters, setFiltersState] = useState<GridFilters>(initialFilters);
  const [searchInput, setSearchInputState] = useState(
    typeof initialFilters.search === 'string' ? initialFilters.search : '',
  );
  const search = useDebouncedValue(searchInput, 350);
  const [rows, setRows] = useState<T[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const silentRef = useRef(false);
  const requestRef = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const fixedKey = JSON.stringify(fixedQuery ?? {});
  const filterKey = filtersKey(filters);

  // Filter, search or scope changes go back to the first page. Done during
  // render (not in an effect) so the stale page is never requested.
  const scopeKey = `${filterKey}|${search}|${fixedKey}`;
  const [lastScopeKey, setLastScopeKey] = useState(scopeKey);
  if (lastScopeKey !== scopeKey) {
    setLastScopeKey(scopeKey);
    if (paginationModel.page !== 0) {
      setPaginationModel({ ...paginationModel, page: 0 });
    }
  }

  const query = useMemo(
    () => {
      const { search: _ignored, ...rest } = filters;
      return buildListQuery(
        {
          page: paginationModel.page,
          pageSize: paginationModel.pageSize,
          sortModel,
          filters: rest,
          search,
        },
        { allowedSort, defaultSort, fieldMap, fixed: fixedQuery },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paginationModel, sortModel, filterKey, search, fixedKey],
  );
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    const requestId = ++requestRef.current;
    if (!silentRef.current) setLoading(true);
    silentRef.current = false;
    fetchRef
      .current(query)
      .then(result => {
        if (requestId !== requestRef.current) return;
        setRows(result.items);
        setRowCount(result.total);
        setError(null);
        // The page can fall off the end after deletes or narrower filters.
        if (result.items.length === 0 && result.total > 0 && query.page) {
          const lastPage = Math.max(
            0,
            Math.ceil(result.total / (query.pageSize ?? defaultPageSize)) - 1,
          );
          setPaginationModel(current => ({ ...current, page: lastPage }));
        }
      })
      .catch(err => {
        if (requestId !== requestRef.current) return;
        setError(errorMessage(err));
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, version]);

  // Supersede any in-flight request on unmount.
  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  const reload = useCallback((reloadOptions?: { silent?: boolean }) => {
    silentRef.current = Boolean(reloadOptions?.silent);
    setVersion(v => v + 1);
  }, []);

  const polling = Boolean(
    pollMs && shouldPoll && !loading && !error && shouldPoll(rows),
  );
  useInterval(() => reload({ silent: true }), polling ? pollMs! : null);

  const setFilter = useCallback(
    (key: string, value: GridFilters[string]) =>
      setFiltersState(current => ({ ...current, [key]: value })),
    [],
  );
  const setFilters = useCallback(
    (next: GridFilters) => setFiltersState(next),
    [],
  );
  const clearFilters = useCallback(() => {
    setFiltersState({});
    setSearchInputState('');
  }, []);

  const onSortModelChange = useCallback(
    (model: GridSortModel) => setSortModel(model),
    [],
  );
  const onPaginationModelChange = useCallback(
    (model: GridPaginationModel) =>
      setPaginationModel(current =>
        current.pageSize !== model.pageSize ? { ...model, page: 0 } : model,
      ),
    [],
  );

  return {
    rows,
    rowCount,
    loading,
    error,
    query,
    filters,
    searchInput,
    setSearchInput: setSearchInputState,
    setFilter,
    setFilters,
    clearFilters,
    reload,
    gridProps: {
      rows,
      rowCount,
      loading,
      paginationMode: 'server',
      sortingMode: 'server',
      filterMode: 'server',
      paginationModel,
      onPaginationModelChange,
      sortModel,
      onSortModelChange,
    },
  };
}
