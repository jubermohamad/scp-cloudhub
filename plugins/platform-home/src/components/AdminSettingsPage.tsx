/**
 * AdminSettingsPage — Visible only to Platform Super Users (cloudhub-platform persona).
 *
 * Surfaces platform-wide configuration controls for operational management.
 */

import { Typography, Paper, Button, Divider, Chip, Grid, Card, CardContent } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { useNavigate } from 'react-router-dom';
import SettingsIcon from '@mui/icons-material/Settings';
import SecurityIcon from '@mui/icons-material/Security';
import BuildIcon from '@mui/icons-material/Build';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LockIcon from '@mui/icons-material/Lock';
import { usePersona } from '@internal/plugin-platform-common';
import { GpuVnetManagementPanel } from './admin/GpuVnetManagementPanel';

// ─── Styles ───────────────────────────────────────────────────────────────────

const ACCENT = '#1565c0';
const ACCENT_LIGHT = '#EFF6FF';
const GRADIENT = 'linear-gradient(135deg, #0D47A1 0%, #1565c0 100%)';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(4),
    maxWidth: 1100,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },

  // ── Hero banner ──────────────────────────────────────────────────────────
  hero: {
    background: GRADIENT,
    borderRadius: 16,
    padding: theme.spacing(4, 5),
    color: '#fff',
    marginBottom: theme.spacing(4),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(3),
  },
  heroIconWrap: {
    background: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    padding: theme.spacing(1.5),
    display: 'flex',
  },
  heroTitle: {
    fontWeight: 700,
    fontSize: '1.75rem',
    lineHeight: 1.2,
  },
  heroSub: {
    opacity: 0.85,
    fontSize: '0.95rem',
    marginTop: theme.spacing(0.5),
  },
  superUserBadge: {
    background: 'rgba(255,255,255,0.2)',
    color: '#fff',
    fontWeight: 600,
    fontSize: '0.72rem',
    marginTop: theme.spacing(1),
  },

  // ── Section ──────────────────────────────────────────────────────────────
  sectionTitle: {
    fontWeight: 700,
    fontSize: '1.1rem',
    color: '#111827',
    marginBottom: theme.spacing(0.5),
  },
  sectionSub: {
    color: '#6B7280',
    fontSize: '0.875rem',
    marginBottom: theme.spacing(2.5),
  },

  // ── Info cards ────────────────────────────────────────────────────────────
  infoCard: {
    borderRadius: 12,
    border: '1px solid #E5E7EB',
    height: '100%',
  },
  infoCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(1.5),
  },
  infoCardIconWrap: {
    background: ACCENT_LIGHT,
    borderRadius: 8,
    padding: theme.spacing(1),
    display: 'flex',
  },
  infoCardTitle: {
    fontWeight: 600,
    fontSize: '0.95rem',
    color: '#111827',
  },
  infoCardBody: {
    color: '#6B7280',
    fontSize: '0.85rem',
    lineHeight: 1.6,
  },

  rbacCard: {
    borderRadius: 12,
    border: '1px solid #E5E7EB',
    padding: theme.spacing(2.5),
    marginTop: theme.spacing(3),
  },
  rbacContent: {
    '& a': {
      textDecoration: 'none',
      color: '#464feb',
    },
    '& table': {
      width: '100%',
      borderCollapse: 'collapse',
      marginTop: theme.spacing(1.5),
      marginBottom: theme.spacing(1.5),
    },
    '& tr th, & tr td': {
      border: '1px solid #e6e6e6',
      padding: theme.spacing(1),
      textAlign: 'left',
      verticalAlign: 'top',
      fontSize: '0.85rem',
    },
    '& tr th': {
      backgroundColor: '#f5f5f5',
      fontWeight: 700,
      color: '#111827',
    },
    '& p': {
      color: '#374151',
      lineHeight: 1.6,
      marginTop: theme.spacing(1),
      marginBottom: theme.spacing(1),
      fontSize: '0.875rem',
    },
    '& h4': {
      marginTop: theme.spacing(2.5),
      marginBottom: theme.spacing(1),
      fontSize: '0.95rem',
      color: '#111827',
      fontWeight: 700,
    },
    '& ol': {
      marginTop: theme.spacing(1),
      marginBottom: theme.spacing(1.5),
      paddingLeft: theme.spacing(2.5),
      color: '#374151',
      lineHeight: 1.6,
      fontSize: '0.875rem',
    },
    '& pre': {
      marginTop: theme.spacing(1),
      marginBottom: theme.spacing(1.5),
      padding: theme.spacing(1.5),
      borderRadius: 8,
      background: '#F9FAFB',
      border: '1px solid #E5E7EB',
      color: '#111827',
      fontSize: '0.8rem',
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
    },
  },

  // ── Divider ───────────────────────────────────────────────────────────────
  divider: {
    margin: theme.spacing(3, 0),
  },

  // ── Access denied ─────────────────────────────────────────────────────────
  accessDenied: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    gap: theme.spacing(2),
    textAlign: 'center',
  },
  accessDeniedIcon: {
    fontSize: 72,
    color: '#D1D5DB',
  },
  accessDeniedTitle: {
    fontWeight: 700,
    fontSize: '1.5rem',
    color: '#374151',
  },
  accessDeniedSub: {
    color: '#9CA3AF',
    maxWidth: 400,
  },
}));

