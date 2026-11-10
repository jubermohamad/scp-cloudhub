import { ReactNode } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Alert, Box, Stack, Tab, Tabs } from '@mui/material';
import { Content, Header, Page } from '@backstage/core-components';
import { HUB_NAV, sectionForPath } from '../../routes';
import { hasNoAccess } from '../../utils';
import { SectionErrorBoundary } from './ErrorBoundary';
import { HubProvider, useHub } from './HubContext';
import { NoAccess } from './NoAccess';

interface Props {
  /** Page name for the error boundary. */
  label: string;
  title?: string;
  subtitle?: string;
  showSectionTabs?: boolean;
  /** Platform-admin-only pages show a no-access state to everyone else. */
  requirePlatformAdmin?: boolean;
  children: ReactNode;
}

/** Shared chrome for every Data Export Hub page: header, section tabs, permissions context. */
export function HubLayout(props: Props) {
  return (
    <Page themeId="tool">
      <Header
        title={props.title ?? 'Data Export Hub'}
        subtitle={
          props.subtitle ??
          'Configure and manage scheduled exports from NetReveal platforms.'
        }
        type=""
      />
      <HubProvider>
        <HubBody {...props} />
      </HubProvider>
    </Page>
  );
}

function HubBody({
  label,
  requirePlatformAdmin,
  showSectionTabs = true,
  children,
}: Props) {
  const { me, meLoading, meError, isPlatformAdmin } = useHub();
  const location = useLocation();
  const current = sectionForPath(location.pathname);
  const items = HUB_NAV.filter(item => !item.adminOnly || isPlatformAdmin);
  const tabValue = items.some(item => item.key === current) ? current : false;

  let body: ReactNode = children;
  if (requirePlatformAdmin && !isPlatformAdmin) {
    body = meLoading ? null : (
      <NoAccess
        title="Administration is restricted"
        message="This area is available to members of CloudHub.DataExport.Admin (platform administrators)."
      />
    );
  }

  return (
    <Content>
      <Stack spacing={2}>
        {showSectionTabs && (
          <Box
            component="nav"
            aria-label="Data Export Hub sections"
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            <Tabs
              value={tabValue}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
            >
              {items.map(item => (
                <Tab
                  key={item.key}
                  value={item.key}
                  label={item.label}
                  component={RouterLink}
                  to={item.path}
                />
              ))}
            </Tabs>
          </Box>
        )}

        {meError && (
          <Alert severity="warning">
            Could not confirm your export permissions: {meError}
          </Alert>
        )}
        {hasNoAccess(me) && (
          <Alert severity="warning">
            You are not a member of a Data Export Hub access group, so no
            exports are visible. Ask to be added to grp-cloudhub-data-export,
            CloudHubPlatformOwners, or the appropriate
            CloudHub.DataExport.Tenant.&lt;tenant&gt;.User or .Admin group.
          </Alert>
        )}

        <SectionErrorBoundary label={label}>{body}</SectionErrorBoundary>
      </Stack>
    </Content>
  );
}
