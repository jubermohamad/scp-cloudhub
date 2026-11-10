import { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

/** Label/value pair used in drawers and detail pages. */
export function DetailField({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  const empty =
    children === null ||
    children === undefined ||
    children === '' ||
    (Array.isArray(children) && children.length === 0);
  return (
    <Box minWidth={0}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography
        variant="body2"
        component="div"
        sx={{
          wordBreak: 'break-word',
          ...(mono ? { fontFamily: 'monospace' } : {}),
        }}
      >
        {empty ? '—' : children}
      </Typography>
    </Box>
  );
}
