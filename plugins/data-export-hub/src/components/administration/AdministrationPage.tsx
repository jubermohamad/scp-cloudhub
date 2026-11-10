import { ReactNode, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Button,
  Card,
  CardActions,
  CardContent,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { hubPaths } from '../../routes';
import { ClusterSyncButton } from '../clusters/ClusterSyncButton';
import { HubLayout } from '../common/HubLayout';
import { useHub } from '../common/HubContext';
import { useToast } from '../common/useToast';
import { DatasetFormDialog } from '../datasets/DatasetFormDialog';
import { AccessModel } from './AccessModel';
import { AuditLogGrid } from './AuditLogGrid';

export function AdministrationPage() {
  return (
    <HubLayout label="Administration" requirePlatformAdmin>
      <AdministrationContent />
    </HubLayout>
  );
}

function AdminCard({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: ReactNode;
}) {
  return (
    <Card
      variant="outlined"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <CardContent sx={{ flex: 1 }}>
        <Typography variant="h6" gutterBottom>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        {actions}
      </CardActions>
    </Card>
  );
}

function AdministrationContent() {
  const { api, filterOptions, reloadFilterOptions } = useHub();
  const { showToast, toastElement } = useToast();
  const [registering, setRegistering] = useState(false);

  return (
    <Stack spacing={3}>
      <AccessModel />

      <Grid container spacing={2}>
        <Grid item xs={12} md={6} lg={4}>
          <AdminCard
            title="Data catalog"
            description="Register product tables and views with their business description, classification, columns and lineage. Disable a dataset to stop it being added to exports."
            actions={
              <>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setRegistering(true)}
                >
                  Register dataset
                </Button>
                <Button component={RouterLink} to={hubPaths.datasets}>
                  Open catalog
                </Button>
              </>
            }
          />
        </Grid>
        <Grid item xs={12} md={6} lg={4}>
          <AdminCard
            title="Clusters"
            description="Pull AKS clusters from Platform Registry. New clusters are created, changed ones updated, and clusters removed from the registry are retired here (never deleted)."
            actions={
              <>
                <ClusterSyncButton
                  api={api}
                  variant="contained"
                  onSynced={() => reloadFilterOptions()}
                />
                <Button component={RouterLink} to={hubPaths.clusters}>
                  Open clusters
                </Button>
              </>
            }
          />
        </Grid>
        <Grid item xs={12} md={6} lg={4}>
          <AdminCard
            title="Agents"
            description="Register each cluster's export agent by its workload identity, review versions, capabilities and heartbeats, and remove agents that are decommissioned."
            actions={
              <Button component={RouterLink} to={hubPaths.agents}>
                Open agents
              </Button>
            }
          />
        </Grid>
      </Grid>

      <Stack spacing={1}>
        <Typography variant="h6">Audit log</Typography>
        <Typography variant="body2" color="text.secondary">
          Every change and system action, newest first.
        </Typography>
      </Stack>
      <AuditLogGrid />

      <DatasetFormDialog
        open={registering}
        api={api}
        catalog={filterOptions.datasets}
        onClose={() => setRegistering(false)}
        onSaved={created => {
          showToast('success', `Registered ${created.datasetId}`);
          reloadFilterOptions();
        }}
      />
      {toastElement}
    </Stack>
  );
}
