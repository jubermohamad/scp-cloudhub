import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { makeStyles } from '@mui/styles';
import {
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { useBackendFetch } from '@internal/plugin-platform-common';

const useStyles = makeStyles(theme => ({
  formCard: {
    border: '1px solid #E5E7EB',
    borderRadius: 10,
    padding: theme.spacing(3),
    background: '#FFFFFF',
  },
  formTitle: {
    fontWeight: 700,
    fontSize: '1rem',
    color: '#111827',
    marginBottom: 4,
  },
  formSub: {
    fontSize: '0.8125rem',
    color: '#6B7280',
    marginBottom: theme.spacing(2.5),
  },
  compactField: {
    '& .MuiInputBase-input': {
      fontSize: '0.8125rem',
      paddingTop: 9,
      paddingBottom: 9,
    },
    '& .MuiInputLabel-root': { fontSize: '0.8125rem' },
    '& .MuiFormHelperText-root': {
      marginTop: 2,
      fontSize: '0.7rem',
      lineHeight: 1.3,
    },
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.25),
    marginTop: theme.spacing(3),
    paddingTop: theme.spacing(2.5),
    borderTop: '1px solid #E5E7EB',
    flexWrap: 'wrap',
  },
  reviewBtn: {
    borderRadius: 6,
    fontWeight: 700,
    fontSize: '0.875rem',
    textTransform: 'none',
    borderColor: '#6B21A8',
    color: '#6B21A8',
    '&:hover': { background: '#FAF5FF', borderColor: '#5B21B6' },
  },
  submitBtn: {
    borderRadius: 6,
    fontWeight: 700,
    fontSize: '0.875rem',
    textTransform: 'none',
    background: '#059669',
    color: '#FFFFFF',
    '&:hover': { background: '#047857' },
    '&:disabled': { background: '#D1D5DB', color: '#9CA3AF' },
  },
  clearBtn: {
    borderRadius: 6,
    fontWeight: 700,
    fontSize: '0.875rem',
    textTransform: 'none',
    color: '#6B7280',
    borderColor: '#D1D5DB',
    '&:hover': { background: '#F3F4F6' },
  },
  successBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#DCFCE7',
    border: '1px solid #86EFAC',
    borderRadius: 10,
    padding: '14px 20px',
    marginBottom: theme.spacing(2.5),
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#FEE2E2',
    border: '1px solid #FECACA',
    borderRadius: 10,
    padding: '14px 20px',
    marginBottom: theme.spacing(2.5),
  },
  infoBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#EFF6FF',
    border: '1px solid #BFDBFE',
    borderRadius: 10,
    padding: '14px 20px',
    marginBottom: theme.spacing(2.5),
  },
  bannerText: { fontWeight: 700, fontSize: '0.875rem' },
  reviewPanel: {
    borderRadius: 10,
    border: '1px solid #C4B5FD',
    background: '#FAF5FF',
    padding: theme.spacing(2, 2.5),
    marginTop: theme.spacing(2.5),
  },
  reviewTitle: {
    fontWeight: 800,
    fontSize: '0.875rem',
    color: '#5B21B6',
    marginBottom: 12,
  },
  reviewRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(0.625),
    '&:last-child': { marginBottom: 0 },
  },
  reviewKey: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#6B7280',
    minWidth: 170,
    flexShrink: 0,
  },
  reviewVal: {
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: '#111827',
    wordBreak: 'break-word',
  },
}));

type RequestType =
  | 'Repository Access'
  | 'Team Membership'
  | 'Organization Permission'
  | 'Repository Creation';

type LegacyFormValues = {
  organisation: string;
  repoName: string;
  accessLevel: string;
  team: string;
  justification: string;
};

type RepoCreationValues = {
  repositoryName: string;
  description: string;
  visibility: 'private' | 'internal' | 'public';
  ownerTeam: string;
  templateName: string;
  enableBranchProtection: boolean;
  enableCodeOwners: boolean;
  enableDependabot: boolean;
};

interface AuthorizationState {
  loading: boolean;
  authorized: boolean;
  enabled: boolean;
}

interface GitHubTeam {
  slug: string;
  name: string;
}

interface GitHubToolFormProps {
  accent: string;
  heroTitle: React.ReactNode;
  heroDesc: React.ReactNode;
}

const REPO_NAME_RE = /^[a-z0-9-]+$/;

