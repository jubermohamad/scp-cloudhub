type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Route = [Method, string, string];
type OpenApiOperation = Record<string, unknown>;
type OpenApiPaths = Record<string, Partial<Record<Method, OpenApiOperation>>>;
interface CloudHubOpenApiDocument {
  openapi: string;
  info: Record<string, string>;
  servers: Array<Record<string, string>>;
  tags: Array<Record<string, string>>;
  paths: OpenApiPaths;
  components: { securitySchemes: Record<string, Record<string, string>> };
}

const routes: Route[] = [
  ['get', '/summary', 'Platform registry summary'],
  ['get', '/platforms', 'List platforms'], ['get', '/platforms/{id}', 'Get platform'], ['get', '/platforms/{id}/detail', 'Get platform detail'],
  ['get', '/cloud-accounts', 'List cloud accounts'], ['get', '/environments', 'List environments'],
  ['get', '/clusters', 'List registered clusters'], ['get', '/clusters/onboarded', 'List onboarded clusters'], ['get', '/clusters/{id}', 'Get cluster'],
  ['get', '/namespaces', 'List namespaces'], ['get', '/deployment-targets', 'List deployment targets'], ['get', '/applications', 'List applications'],
  ['get', '/deployments', 'List deployments'], ['get', '/deployments/{id}', 'Get deployment'], ['get', '/deployments/{id}/events', 'List deployment events'],
  ['get', '/tenants', 'List tenants'], ['get', '/tenants/{id}', 'Get tenant'], ['get', '/customers', 'List customers'],
  ['post', '/platforms', 'Create platform'], ['post', '/cloud-accounts', 'Create cloud account'], ['post', '/environments', 'Create environment'],
  ['post', '/clusters', 'Create cluster'], ['post', '/namespaces', 'Create namespace'], ['post', '/deployment-targets', 'Create deployment target'],
  ['post', '/applications', 'Create application'], ['post', '/deployments', 'Create deployment'], ['post', '/tenants', 'Create tenant'],
  ['delete', '/platforms/{id}', 'Delete platform'], ['delete', '/cloud-accounts/{id}', 'Delete cloud account'], ['delete', '/environments/{id}', 'Delete environment'],
  ['delete', '/clusters/{id}', 'Delete cluster'], ['delete', '/namespaces/{id}', 'Delete namespace'], ['delete', '/deployment-targets/{id}', 'Delete deployment target'],
  ['delete', '/applications/{id}', 'Delete application'], ['delete', '/tenants/{id}', 'Delete tenant'],
  ['post', '/discovery/clusters', 'Discover tagged clusters'], ['post', '/discovery/preflight', 'Run discovery preflight'], ['post', '/discovery/import', 'Import discovered clusters'],
  ['post', '/onboarding/platform', 'Onboard platform'], ['get', '/health', 'Platform registry health'],
  ['get', '/argocd/status', 'Get Argo CD status'], ['post', '/argocd/sync', 'Sync Argo CD application'],
  ['get', '/clusters/deployable', 'List deployable clusters'], ['get', '/clusters/discover', 'Discover AKS clusters'], ['get', '/clusters/namespaces', 'List cluster namespaces'],
  ['get', '/resource-groups', 'List Azure resource groups'], ['get', '/subnets', 'List Azure subnets'], ['get', '/persona/permissions', 'Get persona permissions'],
  ['get', '/gpu-instances', 'List GPU instances'], ['get', '/gpu-instances/{id}', 'Get GPU instance'], ['get', '/gpu-instances/{id}/status', 'Get GPU instance status'],
  ['get', '/gpu-instances/options', 'Get GPU options'], ['get', '/gpu-instances/permissions', 'Get GPU permissions'], ['get', '/gpu-instances/vnets', 'List GPU VNets'], ['get', '/gpu-instances/network-options', 'List GPU subnets'],
  ['post', '/gpu-instances', 'Create GPU instance'], ['post', '/gpu-instances/quota-check', 'Check GPU quota'], ['post', '/gpu-instances/{id}/delete', 'Delete GPU instance'], ['post', '/gpu-instances/{id}/start', 'Start GPU instance'], ['post', '/gpu-instances/{id}/stop', 'Stop GPU instance'],
  ['get', '/test-vms', 'List test VMs'], ['get', '/test-vms/options', 'Get test VM options'], ['get', '/test-vms/{id}/status', 'Get test VM status'], ['post', '/test-vms', 'Create test VM'], ['delete', '/test-vms/{id}', 'Delete test VM'],
  ['get', '/deployments/options', 'Get deployment options'], ['get', '/deployments/approvals', 'List deployment approvals'], ['get', '/deployments/approvals/{id}', 'Get deployment approval'], ['get', '/deployments/approvals/permissions', 'Get approval permissions'],
  ['post', '/deployments/preview', 'Preview deployment'], ['post', '/deployments/approvals', 'Create deployment approval'], ['post', '/deployments/{id}/approve', 'Approve deployment'], ['post', '/deployments/{id}/reject', 'Reject deployment'], ['post', '/deployments/{id}/retry', 'Retry deployment'], ['post', '/deployments/{id}/rollback', 'Rollback deployment'], ['post', '/deployments/{id}/transition', 'Transition deployment'],
  ['get', '/pipelines/runs/{runId}', 'Get pipeline run'], ['get', '/pipelines/runs/{runId}/logs', 'Get pipeline logs'], ['post', '/pipelines/sri/deploy', 'Deploy SRI component'],
  ['post', '/infrastructure/provision', 'Provision infrastructure'], ['post', '/platform/deploy', 'Deploy platform'], ['post', '/overlays/deploy', 'Deploy customer overlay'], ['post', '/overlays/promote', 'Promote customer overlay'], ['post', '/overlays/rollback', 'Rollback customer overlay'],
  ['get', '/workspaces', 'List workspaces'], ['get', '/workspaces/{id}', 'Get workspace'], ['get', '/workspaces/options', 'Get workspace options'], ['get', '/workspaces/preflight', 'Run workspace preflight'], ['post', '/workspaces', 'Create workspace'], ['delete', '/workspaces/{id}', 'Delete workspace'], ['post', '/workspaces/{id}/start', 'Start workspace'], ['post', '/workspaces/{id}/stop', 'Stop workspace'], ['post', '/workspaces/{id}/resume', 'Resume workspace'],
  ['get', '/workspaces/{id}/audit-logs', 'List workspace audit logs'], ['get', '/workspaces/{id}/connection', 'Get workspace connection'], ['post', '/workspaces/{id}/connection/session', 'Create workspace session'], ['get', '/workspaces/{id}/deployments', 'List workspace deployments'], ['post', '/workspaces/{id}/deployments', 'Create workspace deployment'], ['get', '/workspaces/{id}/logs/stream', 'Stream workspace logs'],
];

