import { describe, expect, it } from 'vitest';
import type { Campaign, CampaignFilter, MetricSummary } from '@adsight/types';
import { EMPTY_FILTER } from '@adsight/types';

import { applyConfigFilter, applyMetricFilter, normalizePredicateValue } from './filter.js';
import { deriveSummary } from './derive.js';

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp_000001',
    adamId: '1400000001',
    name: 'US - Brand - Core',
    status: 'ENABLED',
    servingStatus: 'RUNNING',
    servingStateReasons: [],
    adChannelType: 'SEARCH',
    supplySources: ['APPSTORE_SEARCH_RESULTS'],
    countriesOrRegions: ['US'],
    billingEvent: 'TAPS',
    budgetAmount: { amount: '5000.00', currency: 'USD' },
    dailyBudgetAmount: { amount: '250.00', currency: 'USD' },
    startTime: '2026-05-07',
    endTime: null,
    createdAt: '2026-05-01',
    modifiedAt: '2026-08-01',
    ...overrides,
  };
}

function filter(overrides: Partial<CampaignFilter> = {}): CampaignFilter {
  return { ...EMPTY_FILTER, ...overrides };
}

function row(metrics: Partial<MetricSummary> & { spendCents?: number }) {
  return {
    metrics: deriveSummary({
      impressions: 0,
      taps: 0,
      installs: 0,
      redownloads: 0,
      spendCents: 0,
      ...metrics,
    }),
  };
}

describe('applyConfigFilter', () => {
  const campaigns = [
    campaign({ id: 'a', name: 'US - Brand - Core', countriesOrRegions: ['US'] }),
    campaign({
      id: 'b',
      name: 'JP - Generic - Broad',
      status: 'PAUSED',
      servingStatus: 'NOT_RUNNING',
      countriesOrRegions: ['JP', 'KR'],
      supplySources: ['APPSTORE_SEARCH_TAB', 'APPSTORE_TODAY_TAB'],
    }),
    campaign({ id: 'c', name: 'GB - Competitor - Exact', countriesOrRegions: ['GB', 'US'] }),
  ];

  it('returns everything for an empty filter', () => {
    expect(applyConfigFilter(campaigns, filter())).toHaveLength(3);
  });

  it('matches search case-insensitively on name and id', () => {
    expect(applyConfigFilter(campaigns, filter({ search: 'generic' })).map((c) => c.id)).toEqual(['b']);
    expect(applyConfigFilter(campaigns, filter({ search: 'C' })).map((c) => c.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('filters on status and serving status independently', () => {
    expect(applyConfigFilter(campaigns, filter({ statuses: ['PAUSED'] })).map((c) => c.id)).toEqual(['b']);
    expect(
      applyConfigFilter(campaigns, filter({ servingStatuses: ['RUNNING'] })).map((c) => c.id),
    ).toEqual(['a', 'c']);
  });

  it('treats multi-value dimensions as "matches any", not "matches all"', () => {
    // Selecting two countries means "targets either", which is what the checkbox
    // UI implies. Requiring both would make most selections return nothing.
    const result = applyConfigFilter(campaigns, filter({ countriesOrRegions: ['US', 'JP'] }));
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('matches a campaign that delivers on any selected supply source', () => {
    const result = applyConfigFilter(campaigns, filter({ supplySources: ['APPSTORE_TODAY_TAB'] }));
    expect(result.map((c) => c.id)).toEqual(['b']);
  });

  it('combines predicates with AND across fields', () => {
    const result = applyConfigFilter(
      campaigns,
      filter({ statuses: ['ENABLED'], countriesOrRegions: ['US'] }),
    );
    expect(result.map((c) => c.id)).toEqual(['a', 'c']);
  });
});

describe('applyMetricFilter', () => {
  it('converts a spend threshold from dollars to cents', () => {
    // The UI collects dollars; storage is cents. Getting this backwards is a
    // 100x filter error, so it is asserted explicitly.
    expect(normalizePredicateValue({ metric: 'spendCents', comparator: 'gt', value: 20 })).toEqual({
      metric: 'spendCents',
      comparator: 'gt',
      value: 2000,
    });
  });

  it('leaves non-spend thresholds untouched', () => {
    const predicate = { metric: 'installs' as const, comparator: 'gte' as const, value: 100 };
    expect(normalizePredicateValue(predicate)).toEqual(predicate);
  });

  it('applies a spend threshold in display units', () => {
    const rows = [row({ spendCents: 1_000 }), row({ spendCents: 5_000 })];
    const result = applyMetricFilter(rows, [
      { metric: 'spendCents', comparator: 'gt', value: 20 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.metrics.spendCents).toBe(5_000);
  });

  it('applies each comparator correctly at the boundary', () => {
    const rows = [row({ installs: 100 })];
    const at = (comparator: 'gt' | 'gte' | 'lt' | 'lte') =>
      applyMetricFilter(rows, [{ metric: 'installs', comparator, value: 100 }]).length;
    expect(at('gt')).toBe(0);
    expect(at('gte')).toBe(1);
    expect(at('lt')).toBe(0);
    expect(at('lte')).toBe(1);
  });

  it('requires every predicate to hold', () => {
    const rows = [
      row({ spendCents: 100_000, installs: 10 }),
      row({ spendCents: 100_000, installs: 5_000 }),
    ];
    const result = applyMetricFilter(rows, [
      { metric: 'spendCents', comparator: 'gt', value: 500 },
      { metric: 'installs', comparator: 'gt', value: 1_000 },
    ]);
    expect(result).toHaveLength(1);
  });

  it('returns a copy when there are no predicates', () => {
    const rows = [row({ installs: 1 })];
    const result = applyMetricFilter(rows, []);
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });
});

describe('deriveSummary', () => {
  it('derives rates from counters', () => {
    const summary = deriveSummary({
      impressions: 10_000,
      taps: 500,
      installs: 100,
      redownloads: 20,
      spendCents: 25_000,
    });
    expect(summary.ttr).toBeCloseTo(0.05);
    expect(summary.conversionRate).toBeCloseTo(0.2);
    expect(summary.avgCPT).toBeCloseTo(0.5);
    expect(summary.avgCPA).toBeCloseTo(2.5);
    expect(summary.avgCPM).toBeCloseTo(25);
    expect(summary.localSpend).toBe('250.00');
  });

  it('returns zero rather than Infinity when a denominator is zero', () => {
    // A campaign that never delivered is common in the fixture; NaN or Infinity
    // here would propagate into sorting and into the UI.
    const summary = deriveSummary({
      impressions: 0,
      taps: 0,
      installs: 0,
      redownloads: 0,
      spendCents: 0,
    });
    expect(summary.ttr).toBe(0);
    expect(summary.avgCPA).toBe(0);
    expect(Number.isFinite(summary.avgCPM)).toBe(true);
  });
});
