/**
 * Writer selection: maps a profile's format and compression to a data file
 * name and a streaming writer.
 */
import path from 'path';
import { NonRetryableError } from '../errors';
import type { Compression, FileFormat } from '../protocol';
import type { FieldInfo } from '../sql/source';
import { ParquetRowWriter } from './parquetWriter';
import { TextRowWriter } from './textWriters';
import type { RowWriter } from './types';

export type { RowWriter, WrittenFile } from './types';

export const SUPPORTED_FORMATS: readonly FileFormat[] = [
  'PARQUET',
  'CSV',
  'TSV',
  'JSON',
];

const EXTENSIONS: Record<FileFormat, string> = {
  PARQUET: 'parquet',
  CSV: 'csv',
  TSV: 'tsv',
  JSON: 'jsonl',
};

/**
 * Checks the format/compression pair. Parquet compresses internally (per
 * column chunk) so it takes NONE/GZIP/SNAPPY; the text formats are gzipped as
 * a whole file or left plain, and SNAPPY has no standard whole-file framing,
 * so it is refused for them.
 */
export function validateFormat(
  format: FileFormat,
  compression: Compression,
): void {
  if (!SUPPORTED_FORMATS.includes(format)) {
    throw new NonRetryableError(`Unsupported file format ${String(format)}`);
  }
  if (!['NONE', 'GZIP', 'SNAPPY'].includes(compression)) {
    throw new NonRetryableError(
      `Unsupported compression ${String(compression)}`,
    );
  }
  if (compression === 'SNAPPY' && format !== 'PARQUET') {
    throw new NonRetryableError(
      `SNAPPY compression is only supported for PARQUET, not ${format}`,
    );
  }
}

/** Dataset ids become file names, so anything outside [A-Za-z0-9._-] is replaced. */
export function safeFileStem(datasetId: string): string {
  const stem = datasetId.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  return stem || 'dataset';
}

/** `<datasetId>.<parquet|csv|tsv|jsonl>[.gz]` */
export function dataFileName(
  datasetId: string,
  format: FileFormat,
  compression: Compression,
): string {
  validateFormat(format, compression);
  const gz = format !== 'PARQUET' && compression === 'GZIP' ? '.gz' : '';
  return `${safeFileStem(datasetId)}.${EXTENSIONS[format]}${gz}`;
}

export interface CreateWriterOptions {
  format: FileFormat;
  compression: Compression;
  datasetId: string;
  dir: string;
  fields: FieldInfo[];
}

/** Opens a writer for the given columns. Duplicate column names are refused (rows are keyed by name). */
export async function createRowWriter(
  options: CreateWriterOptions,
): Promise<RowWriter> {
  const name = dataFileName(
    options.datasetId,
    options.format,
    options.compression,
  );
  const filePath = path.join(options.dir, name);
  const seen = new Set<string>();
  for (const f of options.fields) {
    if (seen.has(f.name)) {
      throw new NonRetryableError(
        `Query returns the column "${f.name}" more than once; alias the columns so every name is unique`,
      );
    }
    seen.add(f.name);
  }
  if (options.format === 'PARQUET') {
    return ParquetRowWriter.open({
      name,
      path: filePath,
      fields: options.fields,
      compression: options.compression,
    });
  }
  return new TextRowWriter({
    format: options.format,
    gzip: options.compression === 'GZIP',
    name,
    path: filePath,
    columns: options.fields.map(f => f.name),
  });
}
