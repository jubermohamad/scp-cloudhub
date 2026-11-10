import { useMemo, useState } from 'react';
import {
  Content,
  ContentHeader,
  Header,
  Page,
  SupportButton,
} from '@backstage/core-components';
import { Box, Button, Card, CardContent, Chip, Grid, Step, StepLabel, Stepper, TextField, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';

import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useNavigate } from 'react-router-dom';
import { usePersona, useBackendFetch } from '@internal/plugin-platform-common';
import { createPlatformRegistryApi } from '../api';
import type { OnboardPlatformInput } from '../types';
import { InlineAlert } from './common/InlineAlert';

const DEFAULT_ENVIRONMENTS = ['production', 'staging', 'development'];

const useStyles = makeStyles(theme => ({
  card: {
    backgroundColor: theme.palette.background.paper,
    borderRadius: theme.shape.borderRadius,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    marginBottom: theme.spacing(2),
  },
  field: {
    marginBottom: theme.spacing(2),
  },
  actions: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: theme.spacing(3),
  },
  envRow: {
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
    marginBottom: theme.spacing(2),
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
  },
  noAccess: {
    padding: theme.spacing(4),
    textAlign: 'center',
  },
  success: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: theme.spacing(6),
    textAlign: 'center',
  },
  successIcon: {
    fontSize: 64,
    color: theme.palette.success.main,
    marginBottom: theme.spacing(2),
  },
}));

const STEPS = ['Platform details', 'Environments', 'Review'];

