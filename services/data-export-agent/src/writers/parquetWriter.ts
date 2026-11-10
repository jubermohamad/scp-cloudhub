/**
 * Streaming Parquet writer built on @dsnp/parquetjs. Rows are buffered only up
 * to one row group, then flushed to the hashing sink.
 */
import {
  ParquetSchema,
  ParquetWriter,
  type FieldDefinition,
  type ParquetCompression,
  type ParquetType,
} from '@dsnp/parquetjs';
import type { Compression } from '../protocol';
import type { FieldInfo } from '../sql/source';
import { HashingFileSink } from './hashingSink';
import type { RowWriter, WrittenFile } from './types';
import { valueToText } from './values';

/** PostgreSQL built-in type OIDs (pg_type.oid) that map to non-string Parquet types. */
export const PG_OID = {
  bool: 16,
  int8: 20,
  int2: 21,
  int4: 23,
  float4: 700,
  float8: 701,
  date: 1082,
  timestamp: 1114,
  timestamptz: 1184,
  numeric: 1700,
} as const;

/**
 * Parquet type for a PostgreSQL column type.
 *
 * `numeric` maps to UTF8, not DOUBLE: numeric columns hold money and exact
 * quantities, and a double silently rounds beyond 15-17 significant digits.
 * Consumers cast the string to DECIMAL with the precision they need. Every
 * type without an explicit mapping (text, uuid, json, arrays, intervals, ...)
 * is written as its text form.
 */
export function parquetTypeFor(oid: number): ParquetType {
  switch (oid) {
    case PG_OID.int2:
    case PG_OID.int4:
      return 'INT32';
    case PG_OID.int8:
      return 'INT64';
    case PG_OID.float4:
    case PG_OID.float8:
      return 'DOUBLE';
    case PG_OID.bool:
      return 'BOOLEAN';
    case PG_OID.date:
    case PG_OID.timestamp:
    case PG_OID.timestamptz:
      return 'TIMESTAMP_MILLIS';
    default:
      return 'UTF8';
  }
}

export function parquetCompression(
  compression: Compression,
): ParquetCompression {
  switch (compression) {
    case 'SNAPPY':
      return 'SNAPPY';
    case 'GZIP':
      return 'GZIP';
    case 'NONE':
    default:
      return 'UNCOMPRESSED';
  }
}

/** Builds the schema; all fields are OPTIONAL because any SELECT column can be NULL. */
export function buildParquetSchema(
  fields: FieldInfo[],
  compression: Compression,
): ParquetSchema {
  const codec = parquetCompression(compression);
  const definition: Record<string, FieldDefinition> = {};
  for (const field of fields) {
    definition[field.name] = {
      type: parquetTypeFor(field.dataTypeID),
      optional: true,
      compression: codec,
    };
  }
  return new ParquetSchema(definition);
}

function convert(type: ParquetType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'INT32':
    case 'DOUBLE':
    case 'BOOLEAN':
      return value;
    case 'INT64':
      return typeof value === 'number' ? BigInt(Math.trunc(value)) : value;
    case 'TIMESTAMP_MILLIS': {
      // 'infinity' / '-infinity' have no Parquet representation; written as NULL.
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isFinite(date.getTime()) ? date : null;
    }
    default:
      return valueToText(value);
  }
}

export class ParquetRowWriter implements RowWriter {
  private readonly sink: HashingFileSink;
  private readonly types: Array<[string, ParquetType]>;
  private writer?: ParquetWriter;
  private records = 0;

  private constructor(
    readonly name: string,
    readonly path: string,
    fields: FieldInfo[],
  ) {
    this.sink = new HashingFileSink(path);
    this.sink.on('error', () => {});
    this.types = fields.map(f => [f.name, parquetTypeFor(f.dataTypeID)]);
  }

  static async open(options: {
    name: string;
    path: string;
    fields: FieldInfo[];
    compression: Compression;
    rowGroupSize?: number;
  }): Promise<ParquetRowWriter> {
    const w = new ParquetRowWriter(options.name, options.path, options.fields);
    const schema = buildParquetSchema(options.fields, options.compression);
    // Only write(buf, cb) and end(cb) are used by the library.
    w.writer = await ParquetWriter.openStream(
      schema,
      w.sink as unknown as Parameters<typeof ParquetWriter.openStream>[1],
      {},
    );
    w.writer.setRowGroupSize(options.rowGroupSize ?? 10_000);
    return w;
  }

  get bytesWritten(): number {
    return this.sink.size;
  }

  async write(row: Record<string, unknown>): Promise<void> {
    const record: Record<string, unknown> = {};
    for (const [name, type] of this.types)
      record[name] = convert(type, row[name]);
    await this.writer!.appendRow(record);
    this.records += 1;
  }

  async finish(): Promise<WrittenFile> {
    await this.writer!.close();
    return {
      name: this.name,
      localPath: this.path,
      sizeBytes: this.sink.size,
      sha256: this.sink.sha256,
      records: this.records,
    };
  }

  async abort(): Promise<void> {
    this.sink.destroy();
  }
}
