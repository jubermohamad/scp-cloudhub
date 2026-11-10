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
  Typography,
} from '@mui/material';
import { useAsync } from '../../hooks';
import type { Agent } from '../../types';
import { formatDateTime, formatRelative, prettyJson } from '../../utils';
import { CodeBlock } from '../common/CodeBlock';
import { DetailDrawer } from '../common/DetailDrawer';
import { DetailField } from '../common/DetailField';
import { useHub } from '../common/HubContext';
import { HealthChip } from '../common/StatusChip';

interface Props {
  agentId: string | null;
  /** Bumped by the page after edits so the drawer re-reads the agent. */
  version: number;
  onClose: () => void;
  onEdit: (agent: Agent) => void;
  onRemove: (agent: Agent) => void;
}

export function AgentDetailDrawer({
  agentId,
  version,
  onClose,
  onEdit,
  onRemove,
}: Props) {
  const { api, isPlatformAdmin } = useHub();
  const detail = useAsync(
    () => (agentId ? api.getAgent(agentId) : Promise.resolve(undefined)),
    [api, agentId, version],
  );
  const agent =
    detail.data && detail.data.id === agentId ? detail.data : undefined;

  return (
    <DetailDrawer
      open={Boolean(agentId)}
      onClose={onClose}
      title={agent?.agentName ?? (agent ? 'Unnamed agent' : 'Agent')}
      subtitle={
        agent && (
          <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
            <HealthChip health={agent.health} />
            <span>
              {agent.clusterName} · {agent.tenantId}
            </span>
          </Stack>
        )
      }
    >
      {detail.error && <Alert severity="error">{detail.error}</Alert>}
      {!agent && detail.loading && (
        <Skeleton variant="rectangular" height={240} />
      )}
      {agent && (
        <>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <DetailField label="Identity subject (Entra object id)" mono>
                {agent.identitySubject}
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Version">{agent.agentVersion}</DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Reported status">
                {agent.reportedStatus}
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Last seen">
                {agent.lastSeen
                  ? `${formatRelative(agent.lastSeen)} (${formatDateTime(
                      agent.lastSeen,
                    )})`
                  : 'Never'}
              </DetailField>
            </Grid>
            <Grid item xs={6}>
              <DetailField label="Registered">
                {formatDateTime(agent.createdAt)}
              </DetailField>
            </Grid>
          </Grid>

          {isPlatformAdmin && (
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => onEdit(agent)}
              >
                Edit agent
              </Button>
              <Button
                variant="outlined"
                size="small"
                color="error"
                onClick={() => onRemove(agent)}
              >
                Remove agent
              </Button>
            </Stack>
          )}

          <Divider />
          <Typography variant="subtitle2">Capabilities</Typography>
          {Object.keys(agent.capabilities).length ? (
            <CodeBlock ariaLabel="Capabilities">
              {prettyJson(agent.capabilities)}
            </CodeBlock>
          ) : (
            <Typography variant="body2" color="text.secondary">
              None declared.
            </Typography>
          )}

          <Typography variant="subtitle2">Recent heartbeats</Typography>
          {agent.heartbeats.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No heartbeats received yet.
            </Typography>
          ) : (
            <TableContainer
              sx={{
                maxHeight: 360,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              <Table size="small" stickyHeader aria-label="Recent heartbeats">
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Version</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {agent.heartbeats.map(beat => (
                    <TableRow key={beat.heartbeatTime}>
                      <TableCell>
                        {formatDateTime(beat.heartbeatTime)}
                      </TableCell>
                      <TableCell>{beat.status}</TableCell>
                      <TableCell>{beat.version ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}
    </DetailDrawer>
  );
}
