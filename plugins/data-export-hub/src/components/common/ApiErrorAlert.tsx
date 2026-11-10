import { Alert, Box } from '@mui/material';
import { DataExportApiError } from '../../api';
import { errorMessage } from '../../utils';

/** Error alert that lists server-side validation details when the API returns them. */
export function ApiErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const details = error instanceof DataExportApiError ? error.details : [];
  return (
    <Alert severity="error">
      {errorMessage(error)}
      {details.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 2 }}>
          {details.map(detail => (
            <li key={detail}>{detail}</li>
          ))}
        </Box>
      )}
    </Alert>
  );
}
