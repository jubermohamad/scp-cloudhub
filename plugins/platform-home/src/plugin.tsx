import { createFrontendPlugin } from '@backstage/frontend-plugin-api';
import { Navigate } from 'react-router-dom';
import { PageBlueprint } from '@backstage/frontend-plugin-api';
import { PlatformHomePage } from './components/PlatformHomePage';
import { CloudProviderPage } from './components/CloudProviderPage';
import { AksCostAutomationOnboardPage } from './components/AksCostAutomationOnboardPage';
import { AksLifecycleManagerPage } from './components/AksLifecycleManagerPage';
import { CostOptimizationPage } from './components/CostOptimizationPage';
import { CostOptimizationAzurePage } from './components/CostOptimizationAzurePage';
import { SriDeploymentHubPage } from './components/SriDeploymentHubPage';
import { SriDeployWizardPage } from './components/SriDeployWizardPage';
import { Stage1ClusterPage } from './components/Stage1ClusterPage';
import { Stage2DeployPage } from './components/Stage2DeployPage';
import { Stage3OverlayPage } from './components/Stage3OverlayPage';
import { NewAppPage } from './components/NewAppPage';
import { AdminSettingsPage } from './components/AdminSettingsPage';
import { UserSettingsPage } from './components/UserSettingsPage';
import { DocumentationPage } from './components/DocumentationPage';
import { AksWorkflowPage } from './components/AksWorkflowPage';
import { DeploymentPage } from './components/DeploymentPage';
import { EngToolsPage } from './components/EngToolsPage';
import { GpuComputePage } from './components/gpu-compute/GpuComputePage';
import { CreateGpuInstancePage } from './components/gpu-compute/CreateGpuInstancePage';
import { GpuAccessGate } from './components/gpu-compute/GpuAccessGate';
import { ApiDocumentationPage } from './components/ApiDocumentationPage';
import { CloudHubSearchPage } from './components/CloudHubSearchPage';
import { InfrastructurePage } from './components/InfrastructurePage';
import { CreateTestVmPage } from './components/CreateTestVmPage';
import { PendingApprovalsPage } from './components/PendingApprovalsPage';
import { GitOpsPage } from './components/GitOpsPage';
import { usePersona } from '@internal/plugin-platform-common';

