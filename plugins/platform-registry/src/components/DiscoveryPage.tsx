import { useEffect, useMemo, useState } from 'react';
import {
  Content,
  ContentHeader,
  Header,
  Page,
  Progress,
  SupportButton,
} from '@backstage/core-components';
import { Box, Button, Card, CardContent, Checkbox, Chip, FormControl, InputLabel, MenuItem, Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import SearchIcon from '@mui/icons-material/Search';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { usePersona, useBackendFetch } from '@internal/plugin-platform-common';
import { createPlatformRegistryApi } from '../api';
import type { DiscoveredCluster, DiscoveryPreflightResult } from '../types';
import { FieldOption, useReferenceData } from './common/useReferenceData';
import { InlineAlert } from './common/InlineAlert';

const useStyles = makeStyles(theme => ({
  card: {
    backgroundColor: theme.palette.background.paper,
    borderRadius: theme.shape.borderRadius,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    marginBottom: theme.spacing(2),
  },
  field: {
    minWidth: 260,
  },
  toolbar: {
    display: 'flex',
    gap: theme.spacing(2),
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  headerCell: {
    fontWeight: 700,
    color: theme.palette.text.secondary,
    textTransform: 'uppercase',
    fontSize: '0.72rem',
    letterSpacing: '0.04em',
  },
  importBar: {
    display: 'flex',
    gap: theme.spacing(2),
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: theme.spacing(2),
  },
  noAccess: {
    padding: theme.spacing(4),
    textAlign: 'center',
  },
}));

function getPreflightStatusStyles(status: 'pass' | 'warn' | 'fail') {
  if (status === 'pass') {
    return { backgroundColor: '#e8f5e9', color: '#1b5e20' };
  }
  if (status === 'warn') {
    return { backgroundColor: '#fff7e6', color: '#9a6700' };
  }
  return { backgroundColor: '#fdecea', color: '#b71c1c' };
}

export function DiscoveryPage() {
  const classes = useStyles();
  const backendFetch = useBackendFetch();
  const { persona } = usePersona();
  const canAccess =
    persona === 'cloudhub-platform' ||
    persona === 'professional-services' ||
    persona === 'app-engineering' ||
    persona === 'sre';
  const canWrite = persona === 'cloudhub-platform';

  const api = useMemo(
    () => createPlatformRegistryApi(backendFetch, persona),
    [backendFetch, persona],
  );

  const { data: references } = useReferenceData(api, [
    'cloudAccounts',
    'platforms',
    'environments',
  ]);

  const cloudAccounts: FieldOption[] = references.cloudAccounts ?? [];
  const platforms: FieldOption[] = references.platforms ?? [];
  const environments: FieldOption[] = references.environments ?? [];

  const [cloudAccountId, setCloudAccountId] = useState('');
  const [discovered, setDiscovered] = useState<DiscoveredCluster[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [hasDiscovered, setHasDiscovered] = useState(false);
  const [preflighting, setPreflighting] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [preflight, setPreflight] =
    useState<DiscoveryPreflightResult | null>(null);

  const hasPreflightFailures = Boolean(
    preflight?.checks?.some(check => check.status === 'fail'),
  );

  const [platformId, setPlatformId] = useState('');
  const [environmentId, setEnvironmentId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  // Reset selection when discovery results change.
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const c of discovered) {
      next[c.clusterName] = !c.alreadyRegistered;
    }
    setSelected(next);
  }, [discovered]);

  const runPreflight = async (): Promise<DiscoveryPreflightResult | null> => {
    if (!cloudAccountId) return null;
    setPreflighting(true);
    setPreflightError(null);
    try {
      const result = await api.discoveryPreflight(cloudAccountId);
      setPreflight(result);
      return result;
    } catch (err) {
      setPreflightError(err instanceof Error ? err.message : String(err));
      setPreflight(null);
      return null;
    } finally {
      setPreflighting(false);
    }
  };

  useEffect(() => {
    if (!cloudAccountId) {
      setPreflight(null);
      setPreflightError(null);
      return;
    }
    void runPreflight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudAccountId]);

  const handleDiscover = async () => {
    if (!cloudAccountId || preflighting) return;

    let activePreflight = preflight;
    if (!activePreflight || activePreflight.cloudAccountId !== cloudAccountId) {
      activePreflight = await runPreflight();
    }

    if (
      activePreflight?.checks?.some(check => check.status === 'fail') ||
      !activePreflight
    ) {
      setDiscoverError(
        'Discovery blocked: preflight has failing checks. Resolve failures and retry.',
      );
      setHasDiscovered(false);
      setDiscovered([]);
      return;
    }

    setDiscovering(true);
    setDiscoverError(null);
    setImportedCount(null);
    try {
      const result = await api.discoverClusters(cloudAccountId);
      setDiscovered(result.items);
      setHasDiscovered(true);
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : String(err));
      setDiscovered([]);
    } finally {
      setDiscovering(false);
    }
  };

  const selectedClusters = discovered.filter(
    c => selected[c.clusterName] && !c.alreadyRegistered,
  );

  const handleImport = async () => {
    if (!platformId || selectedClusters.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await api.importClusters({
        platformId,
        environmentId: environmentId || null,
        cloudAccountId: cloudAccountId || null,
        clusters: selectedClusters,
      });
      setImportedCount(result.imported);
      // Mark imported clusters as registered.
      setDiscovered(prev =>
        prev.map(c =>
          selected[c.clusterName] && !c.alreadyRegistered
            ? { ...c, alreadyRegistered: true }
            : c,
        ),
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handlePreflight = async () => {
    await runPreflight();
  };

  if (!canAccess) {
    return (
      <Page themeId="tool">
        <Header
          title="Discover Clusters"
          subtitle="Platform Registry"
          type="Platform Registry"
        />
        <Content>
          <div className={classes.noAccess}>
            <Typography variant="h6">Access restricted</Typography>
            <Typography color="textSecondary">
              Cluster discovery is available to platform administrators and
              professional services personas.
            </Typography>
          </div>
        </Content>
      </Page>
    );
  }

  return (
    <Page themeId="tool">
      <Header
        title="Discover Clusters"
        subtitle="Platform Registry"
        type="Platform Registry"
      />
      <Content>
        <ContentHeader title="Cluster Discovery">
          <SupportButton>
            Scan a SymphonyAI-managed cloud account for Kubernetes clusters and
            import them into the registry.
          </SupportButton>
        </ContentHeader>

        <Card className={classes.card}>
          <CardContent>
            <div className={classes.toolbar}>
              <FormControl
                className={classes.field}
                variant="outlined"
                size="small"
              >
                <InputLabel>Platform Cloud Account</InputLabel>
                <Select
                  label="Platform Cloud Account"
                  value={cloudAccountId}
                  onChange={e => setCloudAccountId(e.target.value as string)}
                >
                  {cloudAccounts.length === 0 ? (
                    <MenuItem value="" disabled>
                      No cloud accounts available
                    </MenuItem>
                  ) : (
                    cloudAccounts.map(a => (
                      <MenuItem key={a.value} value={a.value}>
                        {a.label}
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
              <Button
                color="primary"
                variant="contained"
                startIcon={<SearchIcon />}
                disabled={
                  !cloudAccountId ||
                  discovering ||
                  preflighting ||
                  hasPreflightFailures
                }
                onClick={handleDiscover}
              >
                {discovering ? 'Discovering…' : 'Discover'}
              </Button>
              <Button
                variant="outlined"
                startIcon={<CheckCircleIcon />}
                disabled={!cloudAccountId || preflighting}
                onClick={handlePreflight}
              >
                {preflighting ? 'Checking…' : 'Run Preflight'}
              </Button>
            </div>

            {preflightError && (
              <Box mt={2}>
                <InlineAlert severity="error">{preflightError}</InlineAlert>
              </Box>
            )}

            {preflight && (
              <Box mt={2}>
                <InlineAlert severity={preflight.ready ? 'success' : 'warning'}>
                  {preflight.ready
                    ? `Preflight passed for ${preflight.provider} (${preflight.accountScope}).`
                    : `Preflight found blocking issues for ${preflight.provider} (${preflight.accountScope}).`}
                </InlineAlert>
                <Box mt={1}>
                  {preflight.checks.map(check => {
                    const statusStyles = getPreflightStatusStyles(check.status);
                    return (
                    <Box
                      key={check.id}
                      display="flex"
                      alignItems="center"
                      mb={0.75}
                      sx={{ gap: 1.25 }}
                    >
                      <Chip
                        size="small"
                        label={check.status.toUpperCase()}
                        style={{
                          backgroundColor: statusStyles.backgroundColor,
                          color: statusStyles.color,
                        }}
                      />
                      <Typography variant="body2" style={{ fontWeight: 600 }}>
                        {check.label}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {check.detail}
                      </Typography>
                    </Box>
                    );
                  })}
                </Box>
              </Box>
            )}

            {hasPreflightFailures && (
              <Box mt={2}>
                <InlineAlert severity="warning">
                  Discover is disabled until all preflight FAIL checks are
                  resolved.
                </InlineAlert>
              </Box>
            )}

            {discoverError && (
              <Box mt={2}>
                <InlineAlert severity="error">{discoverError}</InlineAlert>
              </Box>
            )}
          </CardContent>
        </Card>

        {discovering && <Progress />}

        {hasDiscovered && !discovering && (
          <Card className={classes.card}>
            <CardContent>
              {importedCount !== null && (
                <Box mb={2}>
                  <InlineAlert severity="success">
                    Imported {importedCount} cluster(s) into the registry.
                  </InlineAlert>
                </Box>
              )}
              {importError && (
                <Box mb={2}>
                  <InlineAlert severity="error">{importError}</InlineAlert>
                </Box>
              )}

              {discovered.length === 0 ? (
                <Typography color="textSecondary">
                  No clusters discovered for this account.
                </Typography>
              ) : (
                <>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox" />
                          <TableCell className={classes.headerCell}>
                            Cluster
                          </TableCell>
                          <TableCell className={classes.headerCell}>
                            Type
                          </TableCell>
                          <TableCell className={classes.headerCell}>
                            Region
                          </TableCell>
                          <TableCell className={classes.headerCell}>
                            Version
                          </TableCell>
                          <TableCell className={classes.headerCell}>
                            Nodes
                          </TableCell>
                          <TableCell className={classes.headerCell}>
                            State
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {discovered.map(c => (
                          <TableRow key={c.clusterName} hover>
                            <TableCell padding="checkbox">
                              <Checkbox
                                color="primary"
                                disabled={c.alreadyRegistered || !canWrite}
                                checked={
                                  !!selected[c.clusterName] &&
                                  !c.alreadyRegistered
                                }
                                onChange={e =>
                                  setSelected(prev => ({
                                    ...prev,
                                    [c.clusterName]: e.target.checked,
                                  }))
                                }
                              />
                            </TableCell>
                            <TableCell>{c.clusterName}</TableCell>
                            <TableCell>{c.clusterType}</TableCell>
                            <TableCell>{c.region}</TableCell>
                            <TableCell>{c.kubernetesVersion}</TableCell>
                            <TableCell>{c.nodeCount}</TableCell>
                            <TableCell>
                              {c.alreadyRegistered ? (
                                <Chip size="small" label="Registered" />
                              ) : (
                                <Chip
                                  size="small"
                                  color="primary"
                                  label="New"
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  {canWrite ? (
                    <div className={classes.importBar}>
                      <FormControl
                        className={classes.field}
                        variant="outlined"
                        size="small"
                      >
                        <InputLabel>Platform</InputLabel>
                        <Select
                          label="Platform"
                          value={platformId}
                          onChange={e =>
                            setPlatformId(e.target.value as string)
                          }
                        >
                          {platforms.map(t => (
                            <MenuItem key={t.value} value={t.value}>
                              {t.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControl
                        className={classes.field}
                        variant="outlined"
                        size="small"
                      >
                        <InputLabel>Environment (optional)</InputLabel>
                        <Select
                          label="Environment (optional)"
                          value={environmentId}
                          onChange={e =>
                            setEnvironmentId(e.target.value as string)
                          }
                        >
                          <MenuItem value="">
                            <em>None</em>
                          </MenuItem>
                          {environments.map(env => (
                            <MenuItem key={env.value} value={env.value}>
                              {env.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Button
                        color="primary"
                        variant="contained"
                        startIcon={<CloudDownloadIcon />}
                        disabled={
                          importing ||
                          !platformId ||
                          selectedClusters.length === 0 ||
                          hasPreflightFailures
                        }
                        onClick={handleImport}
                      >
                        {importing
                          ? 'Importing…'
                          : `Import ${selectedClusters.length} selected`}
                      </Button>
                    </div>
                  ) : (
                    <Box mt={2}>
                      <Typography variant="caption" color="textSecondary">
                        Importing clusters requires the platform administrator
                        persona.
                      </Typography>
                    </Box>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </Content>
    </Page>
  );
}
