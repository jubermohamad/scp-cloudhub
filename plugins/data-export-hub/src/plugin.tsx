import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { Navigate } from 'react-router-dom';
import { hubPaths, HUB_ROOT } from './routes';

/*
 * One page extension per route. Pages are loaded on demand so heavy
 * dependencies (the data grid, the lineage graph) stay out of the main bundle.
 */

const hubRootPage = PageBlueprint.make({
  name: 'data-export-hub',
  params: {
    path: HUB_ROOT,
    loader: async () => <Navigate to={hubPaths.exports} replace />,
  },
});

const dashboardPage = PageBlueprint.make({
  name: 'data-export-dashboard',
  params: {
    path: hubPaths.dashboard,
    loader: () =>
      import('./components/dashboard/DashboardPage').then(m => (
        <m.DashboardPage />
      )),
  },
});

const exportsPage = PageBlueprint.make({
  name: 'data-export-hub-exports',
  params: {
    path: hubPaths.exports,
    loader: () =>
      import('./components/exports/ExportsPage').then(m => <m.ExportsPage />),
  },
});

const datasetsPage = PageBlueprint.make({
  name: 'data-export-hub-datasets',
  params: {
    path: hubPaths.datasets,
    loader: () =>
      import('./components/datasets/DatasetsPage').then(m => (
        <m.DatasetsPage />
      )),
  },
});

const datasetDetailPage = PageBlueprint.make({
  name: 'data-export-hub-dataset-detail',
  params: {
    path: `${hubPaths.datasets}/:id`,
    loader: () =>
      import('./components/datasets/DatasetDetailPage').then(m => (
        <m.DatasetDetailPage />
      )),
  },
});

const destinationsPage = PageBlueprint.make({
  name: 'data-export-hub-destinations',
  params: {
    path: hubPaths.destinations,
    loader: () =>
      import('./components/destinations/DestinationsPage').then(m => (
        <m.DestinationsPage />
      )),
  },
});

const executionsPage = PageBlueprint.make({
  name: 'data-export-hub-executions',
  params: {
    path: hubPaths.executions,
    loader: () =>
      import('./components/executions/ExecutionsPage').then(m => (
        <m.ExecutionsPage />
      )),
  },
});

const clustersPage = PageBlueprint.make({
  name: 'data-export-hub-clusters',
  params: {
    path: hubPaths.clusters,
    loader: () =>
      import('./components/clusters/ClustersPage').then(m => (
        <m.ClustersPage />
      )),
  },
});

const agentsPage = PageBlueprint.make({
  name: 'data-export-hub-agents',
  params: {
    path: hubPaths.agents,
    loader: () =>
      import('./components/agents/AgentsPage').then(m => <m.AgentsPage />),
  },
});

const administrationPage = PageBlueprint.make({
  name: 'data-export-hub-administration',
  params: {
    path: hubPaths.administration,
    loader: () =>
      import('./components/administration/AdministrationPage').then(m => (
        <m.AdministrationPage />
      )),
  },
});

export default createFrontendPlugin({
  pluginId: 'data-export-hub',
  extensions: [
    hubRootPage,
    dashboardPage,
    exportsPage,
    datasetsPage,
    datasetDetailPage,
    destinationsPage,
    executionsPage,
    clustersPage,
    agentsPage,
    administrationPage,
  ],
});
