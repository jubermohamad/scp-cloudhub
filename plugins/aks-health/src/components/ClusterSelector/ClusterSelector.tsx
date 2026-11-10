import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  CircularProgress,
  Box,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DnsIcon from '@mui/icons-material/Dns';
import type { PlatformCluster } from '../../api/AksHealthApi';

interface ClusterSelectorProps {
  customers: string[];
  selectedCustomer: string;
  onSelectCustomer: (customer: string) => void;
  environments: string[];
  selectedEnvironment: string;
  onSelectEnvironment: (env: string) => void;
  clusters: PlatformCluster[];
  selectedClusterId: string;
  onSelectCluster: (clusterId: string) => void;
  onRunHealthCheck: () => void;
  isRunning: boolean;
  loadingClusters: boolean;
}

export const ClusterSelector: React.FC<ClusterSelectorProps> = ({
  customers,
  selectedCustomer,
  onSelectCustomer,
  environments,
  selectedEnvironment,
  onSelectEnvironment,
  clusters,
  selectedClusterId,
  onSelectCluster,
  onRunHealthCheck,
  isRunning,
  loadingClusters,
}) => {
  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <Box
        sx={{
          backgroundColor: '#f5f5f5',
          borderBottom: '1px solid #e6e6e6',
          px: 3,
          py: 1.5,
        }}
      >
        <Typography
          variant="h6"
          sx={{ fontWeight: 600, color: '#1e293b', fontSize: '1.1rem' }}
        >
          AKS Health Certification
        </Typography>
        <Typography variant="caption" sx={{ color: '#64748b' }}>
          Select cluster from Platform Registry to perform operational certification
        </Typography>
      </Box>
      <CardContent sx={{ p: 3 }}>
        <Grid container spacing={3} alignItems="center">
          <Grid item xs={12} sm={3}>
            <FormControl fullWidth size="small">
              <InputLabel id="customer-select-label">Customer</InputLabel>
              <Select
                labelId="customer-select-label"
                id="customer-select"
                value={selectedCustomer}
                label="Customer"
                onChange={e => onSelectCustomer(e.target.value)}
                disabled={isRunning || loadingClusters}
              >
                {customers.map(c => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={3}>
            <FormControl fullWidth size="small">
              <InputLabel id="environment-select-label">Environment</InputLabel>
              <Select
                labelId="environment-select-label"
                id="environment-select"
                value={selectedEnvironment}
                label="Environment"
                onChange={e => onSelectEnvironment(e.target.value)}
                disabled={isRunning || !selectedCustomer || loadingClusters}
              >
                {environments.map(env => (
                  <MenuItem key={env} value={env}>
                    {env}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small">
              <InputLabel id="cluster-select-label">Cluster</InputLabel>
              <Select
                labelId="cluster-select-label"
                id="cluster-select"
                value={selectedClusterId}
                label="Cluster"
                onChange={e => onSelectCluster(e.target.value)}
                disabled={isRunning || !selectedEnvironment || loadingClusters}
              >
                {clusters.map(cluster => (
                  <MenuItem key={cluster.id} value={cluster.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <DnsIcon fontSize="small" sx={{ color: '#64748b' }} />
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {cluster.clusterName}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                        ({cluster.region})
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={2}>
            <Button
              fullWidth
              variant="contained"
              onClick={onRunHealthCheck}
              disabled={isRunning || !selectedClusterId || loadingClusters}
              startIcon={
                isRunning ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <PlayArrowIcon />
                )
              }
              sx={{
                height: 40,
                backgroundColor: '#464feb',
                '&:hover': {
                  backgroundColor: '#373ec7',
                },
                textTransform: 'none',
                fontWeight: 600,
              }}
            >
              {isRunning ? 'Running...' : 'Run Health Check'}
            </Button>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};
export default ClusterSelector;
