import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { Navigate } from 'react-router-dom';

const clusterRegistryPage = PageBlueprint.make({
  name: 'cluster-registry',
  params: {
    path: '/cluster-registry',
    loader: async () => <Navigate to="/tenant-environment-registry" replace />,
  },
});

export default createFrontendPlugin({
  pluginId: 'cluster-registry',
  extensions: [clusterRegistryPage],
});
