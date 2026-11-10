import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { makeStyles } from '@mui/styles';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { OperationsTabs } from './OperationsTabs';

type TestCaseId =
  | 'api-reachable'
  | 'nodes-ready'
  | 'system-pods-ready'
  | 'argocd-apps-synced'
  | 'ootb-apps-present';

interface TestCase {
  id: TestCaseId;
  name: string;
  description: string;
}

interface RunResult {
  id: TestCaseId;
  name: string;
  status: 'passed' | 'failed';
  durationMs: number;
  command: string;
  stdout: string;
  stderr: string;
  error?: string;
}

interface RunResponse {
  summary: {
    total: number;
    passed: number;
    failed: number;
    startedAt: string;
    mode?: 'dry-run';
  };
  preview?: Array<{
    id: TestCaseId;
    name: string;
    description: string;
    command: string;
    args: string[];
    timeoutMs: number;
    commandText: string;
  }>;
  results: RunResult[];
}

const useStyles = makeStyles(theme => ({
  root: {
    padding: theme.spacing(3),
    maxWidth: 1500,
    margin: '0 auto',
  },
  title: {
    marginBottom: theme.spacing(0.5),
  },
  subtitle: {
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(3),
  },
  panel: {
    borderRadius: 10,
  },
  sectionTitle: {
    marginBottom: theme.spacing(1),
  },
  sectionDescription: {
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(2),
  },
  runActions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  },
  summaryRow: {
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
    marginBottom: theme.spacing(2),
  },
  resultCard: {
    marginBottom: theme.spacing(1.5),
    border: `1px solid ${theme.palette.divider}`,
  },
  resultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    flexWrap: 'wrap',
  },
  mono: {
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: '0.8rem',
    background:
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.05)'
        : 'rgba(0,0,0,0.04)',
    borderRadius: 6,
    padding: theme.spacing(1.25),
    marginTop: theme.spacing(1),
  },
  command: {
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    color: theme.palette.text.secondary,
    marginTop: theme.spacing(0.5),
  },
}));

