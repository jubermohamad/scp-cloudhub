import { useState, useEffect } from 'react';
import { Typography, Grid, Card, CardContent, CardActions, Button, Chip, Divider, Tooltip } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { useNavigate, useSearchParams } from 'react-router-dom';
import AppsIcon from '@mui/icons-material/Apps';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SettingsIcon from '@mui/icons-material/Settings';
import LockIcon from '@mui/icons-material/Lock';
import BarChartIcon from '@mui/icons-material/BarChart';
import PersonIcon from '@mui/icons-material/Person';
import StarBorderIcon from '@mui/icons-material/StarBorder';

// ─── Types ────────────────────────────────────────────────────────────────────

type CategoryId =
  | 'all'
  | 'provision'
  | 'deploy'
  | 'operate'
  | 'secure'
  | 'observe';

interface Category {
  id: CategoryId;
  label: string;
  description: string;
  Icon: React.ElementType;
  color: string;
  gradient: string;
}

interface WorkflowEntry {
  id: string;
  title: string;
  description: string;
  type: string;
  tags: string[];
  owner: string;
  category: Exclude<CategoryId, 'all'>;
  /** Real Backstage scaffolder template name — null means "coming soon" */
  templateName: string | null;
  /** Override destination — bypasses the scaffolder route when set */
  href?: string;
}

// ─── Category catalogue ───────────────────────────────────────────────────────

const CATEGORIES: Category[] = [
  {
    id: 'all',
    label: 'All Workflows',
    description: '',
    Icon: AppsIcon,
    color: '#374151',
    gradient: 'linear-gradient(135deg, #374151 0%, #6B7280 100%)',
  },
  {
    id: 'provision',
    label: 'Provision',
    description: 'Stage 1 — AKS clusters, namespaces, cloud infra',
    Icon: CloudQueueIcon,
    color: '#6B21A8',
    gradient: 'linear-gradient(135deg, #4C1480 0%, #6B21A8 100%)',
  },
  {
    id: 'deploy',
    label: 'Deploy',
    description: 'Stage 2 — Helm deployments, services, batch jobs',
    Icon: CloudUploadIcon,
    color: '#2563EB',
    gradient: 'linear-gradient(135deg, #1E40AF 0%, #3B82F6 100%)',
  },
  {
    id: 'operate',
    label: 'Operate',
    description: 'Logs, rollbacks, scaling operations',
    Icon: SettingsIcon,
    color: '#D97706',
    gradient: 'linear-gradient(135deg, #B45309 0%, #D97706 100%)',
  },
  {
    id: 'secure',
    label: 'Secure',
    description: 'Secrets, certificates, RBAC policies',
    Icon: LockIcon,
    color: '#0D9488',
    gradient: 'linear-gradient(135deg, #0F766E 0%, #14B8A6 100%)',
  },
  {
    id: 'observe',
    label: 'Observe',
    description: 'Dashboards, alerts, distributed tracing',
    Icon: BarChartIcon,
    color: '#0369A1',
    gradient: 'linear-gradient(135deg, #0369A1 0%, #0EA5E9 100%)',
  },
];

// ─── Workflow catalogue ───────────────────────────────────────────────────────

