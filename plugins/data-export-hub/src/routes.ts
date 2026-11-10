export const HUB_ROOT = '/data-export-hub';
const HUB_DASHBOARD = '/dashboard';

export const hubPaths = {
  dashboard: HUB_DASHBOARD,
  exports: `${HUB_ROOT}/exports`,
  datasets: `${HUB_ROOT}/datasets`,
  datasetDetail: (id: string) =>
    `${HUB_ROOT}/datasets/${encodeURIComponent(id)}`,
  destinations: `${HUB_ROOT}/destinations`,
  executions: `${HUB_ROOT}/executions`,
  clusters: `${HUB_ROOT}/clusters`,
  agents: `${HUB_ROOT}/agents`,
  administration: `${HUB_ROOT}/administration`,
};

export type HubSection =
  | 'dashboard'
  | 'exports'
  | 'datasets'
  | 'destinations'
  | 'executions'
  | 'clusters'
  | 'agents'
  | 'administration';

export interface HubNavItem {
  key: HubSection;
  label: string;
  path: string;
  adminOnly?: boolean;
}

export const HUB_NAV: HubNavItem[] = [
  { key: 'exports', label: 'Exports', path: hubPaths.exports },
  { key: 'executions', label: 'Executions', path: hubPaths.executions },
  { key: 'clusters', label: 'Clusters', path: hubPaths.clusters },
  { key: 'agents', label: 'Agents', path: hubPaths.agents },
  {
    key: 'administration',
    label: 'Administration',
    path: hubPaths.administration,
    adminOnly: true,
  },
];

/** Which section a pathname belongs to (detail pages map to their list). */
export function sectionForPath(pathname: string): HubSection {
  if (pathname === HUB_DASHBOARD || pathname.startsWith(`${HUB_DASHBOARD}/`)) {
    return 'dashboard';
  }
  const rest = pathname.replace(/\/+$/, '').slice(HUB_ROOT.length);
  const first = rest.split('/').filter(Boolean)[0] as HubSection;
  if (
    [
      'exports',
      'datasets',
      'destinations',
      'executions',
      'clusters',
      'agents',
      'administration',
    ].includes(first)
  ) {
    return first;
  }
  return 'exports';
}
