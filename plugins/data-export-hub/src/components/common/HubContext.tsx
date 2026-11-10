import { createContext, ReactNode, useContext, useMemo } from 'react';
import type { DataExportApi } from '../../api';
import { useAsync, useDataExportApi } from '../../hooks';
import type { FilterOptions, Me } from '../../types';
import { manageableTenants } from '../../utils';

export interface HubContextValue {
  api: DataExportApi;
  me: Me | undefined;
  meLoading: boolean;
  meError: string | null;
  isPlatformAdmin: boolean;
  filterOptions: FilterOptions;
  filterOptionsError: string | null;
  /** Tenants the caller may create exports and destinations for. */
  tenantOptions: string[];
  reloadFilterOptions: () => void;
}

const EMPTY_OPTIONS: FilterOptions = {
  tenants: [],
  clusters: [],
  datasets: [],
  owners: [],
};

const HubContext = createContext<HubContextValue | undefined>(undefined);

/** Loads the caller's permissions and the filter drop-down values once per page. */
export function HubProvider({ children }: { children: ReactNode }) {
  const api = useDataExportApi();
  const me = useAsync(() => api.me(), [api]);
  const options = useAsync(() => api.filterOptions(), [api]);

  const value = useMemo<HubContextValue>(() => {
    const filterOptions = options.data ?? EMPTY_OPTIONS;
    return {
      api,
      me: me.data,
      meLoading: me.loading,
      meError: me.error,
      isPlatformAdmin: me.data?.isPlatformAdmin ?? false,
      filterOptions,
      filterOptionsError: options.error,
      tenantOptions: manageableTenants(me.data, filterOptions.tenants),
      reloadFilterOptions: () => options.reload({ silent: true }),
    };
    // `options.reload` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, me.data, me.loading, me.error, options.data, options.error]);

  return <HubContext.Provider value={value}>{children}</HubContext.Provider>;
}

export function useHub(): HubContextValue {
  const value = useContext(HubContext);
  if (!value) {
    throw new Error('useHub must be used inside <HubLayout>');
  }
  return value;
}