export function OnboardingWizardPage() {
  const classes = useStyles();
  const navigate = useNavigate();
  const backendFetch = useBackendFetch();
  const { persona } = usePersona();
  const canWrite = persona === 'cloudhub-platform';

  const api = useMemo(
    () => createPlatformRegistryApi(backendFetch, persona),
    [backendFetch, persona],
  );

  const [activeStep, setActiveStep] = useState(0);

  // Platform
  const [platformCode, setPlatformCode] = useState('');
  const [platformName, setPlatformName] = useState('');
  const [platformType, setPlatformType] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');

  // Environments
  const [environments, setEnvironments] = useState<string[]>([
    ...DEFAULT_ENVIRONMENTS,
  ]);
  const [newEnv, setNewEnv] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const platformValid =
    platformCode.trim() !== '' && platformName.trim() !== '';
  const addEnvironment = () => {
    const value = newEnv.trim();
    if (value && !environments.includes(value)) {
      setEnvironments(prev => [...prev, value]);
    }
    setNewEnv('');
  };

  const removeEnvironment = (env: string) =>
    setEnvironments(prev => prev.filter(e => e !== env));

  const handleNext = () =>
    setActiveStep(s => Math.min(s + 1, STEPS.length - 1));
  const handleBack = () => setActiveStep(s => Math.max(s - 1, 0));

  const canAdvance = (activeStep === 0 && platformValid) || activeStep === 1;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    const payload: OnboardPlatformInput = {
      platform: {
        platformCode: platformCode.trim(),
        platformName: platformName.trim(),
        platformType: platformType.trim() || null,
        ownerEmail: ownerEmail.trim() || null,
      },
      cloudAccount: null,
      environments,
    };
    try {
      await api.onboardPlatform(payload);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!canWrite) {
    return (
      <Page themeId="tool">
        <Header
          title="Create Platform Context"
          subtitle="Platform Registry"
          type="Platform Registry"
        />
        <Content>
          <div className={classes.noAccess}>
            <Typography variant="h6">Access restricted</Typography>
            <Typography color="textSecondary">
              Platform context creation requires the platform administrator
              persona.
            </Typography>
          </div>
        </Content>
      </Page>
    );
  }

  return (
    <Page themeId="tool">
      <Header
        title="Create Platform Context"
        subtitle="Platform Registry"
        type="Platform Registry"
      />
      <Content>
        <ContentHeader title="Platform Context">
          <SupportButton>
            Create customer deployment context (platform and environments) using
            SymphonyAI-managed cloud infrastructure.
          </SupportButton>
        </ContentHeader>

        {done ? (
          <Card className={classes.card}>
            <CardContent className={classes.success}>
              <CheckCircleIcon className={classes.successIcon} />
              <Typography variant="h5" gutterBottom>
                Platform context created
              </Typography>
              <Typography color="textSecondary" gutterBottom>
                {platformName} ({platformCode}) has been created with{' '}
                {environments.length} environment(s).
              </Typography>
              <Box mt={3} display="flex" style={{ gap: 12 }}>
                <Button
                  color="primary"
                  variant="contained"
                  onClick={() => navigate('/platform-registry/platforms')}
                >
                  View Platforms
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => {
                    setDone(false);
                    setActiveStep(0);
                    setPlatformCode('');
                    setPlatformName('');
                    setPlatformType('');
                    setOwnerEmail('');
                    setEnvironments([...DEFAULT_ENVIRONMENTS]);
                  }}
                >
                  Create Another
                </Button>
              </Box>
            </CardContent>
          </Card>
        ) : (
          <Card className={classes.card}>
            <CardContent>
              <Stepper activeStep={activeStep} alternativeLabel>
                {STEPS.map(label => (
                  <Step key={label}>
                    <StepLabel>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>

              {error && (
                <Box mb={2}>
                  <InlineAlert severity="error">{error}</InlineAlert>
                </Box>
              )}

              {activeStep === 0 && (
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      className={classes.field}
                      label="Platform Code"
                      required
                      fullWidth
                      variant="outlined"
                      size="small"
                      value={platformCode}
                      onChange={e => setPlatformCode(e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      className={classes.field}
                      label="Platform Name"
                      required
                      fullWidth
                      variant="outlined"
                      size="small"
                      value={platformName}
                      onChange={e => setPlatformName(e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      className={classes.field}
                      label="Platform Type"
                      fullWidth
                      variant="outlined"
                      size="small"
                      value={platformType}
                      onChange={e => setPlatformType(e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      className={classes.field}
                      label="Owner Email"
                      fullWidth
                      variant="outlined"
                      size="small"
                      value={ownerEmail}
                      onChange={e => setOwnerEmail(e.target.value)}
                    />
                  </Grid>
                </Grid>
              )}

              {activeStep === 1 && (
                <Box>
                  <div className={classes.envRow}>
                    <TextField
                      label="Add environment"
                      variant="outlined"
                      size="small"
                      value={newEnv}
                      onChange={e => setNewEnv(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addEnvironment();
                        }
                      }}
                    />
                    <Button
                      startIcon={<AddIcon />}
                      variant="outlined"
                      onClick={addEnvironment}
                    >
                      Add
                    </Button>
                  </div>
                  <div className={classes.chips}>
                    {environments.length === 0 ? (
                      <Typography color="textSecondary">
                        No environments added.
                      </Typography>
                    ) : (
                      environments.map(env => (
                        <Chip
                          key={env}
                          label={env}
                          onDelete={() => removeEnvironment(env)}
                        />
                      ))
                    )}
                  </div>
                </Box>
              )}

              {activeStep === 2 && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Platform
                  </Typography>
                  <Typography color="textSecondary" gutterBottom>
                    {platformName} ({platformCode})
                    {platformType ? ` · ${platformType}` : ''}
                    {ownerEmail ? ` · ${ownerEmail}` : ''}
                  </Typography>

                  <Box mt={2}>
                    <Typography variant="subtitle2" gutterBottom>
                      Environments
                    </Typography>
                    <div className={classes.chips}>
                      {environments.length === 0 ? (
                        <Typography color="textSecondary">None</Typography>
                      ) : (
                        environments.map(env => <Chip key={env} label={env} />)
                      )}
                    </div>
                  </Box>
                </Box>
              )}

              <div className={classes.actions}>
                <Button
                  disabled={activeStep === 0 || submitting}
                  onClick={handleBack}
                >
                  Back
                </Button>
                {activeStep < STEPS.length - 1 ? (
                  <Button
                    color="primary"
                    variant="contained"
                    disabled={!canAdvance}
                    onClick={handleNext}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    color="primary"
                    variant="contained"
                    disabled={submitting || !platformValid}
                    onClick={handleSubmit}
                  >
                    {submitting ? 'Saving…' : 'Create Platform Context'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </Content>
    </Page>
  );
}
