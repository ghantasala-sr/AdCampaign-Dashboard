/**
 * Shape of the generated fixture set, shared by the seed script (writer) and the
 * upstream clients (readers).
 *
 * Daily metrics are stored as a flat Int32Array in a binary file rather than
 * JSON. 10,000 campaigns x 90 days x 5 counters is 4.5M numbers: as JSON that is
 * ~40MB to parse on every boot, as Int32 it is an 18MB `readFileSync` plus a
 * zero-copy view. It also makes a date-range rollup a contiguous scan, which is
 * the property the list endpoint depends on.
 */

export const METRIC_ORDER = ['impressions', 'taps', 'installs', 'redownloads', 'spendCents'] as const;
export type MetricKey = (typeof METRIC_ORDER)[number];

export const DAYS = 90;
export const CAMPAIGN_COUNT = 10_000;
export const SEED = 20260805;

/** File names inside `apps/api/data/`. */
export const FILES = {
  manifest: 'manifest.json',
  apps: 'apps.json',
  campaigns: 'campaigns.ndjson',
  adGroups: 'adgroups.ndjson',
  keywords: 'keywords.ndjson',
  metrics: 'daily-metrics.bin',
} as const;

export interface Manifest {
  readonly seed: number;
  readonly generatedAt: string;
  /** Inclusive first day of the metrics window (YYYY-MM-DD). */
  readonly startDate: string;
  /** Inclusive last day of the metrics window (YYYY-MM-DD). */
  readonly endDate: string;
  readonly days: number;
  readonly campaignCount: number;
  readonly metricOrder: readonly MetricKey[];
  /** Campaign ids in the same order as their slot in the metrics array. */
  readonly campaignIds: readonly string[];
}

/**
 * Index into the flat metrics array.
 *
 * Layout is metric-major, then campaign, then day, so that all `days` values for
 * one (metric, campaign) pair are adjacent.
 */
export function metricIndex(
  metricSlot: number,
  campaignSlot: number,
  daySlot: number,
  campaignCount: number,
  days: number,
): number {
  return metricSlot * campaignCount * days + campaignSlot * days + daySlot;
}

export function totalMetricValues(campaignCount: number, days: number): number {
  return METRIC_ORDER.length * campaignCount * days;
}

/** UTC-only date helpers. The fixture has no notion of local time. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return isoDate(d);
}

export function daysBetween(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}
