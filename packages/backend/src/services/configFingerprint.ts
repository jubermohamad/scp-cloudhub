/**
 * Configuration fingerprint for approval integrity.
 *
 * Approvals are bound to the exact configuration they were given for. The
 * fingerprint is a SHA-256 over a canonical serialisation (object keys sorted
 * recursively, `undefined` dropped) so it is independent of key order and of
 * how the record round-trips through Postgres JSONB.
 */

import { createHash } from 'crypto';

/** Deterministic JSON: sorted keys at every level, undefined members dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value
      .map(item => (item === undefined ? 'null' : canonicalJson(item)))
      .join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(',')}}`;
}

/** `sha256:<hex>` fingerprint of the canonical form of `value`. */
export function configFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex')}`;
}
