import { Alert, Box, Typography } from '@mui/material';

/** Explains who can do what. Mirrors the backend access rules. */
export function AccessModel() {
  return (
    <Alert severity="info" variant="outlined">
      <Typography variant="subtitle2" gutterBottom>
        Access model
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2 }}>
        <li>
          <strong>Platform admin</strong> (grp-cloudhub-data-export or
          CloudHubPlatformOwners): every tenant, the data catalog, clusters,
          agents, shared destinations, Platform Registry sync and the full
          audit log.
        </li>
        <li>
          <strong>Tenant admin</strong>{' '}
          (CloudHub.DataExport.Tenant.&lt;tenant&gt;.Admin): create, change,
          run, retry, cancel and delete that tenant&apos;s exports and jobs, and
          manage its destinations. Can use shared destinations but not change
          them.
        </li>
        <li>
          <strong>Tenant user</strong>{' '}
          (CloudHub.DataExport.Tenant.&lt;tenant&gt;.User): read-only view of
          that tenant&apos;s exports, executions, destinations, clusters and
          agents, and the whole data catalog.
        </li>
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        display="block"
        mt={1}
      >
        The UI hides actions you cannot take; the API enforces the same rules.
      </Typography>
    </Alert>
  );
}
