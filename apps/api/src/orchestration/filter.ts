/**
 * Filtering runs in two passes, and the split matters.
 *
 * Config predicates (name, status, geo, supply source) need only the campaign
 * record, so they run first and typically cut 10,000 rows to a few hundred.
 * Metric predicates need a rollup for the selected date range, so they run
 * second — against the already-narrowed set. Doing it the other way round means
 * rolling up 10,000 campaigns to answer "paused campaigns in Japan".
 */

import type {
  Campaign,
  CampaignFilter,
  MetricPredicate,
  MetricSummary,
} from '@adsight/types';

/** Case- and diacritic-insensitive substring match on name and campaign id. */
function matchesSearch(campaign: Campaign, needle: string): boolean {
  if (needle === '') return true;
  return (
    campaign.name.toLowerCase().includes(needle) || campaign.id.toLowerCase().includes(needle)
  );
}

export function applyConfigFilter(
  campaigns: readonly Campaign[],
  filter: CampaignFilter,
): Campaign[] {
  const needle = filter.search.trim().toLowerCase();
  const statuses = filter.statuses.length > 0 ? new Set(filter.statuses) : null;
  const servingStatuses =
    filter.servingStatuses.length > 0 ? new Set(filter.servingStatuses) : null;
  const supplySources = filter.supplySources.length > 0 ? new Set(filter.supplySources) : null;
  const countries =
    filter.countriesOrRegions.length > 0 ? new Set(filter.countriesOrRegions) : null;

  const out: Campaign[] = [];
  for (const campaign of campaigns) {
    if (!matchesSearch(campaign, needle)) continue;
    if (statuses && !statuses.has(campaign.status)) continue;
    if (servingStatuses && !servingStatuses.has(campaign.servingStatus)) continue;
    // Multi-value dimensions match on intersection: selecting two supply sources
    // means "delivers on either", which is what the checkbox UI implies.
    if (supplySources && !campaign.supplySources.some((s) => supplySources.has(s))) continue;
    if (countries && !campaign.countriesOrRegions.some((c) => countries.has(c))) continue;
    out.push(campaign);
  }
  return out;
}

function satisfies(value: number, predicate: MetricPredicate): boolean {
  switch (predicate.comparator) {
    case 'gt':
      return value > predicate.value;
    case 'gte':
      return value >= predicate.value;
    case 'lt':
      return value < predicate.value;
    case 'lte':
      return value <= predicate.value;
  }
}

/**
 * Predicate values arrive in display units — a UI that shows dollars must not
 * force the user to type cents — so spend is converted here, in one place.
 */
export function metricValueFor(summary: MetricSummary, metric: MetricPredicate['metric']): number {
  return summary[metric];
}

export function normalizePredicateValue(predicate: MetricPredicate): MetricPredicate {
  if (predicate.metric !== 'spendCents') return predicate;
  return { ...predicate, value: Math.round(predicate.value * 100) };
}

export function applyMetricFilter<T extends { readonly metrics: MetricSummary }>(
  rows: readonly T[],
  predicates: readonly MetricPredicate[],
): T[] {
  if (predicates.length === 0) return [...rows];
  const normalized = predicates.map(normalizePredicateValue);

  const out: T[] = [];
  for (const row of rows) {
    let ok = true;
    for (const predicate of normalized) {
      if (!satisfies(metricValueFor(row.metrics, predicate.metric), predicate)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(row);
  }
  return out;
}
