import { useCallback, useState } from 'react';
import { errorMessage } from '../../utils';
import type { ToastSeverity } from './useToast';

/**
 * Runs row actions one at a time per key, reporting success or failure through
 * a toast. `busyKey` lets the grid disable the row's buttons while it runs.
 */
export function useActionRunner(
  showToast: (severity: ToastSeverity, message: string) => void,
) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const run = useCallback(
    async <R>(
      key: string,
      action: () => Promise<R>,
      success?: string | ((result: R) => string),
    ): Promise<R | undefined> => {
      setBusyKey(key);
      try {
        const result = await action();
        if (success) {
          showToast(
            'success',
            typeof success === 'function' ? success(result) : success,
          );
        }
        return result;
      } catch (error) {
        showToast('error', errorMessage(error));
        return undefined;
      } finally {
        setBusyKey(null);
      }
    },
    [showToast],
  );

  return { busyKey, run };
}
