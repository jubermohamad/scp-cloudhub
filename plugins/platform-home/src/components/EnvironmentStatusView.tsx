import { Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Chip } from '@mui/material';
import { makeStyles } from '@mui/styles';

import { useEffect, useMemo, useState } from 'react';
import {
  useBackendFetch,
  usePersona,
} from '@internal/plugin-platform-common';
import { createPlatformRegistryApi } from './platformRegistryClient';
import type {
  Cluster,
  Deployment,
  Environment,
} from './platformRegistryClient';

// ─── Types ────────────────────────────────────────────────────────────────────

type EnvStatus =
  | 'running'
  | 'provisioning'
  | 'failed'
  | 'upgrading'
  | 'destroyed';

interface EnvironmentRow {
  id: string;
  name: string;
  tier: 'production' | 'staging' | 'development';
  region: string;
  status: EnvStatus;
  lastActivity: string;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles(theme => ({
  sectionTitle: {
    fontSize: '1.1rem',
    marginBottom: theme.spacing(2),
  },
  tableContainer: {
    borderRadius: 10,
    overflowX: 'auto',
    border: `1px solid ${theme.palette.divider}`,
  },
  tableHeader: {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? theme.palette.grey[800]
        : theme.palette.grey[50],
    '& th': {
      fontSize: '0.72rem',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: theme.palette.text.secondary,
      borderBottom: `2px solid ${theme.palette.divider}`,
    },
  },
  envName: {
    fontFamily: 'monospace',
    fontSize: '0.84rem',
  },
  timestamp: {
    fontSize: '0.75rem',
    color: theme.palette.text.disabled,
    whiteSpace: 'nowrap',
  },

  // Status chips
  chipRunning: {
    backgroundColor: '#e8f5e9',
    color: '#1b5e20',
    height: 22,
    fontSize: '0.7rem',
  },
  chipProvisioning: {
    backgroundColor: '#e3f2fd',
    color: '#0d47a1',
    height: 22,
    fontSize: '0.7rem',
  },
  chipUpgrading: {
    backgroundColor: '#fff3e0',
    color: '#e65100',
    height: 22,
    fontSize: '0.7rem',
  },
  chipFailed: {
    backgroundColor: '#fce4ec',
    color: '#b71c1c',
    height: 22,
    fontSize: '0.7rem',
  },
  chipDestroyed: {
    backgroundColor: theme.palette.grey[100],
    color: theme.palette.text.disabled,
    height: 22,
    fontSize: '0.7rem',
  },

  // Tier chips
  chipProd: {
    backgroundColor: '#fce4ec',
    color: '#880e4f',
    height: 20,
    fontSize: '0.65rem',
  },
  chipStaging: {
    backgroundColor: '#e3f2fd',
    color: '#0d47a1',
    height: 20,
    fontSize: '0.65rem',
  },
  chipDev: {
    backgroundColor: '#f3e5f5',
    color: '#4a148c',
    height: 20,
    fontSize: '0.65rem',
  },

}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function EnvStatusChip({
  status,
  classes,
}: {
  status: EnvStatus;
  classes: ReturnType<typeof useStyles>;
}) {
  const map: Record<EnvStatus, { cls: string; label: string }> = {
    running: { cls: classes.chipRunning, label: 'Running' },
    provisioning: { cls: classes.chipProvisioning, label: 'Provisioning' },
    upgrading: { cls: classes.chipUpgrading, label: 'Upgrading' },
    failed: { cls: classes.chipFailed, label: 'Failed' },
    destroyed: { cls: classes.chipDestroyed, label: 'Destroyed' },
  };
  const { cls, label } = map[status];
  return <Chip label={label} className={cls} size="small" />;
}

function TierChip({
  tier,
  classes,
}: {
  tier: EnvironmentRow['tier'];
  classes: ReturnType<typeof useStyles>;
}) {
  const map = {
    production: { cls: classes.chipProd, label: 'prod' },
    staging: { cls: classes.chipStaging, label: 'staging' },
    development: { cls: classes.chipDev, label: 'dev' },
  };
  const { cls, label } = map[tier];
  return <Chip label={label} className={cls} size="small" />;
}

function toEnvironmentTier(environmentType: string | null): EnvironmentRow['tier'] {
  const normalized = (environmentType ?? '').toLowerCase();
  if (normalized.includes('prod')) return 'production';
  if (normalized.includes('stage')) return 'staging';
  return 'development';
}

function mapEnvironmentStatus(status: Environment['status']): EnvStatus {
  switch (status) {
    case 'active':
      return 'running';
    case 'pending':
      return 'provisioning';
    case 'error':
      return 'failed';
    case 'inactive':
      return 'destroyed';
    default:
      return 'provisioning';
  }
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return '—';
  }

  const diffMinutes = Math.round((Date.now() - timestamp.getTime()) / 60000);
  if (diffMinutes < 1) {
    return 'Just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hr ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function pickLatestTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .map(value => (value ? new Date(value) : undefined))
    .filter(
      (value): value is Date =>
        value !== undefined && !Number.isNaN(value.getTime()),
    );

  if (timestamps.length === 0) {
    return null;
  }

  return timestamps
    .sort((left, right) => right.getTime() - left.getTime())[0]
    .toISOString();
}

function buildEnvironmentRows(
  environments: Environment[],
  clusters: Cluster[],
  deployments: Deployment[],
): EnvironmentRow[] {
  return environments.map(envRecord => {
    const matchingClusters = clusters.filter(
      cluster =>
        cluster.environmentId === envRecord.id ||
        cluster.environmentName === envRecord.environmentName,
    );
    const matchingDeployments = deployments.filter(deployment =>
      matchingClusters.some(
        cluster => cluster.id === deployment.deploymentTargetId,
      ),
    );
    const latestActivity = pickLatestTimestamp([
      envRecord.status === 'active' ? new Date().toISOString() : null,
      ...matchingClusters.flatMap(cluster => [
        cluster.lastSyncedAt,
        cluster.discoveredAt,
      ]),
      ...matchingDeployments.map(deployment => deployment.deployedAt),
    ]);

    const region = matchingClusters.length === 0
      ? '—'
      : Array.from(new Set(matchingClusters.map(cluster => cluster.region).filter(Boolean)))
          .slice(0, 2)
          .join(', ') || '—';

    return {
      id: envRecord.id,
      name: envRecord.platformName
        ? `${envRecord.platformName} / ${envRecord.environmentName}`
        : envRecord.environmentName,
      tier: toEnvironmentTier(envRecord.environmentType),
      region,
      status: mapEnvironmentStatus(envRecord.status),
      lastActivity: formatRelativeTime(latestActivity),
    };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EnvironmentStatusView() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const { persona } = usePersona();
  const registryApi = useMemo(
    () => createPlatformRegistryApi(backendFetch, persona),
    [backendFetch, persona],
  );
  const [rows, setRows] = useState<EnvironmentRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    Promise.all([
      registryApi.listEnvironments({ pageSize: 200 }),
      registryApi.listClusters({ pageSize: 200 }),
      registryApi.listDeployments({ pageSize: 200 }),
    ])
      .then(([environmentsResult, clustersResult, deploymentsResult]) => {
        if (!cancelled) {
          setRows(
            buildEnvironmentRows(
              environmentsResult.items,
              clustersResult.items,
              deploymentsResult.items,
            ),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [registryApi]);

  const renderTableBodyRows = () => {
    if (loading) {
      return (
        <TableRow>
          <TableCell colSpan={5}>
            <Typography className={classes.timestamp}>
              Loading live environment data...
            </Typography>
          </TableCell>
        </TableRow>
      );
    }

    if (rows.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={5}>
            <Typography className={classes.timestamp}>
              No environments found.
            </Typography>
          </TableCell>
        </TableRow>
      );
    }

    return rows.map(env => (
      <TableRow key={env.id} hover>
        <TableCell>
          <Typography className={classes.envName}>{env.name}</Typography>
        </TableCell>
        <TableCell>
          <TierChip tier={env.tier} classes={classes} />
        </TableCell>
        <TableCell>{env.region}</TableCell>
        <TableCell>
          <EnvStatusChip status={env.status} classes={classes} />
        </TableCell>
        <TableCell>
          <Typography className={classes.timestamp}>{env.lastActivity}</Typography>
        </TableCell>
      </TableRow>
    ));
  };

  return (
    <>
      <Typography className={classes.sectionTitle}>
        Environment Status
      </Typography>
      <TableContainer
        component={Paper}
        className={classes.tableContainer}
        elevation={0}
      >
        <Table size="small">
          <TableHead className={classes.tableHeader}>
            <TableRow>
              <TableCell>Environment</TableCell>
              <TableCell>Tier</TableCell>
              <TableCell>Region</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Last Activity</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>{renderTableBodyRows()}</TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
