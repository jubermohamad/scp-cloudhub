/** Accumulates positional parameters so query fragments can be composed safely. */
export class SqlParams {
  readonly values: unknown[] = [];

  /** Adds a value and returns its placeholder, e.g. `$3`. */
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** Builds `WHERE a AND b` from optional clauses; empty when there are none. */
export function whereClause(clauses: Array<string | false | undefined | null>): string {
  const active = clauses.filter((clause): clause is string => Boolean(clause));
  return active.length ? `WHERE ${active.join(' AND ')}` : '';
}

/** Limits `column` to a tenant scope: no restriction for null (platform admin), none visible for []. */
export function tenantScopeClause(column: string, scope: string[] | null, params: SqlParams): string | null {
  return scope === null ? null : `${column} = ANY(${params.add(scope)}::text[])`;
}

/** Escapes `%`, `_` and `\` so user search text matches literally inside ILIKE. */
export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}
