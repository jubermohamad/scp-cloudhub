/**
 * GpuVnetManagementPanel — Admin UI for managing GPU VNets
 *
 * Allows platform admins to onboard, edit, and remove Virtual Networks
 * available for GPU instance creation. VNets can be configured for specific
 * GPU SKUs (A100, H100).
 */

import { useCallback, useEffect, useState } from 'react';
import { Paper, Typography, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormGroup, FormControlLabel, Checkbox, CircularProgress, Alert, IconButton, Chip } from '@mui/material';
import { makeStyles } from '@mui/styles';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CloudIcon from '@mui/icons-material/Cloud';
import { useBackendFetch } from '@internal/plugin-platform-common';

const useStyles = makeStyles(theme => ({
  root: {
    marginTop: theme.spacing(3),
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(2),
  },
  headerTitle: {
    fontWeight: 700,
    fontSize: '1rem',
    color: '#111827',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  headerIcon: {
    color: '#3b82f6',
  },
  addButton: {
    backgroundColor: '#3b82f6',
    color: '#fff',
    fontWeight: 600,
    textTransform: 'none',
    '&:hover': {
      backgroundColor: '#2563eb',
    },
  },
  tableContainer: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
  },
  tableHeader: {
    backgroundColor: '#f9fafb',
    '& th': {
      fontWeight: 700,
      color: '#374151',
      fontSize: '0.875rem',
    },
  },
  tableRow: {
    '&:hover': {
      backgroundColor: '#f3f4f6',
    },
  },
  skuChip: {
    marginRight: theme.spacing(0.5),
    fontSize: '0.75rem',
  },
  actions: {
    display: 'flex',
    gap: theme.spacing(1),
  },
  dialog: {},
  dialogContent: {
    minWidth: 500,
  },
  formField: {
    marginBottom: theme.spacing(2),
  },
  skuSection: {
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  skuLabel: {
    fontWeight: 600,
    fontSize: '0.875rem',
    marginBottom: theme.spacing(1),
    display: 'block',
    color: '#374151',
  },
  noData: {
    textAlign: 'center',
    padding: theme.spacing(4),
    color: '#9ca3af',
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(4),
  },
}));

export interface GpuVnetRecord {
  id: string;
  subscriptionId: string;
  resourceGroup: string;
  vnetName: string;
  region: string;
  gpuSkus: string[];
  createdAt: string;
  updatedAt: string;
}

interface VnetFormData {
  subscriptionId: string;
  resourceGroup: string;
  vnetName: string;
  region: string;
  gpuSkus: Record<string, boolean>;
}

const initialFormData: VnetFormData = {
  subscriptionId: '',
  resourceGroup: '',
  vnetName: '',
  region: '',
  gpuSkus: {
    a100: true,
    h100: true,
  },
};

export function GpuVnetManagementPanel() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const [vnets, setVnets] = useState<GpuVnetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [formData, setFormData] = useState<VnetFormData>(initialFormData);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load VNets
  const loadVnets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/admin/gpu-vnets',
      );
      if (!response.ok) {
        throw new Error('Failed to load VNets');
      }
      const data = await response.json();
      setVnets(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [backendFetch]);

  useEffect(() => {
    loadVnets();
  }, [loadVnets]);

  const handleOpenDialog = (vnet?: GpuVnetRecord) => {
    if (vnet) {
      setEditingId(vnet.id);
      setFormData({
        subscriptionId: vnet.subscriptionId,
        resourceGroup: vnet.resourceGroup,
        vnetName: vnet.vnetName,
        region: vnet.region,
        gpuSkus: {
          a100: vnet.gpuSkus.includes('a100'),
          h100: vnet.gpuSkus.includes('h100'),
        },
      });
    } else {
      setEditingId(null);
      setFormData(initialFormData);
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingId(null);
    setFormData(initialFormData);
  };

  const handleFormChange = (field: keyof Omit<VnetFormData, 'gpuSkus'>, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: field === 'region' ? value.toLowerCase() : value,
    }));
  };

  const handleSkuChange = (sku: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      gpuSkus: {
        ...prev.gpuSkus,
        [sku]: checked,
      },
    }));
  };

  const handleSave = async () => {
    setSubmitting(true);
    try {
      const gpuSkus = Object.entries(formData.gpuSkus)
        .filter(([, checked]) => checked)
        .map(([sku]) => sku);

      if (gpuSkus.length === 0) {
        setError('At least one GPU SKU must be selected');
        return;
      }

      const payload = {
        subscriptionId: formData.subscriptionId,
        resourceGroup: formData.resourceGroup,
        vnetName: formData.vnetName,
        region: formData.region,
        gpuSkus,
      };

      if (editingId) {
        // Update
        const response = await backendFetch(
          'deployment-control-plane',
          `/admin/gpu-vnets/${editingId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to update VNet');
        }
      } else {
        // Create
        const response = await backendFetch(
          'deployment-control-plane',
          '/admin/gpu-vnets',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to create VNet');
        }
      }

      handleCloseDialog();
      await loadVnets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;

    try {
      const id = deleteId;
      setDeleteId(null);
      const response = await backendFetch(
        'deployment-control-plane',
        `/admin/gpu-vnets/${id}`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        throw new Error('Failed to delete VNet');
      }

      await loadVnets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const submitButtonLabel = () => {
    if (submitting) {
      return <CircularProgress size={24} />;
    }
    return editingId ? 'Update' : 'Create';
  };

  const loadingContent = () => {
    if (loading) {
      return (
        <div className={classes.loading}>
          <CircularProgress />
        </div>
      );
    }
    if (vnets.length === 0) {
      return (
        <Paper className={classes.noData}>
          <Typography>No VNets configured yet. Add one to get started.</Typography>
        </Paper>
      );
    }
    return null;
  };

  return (
    <div className={classes.root}>
      <div className={classes.header}>
        <Typography className={classes.headerTitle}>
          <CloudIcon className={classes.headerIcon} />
          GPU VNet Onboarding
        </Typography>
        <Button
          variant="contained"
          className={classes.addButton}
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          Add VNet
        </Button>
      </div>

      {error && <Alert severity="error" onClose={() => setError(null)} style={{ marginBottom: 16 }} />}

      {loadingContent() || (
        <TableContainer className={classes.tableContainer}>
          <Table>
            <TableHead className={classes.tableHeader}>
              <TableRow>
                <TableCell>VNet Name</TableCell>
                <TableCell>Resource Group</TableCell>
                <TableCell>Region</TableCell>
                <TableCell>GPU SKUs</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {vnets.map(vnet => (
                <TableRow key={vnet.id} className={classes.tableRow}>
                  <TableCell>{vnet.vnetName}</TableCell>
                  <TableCell>{vnet.resourceGroup}</TableCell>
                  <TableCell>{vnet.region}</TableCell>
                  <TableCell>
                    {vnet.gpuSkus.map(sku => (
                      <Chip
                        key={sku}
                        label={sku.toUpperCase()}
                        size="small"
                        className={classes.skuChip}
                        variant="outlined"
                      />
                    ))}
                  </TableCell>
                  <TableCell>
                    <div className={classes.actions}>
                      <IconButton
                        size="small"
                        onClick={() => handleOpenDialog(vnet)}
                        title="Edit"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(vnet.id)}
                        title="Delete"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} className={classes.dialog}>
        <DialogTitle>{editingId ? 'Edit VNet' : 'Add New VNet'}</DialogTitle>
        <DialogContent className={classes.dialogContent}>
          <TextField
            fullWidth
            label="Subscription ID"
            value={formData.subscriptionId}
            onChange={e => handleFormChange('subscriptionId', e.target.value)}
            className={classes.formField}
            disabled={editingId !== null}
            placeholder="e.g., b0799078-b42a-4b59-9e70-22cd09a20ee2"
          />

          <TextField
            fullWidth
            label="Resource Group"
            value={formData.resourceGroup}
            onChange={e => handleFormChange('resourceGroup', e.target.value)}
            className={classes.formField}
            disabled={editingId !== null}
            placeholder="e.g., rg-scp-dev-itn-st-cms"
          />

          <TextField
            fullWidth
            label="VNet Name"
            value={formData.vnetName}
            onChange={e => handleFormChange('vnetName', e.target.value)}
            className={classes.formField}
            disabled={editingId !== null}
            placeholder="e.g., fr-napoleon-vnet"
          />

          <TextField
            fullWidth
            label="Region"
            value={formData.region}
            onChange={e => handleFormChange('region', e.target.value)}
            className={classes.formField}
            disabled={editingId !== null}
            placeholder="e.g., francecentral"
          />

          <div className={classes.skuSection}>
            <Typography className={classes.skuLabel}>GPU SKUs</Typography>
            <FormGroup>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.gpuSkus.a100}
                    onChange={e => handleSkuChange('a100', e.target.checked)}
                  />
                }
                label="NC24ads A100 v4"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.gpuSkus.h100}
                    onChange={e => handleSkuChange('h100', e.target.checked)}
                  />
                }
                label="NC80adis H100 v5"
              />
            </FormGroup>
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            color="primary"
            disabled={submitting}
          >
            {submitButtonLabel()}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteId)} onClose={() => setDeleteId(null)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete this VNet?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button onClick={confirmDelete} variant="contained" color="secondary">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