// ─── Demo lifecycle summary ───────────────────────────────────────────────────


// ─── Component ────────────────────────────────────────────────────────────────

export function AdminSettingsPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const { persona } = usePersona();

  // Guard: Super Users only
  if (persona !== 'cloudhub-platform') {
    return (
      <div className={classes.accessDenied}>
        <LockIcon className={classes.accessDeniedIcon} />
        <Typography className={classes.accessDeniedTitle}>
          Access Restricted
        </Typography>
        <Typography className={classes.accessDeniedSub}>
          Admin Settings are available to Platform Super Users only. Switch your
          persona to access this area.
        </Typography>
        <Button
          variant="outlined"
          onClick={() => navigate('/')}
          style={{ marginTop: 8 }}
        >
          Return to Platform Home
        </Button>
      </div>
    );
  }

  return (
    <div className={classes.root}>
      <Paper elevation={0} className={classes.hero}>
        <div className={classes.heroIconWrap}>
          <SettingsIcon style={{ fontSize: 36, color: '#fff' }} />
        </div>
        <div>
          <Typography className={classes.heroTitle}>Admin Settings</Typography>
          <Typography className={classes.heroSub}>
            Platform-wide configuration controls for SymphonyAI CloudHub
          </Typography>
          <Chip
            size="small"
            label="Platform Super Users Only"
            className={classes.superUserBadge}
            icon={<SecurityIcon style={{ fontSize: 14, color: '#fff' }} />}
          />
        </div>
      </Paper>

      <Typography className={classes.sectionTitle}>Platform Configuration</Typography>
      <Typography className={classes.sectionSub}>
        Configure operational controls for platform administration.
      </Typography>

      <Divider className={classes.divider} />

      {/* ── Deployment Backend Selection ────────────────────────────────────── */}
      <Typography className={classes.sectionTitle} style={{ marginBottom: 8 }}>
        Deployment Backend
      </Typography>
      <Typography className={classes.sectionSub}>
        Choose which deployment backend to use for new deployments. CloudHub Native, Provisioner Pipeline, or SRI-Provisional.
      </Typography>

      <Divider className={classes.divider} />

      {/* ── GPU VNet Management ────────────────────────────────────────────── */}
      <Typography className={classes.sectionTitle} style={{ marginBottom: 8 }}>
        GPU Infrastructure
      </Typography>
      <Typography className={classes.sectionSub}>
        Configure GPU VNets for instance creation and manage available resources.
      </Typography>
      <GpuVnetManagementPanel />

      <Divider className={classes.divider} />

      {/* ── Platform info cards ───────────────────────────────────────────── */}
      <Typography className={classes.sectionTitle} style={{ marginBottom: 16 }}>
        Platform Information
      </Typography>
      <Grid container spacing={3}>
        {[
          {
            icon: <BuildIcon style={{ color: ACCENT }} />,
            title: 'Platform Version',
            body: 'SymphonyAI CloudHub v2.0 · Backstage New Frontend System · Three-Stage Pipeline Model',
          },
          {
            icon: <SecurityIcon style={{ color: ACCENT }} />,
            title: 'Access Control',
            body: 'RBAC via Microsoft Entra ID groups. Four personas: Platform Super User, App Engineering, Professional Services, SRE.',
          },
          {
            icon: <InfoOutlinedIcon style={{ color: ACCENT }} />,
            title: 'Pipeline Model',
            body: 'Dual-pipeline IDP. Infrastructure Pipeline (Terraform) + Application Pipeline (GitHub Actions + Helmfile).',
          },
        ].map(card => (
          <Grid item xs={12} md={4} key={card.title}>
            <Card elevation={0} className={classes.infoCard}>
              <CardContent>
                <div className={classes.infoCardHeader}>
                  <div className={classes.infoCardIconWrap}>{card.icon}</div>
                  <Typography className={classes.infoCardTitle}>
                    {card.title}
                  </Typography>
                </div>
                <Typography className={classes.infoCardBody}>
                  {card.body}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Paper elevation={0} className={classes.rbacCard}>
        <Typography className={classes.sectionTitle}>
          Role-Based Access Control (RBAC)
        </Typography>
        <div className={classes.rbacContent}>
          <p>
            CloudHub uses Microsoft Entra ID as the authentication source and
            Entra App Roles as the authorization signal. Internal permission
            checks and Kubernetes access are derived from these roles for
            least-privilege access.
          </p>

          <table>
            <thead>
              <tr>
                <th>CloudHub Persona</th>
                <th>Entra ID App Role</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Platform Super User</td>
                <td>CloudHub.PlatformAdmin</td>
                <td>Full platform administration and governance</td>
              </tr>
              <tr>
                <td>Application Engineering</td>
                <td>CloudHub.AppEngineer</td>
                <td>
                  Deploy and manage NetReveal and SRI application components
                </td>
              </tr>
              <tr>
                <td>Professional Services</td>
                <td>CloudHub.ProfessionalServices</td>
                <td>Overlays and tenant-specific configuration</td>
              </tr>
              <tr>
                <td>SRE</td>
                <td>CloudHub.SRE</td>
                <td>
                  Read-only operations, diagnostics, and monitoring visibility
                </td>
              </tr>
            </tbody>
          </table>

          <p>
            Reference:{' '}
            <a
              href="https://learn.microsoft.com/entra/identity-platform/howto-add-app-roles-in-apps"
              target="_blank"
              rel="noopener noreferrer"
            >
              Configure app roles in Microsoft Entra ID
            </a>
          </p>

          <h4>Step 1: Enable Authentication on Azure App Service</h4>
          <ol>
            <li>
              Open Azure Portal, select your App Service, and open
              Authentication.
            </li>
            <li>Add identity provider: Microsoft Identity Platform.</li>
            <li>Set App Registration to spn-aks-automation.</li>
            <li>Set unauthenticated requests to Require authentication.</li>
            <li>Enable token store.</li>
          </ol>
          <p>
            After this is enabled, your CloudHub URL redirects users to Entra
            sign-in automatically.
          </p>

          <h4>Step 2: Verify Role Claims in Token</h4>
          <p>
            After sign-in, inspect{' '}
            <a
              href="https://learn.microsoft.com/azure/app-service/configure-authentication-user-identities#access-user-claims-in-app-code"
              target="_blank"
              rel="noopener noreferrer"
            >
              /.auth/me claims output
            </a>{' '}
            for role claims.
          </p>
          <pre>{`{
  "user_claims": [
    { "typ": "roles", "val": "CloudHub.PlatformAdmin" }
  ]
}`}</pre>

          <h4>Step 3: Read Roles in CloudHub Session Context</h4>
          <p>
            CloudHub reads role values from identity claims and maps them to
            personas used by frontend and backend authorization checks.
          </p>
          <table>
            <thead>
              <tr>
                <th>Role Claim</th>
                <th>Persona</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>CloudHub.PlatformAdmin</td>
                <td>cloudhub-platform</td>
              </tr>
              <tr>
                <td>CloudHub.AppEngineer</td>
                <td>app-engineering</td>
              </tr>
              <tr>
                <td>CloudHub.ProfessionalServices</td>
                <td>professional-services</td>
              </tr>
              <tr>
                <td>CloudHub.SRE</td>
                <td>sre</td>
              </tr>
            </tbody>
          </table>

          <h4>Step 4: Permission-Based Authorization Layer</h4>
          <p>
            Avoid hard-coded role checks in business handlers. Use named
            permissions and map roles to permissions centrally.
          </p>
          <table>
            <thead>
              <tr>
                <th>App Role</th>
                <th>Key Permissions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>CloudHub.PlatformAdmin</td>
                <td>
                  cluster.create, cluster.delete, app.deploy, overlay.deploy,
                  user.manage
                </td>
              </tr>
              <tr>
                <td>CloudHub.AppEngineer</td>
                <td>app.deploy, app.rollback, logs.view</td>
              </tr>
              <tr>
                <td>CloudHub.ProfessionalServices</td>
                <td>overlay.deploy, customer.config.manage</td>
              </tr>
              <tr>
                <td>CloudHub.SRE</td>
                <td>health.view, logs.view, monitoring.view</td>
              </tr>
            </tbody>
          </table>

          <h4>Step 5: Secure API Endpoints</h4>
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Allowed App Roles</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>POST /api/clusters</td>
                <td>CloudHub.PlatformAdmin</td>
              </tr>
              <tr>
                <td>POST /api/applications/netreveal/deploy</td>
                <td>CloudHub.PlatformAdmin, CloudHub.AppEngineer</td>
              </tr>
              <tr>
                <td>POST /api/customers/{'{id}'}/overlay</td>
                <td>CloudHub.PlatformAdmin, CloudHub.ProfessionalServices</td>
              </tr>
              <tr>
                <td>GET /api/health</td>
                <td>All CloudHub roles</td>
              </tr>
            </tbody>
          </table>

          <h4>Step 6: Role-Aware UI</h4>
          <p>
            UI should hide controls that the current role cannot execute, but
            backend authorization remains mandatory for security.
          </p>
          <pre>{`Entra ID Groups -> App Roles -> App Service Auth -> JWT roles claim -> CloudHub permissions`}</pre>
        </div>
      </Paper>
    </div>
  );
}
