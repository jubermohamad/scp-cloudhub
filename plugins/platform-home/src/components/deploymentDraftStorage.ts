export interface DeploymentDraft {
  form: {
    application: string;
    instanceName: string;
    clusterName: string;
    vault?: string;
    customer: string;
    chartVersion: string;
    aiStoreIntegration: boolean;
  };
  activeStep: number;
  bypassOnePasswordValidation: boolean;
  instanceOperation?: 'update-existing' | 'new-instance';
  deploymentId?: string;
  savedAt: string;
}

function storageKey(componentId: string): string {
  return `cloudhub:deploy-draft:${componentId}`;
}

export function saveDraft(componentId: string, draft: DeploymentDraft): void {
  try {
    sessionStorage.setItem(storageKey(componentId), JSON.stringify(draft));
  } catch {
    // sessionStorage unavailable (private mode, quota exceeded, etc.)
  }
}

export function loadDraft(componentId: string): DeploymentDraft | null {
  try {
    const raw = sessionStorage.getItem(storageKey(componentId));
    if (!raw) return null;
    return JSON.parse(raw) as DeploymentDraft;
  } catch {
    return null;
  }
}

export function clearDraft(componentId: string): void {
  try {
    sessionStorage.removeItem(storageKey(componentId));
  } catch {
    // ignore
  }
}

export function hasNonEmptyDraft(componentId: string): boolean {
  try {
    const raw = sessionStorage.getItem(storageKey(componentId));
    if (!raw) return false;
    const draft = JSON.parse(raw) as DeploymentDraft;
    const { form } = draft;
    return Boolean(
      form.application ||
        form.instanceName ||
        form.clusterName ||
        form.customer,
    );
  } catch {
    return false;
  }
}
