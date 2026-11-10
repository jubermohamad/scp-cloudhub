import { useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Grid,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useAsync, useInterval } from '../../hooks';
import { JOB_TRIGGER_LABELS, labelFor } from '../../labels';
import {
  downloadText,
  errorMessage,
  formatBytes,
  formatCount,
  formatDateTime,
  formatSeconds,
  isTerminalJob,
  prettyJson,
  shortId,
} from '../../utils';
import { CodeBlock } from '../common/CodeBlock';
import { DetailDrawer } from '../common/DetailDrawer';
import { DetailField } from '../common/DetailField';
import { useHub } from '../common/HubContext';
import { JobStatusChip } from '../common/StatusChip';

const POLL_MS = 10_000;

interface Props {
  jobId: string | null;
  onClose: () => void;
}

export function JobDetailDrawer({ jobId, onClose }: Props) {
  const { api } = useHub();
  const detail = useAsync(
    () => (jobId ? api.getJob(jobId) : Promise.resolve(undefined)),
    [api, jobId],
  );
  const job = detail.data && detail.data.id === jobId ? detail.data : undefined;
  useInterval(
    () => detail.reload({ silent: true }),
    job && !isTerminalJob(job.status) ? POLL_MS : null,
  );
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function download(kind: 'manifest' | 'logs') {
    if (!job) return;
    setDownloading(kind);
    setDownloadError(null);
    try {
      if (kind === 'manifest') {
        const text = await api.downloadManifest(job.id);
        downloadText(
          `job-${shortId(job.id)}-manifest.json`,
          text,
          'application/json',
        );
      } else {
        const text = await api.downloadLogs(job.id);
        downloadText(`job-${shortId(job.id)}.log`, text);
      }
    } catch (err) {
      setDownloadError(errorMessage(err));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <DetailDrawer
      open={Boolean(jobId)}
      onClose={onClose}
      width={680}
      title={
        job ? `${job.exportName} · ${job.datasetDisplayName}` : 'Execution'
      }
      subtitle={
        job && (
          <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
            <JobStatusChip status={job.status} />
            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
              {job.id}
            </Typography>
          </Stack>
        )
      }
    >
      {detail.error && <Alert severity="error">{detail.error}</Alert>}
      {downloadError && <Alert severity="error">{downloadError}</Alert>}
      {!job && detail.loading && (
        <Skeleton variant="rectangular" height={240} />
      )}
      {job && (
        <>
          {job.errorMessage && (
            <Alert severity="error">
              <Typography variant="subtitle2">Error</Typography>
              <Typography
                variant="body2"
                sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {job.errorMessage}
              </Typography>
            </Alert>
          )}

          <Grid container spacing={2}>
            <Grid item xs={6} sm={4}>
              <DetailField label="Tenant">{job.tenantId}</DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Cluster">{job.clusterName}</DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Agent">{job.assignedAgentName}</DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Trigger">
                {labelFor(JOB_TRIGGER_LABELS, job.trigger)}
                {job.requestedBy ? ` by ${job.requestedBy}` : ''}
              </DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Retries">
                {job.retryCount} / {job.maxRetries}
              </DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Priority">{job.priority}</DetailField>
            </Grid>
          </Grid>

          <Divider />
          <Typography variant="subtitle2">Timings</Typography>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={4}>
              <DetailField label="Created">
                {formatDateTime(job.createdAt)}
              </DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Scheduled">
                {formatDateTime(job.scheduledTime)}
              </DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Assigned">
                {formatDateTime(job.assignedTime)}
              </DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Started">
                {formatDateTime(job.startedTime)}
              </DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Completed">
                {formatDateTime(job.completedTime)}
              </DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Duration">
                {formatSeconds(job.durationSeconds)}
              </DetailField>
            </Grid>
          </Grid>

          <Divider />
          <Typography variant="subtitle2">Output</Typography>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={4}>
              <DetailField label="Rows">
                {formatCount(job.rowsExported)}
              </DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Data">
                {formatBytes(job.bytesExported)}
              </DetailField>
            </Grid>
            <Grid item xs={6} sm={4}>
              <DetailField label="Files delivered">
                {formatCount(job.filesDelivered)}
              </DetailField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <DetailField label="Watermark from" mono>
                {job.watermarkFrom}
              </DetailField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <DetailField label="Watermark to" mono>
                {job.watermarkTo}
              </DetailField>
            </Grid>
          </Grid>

          {job.outputFiles.length > 0 ? (
            <TableContainer
              sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}
            >
              <Table size="small" aria-label="Output files">
                <TableHead>
                  <TableRow>
                    <TableCell>File</TableCell>
                    <TableCell align="right">Size</TableCell>
                    <TableCell align="right">Records</TableCell>
                    <TableCell>SHA-256</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {job.outputFiles.map(file => (
                    <TableRow key={file.path}>
                      <TableCell sx={{ maxWidth: 260 }}>
                        <Typography variant="body2" noWrap title={file.name}>
                          {file.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          noWrap
                          title={file.path}
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {file.path}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {formatBytes(file.sizeBytes)}
                      </TableCell>
                      <TableCell align="right">
                        {formatCount(file.records)}
                      </TableCell>
                      <TableCell>
                        <Tooltip title={file.sha256}>
                          <Typography
                            variant="caption"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {file.sha256.slice(0, 12)}…
                          </Typography>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No output files recorded.
            </Typography>
          )}

          <Divider />
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="subtitle2">Manifest</Typography>
            <Button
              size="small"
              startIcon={<DownloadIcon />}
              disabled={!job.manifest || downloading !== null}
              onClick={() => download('manifest')}
            >
              Download
            </Button>
          </Stack>
          {job.manifest ? (
            <CodeBlock ariaLabel="Manifest">
              {prettyJson(job.manifest)}
            </CodeBlock>
          ) : (
            <Typography variant="body2" color="text.secondary">
              The manifest is written when the job completes.
            </Typography>
          )}

          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="subtitle2">Logs</Typography>
            <Button
              size="small"
              startIcon={<DownloadIcon />}
              disabled={!job.logs || downloading !== null}
              onClick={() => download('logs')}
            >
              Download
            </Button>
          </Stack>
          {job.logs ? (
            <CodeBlock ariaLabel="Logs" maxHeight={420}>
              {job.logs}
            </CodeBlock>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No logs reported yet.
            </Typography>
          )}
        </>
      )}
    </DetailDrawer>
  );
}
