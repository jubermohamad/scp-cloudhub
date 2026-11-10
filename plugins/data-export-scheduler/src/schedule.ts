import { parseExpression } from 'cron-parser';

/**
 * The occurrence of `cronExpression` (UTC) that is due now: the latest fire
 * time in (since, now]. Returns null when nothing has fired since `since`.
 *
 * Only the latest missed occurrence is returned, never a backlog, so a
 * scheduler outage produces one catch-up run per profile rather than a storm.
 */
export function dueOccurrence(cronExpression: string, since: Date, now: Date): Date | null {
  let latest: Date;
  try {
    // prev() is strictly before currentDate; nudge forward so a fire time of exactly `now` counts.
    latest = parseExpression(cronExpression, { currentDate: new Date(now.getTime() + 1), utc: true })
      .prev()
      .toDate();
  } catch {
    return null;
  }
  return latest.getTime() > since.getTime() && latest.getTime() <= now.getTime() ? latest : null;
}
