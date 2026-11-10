import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface GuardOptions {
  shouldBlock: () => boolean;
  message?: string;
}

export interface UnsavedChangesGuard {
  guardedNavigate: (to: string) => void;
  confirmOpen: boolean;
  confirmMessage: string;
  onConfirmLeave: () => void;
  onCancelLeave: () => void;
}

export function useUnsavedChangesGuard({
  shouldBlock,
  message = 'You have unsaved changes. If you leave now, your draft will be lost.',
}: GuardOptions): UnsavedChangesGuard {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // null → use navigate(-1) (browser back); string → navigate to that path
  const pendingNavRef = useRef<string | null | undefined>(undefined);

  // Tab close / page refresh guard
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (shouldBlock()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [shouldBlock]);

  // In-app anchor click guard (capture phase — fires before React Router)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!shouldBlock()) return;
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (
        !href ||
        href.startsWith('#') ||
        anchor.target === '_blank' ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      try {
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) return;
      } catch {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      pendingNavRef.current = href;
      setConfirmOpen(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [shouldBlock]);

  // Browser back/forward guard
  useEffect(() => {
    // Push an extra entry so back-button fires popstate (which we can cancel)
    window.history.pushState(null, '', window.location.href);
    const onPopState = () => {
      if (!shouldBlock()) return;
      window.history.pushState(null, '', window.location.href);
      pendingNavRef.current = null; // null → navigate(-1) on confirm
      setConfirmOpen(true);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [shouldBlock]);

  const guardedNavigate = useCallback(
    (to: string) => {
      if (shouldBlock()) {
        pendingNavRef.current = to;
        setConfirmOpen(true);
      } else {
        navigate(to);
      }
    },
    [shouldBlock, navigate],
  );

  const onConfirmLeave = useCallback(() => {
    setConfirmOpen(false);
    const to = pendingNavRef.current;
    pendingNavRef.current = undefined;
    if (to) {
      navigate(to);
    } else {
      navigate(-1);
    }
  }, [navigate]);

  const onCancelLeave = useCallback(() => {
    setConfirmOpen(false);
    pendingNavRef.current = undefined;
  }, []);

  return {
    guardedNavigate,
    confirmOpen,
    confirmMessage: message,
    onConfirmLeave,
    onCancelLeave,
  };
}
