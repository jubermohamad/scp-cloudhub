/**
 * DocumentationPage - beta launch guide for CloudHub.
 */

import { useNavigate } from 'react-router-dom';
import { makeStyles } from '@mui/styles';
import { Button, Chip, Divider, Paper, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import BuildIcon from '@mui/icons-material/Build';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import PeopleIcon from '@mui/icons-material/People';
import SecurityIcon from '@mui/icons-material/Security';
import StorageIcon from '@mui/icons-material/Storage';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import LayersIcon from '@mui/icons-material/Layers';

interface SectionLink {
  id: string;
  label: string;
}

const SECTION_LINKS: SectionLink[] = [
  { id: 'access', label: 'Access and secrets' },
  { id: 'aks', label: 'Create the AKS cluster' },
  { id: 'common-res', label: 'Deploy common-res' },
  { id: 'sri', label: 'Deploy SRI workloads' },
  { id: 'netreveal', label: 'Deploy NetReveal' },
  { id: 'approvals', label: 'Approvals and PRs' },
  { id: 'overlay', label: 'Customer overlay' },
  { id: 'api-documentation', label: 'CloudHub API Explorer' },
];

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(1.5, 4, 3),
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(1, 2, 2) },
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
    flexWrap: 'wrap',
    position: 'sticky',
    top: theme.spacing(8),
    zIndex: theme.zIndex.appBar - 1,
    padding: theme.spacing(0.75, 0),
    background: 'rgba(255,255,255,0.96)',
    backdropFilter: 'blur(8px)',
  },
  backButton: {
    color: '#6B7280',
    textTransform: 'none',
    fontWeight: 700,
  },
  hero: {
    borderRadius: 12,
    padding: theme.spacing(2.5),
    color: '#FFFFFF',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
    marginBottom: theme.spacing(2),
    background: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)',
  },
  heroBadge: {
    background: 'rgba(255,255,255,0.16)',
    color: '#FFFFFF',
    border: '1px solid rgba(255,255,255,0.24)',
    fontWeight: 800,
    marginBottom: theme.spacing(0.5),
    letterSpacing: '0.03em',
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  subtitle: {
    maxWidth: 980,
    color: 'rgba(255,255,255,0.85)',
    fontSize: '0.875rem',
    lineHeight: 1.5,
  },
  heroActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1.25),
    marginTop: theme.spacing(1.5),
  },
  heroButton: {
    textTransform: 'none',
    fontWeight: 700,
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#111827',
    margin: theme.spacing(3.5, 0, 2),
  },
  introCard: {
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    padding: theme.spacing(2.5),
    boxShadow: 'none',
    background: '#FFFFFF',
  },
  introList: {
    margin: 0,
    paddingLeft: theme.spacing(2.5),
    color: '#374151',
    lineHeight: 1.8,
  },
  toc: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1.5),
  },
  tocChip: {
    textTransform: 'none',
    fontWeight: 600,
    background: '#F3F4F6',
    color: '#374151',
  },
  guideCard: {
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    boxShadow: 'none',
    background: '#FFFFFF',
    padding: theme.spacing(2.5),
    marginBottom: theme.spacing(2),
  },
  guideHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.25),
    marginBottom: theme.spacing(1.25),
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#FFFFFF',
    flexShrink: 0,
  },
  guideTitle: {
    fontSize: '0.9375rem',
    fontWeight: 700,
    color: '#111827',
    lineHeight: 1.25,
  },
  guideLead: {
    fontSize: '0.8125rem',
    color: '#4B5563',
    lineHeight: 1.6,
    marginBottom: theme.spacing(1.5),
  },
  stepList: {
    margin: 0,
    paddingLeft: theme.spacing(2.25),
    color: '#374151',
    fontSize: '0.8125rem',
    lineHeight: 1.75,
  },
  noteBox: {
    marginTop: theme.spacing(1.5),
    padding: theme.spacing(1.5, 2),
    borderRadius: 8,
    background: '#F8FAFC',
    border: '1px solid #E2E8F0',
  },
  noteTitle: {
    fontSize: '0.875rem',
    fontWeight: 700,
    color: '#1E3A8A',
    marginBottom: theme.spacing(0.5),
  },
  noteText: {
    fontSize: '0.8125rem',
    color: '#334155',
    lineHeight: 1.6,
  },
  divider: {
    margin: theme.spacing(3, 0, 0.5),
  },
  footerHint: {
    marginTop: theme.spacing(2.5),
    padding: theme.spacing(2.25),
    borderRadius: 8,
    background: 'linear-gradient(135deg, #F8FAFC 0%, #EFF6FF 100%)',
    border: '1px solid #DBEAFE',
  },
  footerHintTitle: {
    fontSize: '0.9375rem',
    fontWeight: 700,
    color: '#1E3A8A',
    marginBottom: theme.spacing(0.5),
  },
  footerHintText: {
    fontSize: '0.8125rem',
    color: '#334155',
    lineHeight: 1.55,
  },
}));

