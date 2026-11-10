import { ReactNode } from 'react';
import { Box, Drawer, IconButton, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

interface Props {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

/** Right-hand detail panel; full width on phones. */
export function DetailDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  width = 560,
}: Props) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: width } } }}
    >
      <Stack spacing={2.5} p={3}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          spacing={1}
        >
          <Box minWidth={0}>
            <Typography variant="h6" sx={{ wordBreak: 'break-word' }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography
                variant="body2"
                color="text.secondary"
                component="div"
              >
                {subtitle}
              </Typography>
            )}
          </Box>
          <IconButton aria-label="Close details" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
        {children}
      </Stack>
    </Drawer>
  );
}
