// React-free subset of this package, for backend plugins. The root entry
// (./index) re-exports PersonaContext/useBackendFetch, which
// would pull React into a backend bundle.
//
// This file is a declared entry point in package.json (`exports`/
// `typesVersions`), so the build emits dist/backend.cjs.js and consumers
// import '@internal/plugin-platform-common/backend'. Never import it via a
// deep '/src/...' path — that resolves in dev but not in a built image, where
// only dist/ is shipped.
export {
  SRI_CATALOG_COMPONENTS,
  SRI_COMPONENTS,
  SRI_DEPLOYMENT_WORKFLOW_ID,
  SYMPHONYFS_SCRIPTS_SUPPORTED_APPS,
  getSriCatalogComponent,
  getSriComponent,
  isSymphonyFsScriptsSupportedApp,
  type SriCatalogComponentDefinition,
  type SriComponentDefinition,
  type SriDevelopmentProfileRef,
  type SriDeploymentTarget,
  type SriRepositoryRef,
  type SymphonyFsScriptsApp,
} from './sriDeploymentCatalog';

export {
  COMMON_RES_COMPONENTS,
  COMMON_RES_COMPONENT_CATEGORIES,
  buildCommonResOverrides,
  buildDefaultCommonResSelection,
  type CommonResComponent,
} from './commonResComponents';

export {
  NON_PROD_INGRESS_ZONE,
  PROD_INGRESS_ZONE,
  calculateIngressTarget,
  isProductionEnvironment,
  type IngressTarget,
} from './ingressUrl';

// Canonical AKS cluster request model (shared by /create/aks and the
// provisioning backend).
export * from './aksCluster';
export {
  CLOUDHUB_AZURE_CLIENT_ID,
  CLOUDHUB_AZURE_TENANT_ID,
  createCloudHubAzureCredential,
  type AzureCredentialDiagnostic,
  type AzureCredentialLogger,
} from './azureCredential';
