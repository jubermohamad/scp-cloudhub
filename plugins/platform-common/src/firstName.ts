function isReservedIdentityValue(value?: string | null): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized === 'cloudhub-platform' ||
    normalized === 'cloudhub' ||
    normalized === 'user' ||
    normalized === 'unknown' ||
    normalized.split('@')[0]?.trim() === 'cloudhub-platform'
  );
}

export function getFirstName(
  identity:
    | {
        displayName?: string;
        email?: string;
        userEntityRef?: string;
      }
    | null
    | undefined,
) {
  const displayName = identity?.displayName?.trim();
  if (displayName && !isReservedIdentityValue(displayName)) {
    return displayName.split(/\s+/)[0];
  }

  const email = identity?.email?.trim();
  if (email && !isReservedIdentityValue(email)) {
    const localPart = email.split('@')[0]?.trim();
    const firstName = localPart?.split(/[._\s-]+/)[0]?.trim();
    if (firstName && !isReservedIdentityValue(firstName)) return firstName;
  }

  return 'User';
}