export const SRI_DEPLOYMENT_WORKFLOW_ID = 'stage-2-deploy-component.yml';

// The app names currently managed by the CloudHub stage-based deploy flow.
// Components outside this list stay unavailable until their app path is wired
// in the platform repository's apps/ tree.
export const SYMPHONYFS_SCRIPTS_SUPPORTED_APPS = [
  'ai-store',
  'datadog',
  'common-res',
  'dxv',
  'detectionhub',
  'edb-common-res',
  'flows',
  'invhub',
  'netreveal',
  'netrevealv95',
  'netrevealv96',
  'edb-netrevealv96',
  'mtls-outbound',
  // 'sales-genie' is intentionally absent: no chart for it is bundled under
  // charts/, so CloudHub Native can only fail the deploy with "has no bundled
  // chart in this repository". Add it back together with its chart and its
  // entry in LOCAL_CHART_PATHS (helmfileTemplateService.ts).
  'sensaai-sanctions',
  'tailscale',
  'velero',
  'istio-service-entry',
  'hybrid-manager',
] as const;

export type SymphonyFsScriptsApp =
  (typeof SYMPHONYFS_SCRIPTS_SUPPORTED_APPS)[number];

const SYMPHONYFS_SCRIPTS_SUPPORTED_APPS_SET: Set<string> = new Set(
  SYMPHONYFS_SCRIPTS_SUPPORTED_APPS,
);

export function isSymphonyFsScriptsSupportedApp(
  application: string | null | undefined,
): boolean {
  return (
    Boolean(application) &&
    SYMPHONYFS_SCRIPTS_SUPPORTED_APPS_SET.has(application!)
  );
}

export interface SriRepositoryRef {
  provider: 'github';
  organization: string | null;
  name: string | null;
  url: string | null;
  defaultBranch: string | null;
}

export interface SriDevelopmentProfileRef {
  id: string;
  version: string;
}

export interface SriCatalogComponentDefinition {
  id: string;
  product: 'SRI' | 'NetReveal';
  domain: string;
  displayName: string;
  componentType:
    | 'api'
    | 'ui'
    | 'ai'
    | 'engine'
    | 'db'
    | 'pipeline'
    | 'service'
    | 'agent';
  language: {
    name: string;
  };
  runtime: {
    name: string;
    version: string | null;
  };
  developmentProfile: SriDevelopmentProfileRef;
  build?: {
    adapter: 'node' | 'python' | 'java' | 'scala' | 'database';
    dockerfile: string;
    context: string;
  };
  repository: SriRepositoryRef;
  deployment: {
    type: 'kubernetes';
    packaging?: 'helm';
    branchPolicy?: {
      allowedBranches: string[];
    };
    service?: {
      port?: number;
      targetPort?: number;
    };
    health?: {
      readinessPath?: string;
      livenessPath?: string;
    };
    workflowId?: string;
  };
  dependencies: string[];
  owner: {
    team: string;
  };
  status: 'active' | 'deprecated' | 'disabled';
}

export interface SriDeploymentTarget {
  workflow: string;
  application: string | null;
  supported: boolean;
}

export interface SriComponentDefinition {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  tag: string;
  gradient: string;
  deployment: SriDeploymentTarget;
}

const UNCONFIGURED_GITHUB_REPOSITORY: SriRepositoryRef = {
  provider: 'github',
  organization: null,
  name: null,
  url: null,
  defaultBranch: null,
};

