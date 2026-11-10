import { createHash } from 'crypto';
import fs from 'fs';
import { Writable } from 'stream';

/**
 * A file sink that hashes and counts bytes as they are written, so the
 * sha256 and size of a multi-gigabyte export are known the moment the file is
 * closed, without reading it back.
 */
export class HashingFileSink extends Writable {
  private readonly hash = createHash('sha256');
  private readonly file: fs.WriteStream;
  private bytesWritten = 0;
  private digestHex?: string;

  constructor(readonly path: string) {
    super();
    this.file = fs.createWriteStream(path, { flags: 'wx', mode: 0o600 });
    this.file.on('error', err => this.destroy(err));
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.hash.update(chunk);
    this.bytesWritten += chunk.length;
    this.file.write(chunk, err => callback(err ?? null));
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.digestHex = this.hash.digest('hex');
    this.file.end(() => callback());
  }

  override _destroy(
    err: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.file.destroyed) this.file.destroy();
    callback(err);
  }

  /** sha256 (hex) of everything written; only valid after the stream finished. */
  get sha256(): string {
    if (!this.digestHex) throw new Error('HashingFileSink has not finished');
    return this.digestHex;
  }

  get size(): number {
    return this.bytesWritten;
  }
}

/** sha256 of a small in-memory payload (checksum file, manifest). */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** sha256 of a file on disk, streamed. */
export async function sha256File(
  path: string,
): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of fs.createReadStream(path)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: hash.digest('hex'), size };
}
