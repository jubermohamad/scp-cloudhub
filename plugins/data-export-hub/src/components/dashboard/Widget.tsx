import { ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@mui/material';

export function Widget({
  title,
  subheader,
  action,
  children,
}: {
  title: string;
  subheader?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardHeader
        title={title}
        subheader={subheader}
        action={action}
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
        subheaderTypographyProps={{ variant: 'caption' }}
        sx={{ pb: 0 }}
      />
      <CardContent>{children}</CardContent>
    </Card>
  );
}
