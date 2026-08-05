/**
 * Derives every rate and average from the five raw counters.
 *
 * All of this could happen in the browser. It happens here because the same
 * numbers are also needed for server-side metric filtering and sorting, and
 * because a divide-by-zero convention decided in one place cannot drift between
 * the table cell, the sort comparator, and the CSV export.
 */

import type { MetricCounters, MetricSummary } from '@adsight/types';

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function deriveSummary(counters: MetricCounters, currency = 'USD'): MetricSummary {
  const spendDollars = counters.spendCents / 100;
  return {
    ...counters,
    localSpend: spendDollars.toFixed(2),
    ttr: ratio(counters.taps, counters.impressions),
    conversionRate: ratio(counters.installs, counters.taps),
    avgCPT: ratio(spendDollars, counters.taps),
    avgCPA: ratio(spendDollars, counters.installs),
    avgCPM: ratio(spendDollars * 1000, counters.impressions),
  };
}

export const ZERO_COUNTERS: MetricCounters = {
  impressions: 0,
  taps: 0,
  installs: 0,
  redownloads: 0,
  spendCents: 0,
};

export function sumCounters(items: Iterable<MetricCounters>): MetricCounters {
  let impressions = 0;
  let taps = 0;
  let installs = 0;
  let redownloads = 0;
  let spendCents = 0;
  for (const c of items) {
    impressions += c.impressions;
    taps += c.taps;
    installs += c.installs;
    redownloads += c.redownloads;
    spendCents += c.spendCents;
  }
  return { impressions, taps, installs, redownloads, spendCents };
}
