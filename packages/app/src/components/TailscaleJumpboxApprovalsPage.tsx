import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

interface ApprovalStage {
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  approver?: string;
  decidedAt?: string;
}

interface RequestRecord {
  requestId: string;
  clusterName: string;
  clusterProfile?: string;
  status: string;
  requestor?: string;
  customer?: string;
  environment?: string;
  approvalChain?: ApprovalStage[];
  accessStatus?: string;
  tailscalePrUrl?: string;
  error?: string;
}

const statusColor = (status: string) => {
  switch (status) {
    case 'pending_approval':
      return 'warning';
    case 'awaiting_tailscale_merge':
      return 'info';
    case 'rejected':
      return 'error';
    case 'approved':
    case 'completed':
      return 'success';
    default:
      return 'default';
  }
};

const initialFormState = {
  name: '',
  email: '',
  githubUsername: '',
  jobTitle: '',
  department: '',
  location: '',
  requestedAccess: '',
  jiraTicket: '',
  accessSummary: '',
};

export const TailscaleJumpboxApprovalsPage = () => {
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [form, setForm] = useState(initialFormState);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const loadRequests = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/provisioning/requests');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to load requests');
      }
      setRequests(data.requests || []);
      setError('');
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to load requests.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRequests();
  }, []);

  const updateRequest = async (
    requestId: string,
    action: 'approve' | 'reject',
  ) => {
    setActioningId(requestId);
    try {
      const response = await fetch(`/api/provisioning/request/${requestId}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'Platform Team',
          approver: 'cloudhub-approver',
          reason: action === 'reject' ? 'Rejected via CloudHub approval UI' : undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Unable to ${action} request.`);
      }

      setError('');
      await loadRequests();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : `Unable to ${action} the request.`,
      );
    } finally {
      setActioningId(null);
    }
  };

  const updateField = (field: keyof typeof initialFormState, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const submitRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setSubmitMessage(null);

    try {
      const payload = {
        requestor: form.name,
        email: form.email,
        githubUsername: form.githubUsername,
        jobTitle: form.jobTitle,
        department: form.department,
        location: form.location,
        requestedAccess: form.requestedAccess,
        jiraTicket: form.jiraTicket,
        accessReason: form.accessSummary,
        customer: 'Symphony',
        environment: 'dev',
        businessUnit: form.department,
        clusterName: 'tailscale-jumpbox',
        clusterAdministrators: [form.githubUsername].filter(Boolean),
      };

      const response = await fetch('/api/provisioning/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to submit the request.');
      }

      setForm(initialFormState);
      setSubmitMessage(
        data?.requestId
          ? `Request submitted successfully. Request ID: ${data.requestId}`
          : 'Request submitted successfully.',
      );
      await loadRequests();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Submission failed.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      <Card sx={{ mb: 3, background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 100%)', color: 'white' }}>
        <CardContent>
          <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: 1.2 }}>
            Eng. Tools
          </Typography>
          <Typography variant="h3" sx={{ fontWeight: 700, mb: 1 }}>
            Tailscale Jumpbox Access
          </Typography>
          <Typography variant="body1" sx={{ opacity: 0.95 }}>
            Submit a jumpbox access request and review the approval flow in one place.
          </Typography>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
            Tailscale Access Request
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          {submitMessage && (
            <Alert severity="success" sx={{ mb: 3 }}>
              {submitMessage}
            </Alert>
          )}

          <form onSubmit={submitRequest}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Name"
                  value={form.name}
                  onChange={event => updateField('name', event.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={event => updateField('email', event.target.value)}
                  required
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="GitHub Username"
                  value={form.githubUsername}
                  onChange={event => updateField('githubUsername', event.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Job Title"
                  value={form.jobTitle}
                  onChange={event => updateField('jobTitle', event.target.value)}
                  required
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Department"
                  value={form.department}
                  onChange={event => updateField('department', event.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Location"
                  value={form.location}
                  onChange={event => updateField('location', event.target.value)}
                  required
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Requested Access"
                  value={form.requestedAccess}
                  onChange={event => updateField('requestedAccess', event.target.value)}
                  placeholder="jumpbox-scp-dev-plc-st-eng, jumpbox-scp-prd-eus-mt-all"
                  helperText="Tailscale group assignment(s)"
                  required
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Jira Ticket / Approval"
                  value={form.jiraTicket}
                  onChange={event => updateField('jiraTicket', event.target.value)}
                  placeholder="SCP-####"
                  required
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  minRows={4}
                  label="Access Summary"
                  value={form.accessSummary}
                  onChange={event => updateField('accessSummary', event.target.value)}
                  placeholder="Provide the reason for the request and the target environment(s)."
                  required
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Required Validation
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Confirm the GitHub user exists in the SymphonyFS GitHub organization, the requested groups exist in policy.hujson, and a ticket or approval has been raised per policy.
                </Typography>
              </Box>

              <Stack direction="row" spacing={2}>
                <Button type="button" variant="outlined" onClick={() => setForm(initialFormState)}>
                  Clear
                </Button>
                <Button type="submit" variant="contained" disabled={submitting}>
                  {submitting ? <CircularProgress size={18} color="inherit" /> : 'Submit Request'}
                </Button>
              </Stack>
            </Stack>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              Approval History
            </Typography>
            <Button variant="outlined" onClick={() => void loadRequests()}>
              Refresh
            </Button>
          </Stack>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Request ID</TableCell>
                    <TableCell>Requestor</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Approval Chain</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {requests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} align="center">
                        <Typography variant="body2" color="text.secondary">
                          No requests found.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    requests.map(request => (
                      <TableRow key={request.requestId}>
                        <TableCell sx={{ fontWeight: 600 }}>{request.requestId}</TableCell>
                        <TableCell>{request.requestor || 'n/a'}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={request.status}
                            color={statusColor(request.status) as any}
                          />
                        </TableCell>
                        <TableCell>
                          <Stack direction="column" spacing={0.5}>
                            {(request.approvalChain || []).map(stage => (
                              <Typography key={`${request.requestId}-${stage.role}`} variant="caption">
                                {stage.role}: {stage.status}
                              </Typography>
                            ))}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          {request.status === 'pending_approval' ? (
                            <Stack direction="row" spacing={1}>
                              <Button
                                size="small"
                                variant="contained"
                                color="success"
                                disabled={actioningId === request.requestId}
                                onClick={() => void updateRequest(request.requestId, 'approve')}
                              >
                                {actioningId === request.requestId ? (
                                  <CircularProgress size={14} color="inherit" />
                                ) : (
                                  'Approve'
                                )}
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="error"
                                disabled={actioningId === request.requestId}
                                onClick={() => void updateRequest(request.requestId, 'reject')}
                              >
                                Reject
                              </Button>
                            </Stack>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              {request.error || request.accessStatus || 'No action required'}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {requests.some(r => r.tailscalePrUrl) && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Tailscale PR Links
            </Typography>
            <Stack direction="column" spacing={1}>
              {requests
                .filter(r => r.tailscalePrUrl)
                .map(request => (
                  request.tailscalePrUrl ? (
                    <Button
                      key={request.requestId}
                      variant="text"
                      component="a"
                      href={request.tailscalePrUrl}
                      target="_blank"
                      rel="noreferrer"
                      sx={{ justifyContent: 'flex-start' }}
                    >
                      {request.requestId} — Tailscale PR
                    </Button>
                  ) : null
                ))}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};
