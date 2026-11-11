import { useEffect, useState } from 'react';
import {
  Sidebar,
  SidebarDivider,
  SidebarGroup,
  SidebarItem,
  SidebarScrollWrapper,
} from '@backstage/core-components';
import { NavContentBlueprint } from '@backstage/plugin-app-react';
import { makeStyles } from '@mui/styles';
import HomeIcon from '@mui/icons-material/Home';
import DashboardIcon from '@mui/icons-material/Dashboard';
import TimelineIcon from '@mui/icons-material/Timeline';
import CloudIcon from '@mui/icons-material/Cloud';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import SettingsApplicationsIcon from '@mui/icons-material/SettingsApplications';
import DescriptionIcon from '@mui/icons-material/Description';
import TuneIcon from '@mui/icons-material/Tune';
import ListAltIcon from '@mui/icons-material/ListAlt';
import MemoryIcon from '@mui/icons-material/Memory';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import AppRegistrationIcon from '@mui/icons-material/AppRegistration';
import GitHubIcon from '@mui/icons-material/GitHub';
import ImportExportIcon from '@mui/icons-material/ImportExport';
import LayersIcon from '@mui/icons-material/Layers';
import ShieldIcon from '@mui/icons-material/Shield';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import StorageIcon from '@mui/icons-material/Storage';
import AppsIcon from '@mui/icons-material/Apps';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import PeopleIcon from '@mui/icons-material/People';
import HistoryIcon from '@mui/icons-material/History';
import {
  dataExportHubRoot,
} from '@internal/plugin-data-export-hub';
import {
  usePersona,
  useBackendFetch,
  type PersonaId,
} from '@internal/plugin-platform-common';

const useStyles = makeStyles(theme => ({
  sidebarSpacer: {
    paddingBottom: theme.spacing(0.25),
  },
  sidebarItemMultiLine: {
    '& .MuiListItemText-root': {
      margin: 0,
      lineHeight: 1.2,
    },
  },
}));

// Deployment stages, each a first-level sidebar entry in lifecycle order.
const deploymentNavItems = [
  { label: 'Create AKS', path: '/deployment/aks', icon: StorageIcon },
  { label: 'Deploy common-res', path: '/deployment/common-res', icon: LayersIcon },
  { label: 'Deploy SRI', path: '/deployment/sri', icon: AppsIcon },
  { label: 'Deploy NetReveal', path: '/deployment/netreveal', icon: CloudUploadIcon },
  {
    label: 'Deploy Customer Overlay',
    path: '/deployment/customer-overlay',
    icon: PeopleIcon,
  },
  { label: 'Deployment History', path: '/deployment/history', icon: HistoryIcon },
];

const NavSection = ({ label, icon, children }: any) => (
  <>
    <SidebarDivider />
    <SidebarGroup label={label} icon={icon} style={{ gap: '4px' }}>
      {children}
    </SidebarGroup>
  </>
);