function PersonaGate({
  allowed,
  resource,
  children,
}: {
  allowed: string[];
  resource: string;
  children: React.ReactNode;
}) {
  const { persona } = usePersona();
  if (!allowed.includes(persona)) {
    return (
      <div style={{ padding: 24 }}>
        <h2>Access Restricted</h2>
        <p>
          Your current persona does not have permission to view {resource}.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

const platformHomePage = PageBlueprint.make({
  name: 'home',
  params: {
    path: '/',
    loader: async () => <PlatformHomePage />,
  },
});

const cloudProviderPage = PageBlueprint.make({
  name: 'cloud-provider',
  params: {
    path: '/cloud/:providerId',
    loader: async () => <CloudProviderPage />,
  },
});

const infrastructurePage = PageBlueprint.make({
  name: 'infrastructure',
  params: {
    path: '/infrastructure',
    loader: async () => <InfrastructurePage />,
  },
});

const createTestVmPage = PageBlueprint.make({
  name: 'test-vm-create',
  params: {
    path: '/infrastructure/test-vm/create',
    loader: async () => <CreateTestVmPage />,
  },
});

const aksCostAutomationOnboardPage = PageBlueprint.make({
  name: 'aks-cost-automation-onboard',
  params: {
    path: '/cost-optimization/azure/aks-cost-automation/onboard',
    loader: async () => <AksCostAutomationOnboardPage />,
  },
});

const aksLifecycleManagerPage = PageBlueprint.make({
  name: 'aks-cost-automation-managed',
  params: {
    path: '/cost-optimization/azure/aks-cost-automation/managed',
    loader: async () => <AksLifecycleManagerPage />,
  },
});

const costOptimizationPage = PageBlueprint.make({
  name: 'cost-optimization',
  params: {
    path: '/cost-optimization',
    loader: async () => <CostOptimizationPage />,
  },
});

const costOptimizationAzurePage = PageBlueprint.make({
  name: 'cost-optimization-azure',
  params: {
    path: '/cost-optimization/azure',
    loader: async () => <CostOptimizationAzurePage />,
  },
});

const sriPage = PageBlueprint.make({
  name: 'sri',
  params: {
    path: '/sri',
    loader: async () => <SriDeploymentHubPage variant="sri" />,
  },
});

const commonResourcesPage = PageBlueprint.make({
  name: 'common-resources',
  params: {
    path: '/common-resources',
    loader: async () => <SriDeploymentHubPage variant="common-resources" />,
  },
});

const netRevealPage = PageBlueprint.make({
  name: 'deploy-netreveal',
  params: {
    path: '/deploy-netreveal',
    loader: async () => <SriDeploymentHubPage variant="netreveal" />,
  },
});

const sriDeployPage = PageBlueprint.make({
  name: 'sri-deploy',
  params: {
    path: '/sri/deploy/:componentId',
    loader: async () => <SriDeployWizardPage />,
  },
});

// The wizard needs a component; a bare /sri/deploy (bookmarks, shared links)
// goes back to the catalog to pick one.
const sriDeployIndexPage = PageBlueprint.make({
  name: 'sri-deploy-index',
  params: {
    path: '/sri/deploy',
    loader: async () => <Navigate to="/sri" replace />,
  },
});

// ── Three-stage pipeline pages ──────────────────────────────────────────────

const pipelineOverviewPage = PageBlueprint.make({
  name: 'deployment',
  params: {
    path: '/deployment',
    loader: async () => (
      <PersonaGate
        allowed={[
          'cloudhub-platform',
          'app-engineering',
          'professional-services',
        ]}
        resource="Deployment"
      >
        <DeploymentPage />
      </PersonaGate>
    ),
  },
});

const stage1Page = PageBlueprint.make({
  name: 'deployment-stage-1',
  params: {
    path: '/deployment/stage/1',
    loader: async () => <Stage1ClusterPage />,
  },
});

const stage2Page = PageBlueprint.make({
  name: 'deployment-stage-2',
  params: {
    path: '/deployment/stage/2',
    loader: async () => <Stage2DeployPage />,
  },
});

const stage3Page = PageBlueprint.make({
  name: 'deployment-stage-3',
  params: {
    path: '/deployment/stage/3',
    loader: async () => <Stage3OverlayPage />,
  },
});

const adminSettingsPage = PageBlueprint.make({
  name: 'admin-settings',
  params: {
    path: '/admin-settings',
    loader: async () => <AdminSettingsPage />,
  },
});

const userSettingsPage = PageBlueprint.make({
  name: 'user-settings',
  params: {
    path: '/settings',
    loader: async () => <UserSettingsPage />,
  },
});

const documentationPage = PageBlueprint.make({
  name: 'documentation',
  params: {
    path: '/documentation',
    loader: async () => <DocumentationPage />,
  },
});

const apiDocumentationPage = PageBlueprint.make({
  name: 'api-documentation',
  params: {
    path: '/api-docs',
    loader: async () => <ApiDocumentationPage />,
  },
});

const cloudHubSearchPage = PageBlueprint.make({
  name: 'cloudhub-search',
  params: {
    path: '/search',
    loader: async () => <CloudHubSearchPage />,
  },
});

const aksWorkflowPage = PageBlueprint.make({
  name: 'aks-workflow',
  params: {
    path: '/create/aks',
    loader: async () => (
      <PersonaGate
        allowed={['cloudhub-platform', 'app-engineering', 'professional-services']}
        resource="Create AKS Cluster"
      >
        <AksWorkflowPage />
      </PersonaGate>
    ),
  },
});

const engToolsPage = PageBlueprint.make({
  name: 'eng-tools',
  params: {
    path: '/eng-tools',
    loader: async () => <EngToolsPage />,
  },
});

const gpuComputePage = PageBlueprint.make({
  name: 'gpu-compute',
  params: {
    path: '/gpu-compute',
    loader: async () => (
      <GpuAccessGate>
        <GpuComputePage />
      </GpuAccessGate>
    ),
  },
});

const createGpuInstancePage = PageBlueprint.make({
  name: 'gpu-compute-create',
  params: {
    path: '/gpu-compute/create',
    loader: async () => (
      <GpuAccessGate>
        <CreateGpuInstancePage />
      </GpuAccessGate>
    ),
  },
});

const pendingApprovalsPage = PageBlueprint.make({
  name: 'pending-approvals',
  params: {
    path: '/approvals',
    loader: async () => (
      <PersonaGate allowed={['cloudhub-platform']} resource="Pending Approvals">
        <PendingApprovalsPage />
      </PersonaGate>
    ),
  },
});

const gitOpsPage = PageBlueprint.make({
  name: 'gitops',
  params: {
    path: '/gitops',
    loader: async () => (
      <PersonaGate
        allowed={['cloudhub-platform', 'app-engineering', 'sre']}
        resource="GitOps"
      >
        <GitOpsPage />
      </PersonaGate>
    ),
  },
});

export default createFrontendPlugin({
  pluginId: 'platform-home',
  extensions: [
    platformHomePage,
    cloudProviderPage,
    infrastructurePage,
    createTestVmPage,
    aksCostAutomationOnboardPage,
    aksLifecycleManagerPage,
    costOptimizationPage,
    costOptimizationAzurePage,
    sriPage,
    commonResourcesPage,
    netRevealPage,
    sriDeployIndexPage,
    sriDeployPage,
    pipelineOverviewPage,
    // New App page
    PageBlueprint.make({
      name: 'new-app',
      params: {
        path: '/new-app',
        loader: async () => <NewAppPage />,
      },
    }),
    stage1Page,
    stage2Page,
    stage3Page,
    adminSettingsPage,
    userSettingsPage,
    documentationPage,
    apiDocumentationPage,
    cloudHubSearchPage,
    aksWorkflowPage,
    engToolsPage,
    gpuComputePage,
    createGpuInstancePage,
    pendingApprovalsPage,
    gitOpsPage,
  ],
});