const WORKFLOWS: WorkflowEntry[] = [
  // ── Provision ────────────────────────────────────────────────────────────
  {
    id: 'aks-cluster',
    title: 'Create Kubernetes Environment',
    description:
      'Provision a new Azure Kubernetes Service (AKS) cluster. Renders a tfvars file, opens a PR in cloudhub-infra-as-code, and dispatches a Terraform plan/apply workflow.',
    type: 'infrastructure',
    tags: ['kubernetes', 'infrastructure', 'platform'],
    owner: 'platform-team',
    category: 'provision',
    templateName: null,
    href: '/create/aks',
  },
  {
    id: 'update-cluster',
    title: 'Modify / Scale / Upgrade Environment',
    description:
      'Modifies an existing AKS environment — scale node counts or upgrade the Kubernetes version without reprovisioning.',
    type: 'infrastructure',
    tags: ['kubernetes', 'infrastructure', 'platform'],
    owner: 'platform-team',
    category: 'provision',
    templateName: null,
    href: '/create/aks',
  },
  {
    id: 'create-namespace',
    title: 'Create Namespace',
    description:
      'Provisions a Kubernetes namespace with RBAC bindings, resource quotas, and network policies pre-configured.',
    type: 'infrastructure',
    tags: ['kubernetes', 'namespace', 'rbac'],
    owner: 'platform-team',
    category: 'provision',
    templateName: null,
  },

  // ── Deploy ───────────────────────────────────────────────────────────────
  {
    id: 'generate-helmfile',
    title: 'Generate Helmfile (Service Deployment Wizard)',
    description:
      'Create a Kubernetes-deployed service using approved platform templates. Generates a Helmfile and opens a reviewable PR. (Step 2 of 3)',
    type: 'service',
    tags: ['kubernetes', 'helmfile', 'deployment', 'pr-based'],
    owner: 'platform-team',
    category: 'deploy',
    templateName: 'service-deployment-wizard',
  },
  {
    id: 'deploy-app',
    title: 'Deploy Microservice',
    description:
      'Deploys a containerised microservice to an existing AKS environment. Creates Kubernetes manifests and wires ingress.',
    type: 'service',
    tags: ['kubernetes', 'gitops', 'deployment'],
    owner: 'platform-team',
    category: 'deploy',
    templateName: 'deploy-app-mock',
  },
  {
    id: 'deploy-batch-job',
    title: 'Deploy Batch Job',
    description:
      'Schedules a Kubernetes CronJob with configurable concurrency, retry policies, and failure alerting.',
    type: 'service',
    tags: ['kubernetes', 'batch', 'cronjob'],
    owner: 'platform-team',
    category: 'deploy',
    templateName: null,
  },
  {
    id: 'canary-rollout',
    title: 'Canary Rollout',
    description:
      'Progressively shifts traffic to a new version using Argo Rollouts — with automated promotion gates and instant rollback.',
    type: 'service',
    tags: ['gitops', 'canary', 'deployment'],
    owner: 'platform-team',
    category: 'deploy',
    templateName: null,
  },

  // ── Operate ──────────────────────────────────────────────────────────────
  {
    id: 'scale-deployment',
    title: 'Scale Deployment',
    description:
      'Adjusts replica counts for a workload across environments, supporting HPA configuration and scheduled scaling.',
    type: 'operation',
    tags: ['kubernetes', 'scaling', 'ops'],
    owner: 'platform-team',
    category: 'operate',
    templateName: null,
  },
  {
    id: 'rollback-release',
    title: 'Rollback Release',
    description:
      'Reverts a service to a previous revision with automatic sync and health verification checks.',
    type: 'operation',
    tags: ['gitops', 'rollback', 'ops'],
    owner: 'platform-team',
    category: 'operate',
    templateName: null,
  },
  {
    id: 'export-logs',
    title: 'Export Logs',
    description:
      'Streams structured logs from a pod or namespace to blob storage with configurable retention and redaction rules.',
    type: 'operation',
    tags: ['logs', 'ops', 'azure-monitor'],
    owner: 'platform-team',
    category: 'operate',
    templateName: null,
  },

  // ── Secure ───────────────────────────────────────────────────────────────
  {
    id: 'rotate-secrets',
    title: 'Rotate Secrets',
    description:
      'Rotates Azure Key Vault secrets and restarts dependent pods with zero downtime using a progressive pod restart strategy.',
    type: 'security',
    tags: ['secrets', 'keyvault', 'security'],
    owner: 'platform-team',
    category: 'secure',
    templateName: null,
  },
  {
    id: 'issue-tls-cert',
    title: 'Issue TLS Certificate',
    description:
      'Provisions a cert-manager certificate for a domain and mounts it as a Kubernetes TLS secret automatically.',
    type: 'security',
    tags: ['tls', 'certs', 'cert-manager'],
    owner: 'platform-team',
    category: 'secure',
    templateName: null,
  },
  {
    id: 'apply-rbac',
    title: 'Apply RBAC Policy',
    description:
      'Generates and applies ClusterRoles and RoleBindings aligned to the platform RBAC matrix and audit requirements.',
    type: 'security',
    tags: ['rbac', 'policies', 'security'],
    owner: 'platform-team',
    category: 'secure',
    templateName: null,
  },

  // ── Observe ──────────────────────────────────────────────────────────────
  {
    id: 'create-dashboard',
    title: 'Create Dashboard',
    description:
      'Provisions a Grafana or Azure Monitor dashboard from a template for a namespace or service workload.',
    type: 'observability',
    tags: ['monitoring', 'dashboard', 'grafana'],
    owner: 'platform-team',
    category: 'observe',
    templateName: null,
  },
  {
    id: 'configure-alerts',
    title: 'Configure Alerts',
    description:
      'Creates Azure Monitor alert rules for a workload with configurable thresholds, evaluation windows, and action groups.',
    type: 'observability',
    tags: ['monitoring', 'alerts', 'azure-monitor'],
    owner: 'platform-team',
    category: 'observe',
    templateName: null,
  },
  {
    id: 'setup-tracing',
    title: 'Set Up Tracing',
    description:
      'Injects OpenTelemetry auto-instrumentation for a service and configures export to Azure Application Insights.',
    type: 'observability',
    tags: ['observability', 'tracing', 'otel'],
    owner: 'platform-team',
    category: 'observe',
    templateName: null,
  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3),
    maxWidth: 1600,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.between('lg', 'xl')]: { padding: theme.spacing(2.5) },
    [theme.breakpoints.up('xl')]: { padding: theme.spacing(4) },
  },
  pageTitle: {
    fontSize: '2rem',
    marginBottom: theme.spacing(3),
    [theme.breakpoints.between('lg', 'xl')]: { fontSize: '1.75rem' },
    [theme.breakpoints.up('xl')]: { fontSize: '2.5rem' },
  },

  // ── Left category nav ─────────────────────────────────────────────────────
  categoryNav: {
    position: 'sticky',
    top: theme.spacing(2),
    borderRadius: 8,
    overflow: 'hidden',
    border: `1px solid ${theme.palette.divider}`,
  },
  categoryNavTitle: {
    padding: theme.spacing(1, 2),
    fontSize: '0.65rem',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: theme.palette.text.secondary,
    background:
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.03)'
        : 'rgba(0,0,0,0.03)',
  },
  categoryItem: {
    paddingTop: theme.spacing(1.25),
    paddingBottom: theme.spacing(1.25),
    borderLeft: '3px solid transparent',
    transition: 'background 0.15s',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  categoryItemActive: {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.08)'
        : 'rgba(0,0,0,0.05)',
  },
  categoryIcon: {
    minWidth: 32,
  },
  categoryCount: {
    fontSize: '0.7rem',
    padding: theme.spacing(0.15, 0.6),
    borderRadius: 10,
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.1)'
        : 'rgba(0,0,0,0.08)',
    color: theme.palette.text.secondary,
    lineHeight: 1.6,
  },

  // ── Blueprint cards ─────────────────────────────────────────────────────────
  templateCard: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 8,
    overflow: 'hidden',
    border: `1px solid ${theme.palette.divider}`,
    transition: 'box-shadow 0.2s, transform 0.15s',
    '&:hover': {
      boxShadow: theme.shadows[6],
      transform: 'translateY(-1px)',
    },
  },
  cardHeader: {
    padding: theme.spacing(1.25, 2),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardType: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: '0.68rem',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  cardBookmark: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 16,
    cursor: 'pointer',
    '&:hover': { color: '#fff' },
  },
  cardContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: theme.spacing(2),
  },
  cardTitle: {
    fontSize: '1rem',
    marginBottom: theme.spacing(0.75),
    lineHeight: 1.3,
  },
  cardDivider: {
    margin: theme.spacing(1.25, 0),
  },
  cardDescription: {
    fontSize: '0.82rem',
    color: theme.palette.text.secondary,
    lineHeight: 1.55,
    flex: 1,
  },
  tagsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(1.5),
  },
  tag: {
    height: 20,
    fontSize: '0.68rem',
    borderRadius: 4,
  },
  cardActions: {
    padding: theme.spacing(1.25, 2),
    borderTop: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ownerChip: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.4),
    color: theme.palette.text.secondary,
    fontSize: '0.72rem',
  },
  ownerIcon: {
    fontSize: 14,
  },
  chooseBtn: {
    fontSize: '0.75rem',
    padding: theme.spacing(0.5, 1.5),
  },
  comingSoonLabel: {
    fontSize: '0.72rem',
    color: theme.palette.text.disabled,
    fontStyle: 'italic',
  },
}));