export const SRI_CATALOG_COMPONENTS: SriCatalogComponentDefinition[] = [
  {
    id: 'sri-investigation-api',
    product: 'SRI',
    domain: 'Investigation',
    displayName: 'SRI Investigation - APIs',
    componentType: 'api',
    language: { name: 'TypeScript' },
    runtime: { name: 'Node.js', version: null },
    developmentProfile: { id: 'node-api', version: 'v1' },
    build: {
      adapter: 'node',
      dockerfile: 'Dockerfile',
      context: '.',
    },
    repository: UNCONFIGURED_GITHUB_REPOSITORY,
    deployment: {
      type: 'kubernetes',
      packaging: 'helm',
      branchPolicy: {
        allowedBranches: ['main'],
      },
      service: {
        port: 80,
        targetPort: 8080,
      },
      health: {
        readinessPath: '/health/ready',
        livenessPath: '/health/live',
      },
      workflowId: 'deploy-dev.yml',
    },
    dependencies: [],
    owner: { team: 'sri-investigation' },
    status: 'active',
  },
  {
    id: 'sri-investigation-ui',
    product: 'SRI',
    domain: 'Investigation',
    displayName: 'SRI Investigation - UI',
    componentType: 'ui',
    language: { name: 'TypeScript' },
    runtime: { name: 'React', version: null },
    developmentProfile: { id: 'react-ui', version: 'v1' },
    repository: UNCONFIGURED_GITHUB_REPOSITORY,
    deployment: { type: 'kubernetes' },
    dependencies: ['sri-investigation-api'],
    owner: { team: 'sri-investigation' },
    status: 'active',
  },
  {
    id: 'sri-investigation-ai',
    product: 'SRI',
    domain: 'Investigation',
    displayName: 'SRI Investigation - AI/Copilot',
    componentType: 'ai',
    language: { name: 'Python' },
    runtime: { name: 'Python', version: null },
    developmentProfile: { id: 'python-ai', version: 'v1' },
    repository: UNCONFIGURED_GITHUB_REPOSITORY,
    deployment: { type: 'kubernetes' },
    dependencies: ['sri-investigation-api'],
    owner: { team: 'sri-investigation' },
    status: 'active',
  },
  {
    id: 'sri-detection-api',
    product: 'SRI',
    domain: 'Detection',
    displayName: 'SRI Detection - APIs',
    componentType: 'api',
    language: { name: 'Java' },
    runtime: { name: 'Spring Boot', version: null },
    developmentProfile: { id: 'java-springboot', version: 'v1' },
    repository: UNCONFIGURED_GITHUB_REPOSITORY,
    deployment: { type: 'kubernetes' },
    dependencies: ['sri-detection-db'],
    owner: { team: 'sri-detection' },
    status: 'active',
  },
  {
    id: 'sri-detection-engine',
    product: 'SRI',
    domain: 'Detection',
    displayName: 'SRI Detection - Engines',
    componentType: 'engine',
    language: { name: 'Scala' },
    runtime: { name: 'Spark', version: null },
    developmentProfile: { id: 'scala-spark', version: 'v1' },
    repository: UNCONFIGURED_GITHUB_REPOSITORY,
    deployment: { type: 'kubernetes' },
    dependencies: ['sri-detection-api', 'sri-detection-db'],
    owner: { team: 'sri-detection' },
    status: 'active',
  },
  {
    id: 'sri-detection-ui',
    product: 'SRI',
    domain: 'Detection',
    displayName: 'SRI Detection - UI',
    componentType: 'ui',
    language: { name: 'TypeScript' },
    runtime: { name: 'React', version: null },
    developmentProfile: { id: 'react-ui', version: 'v1' },
    repository: UNCONFIGURED_GITHUB_REPOSITORY,
    deployment: { type: 'kubernetes' },
    dependencies: ['sri-detection-api'],
    owner: { team: 'sri-detection' },
    status: 'active',
  },
  {
    id: 'sri-detection-db',
    product: 'SRI',
    domain: 'Detection',
    displayName: 'SRI Detection - DB',
    componentType: 'db',
    language: { name: 'PL/pgSQL / Java' },
    runtime: { name: 'PostgreSQL', version: null },
    developmentProfile: { id: 'postgres-db', version: 'v1' },
    repository: UNCONFIGURED_GITHUB_REPOSITORY,
    deployment: { type: 'kubernetes' },
    dependencies: [],
    owner: { team: 'sri-detection' },
    status: 'active',
  },
  {
    id: 'sri-data-pipeline',
    product: 'SRI',
    domain: 'Data',
    displayName: 'SRI Data - Pipelines',
    componentType: 'pipeline',
    language: { name: 'Python' },
    runtime: { name: 'Python', version: null },
    developmentProfile: { id: 'python-data', version: 'v1' },
    repository: UNCONFIGURED_GITHUB_REPOSITORY,
    deployment: { type: 'kubernetes' },
    dependencies: [],
    owner: { team: 'sri-data' },
    status: 'active',
  },
  {
    id: 'sri-sanctions',
    product: 'SRI',
    domain: 'Sanctions',
    displayName: 'SRI Sanctions',
    componentType: 'service',
    language: { name: 'Python' },
    runtime: { name: 'Python', version: null },
    developmentProfile: { id: 'python-service', version: 'v1' },
    repository: UNCONFIGURED_GITHUB_REPOSITORY,
    deployment: { type: 'kubernetes' },
    dependencies: [],
    owner: { team: 'sri-sanctions' },
    status: 'active',
  },
  {
    id: 'sri-agents',
    product: 'SRI',
    domain: 'Agents',
    displayName: 'SRI Agents',
    componentType: 'agent',
    language: { name: 'Python' },
    runtime: { name: 'Python', version: null },
    developmentProfile: { id: 'python-agent', version: 'v1' },
    repository: UNCONFIGURED_GITHUB_REPOSITORY,
    deployment: { type: 'kubernetes' },
    dependencies: ['sri-data-pipeline'],
    owner: { team: 'sri-agents' },
    status: 'active',
  },
];

