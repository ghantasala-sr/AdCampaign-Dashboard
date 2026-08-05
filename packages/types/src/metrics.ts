/**
 * Reporting metrics. Counters are raw integers from the reporting service;
 * every rate and average is derived by the BFF so the client never divides.
 */

/** The five counters the reporting service stores per campaign per day. */
export interface MetricCounters {
  readonly impressions: number;
  readonly taps: number;
  readonly installs: number;
  readonly redownloads: number;
  /** Spend in minor currency units (cents) to keep the storage layer integral. */
  readonly spendCents: number;
}

/** Counters plus the ratios derived from them. */
export interface MetricSummary extends MetricCounters {
  readonly localSpend: string;
  /** Tap-through rate: taps / impressions. */
  readonly ttr: number;
  /** Conversion rate: installs / taps. */
  readonly conversionRate: number;
  /** Average cost per tap. */
  readonly avgCPT: number;
  /** Average cost per acquisition (install). */
  readonly avgCPA: number;
  /** Average cost per thousand impressions. */
  readonly avgCPM: number;
}

/** One day of counters, used for time series and sparklines. */
export interface MetricPoint extends MetricCounters {
  readonly date: string;
}

/** Sortable metric keys. Kept as a const array so the BFF can validate input. */
export const SORTABLE_METRICS = [
  'impressions',
  'taps',
  'installs',
  'redownloads',
  'spendCents',
  'ttr',
  'conversionRate',
  'avgCPT',
  'avgCPA',
  'avgCPM',
] as const;

export type SortableMetric = (typeof SORTABLE_METRICS)[number];

export const SORTABLE_FIELDS = [...SORTABLE_METRICS, 'name', 'status', 'createdAt'] as const;

export type SortableField = (typeof SORTABLE_FIELDS)[number];

export type SortDirection = 'asc' | 'desc';
