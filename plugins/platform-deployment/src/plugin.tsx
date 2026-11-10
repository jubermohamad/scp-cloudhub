import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { PlatformDeploymentPage } from './components/PlatformDeploymentPage';

const platformDeploymentPage = PageBlueprint.make({
  name: 'platform-deployment',
  params: {
    path: '/platform-deployment',
    loader: async () => <PlatformDeploymentPage />,
  },
});

export default createFrontendPlugin({
  pluginId: 'platform-deployment',
  extensions: [platformDeploymentPage],
});
