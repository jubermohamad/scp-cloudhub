import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { TenantEnvironmentRegistryPage } from './components/TenantEnvironmentRegistryPage';

const tenantEnvironmentRegistryPage = PageBlueprint.make({
  name: 'tenant-environment-registry',
  params: {
    path: '/tenant-environment-registry',
    loader: async () => <TenantEnvironmentRegistryPage />,
  },
});

export default createFrontendPlugin({
  pluginId: 'tenant-registry',
  extensions: [tenantEnvironmentRegistryPage],
});
