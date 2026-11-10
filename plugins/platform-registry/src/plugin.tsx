import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { RegistryOverviewPage } from './components/RegistryOverviewPage';
import { PlatformsPage } from './components/TenantsPage';
import { PlatformDetailPage } from './components/TenantDetailPage';
import { CloudAccountsPage } from './components/CloudAccountsPage';
import { ClustersPage } from './components/ClustersPage';
import { NamespacesPage } from './components/NamespacesPage';
import { DeploymentTargetsPage } from './components/DeploymentTargetsPage';
import { ApplicationsPage } from './components/ApplicationsPage';
import { DeploymentsPage } from './components/DeploymentsPage';
import { OnboardingWizardPage } from './components/OnboardingWizardPage';
import { DiscoveryPage } from './components/DiscoveryPage';

const overviewPage = PageBlueprint.make({
  name: 'platform-registry-overview',
  params: {
    path: '/platform-registry',
    loader: async () => <RegistryOverviewPage />,
  },
});

const platformsPage = PageBlueprint.make({
  name: 'platform-registry-platforms',
  params: {
    path: '/platform-registry/platforms',
    loader: async () => <PlatformsPage />,
  },
});

const platformDetailPage = PageBlueprint.make({
  name: 'platform-registry-platform-detail',
  params: {
    path: '/platform-registry/platforms/:platformId',
    loader: async () => <PlatformDetailPage />,
  },
});

const cloudAccountsPage = PageBlueprint.make({
  name: 'platform-registry-cloud-accounts',
  params: {
    path: '/platform-registry/cloud-accounts',
    loader: async () => <CloudAccountsPage />,
  },
});

const clustersPage = PageBlueprint.make({
  name: 'platform-registry-clusters',
  params: {
    path: '/platform-registry/clusters',
    loader: async () => <ClustersPage />,
  },
});

const namespacesPage = PageBlueprint.make({
  name: 'platform-registry-namespaces',
  params: {
    path: '/platform-registry/namespaces',
    loader: async () => <NamespacesPage />,
  },
});

const deploymentTargetsPage = PageBlueprint.make({
  name: 'platform-registry-deployment-targets',
  params: {
    path: '/platform-registry/deployment-targets',
    loader: async () => <DeploymentTargetsPage />,
  },
});

const applicationsPage = PageBlueprint.make({
  name: 'platform-registry-applications',
  params: {
    path: '/platform-registry/applications',
    loader: async () => <ApplicationsPage />,
  },
});

const deploymentsPage = PageBlueprint.make({
  name: 'platform-registry-deployments',
  params: {
    path: '/platform-registry/deployments',
    loader: async () => <DeploymentsPage />,
  },
});

const onboardingPage = PageBlueprint.make({
  name: 'platform-registry-onboarding',
  params: {
    path: '/platform-registry/onboard',
    loader: async () => <OnboardingWizardPage />,
  },
});

const discoveryPage = PageBlueprint.make({
  name: 'platform-registry-discovery',
  params: {
    path: '/platform-registry/discovery',
    loader: async () => <DiscoveryPage />,
  },
});

export default createFrontendPlugin({
  pluginId: 'platform-registry',
  extensions: [
    overviewPage,
    platformsPage,
    platformDetailPage,
    cloudAccountsPage,
    clustersPage,
    namespacesPage,
    deploymentTargetsPage,
    applicationsPage,
    deploymentsPage,
    onboardingPage,
    discoveryPage,
  ],
});
