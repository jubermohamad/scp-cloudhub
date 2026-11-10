/**
 * Turns a dataset's `sqlTemplate` plus the profile's export mode into the exact
 * statement the agent runs. Pure functions, no I/O.
 *
 * The template is a single SELECT owned by a CloudHub admin, so this is a
 * belt-and-braces check rather than the security boundary: the session is
 * forced read-only by the guardrails in `source.ts`, and the PG role is a
 * read-only role on a read replica.
 */
import { NonRetryableError } from '../errors';
import type { JobSpec } from '../protocol';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * Extra column carrying the watermark as PostgreSQL renders it (`::text`).
 * Using the server's text form keeps full precision (microsecond timestamps,
 * numeric scale, int8 beyond 2^53) which a JS Date or number would lose, and
 * the value round-trips as the `$1` parameter of the next run unchanged. The
 * writers drop this column, so it never reaches the output files.
 */
export const WATERMARK_COLUMN_ALIAS = '__dxh_watermark__';

export interface BuiltQuery {
  text: string;
  values: unknown[];
  /** Present for INCREMENTAL: the row field holding the watermark text. */
  watermarkField?: string;
  /** SNAPSHOT runs inside a REPEATABLE READ READ ONLY transaction. */
  snapshot: boolean;
}

/** Double-quotes an identifier after checking it is a plain SQL name. */
export function quoteIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new NonRetryableError(
      `Invalid watermark column "${name}": must match ${IDENTIFIER.source}`,
    );
  }
  return `"${name}"`;
}

/**
 * Normalises a template: trims it, strips one trailing semicolon, and rejects
 * anything that is not a single SELECT/WITH statement. A `;` anywhere else is
 * refused outright (even inside a string literal) because a multi-statement
 * template has no legitimate use here.
 */
export function normalizeTemplate(template: string): string {
  let sql = (template ?? '').trim();
  if (sql.endsWith(';')) sql = sql.slice(0, -1).trimEnd();
  if (!sql) throw new NonRetryableError('Dataset SQL template is empty');
  if (!/^(select|with)\b/i.test(sql)) {
    throw new NonRetryableError(
      'Dataset SQL template must start with SELECT or WITH',
    );
  }
  if (sql.includes(';')) {
    throw new NonRetryableError(
      'Dataset SQL template must be a single statement (found ";" before the end)',
    );
  }
  return sql;
}

/** Builds the statement for a claimed job. */
export function buildQuery(
  job: JobSpec,
  reportOverride?: { sqlTemplate: string; watermarkColumn: string | null },
): BuiltQuery {
  const template = normalizeTemplate(
    reportOverride?.sqlTemplate ?? job.dataset.sqlTemplate,
  );
  const mode = job.profile.exportMode;

  if (mode === 'FULL') return { text: template, values: [], snapshot: false };
  if (mode === 'SNAPSHOT')
    return { text: template, values: [], snapshot: true };
  if (mode !== 'INCREMENTAL') {
    throw new NonRetryableError(`Unsupported export mode ${String(mode)}`);
  }

  const column =
    reportOverride?.watermarkColumn ?? job.dataset.watermarkColumn;
  if (!column) {
    throw new NonRetryableError(
      `Dataset ${job.dataset.datasetId} has no watermarkColumn; INCREMENTAL export is not possible`,
    );
  }
  const col = `src.${quoteIdentifier(column)}`;
  const select = `SELECT src.*, (${col})::text AS "${WATERMARK_COLUMN_ALIAS}" FROM (${template}) AS src`;
  const from = job.watermark?.lastSuccessValue ?? null;

  if (from === null) {
    return {
      text: `${select} ORDER BY ${col}`,
      values: [],
      watermarkField: WATERMARK_COLUMN_ALIAS,
      snapshot: false,
    };
  }
  const op = job.profile.watermarkStrategy === 'GREATER_OR_EQUAL' ? '>=' : '>';
  return {
    text: `${select} WHERE ${col} ${op} $1 ORDER BY ${col}`,
    values: [from],
    watermarkField: WATERMARK_COLUMN_ALIAS,
    snapshot: false,
  };
}
