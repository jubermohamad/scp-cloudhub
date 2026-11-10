import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { InfrastructureProvisioningPage } from './components/InfrastructureProvisioningPage';

const infrastructureProvisioningPage = PageBlueprint.make({
  name: 'infrastructure-provisioning',
  params: {
    path: '/infrastructure-provisioning',
    loader: async () => <InfrastructureProvisioningPage />,
  },
});

export default createFrontendPlugin({
  pluginId: 'infrastructure-provisioning',
  extensions: [infrastructureProvisioningPage],
});
