import type { Destination, DestinationType } from './types';

export interface DestinationFieldDef {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
  helperText?: string;
  /** Pre-filled for new destinations. */
  defaultValue?: string;
  /** Format check; `formatHint` explains it when the value does not match. */
  pattern?: RegExp;
  formatHint?: string;
}

/**
 * Configuration fields per destination type, shown dynamically in the wizard
 * and destination forms. Keys must match the backend's required fields.
 * Credentials are never entered here: ADLS uses the agent's workload identity
 * and SFTP keys live in Key Vault, referenced by `secretRef`.
 */
export const DESTINATION_FIELDS: Record<
  DestinationType,
  DestinationFieldDef[]
> = {
  ADLS_GEN2: [
    {
      key: 'accountName',
      label: 'Storage account',
      required: true,
      placeholder: 'stcustomerexports',
      pattern: /^[a-z0-9]{3,24}$/,
      formatHint: '3–24 lower-case letters and digits.',
    },
    {
      key: 'fileSystem',
      label: 'File system (container)',
      required: true,
      defaultValue: 'data-export-hub',
    },
    {
      key: 'path',
      label: 'Directory path',
      required: false,
      placeholder: 'netreveal/outbound',
      helperText:
        'Optional prefix. Files are always written under tenant/<tenant>/.',
    },
  ],
  SFTP: [
    {
      key: 'host',
      label: 'Host',
      required: true,
      placeholder: 'sftp.customer.example.com',
    },
    {
      key: 'port',
      label: 'Port',
      required: false,
      placeholder: '22',
      helperText: 'Optional, defaults to 22.',
      pattern: /^\d{1,5}$/,
      formatHint: 'A port number between 1 and 65535.',
    },
    { key: 'username', label: 'Username', required: true },
    {
      key: 'remotePath',
      label: 'Remote path',
      required: true,
      placeholder: '/outbound/netreveal',
    },
    {
      key: 'secretRef',
      label: 'Private key secret',
      required: true,
      placeholder: 'kv://vault/secret',
      helperText:
        'Key Vault reference to the SSH private key. Never paste keys or passwords here.',
      pattern: /^kv:\/\/[^/\s]+\/[^/\s]+$/,
      formatHint: 'Use kv://<vault>/<secret>.',
    },
    {
      key: 'hostKeyFingerprint',
      label: 'Host key fingerprint',
      required: true,
      placeholder: 'SHA256:...',
      helperText:
        'The server’s SSH host key fingerprint, used to pin the host.',
      pattern: /^SHA256:[A-Za-z0-9+/]+=*$/,
      formatHint: 'Use the OpenSSH form SHA256:<base64>.',
    },
  ],
};

/** Types that can be created. Older rows may carry other types (e.g. AWS_S3). */
export const CREATABLE_DESTINATION_TYPES: DestinationType[] = [
  'ADLS_GEN2',
  'SFTP',
];

const KNOWN_TYPE_LABELS: Record<string, string> = {
  ADLS_GEN2: 'ADLS Gen2',
  SFTP: 'SFTP',
};

/** Label for any destination type, including legacy ones the UI no longer creates. */
export function destinationTypeLabel(type: string | null | undefined): string {
  if (!type) return '—';
  return KNOWN_TYPE_LABELS[type] ?? type;
}

export function isCreatableDestinationType(
  type: string,
): type is DestinationType {
  return (CREATABLE_DESTINATION_TYPES as string[]).includes(type);
}

export const DESTINATION_TYPE_HELP: Record<DestinationType, string> = {
  ADLS_GEN2:
    'The cluster agent writes with its Azure workload identity; grant it Storage Blob Data Contributor on the file system. No secret is stored.',
  SFTP: 'The agent authenticates with an SSH private key held in Key Vault (secretRef) and verifies the server against the pinned host key fingerprint.',
};

export function initialDestinationConfig(
  type: DestinationType,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of DESTINATION_FIELDS[type]) {
    if (field.defaultValue) values[field.key] = field.defaultValue;
  }
  return values;
}

/** Every problem with a destination configuration, in field order. */
export function destinationConfigProblems(
  type: DestinationType,
  values: Record<string, string>,
): string[] {
  const problems: string[] = [];
  for (const field of DESTINATION_FIELDS[type]) {
    const value = (values[field.key] ?? '').trim();
    if (!value) {
      if (field.required) problems.push(`${field.label} is required.`);
      continue;
    }
    if (field.pattern && !field.pattern.test(value)) {
      problems.push(`${field.label}: ${field.formatHint ?? 'invalid format.'}`);
      continue;
    }
    if (field.key === 'port') {
      const port = Number(value);
      if (port < 1 || port > 65535) {
        problems.push(`${field.label}: ${field.formatHint}`);
      }
    }
  }
  return problems;
}

/** Trims values and drops blank optional fields so the backend applies its defaults. */
export function normaliseDestinationConfig(
  type: DestinationType,
  values: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of DESTINATION_FIELDS[type]) {
    const value = (values[field.key] ?? '').trim();
    if (value) result[field.key] = value;
  }
  return result;
}

/** A destination is usable by an export when it is shared or belongs to the export's tenant. */
export function destinationsForTenant<T extends Pick<Destination, 'tenantId'>>(
  destinations: T[],
  tenantId: string,
): T[] {
  return destinations.filter(
    destination =>
      destination.tenantId === null || destination.tenantId === tenantId,
  );
}

/** Destinations an export can deliver to: enabled, a supported type, and visible to the tenant. */
export function usableDestinations(
  destinations: Destination[],
  tenantId: string,
): Destination[] {
  return destinationsForTenant(destinations, tenantId).filter(
    destination =>
      destination.enabled && isCreatableDestinationType(destination.type),
  );
}
