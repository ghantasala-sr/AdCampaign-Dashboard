import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, EMPTY_FILTER } from '@adsight/types';

import { planFromHeuristic } from './heuristic.js';

/**
 * The heuristic planner is the fallback that makes the query bar work with no API
 * key, so it is also the part of the AI feature that can be tested exactly.
 *
 * The cases here are the ones that were wrong on the first pass — they are
 * regression tests, not aspirational ones.
 */

function plan(query: string) {
  return planFromHeuristic(query, EMPTY_FILTER, DEFAULT_SORT);
}

describe('planFromHeuristic', () => {
  it('maps status words to the status field rather than a name search', () => {
    const result = plan('paused campaigns');
    expect(result.filter.statuses).toEqual(['PAUSED']);
    // The whole point: "paused" must not leak into free-text search.
    expect(result.filter.search).toBe('');
  });

  it('distinguishes serving status from campaign status', () => {
    const result = plan('enabled but not running');
    expect(result.filter.statuses).toEqual(['ENABLED']);
    expect(result.filter.servingStatuses).toEqual(['NOT_RUNNING']);
  });

  it('converts country names and bare codes to ISO codes', () => {
    expect(plan('campaigns in japan and germany').filter.countriesOrRegions).toEqual(['DE', 'JP']);
    expect(plan('spend in JP').filter.countriesOrRegions).toEqual(['JP']);
  });

  it('reads a threshold with a currency symbol and thousands separator', () => {
    const result = plan('spend over $2,000');
    expect(result.filter.metricPredicates).toEqual([
      { metric: 'spendCents', comparator: 'gt', value: 2000 },
    ]);
  });

  it('expands k and m suffixes', () => {
    expect(plan('at least 5k impressions').filter.metricPredicates[0]).toEqual({
      metric: 'impressions',
      comparator: 'gte',
      value: 5000,
    });
    expect(plan('over 1.2m impressions').filter.metricPredicates[0]?.value).toBe(1_200_000);
  });

  it('stores rate metrics as fractions whether or not a percent sign is present', () => {
    expect(plan('ttr below 2%').filter.metricPredicates[0]).toEqual({
      metric: 'ttr',
      comparator: 'lt',
      value: 0.02,
    });
    expect(plan('conversion rate above 40').filter.metricPredicates[0]?.value).toBeCloseTo(0.4);
  });

  it('binds a comparator to the number that follows it, not the nearest one', () => {
    // Regression: "last 7 days" used to supply the value for "below", producing
    // "ttr under 7%" instead of "ttr under 2%".
    const result = plan('not running last 7 days with ttr below 2%');
    expect(result.filter.metricPredicates).toEqual([
      { metric: 'ttr', comparator: 'lt', value: 0.02 },
    ]);
    expect(result.filter.dateRange.preset).toBe('LAST_7_DAYS');
  });

  it('reads two independent thresholds', () => {
    const result = plan('spend over $500 and cpa under 4');
    expect(result.filter.metricPredicates).toEqual([
      { metric: 'spendCents', comparator: 'gt', value: 500 },
      { metric: 'avgCPA', comparator: 'lt', value: 4 },
    ]);
  });

  describe('sort direction', () => {
    it('treats "worst" on a cost metric as highest-first', () => {
      // Regression: the worst CPA is the most expensive one, not the cheapest.
      const result = plan('worst CPA first');
      expect(result.sort).toEqual({ field: 'avgCPA', direction: 'desc' });
    });

    it('treats "best" on a cost metric as lowest-first', () => {
      expect(plan('best CPA').sort).toEqual({ field: 'avgCPA', direction: 'asc' });
    });

    it('treats "worst" on a benefit metric as lowest-first', () => {
      expect(plan('worst converting campaigns').sort).toEqual({
        field: 'conversionRate',
        direction: 'asc',
      });
    });

    it('keeps magnitude words literal regardless of whether high is good', () => {
      expect(plan('top campaigns by installs').sort).toEqual({
        field: 'installs',
        direction: 'desc',
      });
      // "lowest" means low, even though low impressions is not a good outcome.
      expect(plan('lowest impressions').sort).toEqual({
        field: 'impressions',
        direction: 'asc',
      });
    });

    it('does not read "at most" or "at least" as sort intent', () => {
      // Regression: \bmost\b matched inside "at most" and invented a sort.
      const result = plan('at least 5k impressions, at most 2% ttr');
      expect(result.sort).toEqual(DEFAULT_SORT);
    });
  });

  it('only treats quoted or explicitly named text as a name filter', () => {
    expect(plan('campaigns named "Brand"').filter.search).toBe('Brand');
    // An unquoted noun is not assumed to be a campaign name.
    expect(plan('show me winback campaigns').filter.search).toBe('');
  });

  it('reports mutation and aggregation requests as unsupported', () => {
    const result = plan('pause everything in Germany and group by week');
    expect(result.filter.countriesOrRegions).toEqual(['DE']);
    expect(result.unsupported).toHaveLength(2);
    expect(result.unsupported.join(' ')).toMatch(/not modify|Grouping/);
  });

  it('reports low confidence and says so when nothing was understood', () => {
    const result = plan('what is the weather today');
    expect(result.confidence).toBe('low');
    expect(result.unsupported.join(' ')).toMatch(/No filterable criteria/);
  });

  it('always describes the plan as reviewable chips', () => {
    const result = plan('paused campaigns in Japan with spend over $2000');
    const labels = result.changes.map((c) => c.label);
    expect(labels).toContain('Status is Paused');
    expect(labels).toContain('Targets JP');
    expect(labels).toContain('Spend over $2,000');
    // The sort is always stated so the review reflects the whole applied view.
    expect(labels.some((l) => l.startsWith('Sorted by'))).toBe(true);
  });

  it('carries over the current filter when the query says nothing about a field', () => {
    const current = { ...EMPTY_FILTER, dateRange: { preset: 'LAST_7_DAYS' as const, start: null, end: null } };
    const result = planFromHeuristic('paused campaigns', current, DEFAULT_SORT);
    expect(result.filter.dateRange.preset).toBe('LAST_7_DAYS');
  });
});