export const SidebarContent = NavContentBlueprint.make({
  params: {
    component: ({ navItems }) => {
      if (/^\/login(?:\/|$)/.test(window.location.pathname)) {
        return null;
      }

      // eslint-disable-next-line react-hooks/rules-of-hooks
      const classes = useStyles();
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { persona, identity } = usePersona();
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const backendFetch = useBackendFetch();
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const [gpuAuthorized, setGpuAuthorized] = useState(false);
      const identityKey =
        identity?.userEntityRef ??
        identity?.ownershipEntityRefs.join('|') ??
        'anonymous';
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const response = await backendFetch(
              'deployment-control-plane',
              '/gpu-instances/permissions',
            );
            const body = await response.json();
            if (!cancelled)
              setGpuAuthorized(response.ok && Boolean(body.authorized));
          } catch {
            if (!cancelled) setGpuAuthorized(false);
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [backendFetch, identityKey]);

      const canSee = (...allowed: PersonaId[]) => allowed.includes(persona);
      const inCompact = (..._allowedInCompact: PersonaId[]) => true;

      const showDeployment =
        canSee(
          'cloudhub-platform',
          'app-engineering',
          'professional-services',
        ) &&
        inCompact(
          'cloudhub-platform',
          'app-engineering',
          'professional-services',
        );
      const showSriCatalog =
        canSee('cloudhub-platform') && inCompact('cloudhub-platform');

      const showEnvRegistry =
        canSee(
          'cloudhub-platform',
          'professional-services',
          'sre',
          'app-engineering',
        ) &&
        inCompact(
          'cloudhub-platform',
          'professional-services',
          'sre',
          'app-engineering',
        );
      // GPU visibility must follow the backend entitlement check only.
      // Persona is still used for other sections, but double-gating GPU here
      // can hide the tab for otherwise authorized users whose identity maps to
      // a different persona or resolves late during sign-in.
      const showGpuCompute = gpuAuthorized && inCompact();

      const showCostMgmt =
        canSee('cloudhub-platform', 'professional-services', 'sre') &&
        inCompact('cloudhub-platform', 'professional-services', 'sre');

      const showK8sHealthCheck =
        canSee('cloudhub-platform', 'sre') &&
        inCompact('cloudhub-platform', 'sre');
      const showObservability =
        canSee('cloudhub-platform', 'sre') &&
        inCompact('cloudhub-platform', 'sre');

      const showDataExportHub =
        canSee('cloudhub-platform', 'professional-services', 'sre') &&
        inCompact('cloudhub-platform', 'professional-services', 'sre');

      const showGitOps =
        canSee('cloudhub-platform', 'app-engineering', 'sre') &&
        inCompact('cloudhub-platform', 'app-engineering', 'sre');

      const showAdminSettings =
        canSee('cloudhub-platform') && inCompact('cloudhub-platform');
      const showEngTools =
        canSee('cloudhub-platform', 'professional-services') &&
        inCompact('cloudhub-platform', 'professional-services');
      const showDocs =
        canSee(
          'cloudhub-platform',
          'app-engineering',
          'professional-services',
          'sre',
          'readonly',
        ) &&
        inCompact(
          'cloudhub-platform',
          'app-engineering',
          'professional-services',
          'sre',
          'readonly',
        );
      const showCodeToProdSection = showEnvRegistry;

      const showDeliverySection =
        showDeployment || showSriCatalog || showGpuCompute;

      const showOperationsSection =
        showK8sHealthCheck || showObservability || showGitOps;

      const showHealthCheckSection = true;

      const showFinOpsSection = showCostMgmt;

      const showEngineeringSection = showEngTools;

      const showAdministrationSection = showAdminSettings;

      const showUtilitiesSection = showDocs;

      const nav = navItems.withComponent(item => (
        <SidebarItem icon={() => item.icon} to={item.href} text={item.title} />
      ));

      nav.take('page:search');
      nav.take('page:scaffolder');
      nav.take('page:catalog');
      nav.take('page:api-docs');
      nav.take('page:user-settings');
      nav.rest();

      return (
        <Sidebar>
          <SidebarItem icon={HomeIcon} to="/" text="Platform Home" />
          <SidebarScrollWrapper>
            {showCodeToProdSection && (
              <NavSection label="Platform" icon={<CloudIcon />}>
                <SidebarItem
                  icon={CloudIcon}
                  to="/infrastructure"
                  text="Infrastructure"
                />
                {showEnvRegistry && (
                  <SidebarItem
                    icon={ListAltIcon}
                    to="/platform-registry/clusters"
                    text="Platform Registry"
                  />
                )}
              </NavSection>
            )}

            {showDeliverySection && (
              <NavSection label="Delivery" icon={<AccountTreeIcon />}>
                {showDeployment &&
                  deploymentNavItems.map(item => (
                    <SidebarItem
                      key={item.path}
                      icon={item.icon}
                      to={item.path}
                      text={item.label}
                    />
                  ))}
                {showSriCatalog && (
                  <>
                    <SidebarItem
                      icon={VerifiedUserIcon}
                      to="/sri"
                      text="SRI Catalog"
                    />
                    <SidebarItem
                      icon={LayersIcon}
                      to="/common-resources"
                      text="Common Resources"
                    />
                    <SidebarItem
                      icon={ShieldIcon}
                      to="/deploy-netreveal"
                      text="Deploy NetReveal"
                    />
                  </>
                )}
                <SidebarItem
                  icon={AppRegistrationIcon}
                  to="/new-app"
                  text="New App"
                />
                {showGpuCompute && (
                  <SidebarItem
                    icon={MemoryIcon}
                    to="/gpu-compute"
                    text="GPU Compute"
                  />
                )}
              </NavSection>
            )}

            {showOperationsSection && (
              <NavSection label="Operations" icon={<DashboardIcon />}>
                {showObservability && (
                  <SidebarItem
                    icon={TimelineIcon}
                    to="/workflows?category=observe"
                    text="Observability"
                  />
                )}
                {showGitOps && (
                  <SidebarItem icon={GitHubIcon} to="/gitops" text="GitOps" />
                )}
              </NavSection>
            )}

            {showHealthCheckSection && (
              <NavSection label="Health Check" icon={<HealthAndSafetyIcon />}>
                <SidebarItem
                  icon={HealthAndSafetyIcon}
                  to="/health-check/aks"
                  text="AKS Health"
                />
              </NavSection>
            )}

            {showDataExportHub && (
              <>
                <SidebarDivider />
                <SidebarItem
                  icon={ImportExportIcon}
                  to={dataExportHubRoot}
                  text="Data Export Hub"
                />
              </>
            )}

            {showFinOpsSection && (
              <NavSection label="FinOps" icon={<TrendingDownIcon />}>
                <SidebarItem
                  icon={TrendingDownIcon}
                  to="/cost-optimization"
                  text="Cost Management"
                />
              </NavSection>
            )}

            {showEngineeringSection && (
              <NavSection label="Engineering" icon={<TuneIcon />}>
                {showEngTools && (
                  <>
                    <SidebarItem
                      icon={TuneIcon}
                      to="/eng-tools"
                      text="Eng. Tools"
                    />
                  </>
                )}
              </NavSection>
            )}

            <div className={classes.sidebarSpacer} />

            {showAdministrationSection && (
              <NavSection
                label="Administration"
                icon={<SettingsApplicationsIcon />}
              >
                <SidebarItem
                  icon={SettingsApplicationsIcon}
                  to="/admin-settings"
                  text="Admin Settings"
                />
                <SidebarItem
                  icon={CheckBoxIcon}
                  to="/approvals"
                  text="Approvals"
                />
              </NavSection>
            )}

            {showUtilitiesSection && (
              <>
                <SidebarDivider />
                {showDocs && (
                  <SidebarItem
                    icon={DescriptionIcon}
                    to="/documentation"
                    text="Documentation"
                  />
                )}
              </>
            )}
          </SidebarScrollWrapper>
        </Sidebar>
      );
    },
  },
}) as any;
