import { Paper, Stack, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

export function NoAccess({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 } }}>
      <Stack spacing={1} alignItems="center" textAlign="center">
        <LockOutlinedIcon color="disabled" fontSize="large" />
        <Typography variant="h6">{title}</Typography>
        <Typography color="text.secondary" maxWidth={520}>
          {message}
        </Typography>
      </Stack>
    </Paper>
  );
}
