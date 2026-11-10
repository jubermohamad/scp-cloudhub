export interface StorageRuntimeConfig {
  accountName: string;
  resourceId: string | null;
  clientId: string | null;
  configured: boolean;
  source: 'env' | 'resource-id' | 'default';
}

export interface DataExportRuntimeConfig {
  storage: StorageRuntimeConfig;
}

function parseStorageAccountNameFromResourceId(
  resourceId: string | undefined,
): string | null {
  if (!resourceId) return null;
  const match = /\/storageAccounts\/([a-z0-9]{3,24})$/i.exec(
    resourceId.trim(),
  );
  return match?.[1]?.toLowerCase() ?? null;
}

export function resolveStorageRuntimeConfig(): StorageRuntimeConfig {
  const resourceId =
    process.env.CLOUDHUB_DATA_EXPORT_STORAGE_ACCOUNT_RESOURCE_ID?.trim() ||
    null;
  const accountFromEnv =
    process.env.CLOUDHUB_DATA_EXPORT_STORAGE_ACCOUNT?.trim() ||
    process.env.AZURE_STORAGE_ACCOUNT?.trim() ||
    null;
  const accountFromResourceId = parseStorageAccountNameFromResourceId(
    resourceId ?? undefined,
  );
  const accountName =
    accountFromEnv || accountFromResourceId || 'cloudhubdataexports';
  const source: StorageRuntimeConfig['source'] = accountFromEnv
    ? 'env'
    : accountFromResourceId
    ? 'resource-id'
    : 'default';
  const clientId =
    process.env.CLOUDHUB_DATA_EXPORT_STORAGE_CLIENT_ID?.trim() ||
    process.env.CLOUDHUB_DATA_EXPORT_STORAGE_SPN_CLIENT_ID?.trim() ||
    null;

  return {
    accountName,
    resourceId,
    clientId,
    configured: Boolean(accountFromEnv || accountFromResourceId),
    source,
  };
}

export function resolveRuntimeConfig(): DataExportRuntimeConfig {
  return {
    storage: resolveStorageRuntimeConfig(),
  };
}