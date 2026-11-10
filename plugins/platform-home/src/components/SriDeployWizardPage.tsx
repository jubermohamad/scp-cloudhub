import { useState } from 'react';
import {
  Box,
  Breadcrumbs,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link as MuiLink,
  Typography,
} from '@mui/material';
import { makeStyles } from '@mui/styles';
import { Link as RouterLink, useParams } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { SRI_COMPONENTS } from '@internal/plugin-platform-common';
import { DeploymentWizard } from './DeploymentWizard';
import { hasNonEmptyDraft, clearDraft } from './deploymentDraftStorage';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3),
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    [theme.breakpoints.down('sm')]: {
      padding: theme.spacing(2),
    },
  },
  breadcrumbs: {
    marginBottom: theme.spacing(2.5),
    fontSize: '0.875rem',
    '& .MuiBreadcrumbs-separator': {
      margin: '0 4px',
    },
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    marginBottom: theme.spacing(3),
  },
  notFound: {
    padding: theme.spacing(6),
    textAlign: 'center',
  },
}));

export function SriDeployWizardPage(): JSX.Element {
  const classes = useStyles();
  const { componentId } = useParams<{ componentId: string }>();
  const component = SRI_COMPONENTS.find(c => c.id === componentId);
  const resolvedAppName = component?.deployment.application ?? componentId;
  const resolvedTitle = component?.title ?? componentId ?? 'Application';
  const draftKey = component ? componentId : `sri-app:${resolvedAppName}`;
  const [refreshSignal, setRefreshSignal] = useState(0);
  void refreshSignal;

  const guard = useUnsavedChangesGuard({
    shouldBlock: () => Boolean(draftKey && hasNonEmptyDraft(draftKey)),
    message:
      'You have an unsaved draft for this deployment. Your form inputs will be restored when you come back, but you can also discard them now.',
  });

  const handleBack = () => guard.guardedNavigate('/sri');

  const handleDeployed = () => {
    if (draftKey) clearDraft(draftKey);
    setRefreshSignal(s => s + 1);
    guard.guardedNavigate('/sri');
  };

  if (!componentId || !resolvedAppName) {
    return (
      <div className={classes.root}>
        <div className={classes.notFound}>
          <Typography variant="h5" gutterBottom>
            Component not found
          </Typography>
          <Typography color="textSecondary" gutterBottom>
            The component ID "{componentId}" does not exist in the SRI catalog.
          </Typography>
          <Button
            component={RouterLink}
            to="/sri"
            variant="contained"
            startIcon={<ArrowBackIcon />}
          >
            Back to SRI Catalog
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={classes.root}>
      <Breadcrumbs className={classes.breadcrumbs}>
        <MuiLink
          component="button"
          underline="hover"
          color="inherit"
          onClick={handleBack}
          sx={{ cursor: 'pointer', background: 'none', border: 'none', font: 'inherit', padding: 0 }}
        >
          SRI Catalog
        </MuiLink>
        <Typography color="textPrimary">Deploy {resolvedTitle}</Typography>
      </Breadcrumbs>

      <Box className={classes.header}>
        <Typography variant="h4" fontWeight={700}>
          Deploy {resolvedTitle}
        </Typography>
        <Typography variant="body1" color="textSecondary">
          {component?.subtitle ?? `Deploy ${resolvedAppName} through the shared CloudHub deployment workflow.`}
        </Typography>
      </Box>

      <DeploymentWizard
        mode="page"
        draftKey={draftKey}
        open
        preselectedApp={resolvedAppName}
        deploymentLabel={resolvedTitle}
        onClose={handleBack}
        onDeployed={handleDeployed}
      />

      {/* Unsaved-changes confirm dialog */}
      <Dialog
        open={guard.confirmOpen}
        onClose={guard.onCancelLeave}
        maxWidth="xs"
      >
        <DialogTitle>Leave this page?</DialogTitle>
        <DialogContent>
          <Typography>{guard.confirmMessage}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={guard.onCancelLeave} variant="outlined">
            Stay
          </Button>
          <Button
            onClick={guard.onConfirmLeave}
            variant="contained"
            color="warning"
          >
            Leave anyway
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
