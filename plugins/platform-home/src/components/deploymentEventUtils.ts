export interface DeploymentEventLike {
  id: string;
  createdAt: string;
}

export function getHelmfileConsoleContent(
  previewContent: string | null | undefined,
  fallbackContent: string | null | undefined,
): string {
  const candidate = (previewContent ?? '').trim();
  if (candidate) {
    return candidate;
  }
  const fallback = (fallbackContent ?? '').trim();
  return fallback || 'Helmfile content is not available yet.';
}

export function mergeDeploymentEvents<T extends DeploymentEventLike>(
  existing: T[],
  incoming: T[],
): T[] {
  if (incoming.length === 0) {
    return existing;
  }

  const seen = new Set(existing.map(item => item.id));
  const added = incoming.filter(item => !seen.has(item.id));
  if (added.length === 0) {
    return existing;
  }

  return [...existing, ...added].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : 1,
  );
}
