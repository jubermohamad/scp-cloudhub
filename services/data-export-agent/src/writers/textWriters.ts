/**
 * Streaming writers for the line-oriented formats: CSV (RFC 4180), TSV and
 * newline-delimited JSON, optionally gzip-compressed.
 */
import { once } from 'events';
import { finished } from 'stream/promises';
import type { Writable } from 'stream';
import zlib from 'zlib';
import { HashingFileSink } from './hashingSink';
import type { RowWriter, WrittenFile } from './types';
import { valueToJson, valueToText } from './values';

/** RFC 4180: quote a field containing a comma, quote, CR or LF; double embedded quotes. */
export function csvField(value: unknown): string {
  const text = valueToText(value);
  if (text === null) return '';
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * TSV has no quoting convention, so backslash, tab, CR and LF are escaped as
 * `\\`, `\t`, `\r`, `\n` (the same escapes PostgreSQL's text COPY format uses).
 * NULL is written as an empty field.
 */
export function tsvField(value: unknown): string {
  const text = valueToText(value);
  if (text === null) return '';
  return text.replace(/[\\\t\r\n]/g, ch =>
    ch === '\\' ? '\\\\' : ch === '\t' ? '\\t' : ch === '\r' ? '\\r' : '\\n',
  );
}

export type TextFormat = 'CSV' | 'TSV' | 'JSON';

export interface TextWriterOptions {
  format: TextFormat;
  gzip: boolean;
  name: string;
  path: string;
  columns: string[];
}

const FLUSH_BYTES = 64 * 1024;

/** One writer for CSV, TSV and JSON lines; only the line encoding differs. */
export class TextRowWriter implements RowWriter {
  readonly name: string;
  readonly path: string;
  private readonly sink: HashingFileSink;
  private readonly head: Writable;
  private readonly encodeRow: (row: Record<string, unknown>) => string;
  private buffer = '';
  private records = 0;

  constructor(options: TextWriterOptions) {
    this.name = options.name;
    this.path = options.path;
    this.sink = new HashingFileSink(options.path);
    if (options.gzip) {
      const gz = zlib.createGzip({ level: 6 });
      gz.pipe(this.sink);
      gz.on('error', err => this.sink.destroy(err));
      this.head = gz;
    } else {
      this.head = this.sink;
    }
    // Keep stream errors from becoming unhandled; they surface via finish()/write().
    this.sink.on('error', () => {});

    const cols = options.columns;
    switch (options.format) {
      case 'CSV':
        this.buffer = `${cols.map(csvField).join(',')}\r\n`;
        this.encodeRow = row =>
          `${cols.map(c => csvField(row[c])).join(',')}\r\n`;
        break;
      case 'TSV':
        this.buffer = `${cols.map(tsvField).join('\t')}\n`;
        this.encodeRow = row =>
          `${cols.map(c => tsvField(row[c])).join('\t')}\n`;
        break;
      case 'JSON':
      default:
        this.encodeRow = row => {
          const out: Record<string, unknown> = {};
          for (const c of cols) out[c] = valueToJson(row[c]);
          return `${JSON.stringify(out)}\n`;
        };
    }
  }

  get bytesWritten(): number {
    return this.sink.size;
  }

  async write(row: Record<string, unknown>): Promise<void> {
    this.buffer += this.encodeRow(row);
    this.records += 1;
    if (this.buffer.length >= FLUSH_BYTES) await this.flush();
  }

  async finish(): Promise<WrittenFile> {
    await this.flush();
    this.head.end();
    await finished(this.sink);
    return {
      name: this.name,
      localPath: this.path,
      sizeBytes: this.sink.size,
      sha256: this.sink.sha256,
      records: this.records,
    };
  }

  async abort(): Promise<void> {
    this.head.destroy();
    this.sink.destroy();
  }

  private async flush(): Promise<void> {
    if (!this.buffer) return;
    if (this.sink.errored) throw this.sink.errored;
    const chunk = Buffer.from(this.buffer, 'utf8');
    this.buffer = '';
    if (!this.head.write(chunk)) {
      // Wait for backpressure to clear, or for the file sink to fail (with
      // gzip in front, a sink error would otherwise leave us waiting forever).
      const ac = new AbortController();
      try {
        await Promise.race([
          once(this.head, 'drain', { signal: ac.signal }),
          once(this.sink, 'error', { signal: ac.signal }).then(([err]) => {
            throw err;
          }),
        ]);
      } finally {
        ac.abort();
      }
    }
  }
}
