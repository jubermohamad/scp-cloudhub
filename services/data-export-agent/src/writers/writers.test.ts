import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { ParquetReader } from '@dsnp/parquetjs';
import { NonRetryableError } from '../errors';
import type { FieldInfo } from '../sql/source';
import { createRowWriter, dataFileName, validateFormat } from './index';
import { buildParquetSchema, PG_OID, parquetTypeFor } from './parquetWriter';
import { csvField, tsvField } from './textWriters';

const fields: FieldInfo[] = [
  { name: 'id', dataTypeID: PG_OID.int4 },
  { name: 'big', dataTypeID: PG_OID.int8 },
  { name: 'name', dataTypeID: 25 },
  { name: 'amount', dataTypeID: PG_OID.numeric },
  { name: 'ratio', dataTypeID: PG_OID.float8 },
  { name: 'active', dataTypeID: PG_OID.bool },
  { name: 'created', dataTypeID: PG_OID.timestamptz },
  { name: 'tags', dataTypeID: 3802 },
];

const created = new Date('2026-10-01T12:34:56.789Z');
const rows: Record<string, unknown>[] = [
  {
    id: 1,
    big: '9007199254740993',
    name: 'plain',
    amount: '12345678901234567890.12',
    ratio: 0.5,
    active: true,
    created,
    tags: { a: [1, 2] },
  },
  {
    id: 2,
    big: '-5',
    name: 'needs, "quoting"\r\nand\ttabs\\',
    amount: null,
    ratio: null,
    active: false,
    created: null,
    tags: null,
  },
  {
    id: null,
    big: null,
    name: null,
    amount: '0',
    ratio: 1e-10,
    active: null,
    created,
    tags: [],
  },
];

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dxh-writers-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function writeAll(format: any, compression: any) {
  const writer = await createRowWriter({
    format,
    compression,
    datasetId: 'accounts',
    dir,
    fields,
  });
  for (const row of rows) await writer.write(row);
  return writer.finish();
}

function sha(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Minimal RFC 4180 parser for verification. */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      out.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  return out;
}

describe('file naming and validation', () => {
  it('builds data file names', () => {
    expect(dataFileName('accounts', 'PARQUET', 'SNAPPY')).toBe(
      'accounts.parquet',
    );
    expect(dataFileName('accounts', 'CSV', 'NONE')).toBe('accounts.csv');
    expect(dataFileName('accounts', 'TSV', 'GZIP')).toBe('accounts.tsv.gz');
    expect(dataFileName('accounts', 'JSON', 'GZIP')).toBe('accounts.jsonl.gz');
    expect(dataFileName('../etc/passwd', 'CSV', 'NONE')).toBe(
      '__etc_passwd.csv',
    );
  });

  it('refuses SNAPPY for text formats', () => {
    expect(() => validateFormat('CSV', 'SNAPPY')).toThrow(NonRetryableError);
    expect(() => validateFormat('JSON', 'SNAPPY')).toThrow(
      /only supported for PARQUET/,
    );
    expect(() => validateFormat('PARQUET', 'SNAPPY')).not.toThrow();
  });

  it('refuses duplicate column names', async () => {
    await expect(
      createRowWriter({
        format: 'CSV',
        compression: 'NONE',
        datasetId: 'x',
        dir,
        fields: [
          { name: 'id', dataTypeID: 23 },
          { name: 'id', dataTypeID: 23 },
        ],
      }),
    ).rejects.toThrow(/more than once/);
  });
});

describe('field encoding', () => {
  it('quotes CSV per RFC 4180', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(null)).toBe('');
    expect(csvField(created)).toBe('2026-10-01T12:34:56.789Z');
  });

  it('escapes TSV', () => {
    expect(tsvField('a\tb\nc\rd\\e')).toBe('a\\tb\\nc\\rd\\\\e');
  });
});

describe('CSV writer', () => {
  it('writes a header and RFC 4180 rows, with correct hash and size', async () => {
    const file = await writeAll('CSV', 'NONE');
    expect(file.name).toBe('accounts.csv');
    expect(file.records).toBe(3);
    expect(file.sizeBytes).toBe(fs.statSync(file.localPath).size);
    expect(file.sha256).toBe(sha(file.localPath));
    const parsed = parseCsv(fs.readFileSync(file.localPath, 'utf8'));
    expect(parsed[0]).toEqual(fields.map(f => f.name));
    expect(parsed[1]).toEqual([
      '1',
      '9007199254740993',
      'plain',
      '12345678901234567890.12',
      '0.5',
      'true',
      '2026-10-01T12:34:56.789Z',
      '{"a":[1,2]}',
    ]);
    expect(parsed[2][2]).toBe('needs, "quoting"\r\nand\ttabs\\');
    expect(parsed[3]).toEqual([
      '',
      '',
      '',
      '0',
      '1e-10',
      '',
      '2026-10-01T12:34:56.789Z',
      '[]',
    ]);
  });

  it('gzips when compression is GZIP', async () => {
    const file = await writeAll('CSV', 'GZIP');
    expect(file.name).toBe('accounts.csv.gz');
    expect(file.sha256).toBe(sha(file.localPath));
    const text = zlib
      .gunzipSync(fs.readFileSync(file.localPath))
      .toString('utf8');
    expect(parseCsv(text)).toHaveLength(4);
  });

  it('writes only a header for an empty result', async () => {
    const writer = await createRowWriter({
      format: 'CSV',
      compression: 'NONE',
      datasetId: 'e',
      dir,
      fields,
    });
    const file = await writer.finish();
    expect(file.records).toBe(0);
    expect(fs.readFileSync(file.localPath, 'utf8')).toBe(
      `${fields.map(f => f.name).join(',')}\r\n`,
    );
  });

  it('handles many rows with backpressure', async () => {
    const writer = await createRowWriter({
      format: 'CSV',
      compression: 'GZIP',
      datasetId: 'many',
      dir,
      fields,
    });
    for (let i = 0; i < 20_000; i++) await writer.write({ ...rows[0], id: i });
    const file = await writer.finish();
    const lines = zlib
      .gunzipSync(fs.readFileSync(file.localPath))
      .toString('utf8')
      .split('\r\n');
    expect(lines).toHaveLength(20_002); // header + rows + trailing empty
    expect(file.sha256).toBe(sha(file.localPath));
  });
});

