/*
 * Hi!
 *
 * Note that this is an EXAMPLE Backstage backend. Please check the README.
 *
 * Happy hacking!
 */

import { createBackend } from '@backstage/backend-defaults';
import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  createOAuthProviderFactory,
  authProvidersExtensionPoint,
} from '@backstage/plugin-auth-node';
import { microsoftAuthenticator } from '@backstage/plugin-auth-backend-module-microsoft-provider';
import dotenv from 'dotenv';
import { costAutomationPlugin } from './costAutomationPlugin';
import { provisioningPlugin } from './provisioningPlugin';
import { k8sHealthCheckPlugin } from './k8sHealthCheckPlugin';
import { symphonyMicrosoftSignInResolver } from './symphonyMicrosoftSignInResolver';

// Local dev convenience: load .env when present. In App Service, runtime env
// vars are already provided and take precedence over dotenv defaults.
dotenv.config();

if (!process.env.GITHUB_TOKEN && process.env.CLOUDHUB_GITHUB_TOKEN) {
  process.env.GITHUB_TOKEN = process.env.CLOUDHUB_GITHUB_TOKEN;
}
if (!process.env.GITHUB_ACTIONS_TOKEN && process.env.CLOUDHUB_GITHUB_TOKEN) {
  process.env.GITHUB_ACTIONS_TOKEN = process.env.CLOUDHUB_GITHUB_TOKEN;
}

const backend = createBackend();

// Serve the frontend statically only in production.
// In development, always use the frontend dev server (port 3000) for live local code reloading.
if (process.env.NODE_ENV !== 'development') {
  backend.add(import('@backstage/plugin-app-backend'));
}
backend.add(import('@backstage/plugin-proxy-backend'));

backend.add(import('@backstage/plugin-auth-backend'));
// Guest and GitHub auth providers are intentionally omitted. CloudHub sign-in
// is Entra ID only; the Microsoft resolver restricts access to symphonysensa.com.
backend.add(
  createBackendModule({
    pluginId: 'auth',
    moduleId: 'symphony-microsoft-provider',
    register(reg) {
      reg.registerInit({
        deps: { providers: authProvidersExtensionPoint },
        async init({ providers }) {
          providers.registerProvider({
            providerId: 'microsoft',
            factory: createOAuthProviderFactory({
              authenticator: microsoftAuthenticator,
              signInResolverFactories: {
                symphonySensaEmail: symphonyMicrosoftSignInResolver,
              },
            }),
          });
        },
      });
    },
  }),
);

// scaffolder plugin
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-github'));

// techdocs plugin
backend.add(import('@backstage/plugin-techdocs-backend'));

// auth providers already registered above

// catalog plugin
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'),
);
backend.add(import('@backstage/plugin-catalog-backend-module-msgraph'));

// See https://backstage.io/docs/features/software-catalog/configuration#subscribing-to-catalog-errors
backend.add(import('@backstage/plugin-catalog-backend-module-logs'));

// permission plugin
backend.add(import('@backstage/plugin-permission-backend'));
// CloudHub custom RBAC policy: Platform / PS / SRE persona enforcement.
// Denies guest/unmapped users by default. Set CLOUDHUB_STRICT_AUTH=false only
// for temporary local troubleshooting.
backend.add(import('./cloudhubPermissionPolicy'));

const disableSearch = process.env.CLOUDHUB_DISABLE_SEARCH === 'true';

if (!disableSearch) {
  // search plugin
  backend.add(import('@backstage/plugin-search-backend'));

  // search engine
  // See https://backstage.io/docs/features/search/search-engines
  backend.add(import('@backstage/plugin-search-backend-module-pg'));

  // search collators
  backend.add(import('@backstage/plugin-search-backend-module-catalog'));
  backend.add(import('@backstage/plugin-search-backend-module-techdocs'));
}

// kubernetes plugin
backend.add(import('@backstage/plugin-kubernetes-backend'));

// cost automation plugin
backend.add(costAutomationPlugin);
backend.add(provisioningPlugin);
backend.add(k8sHealthCheckPlugin);
backend.add(import('@internal/plugin-tenant-registry-backend'));
backend.add(import('@internal/plugin-deployment-control-plane-backend'));
backend.add(import('@internal/plugin-platform-registry-backend'));
backend.add(import('@internal/plugin-aks-health-backend'));
backend.add(import('@internal/plugin-data-export-hub-backend'));
backend.add(import('@internal/plugin-data-export-scheduler'));

backend.start();
