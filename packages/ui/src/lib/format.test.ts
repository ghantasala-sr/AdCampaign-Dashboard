import { describe, expect, it, vi } from 'vitest';

import {
  formatCentsAsCurrency,
  formatCompact,
  formatCount,
  formatRate,
  formatRatio,
  formatShortDate,
  humanizeEnum,
} from './format.js';

/**
 * These formatters run once per table cell — roughly 120,000 calls to paint a
 * 10,000-row table — so the caching is a correctness-adjacent property, not just
 * a micro-optimisation. It gets an explicit test.
 */

describe('formatter caching', () => {
  it('constructs one Intl.NumberFormat per locale, not one per call', () => {
    const spy = vi.spyOn(Intl, 'NumberFormat');
    try {
      // A fresh locale so this test is not satisfied by an earlier test's cache.
      for (let i = 0; i < 500; i += 1) formatCompact(i, 'en-CA');
      // One construction for the whole loop. The naive table's per-cell
      // construction is the single largest cost in the baseline measurement.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('caches currency formatters per locale and currency pair', () => {
    const spy = vi.spyOn(Intl, 'NumberFormat');
    try {
      formatCentsAsCurrency(100, 'JPY', 'ja-JP');
      formatCentsAsCurrency(200, 'JPY', 'ja-JP');
      formatCentsAsCurrency(300, 'EUR', 'ja-JP');
      // Two distinct currencies, two formatters.
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('number formatting', () => {
  it('abbreviates large counts', () => {
    expect(formatCompact(1_234_567)).toBe('1.2M');
    expect(formatCompact(4_200)).toBe('4.2K');
    expect(formatCompact(0)).toBe('0');
  });

  it('groups exact counts', () => {
    expect(formatCount(1_234_567)).toBe('1,234,567');
  });

  it('renders cents as currency', () => {
    expect(formatCentsAsCurrency(123_456)).toBe('$1,234.56');
    expect(formatCentsAsCurrency(0)).toBe('$0.00');
  });

  it('renders ratios as percentages', () => {
    expect(formatRatio(0.0432)).toBe('4.32%');
    expect(formatRatio(1)).toBe('100.00%');
  });

  it('renders a dash rather than NaN or Infinity for an undefined rate', () => {
    // Campaigns with no delivery produce 0/0; the table must not show "NaN%".
    expect(formatRatio(Number.NaN)).toBe('—');
    expect(formatRatio(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatRate(0)).toBe('—');
    expect(formatRate(Number.NaN)).toBe('—');
  });
});

describe('humanizeEnum', () => {
  it('uses the curated label for known values', () => {
    expect(humanizeEnum('APPSTORE_SEARCH_RESULTS')).toBe('Search results');
    expect(humanizeEnum('NOT_RUNNING')).toBe('Not running');
    expect(humanizeEnum('DAILY_CAP_EXHAUSTED')).toBe('Daily cap exhausted');
  });

  it('falls back to sentence case for anything unmapped', () => {
    // A new enum value from the API should read acceptably rather than leak
    // SCREAMING_SNAKE into the UI.
    expect(humanizeEnum('SOME_NEW_REASON')).toBe('Some new reason');
  });
});

describe('formatShortDate', () => {
  it('formats an ISO date in UTC regardless of the host timezone', () => {
    // Parsing as local time would shift the label by a day west of UTC, which
    // silently misaligns every chart axis.
    expect(formatShortDate('2026-03-04')).toBe('Mar 4');
    expect(formatShortDate('2026-01-01')).toBe('Jan 1');
  });
});
