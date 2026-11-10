import { useCallback } from 'react';
import {
  discoveryApiRef,
  fetchApiRef,
  useApi,
} from '@backstage/core-plugin-api';

/**
 * Resolve and call a Backstage backend plugin endpoint.
 *
 * Frontend code must never call backend plugins with a relative path such as
 * `/api/<plugin>/...`. In production that path is proxied to the backend by
 * nginx, but the local Backstage dev server does NOT proxy `/api` and instead
 * serves `index.html`, producing the classic
 * `Unexpected token '<' ... is not valid JSON` error.
 *
 * This hook resolves the absolute backend URL through `discoveryApi`
 * (e.g. `http://localhost:7007/api/<plugin>`) and issues the request through
 * `fetchApi`, which injects the Backstage identity token so authenticated
 * plugin routes (`httpAuth.credentials({ allow: ['user'] })`) succeed.
 */
export function useBackendFetch() {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  return useCallback(
    async (pluginId: string, path: string, init?: RequestInit) => {
      const baseUrl = await discoveryApi.getBaseUrl(pluginId);
      const suffix = path.startsWith('/') ? path : `/${path}`;

      // Do not forward a development persona header. Require the real identity
      // token for authorization. This prevents accidental RBAC bypasses.
      return fetchApi.fetch(`${baseUrl}${suffix}`, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
        },
      });
    },
    [discoveryApi, fetchApi],
  );
}
