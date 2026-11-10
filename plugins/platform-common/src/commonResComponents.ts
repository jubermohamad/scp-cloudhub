/**
 * common-res component catalog — single source of truth shared between the
 * frontend deploy checklist and the backend pipeline dispatch.
 *
 * `common-res` is a shared Helm chart whose sub-charts are toggled through Helm
 * values (`<component>.enabled`, `tags.*`, `global.nrSubChartSwitches.*`). The
 * `helmKey` on each entry is the Helm value path that enables/disables that
 * component, so the UI selection can be translated into `helm --set` overrides.
 */

export interface CommonResComponent {
  /** Stable identifier used by the UI and the deploy payload. */
  id: string;
  /** Human-readable component name. */
  name: string;
  /** Grouping used for display in the deploy checklist. */
  category: string;
  /** Short description shown next to the checkbox. */
  description: string;
  /** Default `enabled` state, mirroring the common-res chart values. */
  defaultEnabled: boolean;
  /**
   * Helm value path that toggles this component. Multiple components may share
   * a key (e.g. tracing operators share `tags.traces`); the override builder
   * OR-combines shared keys.
   */
  helmKey: string;
}

export const COMMON_RES_COMPONENT_CATEGORIES = [
  'Operators / Controllers',
  'Cluster Services',
  'Observability',
] as const;

export const COMMON_RES_COMPONENTS: CommonResComponent[] = [
  {
    id: 'cert-manager',
    name: 'cert-manager',
    category: 'Operators / Controllers',
    description: 'X.509 certificate management, issuance and renewal.',
    defaultEnabled: true,
    helmKey: 'cert-manager.enabled',
  },
  {
    id: 'cloudnative-pg',
    name: 'CloudNativePG',
    category: 'Operators / Controllers',
    description: 'PostgreSQL operator for provisioning and managing databases.',
    defaultEnabled: true,
    helmKey: 'cloudnative-pg.enabled',
  },
  {
    id: 'strimzi-kafka-operator',
    name: 'Strimzi (Kafka)',
    category: 'Operators / Controllers',
    description: 'Apache Kafka operator (supports Kafka 3.8.0).',
    defaultEnabled: true,
    helmKey: 'strimzi-kafka-operator.enabled',
  },
  {
    id: 'minio-operator',
    name: 'MinIO Operator',
    category: 'Operators / Controllers',
    description: 'S3-compatible object storage operator.',
    defaultEnabled: true,
    helmKey: 'minio-operator.enabled',
  },
  {
    id: 'reloader',
    name: 'Reloader',
    category: 'Operators / Controllers',
    description: 'Auto-restarts workloads on ConfigMap/Secret changes.',
    defaultEnabled: true,
    helmKey: 'reloader.enabled',
  },
  {
    id: 'ingress-nginx',
    name: 'ingress-nginx',
    category: 'Operators / Controllers',
    description: 'NGINX ingress controller for HTTP/S routing.',
    defaultEnabled: false,
    helmKey: 'ingress-nginx.enabled',
  },
  {
    id: 'edb-postgres-distributed-for-kubernetes',
    name: 'EDB Postgres Distributed',
    category: 'Operators / Controllers',
    description: 'EDB distributed PostgreSQL operator for active-active DR.',
    defaultEnabled: false,
    helmKey: 'edb-postgres-distributed-for-kubernetes.enabled',
  },
  {
    id: 'scupper-operator',
    name: 'Skupper Operator',
    category: 'Operators / Controllers',
    description: 'Multi-cluster L7 service networking.',
    defaultEnabled: false,
    helmKey: 'scupper-operator.enabled',
  },
  {
    id: 'storageclass',
    name: 'Storage Classes',
    category: 'Cluster Services',
    description: 'Azure NetApp Files, File NFS and XFS SSD storage classes.',
    defaultEnabled: true,
    helmKey: 'storageclass.enabled',
  },
  {
    id: 'cluster-issuers',
    name: 'Cluster Issuers',
    category: 'Cluster Services',
    description: 'cert-manager ClusterIssuer resources for TLS.',
    defaultEnabled: true,
    helmKey: 'cluster-issuers.enabled',
  },
  {
    id: 'argo-workflows',
    name: 'Argo Workflows',
    category: 'Cluster Services',
    description: 'Workflow engine required for Entity Resolution (ER).',
    defaultEnabled: false,
    helmKey: 'global.nrSubChartSwitches.enableER',
  },
  {
    id: 'kube-prometheus',
    name: 'Prometheus',
    category: 'Observability',
    description: 'Prometheus metrics stack.',
    defaultEnabled: false,
    helmKey: 'tags.metrics',
  },
  {
    id: 'opentelemetry-operator',
    name: 'OpenTelemetry',
    category: 'Observability',
    description: 'OpenTelemetry operator for distributed traces.',
    defaultEnabled: false,
    helmKey: 'tags.traces',
  },
  {
    id: 'jaeger-operator',
    name: 'Jaeger',
    category: 'Observability',
    description:
      'Jaeger distributed tracing backend (requires traces enabled).',
    defaultEnabled: false,
    helmKey: 'tags.traces',
  },
];

/** Default selection map derived from each component's `defaultEnabled`. */
export function buildDefaultCommonResSelection(): Record<string, boolean> {
  return COMMON_RES_COMPONENTS.reduce<Record<string, boolean>>(
    (acc, component) => {
      acc[component.id] = component.defaultEnabled;
      return acc;
    },
    {},
  );
}

/**
 * Translate a set of selected component ids into a deterministic, deduplicated
 * `helm --set` override string of the form `key=value;key=value`.
 *
 * Keys shared by multiple components (e.g. `tags.traces`) are OR-combined: the
 * key is `true` when at least one component using it is selected. The UI
 * selection is authoritative, so unselected keys are explicitly set to `false`.
 */
export function buildCommonResOverrides(selectedIds: string[]): string {
  const selected = new Set(selectedIds);
  const keyState = new Map<string, boolean>();

  for (const component of COMMON_RES_COMPONENTS) {
    const isOn = selected.has(component.id);
    keyState.set(
      component.helmKey,
      (keyState.get(component.helmKey) ?? false) || isOn,
    );
  }

  return Array.from(keyState.entries())
    .map(([key, value]) => `${key}=${value ? 'true' : 'false'}`)
    .join(';');
}
