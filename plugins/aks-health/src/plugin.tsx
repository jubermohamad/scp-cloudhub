import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { AksHealthPage } from './pages/AksHealthPage';

export const aksHealthPage = PageBlueprint.make({
  name: 'aks-health',
  params: {
    path: '/health-check/aks',
    loader: async () => <AksHealthPage />,
  },
});

export const aksHealthPlugin = createFrontendPlugin({
  pluginId: 'aks-health',
  extensions: [aksHealthPage],
});

export default aksHealthPlugin;