// Builds a deployment target for the supported stage-based deployment pipeline
// (stage-2-deploy-component.yml in jubermohamad/platform_cloudhub). `supported`
// is derived from the appName whitelist so a component can never be marked
// deployable unless the platform repository supports that app path.
function scriptsDeploymentTarget(application: string): SriDeploymentTarget {
  return {
    workflow: SRI_DEPLOYMENT_WORKFLOW_ID,
    application,
    supported: isSymphonyFsScriptsSupportedApp(application),
  };
}

export const SRI_COMPONENTS: SriComponentDefinition[] = [
  {
    id: 'common-res',
    title: 'Common Resources',
    subtitle: 'Shared Cluster Infrastructure',
    description:
      'Deploy the shared common-res Helm chart (operators, controllers and cluster services) that all SAI applications depend on.',
    tag: 'Shared Infrastructure',
    gradient: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
    deployment: scriptsDeploymentTarget('common-res'),
  },
  {
    id: 'sri-investigation',
    title: 'SRI Investigation',
    subtitle: 'AI-Powered Case Management',
    description:
      'AI-powered case management UI with Copilot, disclosures, and agentic workflows.',
    tag: 'Investigation',
    gradient: 'linear-gradient(135deg, #4a148c 0%, #6a1b9a 100%)',
    deployment: scriptsDeploymentTarget('invhub'),
  },
  {
    id: 'sri-detection',
    title: 'SRI Detection',
    subtitle: 'Model & Detection Management',
    description:
      'Model management, Spark-based batch/streaming detection, and Superset analytics.',
    tag: 'Detection',
    gradient: 'linear-gradient(135deg, #e65100 0%, #ef6c00 100%)',
    deployment: scriptsDeploymentTarget('detectionhub'),
  },
  {
    id: 'sri-data',
    title: 'SRI Data',
    subtitle: 'Data Platform',
    description:
      'Entity resolution (ER-API), data ingestion/egress, and Iceberg data lake management.',
    tag: 'Data',
    gradient: 'linear-gradient(135deg, #37474f 0%, #546e7a 100%)',
    deployment: scriptsDeploymentTarget('flows'),
  },
  {
    id: 'netreveal-v96',
    title: 'NetReveal v9.6',
    subtitle: 'Financial Crime Detection Platform',
    description:
      'Latest NetReveal release with EDB PostgreSQL support and active-active DR.',
    tag: 'Core Platform',
    gradient: 'linear-gradient(135deg, #0d47a1 0%, #1565c0 100%)',
    deployment: scriptsDeploymentTarget('netrevealv96'),
  },
  {
    id: 'ai-store',
    title: 'AIStore',
    subtitle: 'AI Model & Data Store',
    description:
      'Deploy AIStore for AI model storage and retrieval operations across your Kubernetes clusters.',
    tag: 'Data Storage',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    deployment: scriptsDeploymentTarget('ai-store'),
  },
  {
    id: 'flows',
    title: 'Eureka Flows',
    subtitle: 'Workflow Orchestration',
    description:
      'Shared workflow orchestration platform (Temporal-based) powering Data, Detection, and Agents.',
    tag: 'Orchestration',
    gradient: 'linear-gradient(135deg, #006064 0%, #00838f 100%)',
    deployment: scriptsDeploymentTarget('flows'),
  },
  {
    id: 'sensaai-sanctions',
    title: 'SensaAI Sanctions',
    subtitle: 'Sanctions Screening Engine',
    description:
      'Real-time and batch sanctions screening engine with watchlist management.',
    tag: 'Compliance',
    gradient: 'linear-gradient(135deg, #b71c1c 0%, #c62828 100%)',
    deployment: scriptsDeploymentTarget('sensaai-sanctions'),
  },
  {
    id: 'hybrid-manager',
    title: 'EDB Hybrid Manager',
    subtitle: 'PostgreSQL Cluster Management',
    description:
      'PostgreSQL cluster management console for database provisioning, backup, and DR.',
    tag: 'Database',
    gradient: 'linear-gradient(135deg, #1b5e20 0%, #2e7d32 100%)',
    deployment: scriptsDeploymentTarget('hybrid-manager'),
  },
  {
    id: 'sri-agents',
    title: 'SRI Agents',
    subtitle: 'Agentic AI Workflows',
    description:
      'Agentic AI workflows (Temporal-based) for automated investigation and decision-making.',
    tag: 'AI Agents',
    gradient: 'linear-gradient(135deg, #880e4f 0%, #ad1457 100%)',
    deployment: scriptsDeploymentTarget('sales-genie'),
  },
  {
    id: 'netreveal',
    title: 'NetReveal',
    subtitle: 'Core Engine',
    description:
      'NetReveal application runtime utilizing OpenJDK 21, WildFly 37, PostgreSQL 17, and Kafka 4.0.',
    tag: 'Core Platform',
    gradient: 'linear-gradient(135deg, #1a237e 0%, #3949ab 100%)',
    deployment: scriptsDeploymentTarget('netreveal'),
  },
  {
    id: 'datadog',
    title: 'Datadog',
    subtitle: 'Observability & Monitoring',
    description:
      'Deploy Datadog cluster agents and node agents for metrics, logs, APM, and custom endpoint monitoring across the cluster.',
    tag: 'Observability',
    gradient: 'linear-gradient(135deg, #4c2889 0%, #7c3aed 100%)',
    deployment: scriptsDeploymentTarget('datadog'),
  },
  {
    id: 'velero',
    title: 'Velero',
    subtitle: 'Backup & Disaster Recovery',
    description:
      'Deploy the Velero operator with Azure Blob backup targets, snapshotters, and scheduled backups for cluster disaster recovery.',
    tag: 'Resilience',
    gradient: 'linear-gradient(135deg, #134e4a 0%, #0d9488 100%)',
    deployment: scriptsDeploymentTarget('velero'),
  },
  {
    id: 'tailscale',
    title: 'Tailscale',
    subtitle: 'Mesh VPN & Subnet Router',
    description:
      'Deploy the Tailscale operator and SCP subnet router (Connector/ProxyClass) for secure jumpbox and cluster access.',
    tag: 'Networking',
    gradient: 'linear-gradient(135deg, #1f2937 0%, #4b5563 100%)',
    deployment: scriptsDeploymentTarget('tailscale'),
  },
  {
    id: 'dxv',
    title: 'DXV',
    subtitle: 'Data eXchange & Visualization',
    description:
      'Deploy the Data eXchange & Visualization application with automated namespace provisioning and pre-flight cluster validation.',
    tag: 'Data',
    gradient: 'linear-gradient(135deg, #7c2d12 0%, #c2410c 100%)',
    deployment: scriptsDeploymentTarget('dxv'),
  },
];

export function getSriComponent(
  componentId: string,
): SriComponentDefinition | undefined {
  return SRI_COMPONENTS.find(component => component.id === componentId);
}

export function getSriCatalogComponent(
  componentId: string,
): SriCatalogComponentDefinition | undefined {
  return SRI_CATALOG_COMPONENTS.find(component => component.id === componentId);
}
