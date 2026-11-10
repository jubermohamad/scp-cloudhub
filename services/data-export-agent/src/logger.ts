/**
 * Structured JSON logging to stdout, plus a bounded per-job log tail that is
 * shipped to the control plane with /complete and /fail.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export const LOG_LEVELS: readonly LogLevel[] = [
  'debug',
  'info',
  'warn',
  'error',
];

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

type Sink = (line: string) => void;

function serializeField(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function format(level: LogLevel, msg: string, fields: LogFields): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) entry[key] = serializeField(value);
  }
  return JSON.stringify(entry);
}

/** Creates a logger that writes one JSON object per line. */
export function createLogger(
  level: LogLevel = 'info',
  sink: Sink = line => process.stdout.write(`${line}\n`),
  baseFields: LogFields = {},
): Logger {
  const threshold = LOG_LEVELS.indexOf(level);
  const emit = (lvl: LogLevel, msg: string, fields?: LogFields) => {
    if (LOG_LEVELS.indexOf(lvl) < threshold) return;
    sink(format(lvl, msg, { ...baseFields, ...fields }));
  };
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: fields => createLogger(level, sink, { ...baseFields, ...fields }),
  };
}

/** A logger that discards everything (tests). */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

export const JOB_LOG_LIMIT_BYTES = 64 * 1024;

/**
 * Keeps the tail of a job's log in memory, never more than `limitBytes`.
 * The oldest lines are dropped first because the end of a log (where it
 * failed) is what an operator needs.
 */
export class JobLog {
  private readonly lines: string[] = [];
  private bytes = 0;
  private dropped = 0;

  constructor(private readonly limitBytes = JOB_LOG_LIMIT_BYTES) {}

  append(level: LogLevel, msg: string, fields?: LogFields): void {
    const extra =
      fields && Object.keys(fields).length > 0
        ? ` ${JSON.stringify(fields, (_k, v) => serializeField(v))}`
        : '';
    let line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}${extra}`;
    if (Buffer.byteLength(line) + 1 > this.limitBytes) {
      line = line.slice(0, Math.max(0, this.limitBytes - 64));
    }
    this.lines.push(line);
    this.bytes += Buffer.byteLength(line) + 1;
    while (this.bytes > this.limitBytes - 64 && this.lines.length > 1) {
      const removed = this.lines.shift()!;
      this.bytes -= Buffer.byteLength(removed) + 1;
      this.dropped += 1;
    }
  }

  toString(): string {
    const head =
      this.dropped > 0 ? `... ${this.dropped} earlier lines dropped\n` : '';
    return `${head}${this.lines.join('\n')}`;
  }
}

/** A logger that writes both to the agent log and to a job's log tail. */
export function teeLogger(logger: Logger, jobLog: JobLog): Logger {
  const make = (base: Logger): Logger => ({
    debug: (msg, f) => {
      base.debug(msg, f);
      jobLog.append('debug', msg, f);
    },
    info: (msg, f) => {
      base.info(msg, f);
      jobLog.append('info', msg, f);
    },
    warn: (msg, f) => {
      base.warn(msg, f);
      jobLog.append('warn', msg, f);
    },
    error: (msg, f) => {
      base.error(msg, f);
      jobLog.append('error', msg, f);
    },
    child: fields => make(base.child(fields)),
  });
  return make(logger);
}
