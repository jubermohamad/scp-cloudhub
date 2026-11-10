import { NonRetryableError } from '../errors';
import { makeJob } from '../__fixtures__/fakes';
import {
  buildQuery,
  normalizeTemplate,
  quoteIdentifier,
  WATERMARK_COLUMN_ALIAS,
} from './queryBuilder';

describe('normalizeTemplate', () => {
  it('strips one trailing semicolon and whitespace', () => {
    expect(normalizeTemplate('  SELECT 1 ;  ')).toBe('SELECT 1');
    expect(normalizeTemplate('with x as (select 1) select * from x;')).toBe(
      'with x as (select 1) select * from x',
    );
  });

  it.each([
    ['empty', ''],
    ['not a select', 'DELETE FROM accounts'],
    ['update', 'UPDATE accounts SET a = 1'],
    ['two statements', 'SELECT 1; SELECT 2'],
    ['two trailing semicolons', 'SELECT 1;;'],
    ['stacked drop', 'SELECT 1; DROP TABLE accounts;'],
    ['selectx prefix', 'SELECTX 1'],
  ])('rejects %s', (_name, sql) => {
    expect(() => normalizeTemplate(sql)).toThrow(NonRetryableError);
  });
});

describe('quoteIdentifier', () => {
  it.each(['updated_at', '_x', 'Col$1', 'A'])('accepts %s', name => {
    expect(quoteIdentifier(name)).toBe(`"${name}"`);
  });

  it.each(['1col', 'a b', 'a"b', 'a;b', 'a.b', '', 'x)--', 'déjà'])(
    'rejects %p',
    name => {
      expect(() => quoteIdentifier(name)).toThrow(NonRetryableError);
    },
  );
});

describe('buildQuery', () => {
  it('runs FULL as-is', () => {
    const q = buildQuery(
      makeJob({ dataset: { sqlTemplate: 'SELECT * FROM t;' } }),
    );
    expect(q).toEqual({ text: 'SELECT * FROM t', values: [], snapshot: false });
  });

  it('marks SNAPSHOT for a repeatable-read transaction', () => {
    const q = buildQuery(makeJob({ profile: { exportMode: 'SNAPSHOT' } }));
    expect(q.snapshot).toBe(true);
    expect(q.values).toEqual([]);
  });

  it('wraps INCREMENTAL with a strict watermark filter', () => {
    const q = buildQuery(
      makeJob({
        profile: {
          exportMode: 'INCREMENTAL',
          watermarkStrategy: 'GREATER_THAN',
        },
        dataset: {
          sqlTemplate: 'SELECT * FROM t',
          watermarkColumn: 'updated_at',
        },
        watermark: { lastSuccessValue: '2026-10-01 00:00:00+00' },
      }),
    );
    expect(q.text).toBe(
      `SELECT src.*, (src."updated_at")::text AS "${WATERMARK_COLUMN_ALIAS}" FROM (SELECT * FROM t) AS src WHERE src."updated_at" > $1 ORDER BY src."updated_at"`,
    );
    expect(q.values).toEqual(['2026-10-01 00:00:00+00']);
    expect(q.watermarkField).toBe(WATERMARK_COLUMN_ALIAS);
  });

  it('uses >= for GREATER_OR_EQUAL', () => {
    const q = buildQuery(
      makeJob({
        profile: {
          exportMode: 'INCREMENTAL',
          watermarkStrategy: 'GREATER_OR_EQUAL',
        },
        dataset: { watermarkColumn: 'id' },
        watermark: { lastSuccessValue: '10' },
      }),
    );
    expect(q.text).toContain('WHERE src."id" >= $1 ORDER BY src."id"');
  });

  it('exports everything (but still orders and tracks) when there is no previous watermark', () => {
    const q = buildQuery(
      makeJob({
        profile: { exportMode: 'INCREMENTAL' },
        dataset: { watermarkColumn: 'id' },
      }),
    );
    expect(q.text).not.toContain('WHERE');
    expect(q.text).toMatch(/ORDER BY src\."id"$/);
    expect(q.values).toEqual([]);
    expect(q.watermarkField).toBe(WATERMARK_COLUMN_ALIAS);
  });

  it('requires a watermark column for INCREMENTAL', () => {
    expect(() =>
      buildQuery(makeJob({ profile: { exportMode: 'INCREMENTAL' } })),
    ).toThrow(/no watermarkColumn/);
  });

  it('rejects an unsafe watermark column', () => {
    expect(() =>
      buildQuery(
        makeJob({
          profile: { exportMode: 'INCREMENTAL' },
          dataset: { watermarkColumn: 'id" OR 1=1 --' },
        }),
      ),
    ).toThrow(NonRetryableError);
  });
});
