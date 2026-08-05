/**
 * Formatters used by every table cell.
 *
 * `Intl.NumberFormat` construction is expensive — roughly two orders of
 * magnitude more than a format() call on an existing instance. The naive table
 * builds one per cell, which at 10k rows x 8 numeric columns is 80k
 * constructions per render. Here they are built once per (locale, currency) and
 * cached, so a render only pays for `format()`.
 *
 * This module is also why the optimized table can format inside a memoized row
 * without re-deriving anything: same input string in, same string out.
 */

const compactCache = new Map<string, Intl.NumberFormat>();
const decimalCache = new Map<string, Intl.NumberFormat>();
const currencyCache = new Map<string, Intl.NumberFormat>();
const percentCache = new Map<string, Intl.NumberFormat>();

function getCompact(locale: string): Intl.NumberFormat {
  let f = compactCache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    compactCache.set(locale, f);
  }
  return f;
}

function getDecimal(locale: string): Intl.NumberFormat {
  let f = decimalCache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    decimalCache.set(locale, f);
  }
  return f;
}

function getCurrency(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  let f = currencyCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currencyCache.set(key, f);
  }
  return f;
}

function getPercent(locale: string, digits: number): Intl.NumberFormat {
  const key = `${locale}:${digits}`;
  let f = percentCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    percentCache.set(key, f);
  }
  return f;
}

/** Large counts: 1234567 -> "1.2M". Used for impressions and taps. */
export function formatCompact(value: number, locale = 'en-US'): string {
  return getCompact(locale).format(value);
}

/** Exact counts with grouping: 1234567 -> "1,234,567". */
export function formatCount(value: number, locale = 'en-US'): string {
  return getDecimal(locale).format(value);
}

/** Cents to a currency string: 123456 -> "$1,234.56". */
export function formatCentsAsCurrency(cents: number, currency = 'USD', locale = 'en-US'): string {
  return getCurrency(locale, currency).format(cents / 100);
}

/** Already-decimal money amount to a currency string. */
export function formatCurrency(amount: number, currency = 'USD', locale = 'en-US'): string {
  return getCurrency(locale, currency).format(amount);
}

/** Ratio to percent: 0.0432 -> "4.32%". */
export function formatRatio(value: number, digits = 2, locale = 'en-US'): string {
  if (!Number.isFinite(value)) return '—';
  return getPercent(locale, digits).format(value);
}

/** Currency with 2dp, used for CPT/CPA/CPM which are already dollars. */
export function formatRate(value: number, currency = 'USD', locale = 'en-US'): string {
  if (!Number.isFinite(value) || value === 0) return '—';
  return getCurrency(locale, currency).format(value);
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  ENABLED: 'Enabled',
  PAUSED: 'Paused',
  RUNNING: 'Running',
  NOT_RUNNING: 'Not running',
  UNDER_PACING: 'Under pacing',
  ON_PACE: 'On pace',
  OVER_PACING: 'Over pacing',
  CAPPED: 'Capped',
  APPSTORE_SEARCH_RESULTS: 'Search results',
  APPSTORE_SEARCH_TAB: 'Search tab',
  APPSTORE_TODAY_TAB: 'Today tab',
  APPSTORE_PRODUCT_PAGES_BROWSE: 'Product pages',
  CAMPAIGN_ON_HOLD: 'Campaign on hold',
  CAMPAIGN_END_DATE_REACHED: 'End date reached',
  DAILY_CAP_EXHAUSTED: 'Daily cap exhausted',
  TOTAL_BUDGET_EXHAUSTED: 'Total budget exhausted',
  PAUSED_BY_USER: 'Paused by user',
  APP_NOT_ELIGIBLE: 'App not eligible',
  TAPS: 'Taps',
  IMPRESSIONS: 'Impressions',
  EXACT: 'Exact',
  BROAD: 'Broad',
};

/** SCREAMING_SNAKE enum to sentence case, with a generic fallback. */
export function humanizeEnum(value: string): string {
  const known = STATUS_LABELS[value];
  if (known !== undefined) return known;
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const shortDateCache = new Map<string, Intl.DateTimeFormat>();

/** ISO date to "Mar 4". */
export function formatShortDate(iso: string, locale = 'en-US'): string {
  let f = shortDateCache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    shortDateCache.set(locale, f);
  }
  return f.format(new Date(`${iso}T00:00:00Z`));
}
