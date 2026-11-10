import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBackendFetch } from '@internal/plugin-platform-common';
import { createDataExportApi, DataExportApi } from './api';
import { errorMessage } from './utils';

export function useDataExportApi(): DataExportApi {
  const backendFetch = useBackendFetch();
  return useMemo(() => createDataExportApi(backendFetch), [backendFetch]);
}

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** Reloads; a silent reload keeps showing current data without a loading state. */
  reload: (options?: { silent?: boolean }) => void;
}

/**
 * Runs a loader on mount and whenever `deps` change. Stale responses are
 * ignored so a slow earlier request cannot overwrite a newer result.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const silentRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!silentRef.current) setLoading(true);
    silentRef.current = false;
    loader()
      .then(result => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback((options?: { silent?: boolean }) => {
    silentRef.current = Boolean(options?.silent);
    setVersion(v => v + 1);
  }, []);
  return { data, error, loading, reload };
}

/** Calls `callback` every `delayMs` while `delayMs` is a number; pauses while the tab is hidden. */
export function useInterval(callback: () => void, delayMs: number | null) {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delayMs === null) return undefined;
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      saved.current();
    }, delayMs);
    return () => window.clearInterval(id);
  }, [delayMs]);
}

export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
