/** A data file written to the work directory, ready for upload. */
export interface WrittenFile {
  name: string;
  localPath: string;
  sizeBytes: number;
  sha256: string;
  records?: number;
}

/** Streams rows into one output file. */
export interface RowWriter {
  readonly name: string;
  readonly path: string;
  /** Bytes on disk so far (compressed size where compression applies). */
  readonly bytesWritten: number;
  write(row: Record<string, unknown>): Promise<void>;
  /** Flushes and closes the file; returns its size and sha256. */
  finish(): Promise<WrittenFile>;
  /** Closes the file without finishing it; the caller deletes the work dir. */
  abort(): Promise<void>;
}