function operation(method: Method, summary: string, tag: string, route: string): OpenApiOperation {
  const parameters = [...route.matchAll(/\{([^}]+)\}/g)].map(match => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  return {
    summary,
    operationId: `${method}_${summary.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    security: [{ backstageToken: [] }],
    tags: [tag],
    parameters,
    responses: {
      '200': { description: 'Successful response' },
      '202': { description: 'Accepted for asynchronous processing' },
      '400': { description: 'Invalid request' },
      '401': { description: 'Authentication required' },
      '403': { description: 'Access denied' },
      '500': { description: 'Server error' },
    },
  };
}

const paths: OpenApiPaths = {};
for (const [method, route, summary] of routes) {
  const plugin = route.startsWith('/platform') || route.startsWith('/cloud-accounts') || route.startsWith('/discovery') || route.startsWith('/onboarding') || route.startsWith('/summary') || route.startsWith('/applications') || route.startsWith('/clusters') || route.startsWith('/namespaces') || route.startsWith('/deployment-targets') || route.startsWith('/deployments') || route.startsWith('/environments') || route.startsWith('/tenants') || route.startsWith('/customers') ? 'platform-registry' : 'deployment-control-plane';
  const fullPath = `/api/${plugin}${route}`;
  paths[fullPath] ??= {};
  paths[fullPath]![method] = operation(method, summary, plugin, route);
}

const duplicateDeploymentRoutes: Route[] = [
  ['get', '/clusters/discover', 'Discover AKS clusters'],
  ['get', '/clusters/deployable', 'List deployable clusters'],
  ['get', '/clusters/namespaces', 'List cluster namespaces'],
  ['get', '/deployments/options', 'Get deployment options'],
  ['get', '/deployments/approvals', 'List deployment approvals'],
  ['get', '/deployments/approvals/{id}', 'Get deployment approval'],
  ['get', '/deployments/approvals/permissions', 'Get approval permissions'],
  ['post', '/deployments/preview', 'Preview deployment'],
  ['post', '/deployments/approvals', 'Create deployment approval'],
  ['post', '/deployments/{id}/approve', 'Approve deployment'],
  ['post', '/deployments/{id}/reject', 'Reject deployment'],
  ['post', '/deployments/{id}/retry', 'Retry deployment'],
  ['post', '/deployments/{id}/rollback', 'Rollback deployment'],
  ['post', '/deployments/{id}/transition', 'Transition deployment'],
];

for (const [method, route, summary] of duplicateDeploymentRoutes) {
  const fullPath = `/api/deployment-control-plane${route}`;
  paths[fullPath] ??= {};
  paths[fullPath]![method] = operation(method, summary, 'deployment-control-plane', route);
}

const tenantRegistryRoutes: Route[] = [
  ['get', '/tenants', 'List tenants'], ['post', '/tenants', 'Create tenant'], ['get', '/tenants/{id}', 'Get tenant'], ['delete', '/tenants/{id}', 'Delete tenant'],
  ['get', '/clusters/discover', 'Discover tenant clusters'], ['post', '/clusters/onboard', 'Onboard tenant clusters'], ['get', '/clusters', 'List tenant clusters'], ['get', '/clusters/{id}', 'Get tenant cluster'], ['delete', '/clusters/{id}', 'Delete tenant cluster'],
];

for (const [method, route, summary] of tenantRegistryRoutes) {
  const fullPath = `/api/tenant-registry${route}`;
  paths[fullPath] ??= {};
  paths[fullPath]![method] = operation(method, summary, 'tenant-registry', route);
}

const additionalDeploymentRoutes: Route[] = [
  ['get', '/health', 'Get deployment control-plane health'],
  ['post', '/clusters/register', 'Register cluster'],
  ['get', '/development-profiles', 'List development profiles'],
  ['get', '/development-profiles/{id}', 'Get development profile'],
  ['get', '/workspace-templates', 'List workspace templates'],
  ['post', '/webhooks/github/workflow-runs', 'Receive GitHub workflow event'],
  ['post', '/customers/discover-clusters', 'Discover customer clusters'],
  ['post', '/customers/onboard', 'Onboard customer'],
  ['post', '/clusters/onboard', 'Onboard cluster'],
  ['post', '/clusters/offboard', 'Offboard cluster'],
  ['get', '/history', 'Get deployment history'],
];

for (const [method, route, summary] of additionalDeploymentRoutes) {
  const fullPath = `/api/deployment-control-plane${route}`;
  paths[fullPath] ??= {};
  paths[fullPath]![method] = operation(method, summary, 'deployment-control-plane', route);
}

export const cloudHubOpenApiSpec: CloudHubOpenApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'CloudHub API',
    version: '0.9.0-beta.13',
    description: 'CloudHub control-plane, platform-registry, and deployment APIs. All endpoints require Backstage authentication unless explicitly noted.',
  },
  servers: [{ url: window.location.origin, description: 'Current CloudHub instance' }],
  tags: [
    { name: 'platform-registry', description: 'Platform inventory and tagged cluster discovery' },
    { name: 'deployment-control-plane', description: 'Infrastructure, deployment, GPU, workspace, and operational APIs' },
  ],
  paths,
  components: {
    securitySchemes: {
      backstageToken: { type: 'http', scheme: 'bearer', bearerFormat: 'Backstage token' },
    },
  },
};