export function K8sHealthCheckPage() {
  const classes = useStyles();
  const [loadingCases, setLoadingCases] = useState(true);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [selected, setSelected] = useState<Record<TestCaseId, boolean>>({
    'api-reachable': true,
    'nodes-ready': true,
    'system-pods-ready': true,
    'argocd-apps-synced': true,
    'ootb-apps-present': true,
  });
  const [clusterContext, setClusterContext] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [response, setResponse] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadCases = async () => {
      try {
        setLoadingCases(true);
        const res = await fetch('/api/k8s-health-check/test-cases');
        if (!res.ok) {
          throw new Error(`Failed to load test cases: HTTP ${res.status}`);
        }
        const data = await res.json();
        setTestCases(Array.isArray(data?.testCases) ? data.testCases : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingCases(false);
      }
    };

    loadCases();
  }, []);

  const selectedIds = useMemo(
    () => testCases.filter(tc => selected[tc.id]).map(tc => tc.id),
    [selected, testCases],
  );

  const runChecks = async (dryRun = false) => {
    setError(null);
    setResponse(null);
    setIsRunning(true);
    try {
      const res = await fetch('/api/k8s-health-check/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testCaseIds: selectedIds,
          clusterContext: clusterContext.trim() || undefined,
          dryRun,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Execution failed: HTTP ${res.status}`);
      }
      setResponse(data as RunResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Box className={classes.root}>
      <OperationsTabs />

      <Typography variant="h4" className={classes.title}>
        Kubernetes Health
      </Typography>
      <Typography variant="body2" className={classes.subtitle}>
        Run automated end-to-end cluster validation, including out-of-the-box
        platform app setup checks.
      </Typography>

      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <Card className={classes.panel}>
            <CardContent>
              <Typography variant="h6" className={classes.sectionTitle}>
                Test Selection
              </Typography>
              <Typography
                variant="body2"
                className={classes.sectionDescription}
              >
                Choose the checks to run against the current kubectl context or
                a specific cluster context name.
              </Typography>

              <TextField
                fullWidth
                label="Cluster Context (optional)"
                placeholder="aks-prod-eastus-001"
                value={clusterContext}
                onChange={e => setClusterContext(e.target.value)}
                variant="outlined"
                size="small"
              />

              <Box mt={2}>
                {loadingCases ? (
                  <CircularProgress size={20} />
                ) : (
                  testCases.map(tc => (
                    <FormControlLabel
                      key={tc.id}
                      control={
                        <Checkbox
                          color="primary"
                          checked={Boolean(selected[tc.id])}
                          onChange={(_, checked) =>
                            setSelected(prev => ({ ...prev, [tc.id]: checked }))
                          }
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2">{tc.name}</Typography>
                          <Typography variant="caption" color="textSecondary">
                            {tc.description}
                          </Typography>
                        </Box>
                      }
                    />
                  ))
                )}
              </Box>

              <Divider />

              <Box className={classes.runActions}>
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={() => runChecks(true)}
                  disabled={
                    isRunning || selectedIds.length === 0 || loadingCases
                  }
                >
                  Preview Commands
                </Button>
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={
                    isRunning ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <PlayArrowIcon />
                    )
                  }
                  onClick={() => runChecks(false)}
                  disabled={
                    isRunning || selectedIds.length === 0 || loadingCases
                  }
                >
                  {isRunning ? 'Running Checks...' : 'Run Automated Tests'}
                </Button>
                <Typography variant="caption" color="textSecondary">
                  {selectedIds.length} selected
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card className={classes.panel}>
            <CardContent>
              <Typography variant="h6" className={classes.sectionTitle}>
                Execution Results
              </Typography>

              {error && (
                <Paper
                  style={{
                    padding: 12,
                    marginBottom: 12,
                    border: '1px solid #ef9a9a',
                  }}
                >
                  <Typography variant="body2" color="error">
                    {error}
                  </Typography>
                </Paper>
              )}

              {!response && !error && (
                <Typography variant="body2" color="textSecondary">
                  No run yet. Select checks and click "Run Automated Tests".
                </Typography>
              )}

              {response && (
                <>
                  {response.summary.mode === 'dry-run' && (
                    <Paper
                      style={{
                        padding: 12,
                        marginBottom: 12,
                        border: '1px solid #90caf9',
                        background: 'rgba(144, 202, 249, 0.12)',
                      }}
                    >
                      <Typography variant="body2">
                        Dry-run preview only. No test commands were executed.
                      </Typography>
                    </Paper>
                  )}

                  <Box className={classes.summaryRow}>
                    <Chip
                      icon={<DoneAllIcon />}
                      label={`Passed: ${response.summary.passed}`}
                      style={{ backgroundColor: '#e8f5e9', color: '#1b5e20' }}
                    />
                    <Chip
                      icon={<ErrorOutlineIcon />}
                      label={`Failed: ${response.summary.failed}`}
                      style={{ backgroundColor: '#ffebee', color: '#b71c1c' }}
                    />
                    <Chip label={`Total: ${response.summary.total}`} />
                  </Box>

                  {(response.preview ?? []).map(preview => (
                    <Paper
                      key={`preview-${preview.id}`}
                      className={classes.resultCard}
                    >
                      <Box p={1.5}>
                        <Typography variant="subtitle2">
                          {preview.name}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {preview.description}
                        </Typography>
                        <Box className={classes.mono}>
                          {preview.commandText}
                        </Box>
                      </Box>
                    </Paper>
                  ))}

                  {response.results.map(result => (
                    <Paper key={result.id} className={classes.resultCard}>
                      <Box p={1.5}>
                        <Box className={classes.resultHeader}>
                          <Box>
                            <Typography variant="subtitle2">
                              {result.name}
                            </Typography>
                            <Typography className={classes.command}>
                              {result.command}
                            </Typography>
                          </Box>
                          <Box>
                            <Chip
                              label={result.status.toUpperCase()}
                              style={
                                result.status === 'passed'
                                  ? {
                                      backgroundColor: '#e8f5e9',
                                      color: '#1b5e20',
                                    }
                                  : {
                                      backgroundColor: '#ffebee',
                                      color: '#b71c1c',
                                    }
                              }
                            />
                          </Box>
                        </Box>

                        {result.error && (
                          <Typography
                            variant="caption"
                            color="error"
                            display="block"
                          >
                            {result.error}
                          </Typography>
                        )}

                        {result.stdout && (
                          <>
                            <Typography variant="caption" color="textSecondary">
                              stdout
                            </Typography>
                            <Box className={classes.mono}>{result.stdout}</Box>
                          </>
                        )}

                        {result.stderr && (
                          <>
                            <Typography variant="caption" color="textSecondary">
                              stderr
                            </Typography>
                            <Box className={classes.mono}>{result.stderr}</Box>
                          </>
                        )}
                      </Box>
                    </Paper>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