function SectionCard({
  id,
  title,
  icon,
  accent,
  lead,
  steps,
  noteTitle,
  noteText,
}: {
  id: string;
  title: string;
  icon: React.ElementType;
  accent: string;
  lead: string;
  steps: string[];
  noteTitle?: string;
  noteText?: string;
}) {
  const classes = useStyles();
  const Icon = icon;

  return (
    <Paper id={id} className={classes.guideCard} elevation={0}>
      <div className={classes.guideHeader}>
        <div className={classes.iconBox} style={{ background: accent }}>
          <Icon fontSize="small" />
        </div>
        <Typography className={classes.guideTitle}>{title}</Typography>
      </div>
      <Typography className={classes.guideLead}>{lead}</Typography>
      <ol className={classes.stepList}>
        {steps.map(step => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {noteTitle && noteText && (
        <div className={classes.noteBox}>
          <Typography className={classes.noteTitle}>{noteTitle}</Typography>
          <Typography className={classes.noteText}>{noteText}</Typography>
        </div>
      )}
    </Paper>
  );
}

export function DocumentationPage() {
  const classes = useStyles();
  const navigate = useNavigate();

  return (
    <div className={classes.root}>
      <div className={classes.topBar}>
        <Button
          className={classes.backButton}
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
        >
          Home Page
        </Button>
      </div>

      <div className={classes.hero}>
        <Chip label="BETA LAUNCH GUIDE" className={classes.heroBadge} />
        <Typography className={classes.title}>CloudHub Documentation</Typography>
        <Typography className={classes.subtitle}>
          This page is now the actual launch guide. Use it to learn the order,
          the prerequisites, and the approval flow before you touch the
          workflow pages.
        </Typography>
        <div className={classes.heroActions}>
          <Button
            variant="contained"
            color="primary"
            className={classes.heroButton}
            startIcon={<StorageIcon />}
            onClick={() => navigate('/deployment?stage=aks')}
          >
            Open AKS wizard
          </Button>
          <Button
            variant="contained"
            className={classes.heroButton}
            style={{ backgroundColor: '#0F766E', color: '#FFFFFF' }}
            startIcon={<BuildIcon />}
            onClick={() => navigate('/deployment?stage=common-res')}
          >
            Open common-res
          </Button>
          <Button
            variant="outlined"
            className={classes.heroButton}
            style={{ borderColor: '#FFFFFF', color: '#FFFFFF' }}
            startIcon={<VpnKeyIcon />}
            onClick={() => navigate('/eng-tools')}
          >
            Open 1Password tools
          </Button>
        </div>
      </div>

      <Typography className={classes.sectionTitle}>Start here</Typography>
      <Paper className={classes.introCard} elevation={0}>
        <ol className={classes.introList}>
          <li>Get access and 1Password first.</li>
          <li>Create the AKS cluster through the approval flow.</li>
          <li>Deploy common-res before any application workload.</li>
          <li>Deploy AIStore, DetectionHub, and SRI AML from the SRI page.</li>
          <li>Deploy NetReveal from its guided wizard.</li>
          <li>Finish with approvals and the customer overlay.</li>
        </ol>
        <div className={classes.toc}>
          {SECTION_LINKS.map(link => (
            <Chip
              key={link.id}
              component="a"
              href={`#${link.id}`}
              clickable
              label={link.label}
              className={classes.tocChip}
            />
          ))}
        </div>
      </Paper>

      <Typography className={classes.sectionTitle}>Beta launch runbook</Typography>
      <SectionCard
        id="access"
        title="Access and secrets"
        icon={VpnKeyIcon}
        accent="#1D4ED8"
        lead="Before you deploy anything, make sure you can sign in, access the repo, and retrieve shared credentials."
        steps={[
          'Open Engineering Tools and request 1Password access if you do not already have it.',
          'Keep shared secrets in 1Password or a synced secret source.',
          'Do not paste secrets into Helmfiles, tfvars, or PR comments.',
          'Confirm Azure, GitHub, and product permissions before moving on.',
        ]}
        noteTitle="Why this matters"
        noteText="If you cannot access 1Password or the right Azure/GitHub permissions, the rest of the launch flow will stop later and you will have to backtrack."
      />

      <SectionCard
        id="aks"
        title="Create the AKS cluster"
        icon={StorageIcon}
        accent="#7C3AED"
        lead="The AKS wizard is the platform foundation step. It creates the request, routes it through approval, and provisions the cluster only after the review is complete."
        steps={[
          'Choose the cluster profile, customer, subscription, region, and size.',
          'Review the generated plan carefully.',
          'Submit only when the plan looks correct.',
          'Wait for the approval chain to complete.',
          'Merge the generated PR so provisioning can start.',
          'Track the request until the cluster is ready.',
        ]}
        noteTitle="Rule"
        noteText="The generated plan is not approval. It is only the starting point for the workflow."
      />

      <SectionCard
        id="common-res"
        title="Deploy common-res"
        icon={BuildIcon}
        accent="#0F766E"
        lead="common-res installs the shared baseline that product workloads depend on. Deploy it before any product-specific stack."
        steps={[
          'Open the common-res stage.',
          'Select the CloudHub-eligible target cluster.',
          'Choose only the shared components you actually need.',
          'Use a clear application instance name so the pipeline payload is traceable.',
          'Deploy the shared baseline before product workloads.',
        ]}
      />

      <SectionCard
        id="sri"
        title="Deploy SRI workloads"
        icon={CloudUploadIcon}
        accent="#B91C1C"
        lead="The SRI page covers AIStore, DetectionHub, and SRI AML. Each option has a slightly different entry point, but all of them end in the deployment wizard."
        steps={[
          'AIStore is direct: choose the card, set the instance name, and deploy.',
          'DetectionHub opens a component picker first, then passes the selected component to the wizard.',
          'SRI AML is multi-module: pick the modules, give each module a unique instance name, and deploy each selected module through its gate.',
          'Use the history panel to confirm what has already been deployed.',
        ]}
        noteTitle="SRI launch order"
        noteText="Deploy common-res first if the selected SRI workload depends on shared operators or controllers."
      />

      <SectionCard
        id="netreveal"
        title="Deploy NetReveal"
        icon={SecurityIcon}
        accent="#0EA5E9"
        lead="NetReveal uses a guided wizard for Professional Services. Treat it like a controlled sequence, not a free-form form."
        steps={[
          'Pick the environment first.',
          'Choose the target cluster and namespace.',
          'Select the solution profile.',
          'Enable any required supporting components.',
          'Review the generated configuration.',
          'Deploy only when the review is correct.',
        ]}
        noteTitle="What the wizard does"
        noteText="It validates the environment, warns if a required engine is missing, and expects production work to go through review and approval."
      />

      <SectionCard
        id="approvals"
        title="Approvals and PRs"
        icon={LayersIcon}
        accent="#6B7280"
        lead="CloudHub uses a review-first process for infrastructure and deployment changes. Approval is a gate, not a formality."
        steps={[
          'For AKS requests, the reviewable plan is created first and Git work starts after approval is complete.',
          'For deployment requests, the wizard flow is Generate Helmfile → Validate → Send for Review & Approval → Approve → Deploy.',
          'Use the approval step to verify the payload before any deploy action.',
          'If a request is rejected, fix the source issue before resubmitting.',
        ]}
      />

      <SectionCard
        id="overlay"
        title="Customer overlay"
        icon={PeopleIcon}
        accent="#059669"
        lead="The customer overlay is the final step. It layers tenant-specific settings on top of the already deployed platform baseline."
        steps={[
          'Choose the customer and environment.',
          'Generate the overlay configuration.',
          'Review the overlay before applying it.',
          'Confirm the overlay is in place before handoff.',
        ]}
        noteTitle="Do not skip the baseline"
        noteText="The overlay assumes the platform baseline and workload deployment are already in place."
      />

      <Divider className={classes.divider} />

      <div className={classes.footerHint}>
        <Typography className={classes.footerHintTitle}>If you only remember one thing</Typography>
        <Typography className={classes.footerHintText}>
          Follow the order. Access first, AKS second, shared services third,
          workloads fourth, NetReveal next, then approvals and overlay. That is
          the sequence the beta launch depends on.
        </Typography>
      </div>

      <Typography className={classes.sectionTitle}>Runbook files</Typography>
      <Paper className={classes.introCard} elevation={0}>
        <ol className={classes.introList}>
          <li>docs/beta-launch/README.md</li>
          <li>docs/beta-launch/01-access-and-secrets.md</li>
          <li>docs/beta-launch/02-create-the-aks-cluster.md</li>
          <li>docs/beta-launch/03-deploy-common-res.md</li>
          <li>docs/beta-launch/04-deploy-sri-workloads.md</li>
          <li>docs/beta-launch/05-deploy-netreveal.md</li>
          <li>docs/beta-launch/06-approvals-and-prs.md</li>
          <li>docs/beta-launch/07-customer-overlay.md</li>
        </ol>
      </Paper>

      <Typography className={classes.sectionTitle} id="api-documentation">
        CloudHub API Explorer
      </Typography>
      <Paper className={classes.introCard} elevation={0}>
        <Typography className={classes.guideLead}>
          Browse the CloudHub control-plane and platform-registry APIs in the
          interactive Swagger reference.
        </Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<BuildIcon />}
          onClick={() => navigate('/api-docs')}
        >
          Open CloudHub API Explorer
        </Button>
      </Paper>

      <Button
        variant="text"
        style={{ marginTop: 16, textTransform: 'none', color: '#1D4ED8', fontWeight: 700 }}
        endIcon={<ArrowForwardIcon style={{ fontSize: 14 }} />}
        onClick={() => navigate('/deployment?stage=netreveal')}
      >
        Open NetReveal workflow if you need the live form
      </Button>
    </div>
  );
}
