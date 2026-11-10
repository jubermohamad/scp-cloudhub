import { ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      aria-labelledby="dx-confirm-title"
    >
      <DialogTitle id="dx-confirm-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{children}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
