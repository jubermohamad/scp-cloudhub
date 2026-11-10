/**
 * scheduleUtils.ts
 *
 * Pure utility functions for determining whether a weekly schedule entry
 * should fire at a given moment in time.
 *
 * Design: no external dependencies — uses only the built-in Intl API.
 * This keeps the bundle small and avoids cron-parsing libraries.
 */

import { ScheduleEntry } from './types';

/**
 * Returns true if `entry` should fire "now" inside a rolling window.
 *
 * Algorithm:
 *   1. Convert `now` to the cluster's local time using Intl.
 *   2. Check day-of-week matches.
 *   3. Check that the absolute difference between the scheduled minute-of-day
 *      and the current minute-of-day is within `windowMinutes`.
 *
 * Using a window (default 4 min) makes the check resilient to small timer
 * drift and delayed function cold-starts when the timer runs every 5 min.
 *
 * @param entry          The scheduled action to evaluate.
 * @param timezone       IANA timezone string, e.g. "Asia/Kolkata".
 * @param now            The current UTC moment (default: Date.now()).
 * @param windowMinutes  Half-window around the scheduled time (default: 4).
 */
export function isScheduleDue(
  entry: ScheduleEntry,
  timezone: string,
  now: Date = new Date(),
  windowMinutes = 4,
): boolean {
  // Obtain the wall-clock date/time in the cluster's local timezone.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type: string): string =>
    parts.find(p => p.type === type)?.value ?? '0';

  // Intl weekday (short): "Sun", "Mon", … map to 0-6
  const WEEKDAYS: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const localDay = WEEKDAYS[get('weekday')] ?? -1;
  if (localDay !== entry.dayOfWeek) return false;

  const localHour = parseInt(get('hour'), 10);
  const localMinute = parseInt(get('minute'), 10);
  const localTotal = localHour * 60 + localMinute;

  const [schedHH, scheduleMM] = entry.time.split(':').map(Number);
  const scheduleTotal = schedHH * 60 + scheduleMM;

  return Math.abs(localTotal - scheduleTotal) <= windowMinutes;
}

/**
 * Builds a human-readable description of when an entry fires.
 * e.g. "Friday 20:00 Asia/Kolkata"
 */
export function describeEntry(entry: ScheduleEntry, timezone: string): string {
  const DAYS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  return `${DAYS[entry.dayOfWeek] ?? `day(${entry.dayOfWeek})`} ${
    entry.time
  } ${timezone}`;
}
