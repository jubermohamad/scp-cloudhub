import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { TenantOverlayManagerPage } from './components/TenantOverlayManagerPage';

const tenantOverlayManagerPage = PageBlueprint.make({
  name: 'tenant-overlay-manager',
  params: {
    path: '/tenant-overlay-manager',
    loader: async () => <TenantOverlayManagerPage />,
  },
});

export default createFrontendPlugin({
  pluginId: 'tenant-overlay-manager',
  extensions: [tenantOverlayManagerPage],
});
