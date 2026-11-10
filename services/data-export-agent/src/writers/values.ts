/**
 * Conversions from node-postgres row values to text for the text formats.
 *
 * node-postgres parses int2/int4/float to numbers, int8 and numeric to strings
 * (so no precision is lost), bool to boolean, date/timestamp to Date, bytea to
 * Buffer and json/jsonb/arrays to JS values. The text formats render:
 * Date as ISO 8601 UTC, Buffer as base64, objects and arrays as JSON.
 */
export function valueToText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
  }
  if (Buffer.isBuffer(value)) return value.toString('base64');
  return JSON.stringify(value, jsonReplacer);
}

/** Value for a JSON-lines record: JSON-native types kept, the rest as text. */
export function valueToJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return valueToText(value);
  if (Buffer.isBuffer(value)) return value.toString('base64');
  return value;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data).toString('base64');
  }
  return value;
}