export function GitHubToolForm({ accent, heroTitle, heroDesc }: GitHubToolFormProps) {
  const classes = useStyles();
  const backendFetch = useBackendFetch();

  const [requestType, setRequestType] = useState<RequestType>('Repository Access');
  const [legacyValues, setLegacyValues] = useState<LegacyFormValues>({
    organisation: '',
    repoName: '',
    accessLevel: '',
    team: '',
    justification: '',
  });
  const [repoValues, setRepoValues] = useState<RepoCreationValues>({
    repositoryName: '',
    description: '',
    visibility: 'private',
    ownerTeam: '',
    templateName: 'Empty',
    enableBranchProtection: true,
    enableCodeOwners: true,
    enableDependabot: true,
  });

  const [auth, setAuth] = useState<AuthorizationState>({
    loading: true,
    authorized: false,
    enabled: false,
  });
  const [teams, setTeams] = useState<GitHubTeam[]>([]);
  const [templates, setTemplates] = useState<string[]>(['Empty']);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message: string;
    repositoryUrl?: string;
  } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAuth() {
      try {
        const resp = await backendFetch(
          'deployment-control-plane',
          '/github/authorization',
        );
        const data = (await resp.json()) as {
          authorized?: boolean;
          enabled?: boolean;
        };
        if (!cancelled) {
          setAuth({
            loading: false,
            authorized: Boolean(data.authorized),
            enabled: Boolean(data.enabled),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setAuth({ loading: false, authorized: false, enabled: false });
        }
      }
    }

    void loadAuth();
    return () => {
      cancelled = true;
    };
  }, [backendFetch]);

  useEffect(() => {
    if (requestType !== 'Repository Creation') {
      return undefined;
    }

    let cancelled = false;
    setLoadingTeams(true);
    setLoadingTemplates(true);

    async function loadOptions() {
      try {
        const [teamsResp, templatesResp] = await Promise.all([
          backendFetch('deployment-control-plane', '/github/teams'),
          backendFetch('deployment-control-plane', '/github/templates'),
        ]);

        if (!cancelled) {
          if (teamsResp.ok) {
            const teamsData = (await teamsResp.json()) as {
              items?: GitHubTeam[];
            };
            setTeams(teamsData.items ?? []);
          }
          if (templatesResp.ok) {
            const templatesData = (await templatesResp.json()) as {
              items?: string[];
            };
            setTemplates(templatesData.items ?? ['Empty']);
          }
        }
      } catch (error) {
        // Ignore — the form can still be submitted with free-text values.
      } finally {
        if (!cancelled) {
          setLoadingTeams(false);
          setLoadingTemplates(false);
        }
      }
    }

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [backendFetch, requestType]);

  const isRepoCreation = requestType === 'Repository Creation';
  const canCreateRepo = auth.enabled && auth.authorized;

  const repoNameError = useMemo(() => {
    const name = repoValues.repositoryName.trim();
    if (!name) return null;
    if (name.length < 3 || name.length > 100) {
      return 'Repository name must be 3–100 characters.';
    }
    if (!REPO_NAME_RE.test(name)) {
      return 'Repository name may only contain lowercase letters, numbers, and hyphens.';
    }
    return null;
  }, [repoValues.repositoryName]);

  const handleLegacyChange =
    (id: keyof LegacyFormValues) => (e: ChangeEvent<HTMLInputElement>) => {
      setLegacyValues(prev => ({ ...prev, [id]: e.target.value }));
      setShowReview(false);
      setSubmitResult(null);
    };

  const handleRepoChange =
    (id: keyof RepoCreationValues) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setRepoValues(prev => ({ ...prev, [id]: value } as RepoCreationValues));
      setShowReview(false);
      setSubmitResult(null);
    };

  const handleRepoCheckbox =
    (id: keyof RepoCreationValues) =>
    (_e: ChangeEvent<HTMLInputElement>, checked: boolean) => {
      setRepoValues(prev => ({ ...prev, [id]: checked } as RepoCreationValues));
      setShowReview(false);
    };

  const handleClear = () => {
    setRequestType('Repository Access');
    setLegacyValues({
      organisation: '',
      repoName: '',
      accessLevel: '',
      team: '',
      justification: '',
    });
    setRepoValues({
      repositoryName: '',
      description: '',
      visibility: 'private',
      ownerTeam: '',
      templateName: 'Empty',
      enableBranchProtection: true,
      enableCodeOwners: true,
      enableDependabot: true,
    });
    setShowReview(false);
    setSubmitResult(null);
    setValidationError(null);
  };

  const handleReview = () => {
    if (isRepoCreation) {
      if (repoNameError) {
        setValidationError(repoNameError);
        return;
      }
      if (!repoValues.repositoryName.trim() || !repoValues.ownerTeam.trim()) {
        setValidationError('Repository name and owner team are required.');
        return;
      }
    }
    setValidationError(null);
    setShowReview(true);
  };

  const handleSubmit = async () => {
    if (isRepoCreation) {
      if (!canCreateRepo) {
        setSubmitResult({
          success: false,
          message: 'You are not authorized to create GitHub repositories.',
        });
        return;
      }
      if (repoNameError || !repoValues.repositoryName.trim()) {
        setValidationError(repoNameError ?? 'Repository name is required.');
        return;
      }
      if (!repoValues.ownerTeam.trim()) {
        setValidationError('Owner team is required.');
        return;
      }

      setSubmitting(true);
      setSubmitResult(null);
      setValidationError(null);

      try {
        const resp = await backendFetch(
          'deployment-control-plane',
          '/github/repositories',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repositoryName: repoValues.repositoryName.trim(),
              description: repoValues.description.trim(),
              visibility: repoValues.visibility,
              ownerTeam: repoValues.ownerTeam.trim(),
              templateName:
                repoValues.templateName === 'Empty'
                  ? undefined
                  : repoValues.templateName,
              enableBranchProtection: repoValues.enableBranchProtection,
              enableCodeOwners: repoValues.enableCodeOwners,
              enableDependabot: repoValues.enableDependabot,
            }),
          },
        );

        const data = (await resp.json()) as {
          success: boolean;
          message?: string;
          repositoryUrl?: string;
        };

        setSubmitResult({
          success: Boolean(data.success),
          message:
            data.message ??
            (data.success ? 'Repository created successfully.' : 'Request failed.'),
          repositoryUrl: data.repositoryUrl,
        });
      } catch (error) {
        setSubmitResult({
          success: false,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setSubmitting(false);
      }
    } else {
      setSubmitResult({
        success: true,
        message: `${requestType} request submitted successfully. You will receive a confirmation email shortly.`,
      });
    }
  };

  const reviewRows = useMemo(() => {
    if (isRepoCreation) {
      return [
        { key: 'Request Type', value: requestType },
        { key: 'Organisation', value: 'SymphonySensa' },
        { key: 'Repository Name', value: repoValues.repositoryName.trim() || '-' },
        { key: 'Description', value: repoValues.description.trim() || '-' },
        { key: 'Visibility', value: repoValues.visibility },
        { key: 'Owner Team', value: repoValues.ownerTeam.trim() || '-' },
        {
          key: 'Template Repository',
          value: repoValues.templateName,
        },
        {
          key: 'Branch Protection',
          value: repoValues.enableBranchProtection ? 'Enabled' : 'Disabled',
        },
        {
          key: 'CODEOWNERS',
          value: repoValues.enableCodeOwners ? 'Enabled' : 'Disabled',
        },
        {
          key: 'Dependabot',
          value: repoValues.enableDependabot ? 'Enabled' : 'Disabled',
        },
      ];
    }
    return [
      { key: 'Request Type', value: requestType },
      { key: 'Organisation', value: legacyValues.organisation || '-' },
      { key: 'Repository Name', value: legacyValues.repoName || '-' },
      { key: 'Access Level', value: legacyValues.accessLevel || '-' },
      { key: 'Team', value: legacyValues.team || '-' },
      { key: 'Justification', value: legacyValues.justification || '-' },
    ];
  }, [isRepoCreation, legacyValues, repoValues, requestType]);

  const submitDisabled =
    (isRepoCreation && !canCreateRepo) || submitting || (!isRepoCreation && !showReview);

  return (
    <div>
      <div
        className={classes.formCard}
        style={{
          background: `linear-gradient(135deg, ${accent} 0%, ${accent}CC 100%)`,
          color: '#FFFFFF',
          border: 'none',
          marginBottom: 24,
        }}
      >
        <Typography
          style={{ fontWeight: 700, fontSize: '1.25rem', marginBottom: 4 }}
        >
          {heroTitle}
        </Typography>
        <Typography style={{ fontSize: '0.875rem', opacity: 0.85 }}>
          {heroDesc}
        </Typography>
      </div>

      {submitResult?.success && (
        <div className={classes.successBanner}>
          <CheckCircleIcon
            style={{ color: '#059669', fontSize: 20, flexShrink: 0 }}
          />
          <Typography className={classes.bannerText} style={{ color: '#065F46' }}>
            {submitResult.repositoryUrl ? (
              <>
                {submitResult.message}{' '}
                <a
                  href={submitResult.repositoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#065F46', textDecoration: 'underline' }}
                >
                  Open repository
                </a>
              </>
            ) : (
              submitResult.message
            )}
          </Typography>
        </div>
      )}

      {submitResult && !submitResult.success && (
        <div className={classes.errorBanner}>
          <ErrorIcon
            style={{ color: '#DC2626', fontSize: 20, flexShrink: 0 }}
          />
          <Typography className={classes.bannerText} style={{ color: '#991B1B' }}>
            {submitResult.message}
          </Typography>
        </div>
      )}

      {isRepoCreation && auth.loading && (
        <div className={classes.infoBanner}>
          <CircularProgress size={20} style={{ color: '#1D4ED8' }} />
          <Typography className={classes.bannerText} style={{ color: '#1E40AF' }}>
            Checking repository provisioning authorization…
          </Typography>
        </div>
      )}

      {isRepoCreation && !auth.loading && !auth.enabled && (
        <div className={classes.errorBanner}>
          <ErrorIcon style={{ color: '#DC2626', fontSize: 20 }} />
          <Typography className={classes.bannerText} style={{ color: '#991B1B' }}>
            Repository provisioning is not enabled in this environment.
          </Typography>
        </div>
      )}

      {isRepoCreation && !auth.loading && auth.enabled && !auth.authorized && (
        <div className={classes.errorBanner} data-testid="auth-error-banner">
          <ErrorIcon style={{ color: '#DC2626', fontSize: 20 }} />
          <Typography className={classes.bannerText} style={{ color: '#991B1B' }}>
            You are not authorized to create GitHub repositories.
          </Typography>
        </div>
      )}

      {validationError && (
        <div className={classes.errorBanner}>
          <ErrorIcon style={{ color: '#DC2626', fontSize: 20 }} />
          <Typography className={classes.bannerText} style={{ color: '#991B1B' }}>
            {validationError}
          </Typography>
        </div>
      )}

      <div className={classes.formCard}>
        <Typography className={classes.formTitle}>GitHub Request</Typography>
        <Typography className={classes.formSub}>
          Select the request type and complete the required fields.
        </Typography>

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth variant="outlined" size="small">
              <InputLabel id="request-type-label">
                Request Type <span style={{ color: '#DC2626' }}>*</span>
              </InputLabel>
              <Select
                labelId="request-type-label"
                value={requestType}
                onChange={e => {
                  setRequestType(e.target.value as RequestType);
                  setShowReview(false);
                  setSubmitResult(null);
                  setValidationError(null);
                }}
                label="Request Type *"
                className={classes.compactField}
                inputProps={{ 'data-testid': 'request-type-select' }}
              >
                <MenuItem value="Repository Access">Repository Access</MenuItem>
                <MenuItem value="Team Membership">Team Membership</MenuItem>
                <MenuItem value="Organization Permission">
                  Organization Permission
                </MenuItem>
                <MenuItem value="Repository Creation">
                  Repository Creation
                </MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        {isRepoCreation ? (
          <Grid container spacing={2} style={{ marginTop: 4 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Organisation"
                value="SymphonySensa"
                disabled
                variant="outlined"
                size="small"
                className={classes.compactField}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                required
                label="Repository Name"
                value={repoValues.repositoryName}
                onChange={handleRepoChange('repositoryName')}
                error={Boolean(repoNameError)}
                helperText={
                  repoNameError ??
                  'Lowercase letters, numbers, and hyphens only. 3–100 characters.'
                }
                variant="outlined"
                size="small"
                className={classes.compactField}
                inputProps={{ 'data-testid': 'repo-name-input' }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                value={repoValues.description}
                onChange={handleRepoChange('description')}
                variant="outlined"
                size="small"
                className={classes.compactField}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth variant="outlined" size="small">
                <InputLabel id="visibility-label">Visibility *</InputLabel>
                <Select
                  labelId="visibility-label"
                  value={repoValues.visibility}
                  onChange={e =>
                    handleRepoChange('visibility')({
                      target: { value: e.target.value },
                    } as ChangeEvent<HTMLInputElement>)
                  }
                  label="Visibility *"
                  className={classes.compactField}
                >
                  <MenuItem value="private">Private</MenuItem>
                  <MenuItem value="internal">Internal</MenuItem>
                  <MenuItem value="public">Public</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              {loadingTeams ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 40,
                  }}
                >
                  <CircularProgress size={18} />
                  <Typography style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
                    Loading teams…
                  </Typography>
                </div>
              ) : (
                <FormControl fullWidth variant="outlined" size="small">
                  <InputLabel id="owner-team-label">Owner Team *</InputLabel>
                  <Select
                    labelId="owner-team-label"
                    value={repoValues.ownerTeam}
                    onChange={e =>
                      handleRepoChange('ownerTeam')({
                        target: { value: e.target.value },
                      } as ChangeEvent<HTMLInputElement>)
                    }
                    label="Owner Team *"
                    className={classes.compactField}
                    inputProps={{ 'data-testid': 'owner-team-select' }}
                  >
                    {teams.map(team => (
                      <MenuItem key={team.slug} value={team.slug}>
                        {team.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Grid>
            <Grid item xs={12} sm={6}>
              {loadingTemplates ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 40,
                  }}
                >
                  <CircularProgress size={18} />
                  <Typography style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
                    Loading templates…
                  </Typography>
                </div>
              ) : (
                <FormControl fullWidth variant="outlined" size="small">
                  <InputLabel id="template-label">
                    Template Repository
                  </InputLabel>
                  <Select
                    labelId="template-label"
                    value={repoValues.templateName}
                    onChange={e =>
                      handleRepoChange('templateName')({
                        target: { value: e.target.value },
                      } as ChangeEvent<HTMLInputElement>)
                    }
                    label="Template Repository"
                    className={classes.compactField}
                  >
                    {templates.map(template => (
                      <MenuItem key={template} value={template}>
                        {template}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={repoValues.enableBranchProtection}
                    onChange={handleRepoCheckbox('enableBranchProtection')}
                    color="primary"
                  />
                }
                label="Enable branch protection on main"
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={repoValues.enableCodeOwners}
                    onChange={handleRepoCheckbox('enableCodeOwners')}
                    color="primary"
                  />
                }
                label="Create CODEOWNERS file"
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={repoValues.enableDependabot}
                    onChange={handleRepoCheckbox('enableDependabot')}
                    color="primary"
                  />
                }
                label="Enable Dependabot"
              />
            </Grid>
          </Grid>
        ) : (
          <Grid container spacing={2} style={{ marginTop: 4 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                required
                label="Organisation"
                value={legacyValues.organisation}
                onChange={handleLegacyChange('organisation')}
                variant="outlined"
                size="small"
                className={classes.compactField}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                required
                label="Repository Name"
                value={legacyValues.repoName}
                onChange={handleLegacyChange('repoName')}
                variant="outlined"
                size="small"
                className={classes.compactField}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                select
                required
                label="Access Level"
                value={legacyValues.accessLevel}
                onChange={handleLegacyChange('accessLevel')}
                variant="outlined"
                size="small"
                className={classes.compactField}
              >
                <MenuItem value="Read">Read</MenuItem>
                <MenuItem value="Write">Write</MenuItem>
                <MenuItem value="Maintain">Maintain</MenuItem>
                <MenuItem value="Admin">Admin</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Team Name (optional)"
                value={legacyValues.team}
                onChange={handleLegacyChange('team')}
                variant="outlined"
                size="small"
                className={classes.compactField}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                multiline
                rows={3}
                label="Justification"
                value={legacyValues.justification}
                onChange={handleLegacyChange('justification')}
                helperText="Describe why this access is needed."
                variant="outlined"
                size="small"
                className={classes.compactField}
              />
            </Grid>
          </Grid>
        )}

        {showReview && (
          <div className={classes.reviewPanel}>
            <Typography className={classes.reviewTitle}>
              Review — {requestType}
            </Typography>
            {reviewRows.map(row => (
              <div key={row.key} className={classes.reviewRow}>
                <span className={classes.reviewKey}>{row.key}</span>
                <span className={classes.reviewVal}>{row.value}</span>
              </div>
            ))}
          </div>
        )}

        <div className={classes.actions}>
          <Button
            variant="outlined"
            className={classes.reviewBtn}
            onClick={handleReview}
          >
            Review
          </Button>
          <Button
            variant="contained"
            className={classes.submitBtn}
            onClick={handleSubmit}
            disabled={submitDisabled}
          >
            {(() => {
              if (!isRepoCreation) {
                return 'Submit';
              }
              return submitting ? 'Creating…' : 'Create Repository';
            })()}
          </Button>
          <Button
            variant="outlined"
            className={classes.clearBtn}
            onClick={handleClear}
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
