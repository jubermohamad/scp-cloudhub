import { createApp } from '@backstage/frontend-defaults';
import { ConfigReader, type AppConfig } from '@backstage/config';
import {
  SignInPageBlueprint,
  ThemeBlueprint,
  IconBundleBlueprint,
} from '@backstage/plugin-app-react';
import { UnifiedThemeProvider } from '@backstage/theme';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import ApartmentIcon from '@mui/icons-material/Apartment';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';
import CategoryIcon from '@mui/icons-material/Category';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import SubjectIcon from '@mui/icons-material/Subject';
import SearchIcon from '@mui/icons-material/Search';
import ChatIcon from '@mui/icons-material/Chat';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DescriptionIcon from '@mui/icons-material/Description';
import EmailIcon from '@mui/icons-material/Email';
import ExtensionIcon from '@mui/icons-material/Extension';
import GitHubIcon from '@mui/icons-material/GitHub';
import HelpIcon from '@mui/icons-material/Help';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import MemoryIcon from '@mui/icons-material/Memory';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PeopleIcon from '@mui/icons-material/People';
import PersonIcon from '@mui/icons-material/Person';
import WarningIcon from '@mui/icons-material/Warning';
import StorageIcon from '@mui/icons-material/Storage';
import FeaturedPlayListIcon from '@mui/icons-material/FeaturedPlayList';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  SidebarContent,
  sreClustersPageExtension,
  k8sHealthCheckPageExtension,
  workflowsCatalogPageExtension,
} from './modules/nav';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { cloudhubLightTheme } from './themes/cloudhubLightTheme';
import { CloudHubSignInPage } from './components/CloudHubSignInPage';
import { GlobalHeader } from './components/GlobalHeader';
import { ScaffolderLayoutEnhancer } from './components/ScaffolderLayoutEnhancer';
import platformHomePlugin from '@internal/plugin-platform-home';
import platformRegistryPlugin from '@internal/plugin-platform-registry';
import dataExportHubPlugin from '@internal/plugin-data-export-hub';
import aksHealthPlugin from '@internal/plugin-aks-health';
import {
  PersonaProvider,
  SriDeploySourceProvider,
} from '@internal/plugin-platform-common';
import { AppRootWrapperBlueprint } from '@backstage/plugin-app-react';

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, '');
}

function normalizeBaseUrl(value: unknown, fallbackOrigin: string) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallbackOrigin;
  }

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${window.location.protocol}//${trimmed.replace(/^\/\//, '')}`;

  try {
    return trimTrailingSlash(new URL(candidate).toString());
  } catch {
    return fallbackOrigin;
  }
}

export function normalizeAppConfigs(configs: AppConfig[]) {
  const fallbackOrigin = window.location.origin;

  return configs.map(entry => {
    const data: AppConfig['data'] = { ...entry.data };

    if (!data.app || typeof data.app !== 'object') {
      data.app = {};
    }
    const app: AppConfig['data'] = { ...(data.app as AppConfig['data']) };
    const normalizedAppBaseUrl = normalizeBaseUrl(app.baseUrl, fallbackOrigin);
    if (normalizedAppBaseUrl) {
      app.baseUrl = normalizedAppBaseUrl as AppConfig['data']['baseUrl'];
    }
    if (!app.title || typeof app.title !== 'string' || !app.title.trim()) {
      app.title = 'CloudHub';
    }
    data.app = app;

    if (!data.backend || typeof data.backend !== 'object') {
      data.backend = {};
    }
    const backend: AppConfig['data'] = {
      ...(data.backend as AppConfig['data']),
    };
    const normalizedBackendBaseUrl = normalizeBaseUrl(
      backend.baseUrl,
      fallbackOrigin,
    );
    if (normalizedBackendBaseUrl) {
      backend.baseUrl =
        normalizedBackendBaseUrl as AppConfig['data']['baseUrl'];
    }
    data.backend = backend;

    if (!data.organization || typeof data.organization !== 'object') {
      data.organization = { name: 'SymphonyAI' };
    }

    return { ...entry, data };
  });
}

