import {
  createContext,
  useEffect,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import {
  discoveryApiRef,
  fetchApiRef,
  identityApiRef,
  microsoftAuthApiRef,
  useApiHolder,
} from '@backstage/core-plugin-api';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PersonaId =
  | 'unassigned'
  | 'readonly'
  | 'cloudhub-platform'
  | 'app-engineering'
  | 'professional-services'
  | 'sre';

export type PersonaSource = 'identity' | 'local';

export interface PersonaIdentitySnapshot {
  userEntityRef: string;
  ownershipEntityRefs: string[];
  displayName?: string;
  email?: string;
}

export interface PersonaDef {
  id: PersonaId;
  /** Full display name */
  label: string;
  /** Short abbreviation shown on the FAB button */
  abbr: string;
  /** One-line description shown in the switcher panel */
  description: string;
  /** Brand colour for the dot and FAB */
  color: string;
}

function normalizeIdentityResponse(response: any) {
  return response?.identity ?? response;
}

// ─── Persona catalogue ────────────────────────────────────────────────────────

export const PERSONAS: PersonaDef[] = [
  {
    id: 'readonly',
    label: 'Read Only',
    abbr: 'RO',
    description: 'Read-only CloudHub access',
    color: '#607d8b',
  },
  {
    id: 'cloudhub-platform',
    label: 'Platform Admin',
    abbr: 'PA',
    description: 'Full platform administration and governance',
    color: '#1565c0',
  },
  {
    id: 'app-engineering',
    label: 'App Engineering',
    abbr: 'APP',
    description: 'Deploy and manage applications',
    color: '#2e7d32',
  },
  {
    id: 'professional-services',
    label: 'Professional Services',
    abbr: 'PS',
    description: 'Deploy and manage microservices',
    color: '#0277bd',
  },
  {
    id: 'sre',
    label: 'SRE',
    abbr: 'SRE',
    description: 'Operational visibility with read-only access',
    color: '#b71c1c',
  },
];

// ─── Context ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'cloudhub:active_persona';

interface PersonaContextValue {
  persona: PersonaId;
  setPersona: (id: PersonaId) => void;
  personaSource: PersonaSource;
  identity: PersonaIdentitySnapshot | null;
}

const PersonaContext = createContext<PersonaContextValue>({
  persona: 'unassigned',
  setPersona: () => {},
  personaSource: 'local',
  identity: null,
});

const GROUP_TO_PERSONA: Record<string, PersonaId> = {
  'group:default/cloudhub-login-allow': 'readonly',
  cloudhubloginallow: 'readonly',
  'group:default/cloudhubplatformowners': 'cloudhub-platform',
  cloudhubplatformowners: 'cloudhub-platform',
  'CloudHubPlatformOwners': 'cloudhub-platform',
  'group:default/cloudhubappeng': 'app-engineering',
  cloudhubappeng: 'app-engineering',
  'CloudHubAppEng': 'app-engineering',
  'group:default/cloudhubps': 'professional-services',
  cloudhubps: 'professional-services',
  'CloudHubPS': 'professional-services',
  'group:default/cloudhubsre': 'sre',
  cloudhubsre: 'sre',
  'CloudHubSRE': 'sre',
};

function resolvePersonaFromGroups(groups: string[]): PersonaId | null {
  const resolvedSet = new Set<PersonaId>();
  for (const group of groups) {
    const resolved = GROUP_TO_PERSONA[group.toLowerCase()];
    if (resolved) {
      resolvedSet.add(resolved);
    }
  }

  // Enforce deterministic precedence independent of incoming group order.
  if (resolvedSet.has('cloudhub-platform')) return 'cloudhub-platform';
  if (resolvedSet.has('app-engineering')) return 'app-engineering';
  if (resolvedSet.has('professional-services')) return 'professional-services';
  if (resolvedSet.has('sre')) return 'sre';
  if (resolvedSet.has('readonly')) return 'readonly';
  return null;
}

export function resolveIdentityApi(apiHolder: any) {
  if (!apiHolder) return undefined;

  const backstageIdentityApi = apiHolder.get(identityApiRef) as
    | {
        getBackstageIdentity: () => Promise<{ userEntityRef: string; ownershipEntityRefs?: string[] }>;
        getProfileInfo?: () => Promise<{ displayName?: string; email?: string }>;
      }
    | undefined;

  if (backstageIdentityApi) {
    return backstageIdentityApi;
  }

  const microsoftAuthApi = apiHolder.get(microsoftAuthApiRef) as
    | {
        getBackstageIdentity: () => Promise<{ userEntityRef: string; ownershipEntityRefs?: string[] }>;
        getProfile: () => Promise<{ displayName?: string; email?: string }>;
      }
    | undefined;

  if (!microsoftAuthApi) {
    return undefined;
  }

  return {
    getBackstageIdentity: async () =>
      normalizeIdentityResponse(await microsoftAuthApi.getBackstageIdentity()),
    getProfileInfo: async () => {
      const profile = await microsoftAuthApi.getProfile().catch(() => undefined);
      return {
        displayName: profile?.displayName,
        email: profile?.email,
      };
    },
  };
}

export const __test = {
  GROUP_TO_PERSONA,
  resolvePersonaFromGroups,
  resolveIdentityApi,
  normalizeIdentityResponse,
};

function readStoredPersona(): PersonaId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && PERSONAS.some(p => p.id === stored)) {
      return stored as PersonaId;
    }
  } catch {
    // localStorage unavailable (SSR / private browsing)
  }
  return 'unassigned';
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function PersonaProvider({ children }: { children: ReactNode }) {
  const apiHolder = useApiHolder();
  const discoveryApi = apiHolder.get(discoveryApiRef);
  const fetchApi = apiHolder.get(fetchApiRef);
  const [persona, setPersonaState] = useState<PersonaId>(readStoredPersona);
  const [personaSource, setPersonaSource] = useState<PersonaSource>('local');
  const [identity, setIdentity] = useState<PersonaIdentitySnapshot | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimeoutId: NodeJS.Timeout | undefined;

    // Try to resolve the identity API from available providers. Some APIs
    // register asynchronously, so retry multiple times with a short delay.
    // Increased to 30 attempts (15 seconds) to accommodate slower auth startup.
    let attempts = 0;
    const maxInitialAttempts = 30;
    const initialDelayMs = 500;
    let initialAttemptsComplete = false;

    const attemptResolve = async () => {
      attempts += 1;
      if (cancelled) return;

      const identityApi = resolveIdentityApi(apiHolder);

      if (!identityApi) {
        if (attempts < maxInitialAttempts) {
          retryTimeoutId = setTimeout(attemptResolve, initialDelayMs);
          return;
        }

        // Mark initial attempts as complete, but don't give up yet
        initialAttemptsComplete = true;
        
        if (!cancelled) {
          // Don't set identity to null, keep retrying in background
          setPersonaSource('local');
          // Schedule another attempt in 5 seconds
          retryTimeoutId = setTimeout(attemptResolve, 5000);
        }
        return;
      }

      try {
        const [retrievedIdentity, profileInfo] = await Promise.all([
          identityApi.getBackstageIdentity(),
            // `getProfileInfo` may be absent on some identity API implementations.
            (identityApi.getProfileInfo
              ? identityApi.getProfileInfo().catch(() => ({ displayName: undefined, email: undefined }))
              : Promise.resolve({ displayName: undefined, email: undefined })),
        ]);

        if (cancelled) return;

        const resolvedIdentity = normalizeIdentityResponse(retrievedIdentity);
        const snapshot: PersonaIdentitySnapshot = {
          userEntityRef: resolvedIdentity?.userEntityRef ?? '',
          ownershipEntityRefs: resolvedIdentity?.ownershipEntityRefs ?? [],
          displayName: profileInfo?.displayName,
          email: profileInfo?.email,
        };

        setIdentity(snapshot);

        if (discoveryApi && fetchApi) {
          try {
            const baseUrl = await discoveryApi.getBaseUrl(
              'deployment-control-plane',
            );
            const response = await fetchApi.fetch(
              `${baseUrl}/persona/permissions`,
            );
            if (response.ok) {
              const body = (await response.json()) as {
                persona?: PersonaId;
              };
              if (body?.persona) {
                setPersonaState(body.persona);
                setPersonaSource('identity');
                return;
              }
            }
          } catch {
            // Fall back to local group resolution below.
          }
        }

        const resolved = resolvePersonaFromGroups(snapshot.ownershipEntityRefs);
        if (resolved) {
          setPersonaState(resolved);
          setPersonaSource('identity');
          return;
        }

        // Authentication is independent from optional CloudHub group mapping.
        // Keep the verified identity available even when no persona is mapped.
        setPersonaState('unassigned');
        setPersonaSource('identity');
      } catch {
        if (!cancelled) {
          // On error, don't immediately set identity to null
          // Instead, keep retrying in the background
          if (initialAttemptsComplete) {
            retryTimeoutId = setTimeout(attemptResolve, 5000);
          }
        }
      }
    };

    attemptResolve();

    return () => {
      cancelled = true;
      if (retryTimeoutId) clearTimeout(retryTimeoutId);
    };
  }, [apiHolder, discoveryApi, fetchApi]);

  const setPersona = (id: PersonaId) => {
    if (personaSource !== 'identity') {
      setPersonaState(id);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // ignore
      }
    }
    // Cannot change persona when using identity-based persona source
  };

  return (
    <PersonaContext.Provider
      value={{ persona, setPersona, personaSource, identity }}
    >
      {children}
    </PersonaContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePersona(): PersonaContextValue {
  return useContext(PersonaContext);
}

// ─── RBAC Permissions Matrix ──────────────────────────────────────────────────
//
// Declares which personas may access each named capability.
// Mirrors the Access Matrix from the CloudHub RBAC design:
//
//  Capability                 Platform   AppEng  PS    SRE
//  cluster.create               ✅        ✅        ✅    ❌
//  cluster.view                 ✅        ✅        ✅    ✅
//  cluster.modify               ✅        ❌        ❌    ❌
//  service-wizard.run           ✅        ✅        ✅    ❌
//  service-wizard.approve       ✅        ❌        ❌    ❌
//  helmfile.modify              ✅        ❌        ❌    ❌
//  deployment.trigger           ✅        ✅        ✅    ❌
//  deployment.view              ✅        ✅        ✅    ✅
//  deployment.rollback          ✅        ❌        ❌    ❌
//  diagnostics.access           ✅        ❌        ❌    ✅
//  catalog.manage               ✅        ❌        ❌    ❌
//  catalog.read                 ✅        ✅        ✅    ✅
//  portal.readonly              ✅        ✅        ✅    ✅

export const PERSONA_PERMISSIONS: Record<string, PersonaId[]> = {
  // ── Cluster lifecycle ──────────────────────────────────────────────────────
  'cluster.create': [
    'cloudhub-platform',
    'app-engineering',
    'professional-services',
  ],
  'cluster.view': [
    'cloudhub-platform',
    'app-engineering',
    'professional-services',
    'sre',
  ],
  'cluster.modify': ['cloudhub-platform'],

  // ── Service Deployment Wizard (Step 2) ─────────────────────────────────────
  'service-wizard.run': [
    'cloudhub-platform',
    'app-engineering',
    'professional-services',
  ],
  'service-wizard.approve': ['cloudhub-platform'],

  // ── Helmfile / golden templates ────────────────────────────────────────────
  'helmfile.modify': ['cloudhub-platform'],

  // ── Deployments (Step 3) ───────────────────────────────────────────────────
  'deployment.trigger': [
    'cloudhub-platform',
    'app-engineering',
    'professional-services',
  ],
  'deployment.view': [
    'cloudhub-platform',
    'app-engineering',
    'professional-services',
    'sre',
  ],
  'deployment.rollback': ['cloudhub-platform'],

  // ── Observability & diagnostics ────────────────────────────────────────────
  'diagnostics.access': ['cloudhub-platform', 'sre'],

  // ── Software catalog ───────────────────────────────────────────────────────
  'catalog.manage': ['cloudhub-platform'],
  'catalog.read': [
    'cloudhub-platform',
    'app-engineering',
    'professional-services',
    'sre',
  ],

  // ── Read-only portal baseline ─────────────────────────────────────────────
  'portal.readonly': [
    'cloudhub-platform',
    'app-engineering',
    'professional-services',
    'sre',
  ],

  // ── Legacy keys (kept for backward compatibility with existing guards) ──────
  'environment-management': ['cloudhub-platform'],
  'deploy-microservice': [
    'cloudhub-platform',
    'app-engineering',
    'professional-services',
  ],
  'service-deployment-wizard': [
    'cloudhub-platform',
    'app-engineering',
    'professional-services',
  ],
  'environment-health': ['cloudhub-platform', 'sre'],
  'catalog-full': ['cloudhub-platform'],
  'workflows-full': ['cloudhub-platform', 'professional-services'],
};

// ─── usePersonaPermission ─────────────────────────────────────────────────────
//
// Returns true if the active persona is permitted for the given capability key.
//
// @example
//   const canRollback = usePersonaPermission('deployment.rollback');
//   if (!canRollback) return <AccessDenied />;

export function usePersonaPermission(key: string): boolean {
  const { persona } = usePersona();
  const allowed = PERSONA_PERMISSIONS[key] ?? [];
  return allowed.includes(persona);
}