describe('TSV writer', () => {
  it('escapes tabs and newlines', async () => {
    const file = await writeAll('TSV', 'NONE');
    const lines = fs.readFileSync(file.localPath, 'utf8').split('\n');
    expect(lines[0]).toBe(fields.map(f => f.name).join('\t'));
    expect(lines).toHaveLength(5);
    const cols = lines[2].split('\t');
    expect(cols).toHaveLength(fields.length);
    expect(cols[2]).toBe('needs, "quoting"\\r\\nand\\ttabs\\\\');
  });
});

describe('JSON lines writer', () => {
  it('writes one object per line', async () => {
    const file = await writeAll('JSON', 'GZIP');
    expect(file.name).toBe('accounts.jsonl.gz');
    const lines = zlib
      .gunzipSync(fs.readFileSync(file.localPath))
      .toString('utf8')
      .trim()
      .split('\n');
    const objects = lines.map(l => JSON.parse(l));
    expect(objects[0]).toEqual({
      id: 1,
      big: '9007199254740993',
      name: 'plain',
      amount: '12345678901234567890.12',
      ratio: 0.5,
      active: true,
      created: '2026-10-01T12:34:56.789Z',
      tags: { a: [1, 2] },
    });
    expect(objects[1].name).toBe('needs, "quoting"\r\nand\ttabs\\');
    expect(objects[2].id).toBeNull();
  });
});

describe('Parquet writer', () => {
  it('maps PostgreSQL types', () => {
    expect(parquetTypeFor(PG_OID.int2)).toBe('INT32');
    expect(parquetTypeFor(PG_OID.int4)).toBe('INT32');
    expect(parquetTypeFor(PG_OID.int8)).toBe('INT64');
    expect(parquetTypeFor(PG_OID.float4)).toBe('DOUBLE');
    expect(parquetTypeFor(PG_OID.float8)).toBe('DOUBLE');
    expect(parquetTypeFor(PG_OID.numeric)).toBe('UTF8');
    expect(parquetTypeFor(PG_OID.bool)).toBe('BOOLEAN');
    expect(parquetTypeFor(PG_OID.date)).toBe('TIMESTAMP_MILLIS');
    expect(parquetTypeFor(PG_OID.timestamp)).toBe('TIMESTAMP_MILLIS');
    expect(parquetTypeFor(PG_OID.timestamptz)).toBe('TIMESTAMP_MILLIS');
    expect(parquetTypeFor(2950)).toBe('UTF8'); // uuid
    const schema = buildParquetSchema(fields, 'SNAPPY');
    expect(
      Object.values(schema.fields).every(f => f.repetitionType === 'OPTIONAL'),
    ).toBe(true);
    expect(schema.fields.id.compression).toBe('SNAPPY');
  });

  it.each(['SNAPPY', 'GZIP', 'NONE'] as const)(
    'round-trips rows with %s compression',
    async compression => {
      const file = await writeAll('PARQUET', compression);
      expect(file.name).toBe('accounts.parquet');
      expect(file.sha256).toBe(sha(file.localPath));
      expect(file.sizeBytes).toBe(fs.statSync(file.localPath).size);
      const reader = await ParquetReader.openFile(file.localPath);
      const cursor = reader.getCursor();
      const read: any[] = [];
      for (
        let record = await cursor.next();
        record;
        record = await cursor.next()
      )
        read.push(record);
      await reader.close();
      expect(read).toHaveLength(3);
      expect(read[0].id).toBe(1);
      expect(read[0].big).toBe(9007199254740993n);
      expect(read[0].name).toBe('plain');
      expect(read[0].amount).toBe('12345678901234567890.12');
      expect(read[0].ratio).toBe(0.5);
      expect(read[0].active).toBe(true);
      expect(read[0].created).toEqual(created);
      expect(read[0].tags).toBe('{"a":[1,2]}');
      expect(read[1].big).toBe(-5n);
      expect(read[1].amount ?? null).toBeNull();
      expect(read[1].created ?? null).toBeNull();
      expect(read[2].id ?? null).toBeNull();
    },
  );

  it('writes a valid empty file', async () => {
    const writer = await createRowWriter({
      format: 'PARQUET',
      compression: 'SNAPPY',
      datasetId: 'e',
      dir,
      fields,
    });
    const file = await writer.finish();
    const reader = await ParquetReader.openFile(file.localPath);
    expect(Number(reader.getRowCount())).toBe(0);
    await reader.close();
  });
});