function loadAppConfigs(runtimeConfigJson = '__APP_INJECTED_RUNTIME_CONFIG__') {
  const configs: AppConfig[] = [];

  const staticConfig = process.env.APP_CONFIG;
  if (staticConfig) {
    if (!Array.isArray(staticConfig)) {
      throw new Error('Static configuration has invalid format');
    }
    configs.push(...(staticConfig as AppConfig[]));
  }

  const configScripts = document.querySelectorAll(
    'script[type="backstage.io/config"]',
  );

  if (configScripts.length > 0) {
    for (const element of configScripts) {
      const content = element.textContent;
      if (!content) {
        throw new Error('tag is empty');
      }

      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch (error) {
        throw new Error(`failed to parse config; ${error}`);
      }

      if (!Array.isArray(data)) {
        throw new Error('data is not an array');
      }

      configs.push(...(data as AppConfig[]));
    }
  } else if (
    runtimeConfigJson !==
    '__app_injected_runtime_config__'.toLocaleUpperCase('en-US')
  ) {
    try {
      const data: unknown = JSON.parse(runtimeConfigJson);
      if (Array.isArray(data)) {
        configs.push(...(data as AppConfig[]));
      } else {
        configs.push({ data: data as AppConfig['data'], context: 'env' });
      }
    } catch (error) {
      throw new Error(`Failed to load runtime configuration, ${error}`);
    }
  }

  const windowAppConfig = (window as Window & { __APP_CONFIG__?: unknown })
    .__APP_CONFIG__;
  if (windowAppConfig) {
    configs.push({
      context: 'window',
      data: windowAppConfig as AppConfig['data'],
    });
  }

  if (configs.length === 0) {
    const fallbackOrigin = window.location.origin;
    configs.push({
      context: 'fallback',
      data: {
        app: {
          title: 'CloudHub',
          baseUrl: fallbackOrigin,
        },
        backend: { baseUrl: fallbackOrigin },
        enableExperimentalRedirectFlow: true,
      },
    });
  }

  return normalizeAppConfigs(configs);
}

const signInPage = SignInPageBlueprint.make({
  params: {
    loader: async () => {
      return CloudHubSignInPage;
    },
  },
});

// ── CloudHub Light Theme — set as the default (only registered) theme ──────────────
const cloudhubLightThemeExtension = ThemeBlueprint.make({
  params: {
    theme: {
      id: 'cloudhub-light',
      title: 'CloudHub Light',
      variant: 'light',
      Provider: ({ children }) => (
        <UnifiedThemeProvider theme={cloudhubLightTheme}>
          {/* CssBaseline injects the MuiCssBaseline.styleOverrides from
					    cloudhubLightTheme — including the sidebar link colour fix that
					    prevents MuiTypography-colorPrimary from overriding nav text */}
          <CssBaseline />
          {children}
        </UnifiedThemeProvider>
      ),
    },
  },
});

const cloudhubAppIcons = IconBundleBlueprint.make({
  name: 'cloudhub-app-icons',
  params: {
    icons: {
      brokenImage: <BrokenImageIcon />,
      catalog: <MenuBookIcon />,
      scaffolder: <CreateNewFolderIcon />,
      techdocs: <SubjectIcon />,
      search: <SearchIcon />,
      chat: <ChatIcon />,
      dashboard: <DashboardIcon />,
      docs: <DescriptionIcon />,
      email: <EmailIcon />,
      github: <GitHubIcon />,
      group: <PeopleIcon />,
      help: <HelpIcon />,
      'kind:api': <ExtensionIcon />,
      'kind:component': <MemoryIcon />,
      'kind:domain': <ApartmentIcon />,
      'kind:group': <PeopleIcon />,
      'kind:location': <LocationOnIcon />,
      'kind:system': <CategoryIcon />,
      'kind:user': <PersonIcon />,
      'kind:resource': <StorageIcon />,
      'kind:template': <FeaturedPlayListIcon />,
      user: <PersonIcon />,
      warning: <WarningIcon />,
      star: <StarIcon />,
      unstarred: <StarBorderIcon />,
      externalLink: <OpenInNewIcon />,
    },
  },
});

const muiTheme = (cloudhubLightTheme as any).getTheme
  ? (cloudhubLightTheme as any).getTheme('v5')
  : cloudhubLightTheme;

const cloudhubAppRootWrapper = AppRootWrapperBlueprint.make({
  name: 'cloudhub-app-root',
  params: {
    component: ({ children }) => (
      <PersonaProvider>
        <ThemeProvider theme={muiTheme}>
          <SriDeploySourceProvider>
            <GlobalHeader />
            <ScaffolderLayoutEnhancer />
            {children}
          </SriDeploySourceProvider>
        </ThemeProvider>
      </PersonaProvider>
    ),
  },
});

// Single module with all app extensions to avoid duplicate pluginId 'app' modules
const appModule = createFrontendModule({
  pluginId: 'app',
  extensions: [
    SidebarContent,
    sreClustersPageExtension,
    k8sHealthCheckPageExtension,
    workflowsCatalogPageExtension,
    cloudhubAppIcons,
    signInPage,
    cloudhubLightThemeExtension,
    cloudhubAppRootWrapper,
  ],
});

const app = createApp({
  advanced: {
    configLoader: async () => ({
      config: ConfigReader.fromConfigs(loadAppConfigs()),
    }),
  },
  features: [
    appModule,
    platformHomePlugin,
    platformRegistryPlugin,
    dataExportHubPlugin,
    aksHealthPlugin,
  ],
});

export default app;
