import { useCallback, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error';

interface ToastState {
  severity: ToastSeverity;
  message: string;
}

/** Snackbar feedback for actions. Render `toastElement` once in the page. */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback(
    (severity: ToastSeverity, message: string) =>
      setToast({ severity, message }),
    [],
  );
  const close = () => setToast(null);
  const toastElement = (
    <Snackbar
      open={Boolean(toast)}
      autoHideDuration={6000}
      onClose={close}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {toast ? (
        <Alert severity={toast.severity} variant="filled" onClose={close}>
          {toast.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );
  return { showToast, toastElement };
}