// ─── Workflow card ────────────────────────────────────────────────────────────

function WorkflowCard({ workflow }: { workflow: WorkflowEntry }) {
  const classes = useStyles();
  const navigate = useNavigate();
  const cat = CATEGORIES.find(c => c.id === workflow.category)!;

  return (
    <Card className={classes.templateCard} elevation={0}>
      <div className={classes.cardHeader} style={{ background: cat.gradient }}>
        <Typography className={classes.cardType}>{workflow.type}</Typography>
        <Tooltip title="Bookmark workflow">
          <StarBorderIcon className={classes.cardBookmark} fontSize="small" />
        </Tooltip>
      </div>

      <CardContent className={classes.cardContent}>
        <Typography className={classes.cardTitle}>{workflow.title}</Typography>
        <Divider className={classes.cardDivider} />
        <Typography className={classes.cardDescription}>
          {workflow.description}
        </Typography>
        <div className={classes.tagsRow}>
          {workflow.tags.map(tag => (
            <Chip
              key={tag}
              label={tag}
              size="small"
              className={classes.tag}
              variant="outlined"
            />
          ))}
        </div>
      </CardContent>

      <CardActions className={classes.cardActions} disableSpacing>
        <span className={classes.ownerChip}>
          <PersonIcon className={classes.ownerIcon} />
          {workflow.owner}
        </span>

        {workflow.templateName || workflow.href ? (
          <Button
            variant="outlined"
            size="small"
            className={classes.chooseBtn}
            onClick={() =>
              navigate(
                workflow.href ??
                  `/create/templates/default/${workflow.templateName}`,
              )
            }
          >
            CHOOSE
          </Button>
        ) : (
          <Tooltip title="This workflow is coming soon">
            <span className={classes.comingSoonLabel}>Coming soon</span>
          </Tooltip>
        )}
      </CardActions>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function WorkflowsCatalogPage() {
  const classes = useStyles();
  const [searchParams] = useSearchParams();
  const urlCategory = (searchParams.get('category') as CategoryId) ?? 'all';
  const [activeCategory, setActiveCategory] = useState<CategoryId>(urlCategory);

  // Sync state when URL changes (e.g. clicking sidebar links)
  useEffect(() => {
    setActiveCategory(urlCategory);
  }, [urlCategory]);

  const filtered =
    activeCategory === 'all'
      ? WORKFLOWS
      : WORKFLOWS.filter(t => t.category === activeCategory);

  const activeCat =
    CATEGORIES.find(c => c.id === activeCategory) ?? CATEGORIES[0];

  return (
    <div className={classes.root}>
      <Typography variant="h4" className={classes.pageTitle}>
        Workflows
      </Typography>

      <Grid container spacing={3} alignItems="flex-start">
        {/* ── Workflow grid ── */}
        <Grid item xs={12}>
          {activeCategory !== 'all' && (
            <Typography
              variant="subtitle2"
              style={{
                marginBottom: 12,
                color: activeCat.color,
                fontSize: '0.78rem',
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              {activeCat.label} — {activeCat.description}
            </Typography>
          )}
          <Grid container spacing={2}>
            {filtered.map(workflow => (
              <Grid item xs={12} sm={6} lg={4} xl={3} key={workflow.id}>
                <WorkflowCard workflow={workflow} />
              </Grid>
            ))}
          </Grid>
        </Grid>
      </Grid>
    </div>
  );
}
