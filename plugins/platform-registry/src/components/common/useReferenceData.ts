import { useCallback, useEffect, useState } from 'react';
import type { createPlatformRegistryApi } from '../../api';

export type ReferenceKey =
  | 'platforms'
  | 'environments'
  | 'clusters'
  | 'cloudAccounts'
  | 'namespaces'
  | 'deploymentTargets'
  | 'applications';

export interface FieldOption {
  value: string;
  label: string;
}

type Api = ReturnType<typeof createPlatformRegistryApi>;

const LOADERS: Record<ReferenceKey, (api: Api) => Promise<FieldOption[]>> = {
  platforms: async api => {
    const r = await api.listPlatforms({ pageSize: 200 });
    return r.items.map(t => ({
      value: t.id,
      label: `${t.platformName} (${t.platformCode})`,
    }));
  },
  environments: async api => {
    const r = await api.listEnvironments({ pageSize: 200 });
    return r.items.map(e => ({
      value: e.id,
      label: `${e.platformName ? `${e.platformName} / ` : ''}${
        e.environmentName
      }`,
    }));
  },
  clusters: async api => {
    const r = await api.listClusters({ pageSize: 200 });
    return r.items.map(c => ({ value: c.id, label: c.clusterName }));
  },
  cloudAccounts: async api => {
    const r = await api.listCloudAccounts({ pageSize: 200 });
    return r.items.map(a => ({
      value: a.id,
      label: `${a.accountName} (${a.cloudProvider})`,
    }));
  },
  namespaces: async api => {
    const r = await api.listNamespaces({ pageSize: 200 });
    return r.items.map(n => ({
      value: n.id,
      label: `${n.clusterName ? `${n.clusterName} / ` : ''}${n.namespaceName}`,
    }));
  },
  deploymentTargets: async api => {
    const r = await api.listDeploymentTargets({ pageSize: 200 });
    return r.items.map(d => ({ value: d.id, label: d.targetName }));
  },
  applications: async api => {
    const r = await api.listApplications({ pageSize: 200 });
    return r.items.map(a => ({ value: a.id, label: a.applicationName }));
  },
};

export function useReferenceData(api: Api, keys: ReferenceKey[]) {
  const [data, setData] = useState<Record<string, FieldOption[]>>({});
  const [loading, setLoading] = useState(false);
  const keysSig = keys.join(',');

  const reload = useCallback(async () => {
    if (keys.length === 0) return;
    setLoading(true);
    try {
      const entries = await Promise.all(
        keys.map(async key => [key, await LOADERS[key](api)] as const),
      );
      setData(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, keysSig]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, reload };
}
