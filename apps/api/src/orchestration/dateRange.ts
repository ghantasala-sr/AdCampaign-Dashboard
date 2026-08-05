/**
 * Date ranges resolve on the server so "last 7 days" cannot mean two different
 * things in two browsers.
 *
 * Presets resolve against the *dataset's* last day, not the wall clock. The
 * fixture covers a fixed 90-day window; anchoring to `new Date()` would make
 * every preset silently empty the moment the data is a day stale. The resolved
 * window is echoed back in `meta.resolvedDateRange` so the UI can label it.
 */

import type { DateRange, DateRangePreset } from '@adsight/types';

import { daysBetween, type Manifest } from '../lib/dataset.js';
import type { DayWindow } from '../upstream/reportingService.js';

const PRESET_LENGTHS: Readonly<Record<DateRangePreset, number>> = {
  TODAY: 1,
  YESTERDAY: 1,
  LAST_7_DAYS: 7,
  LAST_14_DAYS: 14,
  LAST_30_DAYS: 30,
  LAST_90_DAYS: 90,
};

export interface ResolvedRange extends DayWindow {
  readonly start: string;
  readonly end: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DateRangeError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message);
    this.name = 'DateRangeError';
  }
}

function clampDay(day: number, days: number): number {
  if (day < 0) return 0;
  if (day > days - 1) return days - 1;
  return day;
}

function shiftIso(startDate: string, offset: number): string {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function resolveDateRange(range: DateRange, manifest: Manifest): ResolvedRange {
  const lastDay = manifest.days - 1;

  if (range.preset !== null) {
    const length = PRESET_LENGTHS[range.preset];
    if (length === undefined) {
      throw new DateRangeError(`Unknown date range preset "${range.preset}"`, 'dateRange.preset');
    }
    // YESTERDAY is the single day before the last; the others end on the last day.
    const endDay = clampDay(range.preset === 'YESTERDAY' ? lastDay - 1 : lastDay, manifest.days);
    const startDay = clampDay(endDay - (length - 1), manifest.days);
    return {
      startDay,
      endDay,
      start: shiftIso(manifest.startDate, startDay),
      end: shiftIso(manifest.startDate, endDay),
    };
  }

  if (range.start === null || range.end === null) {
    throw new DateRangeError(
      'A custom date range requires both start and end',
      range.start === null ? 'dateRange.start' : 'dateRange.end',
    );
  }
  if (!ISO_DATE.test(range.start)) {
    throw new DateRangeError('start must be formatted YYYY-MM-DD', 'dateRange.start');
  }
  if (!ISO_DATE.test(range.end)) {
    throw new DateRangeError('end must be formatted YYYY-MM-DD', 'dateRange.end');
  }
  if (range.start > range.end) {
    throw new DateRangeError('start must not be after end', 'dateRange.start');
  }

  const rawStart = daysBetween(manifest.startDate, range.start);
  const rawEnd = daysBetween(manifest.startDate, range.end);
  if (rawEnd < 0 || rawStart > lastDay) {
    throw new DateRangeError(
      `Range ${range.start}..${range.end} lies outside the available window ` +
        `${manifest.startDate}..${manifest.endDate}`,
      'dateRange.start',
    );
  }

  // A range that only partly overlaps the window is clamped rather than
  // rejected — the alternative is an error page for a link that was valid once.
  const startDay = clampDay(rawStart, manifest.days);
  const endDay = clampDay(rawEnd, manifest.days);
  return {
    startDay,
    endDay,
    start: shiftIso(manifest.startDate, startDay),
    end: shiftIso(manifest.startDate, endDay),
  };
}

/** Single-day window for the dataset's last day — used for today's pacing. */
export function todayWindow(manifest: Manifest): DayWindow {
  const lastDay = manifest.days - 1;
  return { startDay: lastDay, endDay: lastDay };
}
