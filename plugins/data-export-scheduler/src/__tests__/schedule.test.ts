import { dueOccurrence } from '../schedule';

const at = (iso: string) => new Date(iso);

describe('dueOccurrence', () => {
  it('returns the latest fire time since the last scheduling', () => {
    expect(dueOccurrence('0 2 * * *', at('2026-10-19T03:00:00Z'), at('2026-10-20T02:00:30Z'))).toEqual(
      at('2026-10-20T02:00:00Z'),
    );
  });

  it('returns null when nothing fired since the last scheduling', () => {
    expect(dueOccurrence('0 2 * * *', at('2026-10-20T02:00:00Z'), at('2026-10-20T09:00:00Z'))).toBeNull();
  });

  it('counts a fire time exactly at now', () => {
    expect(dueOccurrence('0 * * * *', at('2026-10-20T08:30:00Z'), at('2026-10-20T09:00:00Z'))).toEqual(
      at('2026-10-20T09:00:00Z'),
    );
  });

  it('only returns the most recent missed occurrence after an outage', () => {
    expect(dueOccurrence('0 * * * *', at('2026-10-18T00:00:00Z'), at('2026-10-20T09:15:00Z'))).toEqual(
      at('2026-10-20T09:00:00Z'),
    );
  });

  it('evaluates schedules in UTC', () => {
    expect(dueOccurrence('0 2 1 * *', at('2026-09-30T00:00:00Z'), at('2026-10-01T02:00:00Z'))).toEqual(
      at('2026-10-01T02:00:00Z'),
    );
  });

  it('returns null for an invalid expression rather than throwing', () => {
    expect(dueOccurrence('not a cron', at('2026-10-19T00:00:00Z'), at('2026-10-20T00:00:00Z'))).toBeNull();
  });
});
