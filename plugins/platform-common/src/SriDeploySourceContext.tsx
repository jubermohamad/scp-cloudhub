import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { useBackendFetch } from './useBackendFetch';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SriDeploySource = 'cloudhub-native';

export interface SriDeploySourceContextValue {
  deploySource: SriDeploySource;
  pendingSource: SriDeploySource | null;
  isSaving: boolean;
  saveError: string | null;
  setDeploySource: (source: SriDeploySource) => void;
  saveDeploySource: () => Promise<void>;
  discardChanges: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const SRI_DEPLOY_SOURCE_STORAGE_KEY = 'cloudhub:sri_deploy_source';

const SriDeploySourceContext = createContext<SriDeploySourceContextValue>({
  deploySource: 'cloudhub-native',
  pendingSource: null,
  isSaving: false,
  saveError: null,
  setDeploySource: () => {},
  saveDeploySource: async () => {},
  discardChanges: () => {},
});

export function SriDeploySourceProvider({ children }: { children: ReactNode }) {
  const backendFetch = useBackendFetch();

  const [deploySource, setDeploySourceState] = useState<SriDeploySource>(() => {
    try {
      const stored = localStorage.getItem(SRI_DEPLOY_SOURCE_STORAGE_KEY);
      if (stored === 'cloudhub-native') {
        return stored;
      }
      return 'cloudhub-native';
    } catch {
      return 'cloudhub-native';
    }
  });

  const [pendingSource, setPendingSource] = useState<SriDeploySource | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const setDeploySource = (source: SriDeploySource) => {
    setPendingSource(source);
    setSaveError(null);
  };

  const saveDeploySource = async () => {
    if (pendingSource === null) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await backendFetch(
        'deployment-control-plane',
        '/settings/deployment',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sriDeploySource: pendingSource }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ?? `Failed to save setting (HTTP ${response.status})`,
        );
      }

      // Success: update both state and localStorage
      setDeploySourceState(pendingSource);
      setPendingSource(null);
      try {
        localStorage.setItem(SRI_DEPLOY_SOURCE_STORAGE_KEY, pendingSource);
      } catch {
        // localStorage may be unavailable
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save setting';
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const discardChanges = () => {
    setPendingSource(null);
    setSaveError(null);
  };

  // Sync across tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === SRI_DEPLOY_SOURCE_STORAGE_KEY) {
        const newValue = e.newValue;
        if (newValue === 'cloudhub-native') {
          setDeploySourceState(newValue);
          setPendingSource(null);
        }
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return (
    <SriDeploySourceContext.Provider
      value={{
        deploySource,
        pendingSource,
        isSaving,
        saveError,
        setDeploySource,
        saveDeploySource,
        discardChanges,
      }}
    >
      {children}
    </SriDeploySourceContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSriDeploySource(): SriDeploySourceContextValue {
  return useContext(SriDeploySourceContext);
}
