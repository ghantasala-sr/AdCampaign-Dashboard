/**
 * Validates a raw tool argument object into a `FilterPlan`.
 *
 * The model's output is untrusted input like any other, so it goes through zod
 * before it becomes a plan — a hallucinated metric name or a string where a
 * number belongs becomes a clean error rather than a filter the BFF rejects
 * later with a 400. This is also what lets the heuristic fallback and the model
 * path share one output type.
 */

import { z } from 'zod';
import type { CampaignFilter, FilterPlan, PlanChange, SortSpec } from '@adsight/types';
import { SORTABLE_FIELDS, SORTABLE_METRICS } from '@adsight/types';

import { KEEP_CURRENT } from './prompt.js';

const presetEnum = z.enum([
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_14_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
]);

export const rawPlanSchema = z.object({
  interpretation: z.string().max(400),
  confidence: z.enum(['high', 'medium', 'low']),
  unsupported: z.array(z.string().max(200)).max(8),
  search: z.string().max(200),
  statuses: z.array(z.enum(['ENABLED', 'PAUSED'])),
  servingStatuses: z.array(z.enum(['RUNNING', 'NOT_RUNNING'])),
  supplySources: z.array(
    z.enum([
      'APPSTORE_SEARCH_RESULTS',
      'APPSTORE_SEARCH_TAB',
      'APPSTORE_TODAY_TAB',
      'APPSTORE_PRODUCT_PAGES_BROWSE',
    ]),
  ),
  countriesOrRegions: z.array(z.string()),
  metricPredicates: z
    .array(
      z.object({
        metric: z.enum(SORTABLE_METRICS),
        comparator: z.enum(['gt', 'gte', 'lt', 'lte']),
        value: z.number().finite(),
      }),
    )
    .max(6),
  dateRangePreset: z.union([presetEnum, z.literal(KEEP_CURRENT)]),
  sortField: z.union([z.enum(SORTABLE_FIELDS), z.literal(KEEP_CURRENT)]),
  sortDirection: z.union([z.enum(['asc', 'desc']), z.literal(KEEP_CURRENT)]),
});

export type RawPlan = z.infer<typeof rawPlanSchema>;

/**
 * Country names the model is likely to return despite being asked for ISO codes.
 *
 * The schema says "two-letter uppercase ISO country codes" and Gemini mostly
 * complies, but not always — a probe of "campaigns in Japan" came back with
 * `["Japan"]`. Silently dropping that would produce a filter missing the one
 * constraint the user actually asked for, so it is coerced instead. Anything
 * still unrecognised is dropped, which is the correct outcome for a genuinely
 * unknown market.
 */
const COUNTRY_NAME_TO_CODE: Readonly<Record<string, string>> = {
  'united states': 'US', 'united states of america': 'US', usa: 'US', america: 'US',
  'united kingdom': 'GB', britain: 'GB', england: 'GB', uk: 'GB',
  canada: 'CA', australia: 'AU', germany: 'DE', france: 'FR', japan: 'JP',
  'south korea': 'KR', korea: 'KR', brazil: 'BR', mexico: 'MX', india: 'IN',
  italy: 'IT', spain: 'ES', netherlands: 'NL', holland: 'NL', sweden: 'SE',
  singapore: 'SG', 'united arab emirates': 'AE', uae: 'AE',
  'south africa': 'ZA', poland: 'PL', turkey: 'TR', türkiye: 'TR',
};

/**
 * Two-letter strings that look like ISO codes but are not.
 *
 * `UK` is the common one — it is the everyday abbreviation for the United
 * Kingdom and the model emits it readily, but the ISO code is `GB` and the data
 * uses `GB`. Accepting `UK` unchanged produces a filter that matches nothing,
 * which reads to the user as "the AI got it wrong" rather than "the code was
 * wrong".
 */
const NON_ISO_ALIASES: Readonly<Record<string, string>> = { UK: 'GB', EN: 'GB' };

export function coerceCountryCode(value: string): string | null {
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    return NON_ISO_ALIASES[upper] ?? upper;
  }
  return COUNTRY_NAME_TO_CODE[trimmed.toLowerCase()] ?? null;
}

const METRIC_LABELS: Readonly<Record<string, string>> = {
  impressions: 'Impressions',
  taps: 'Taps',
  installs: 'Installs',
  redownloads: 'Redownloads',
  spendCents: 'Spend',
  ttr: 'Tap-through rate',
  conversionRate: 'Conversion rate',
  avgCPT: 'Avg CPT',
  avgCPA: 'Avg CPA',
  avgCPM: 'Avg CPM',
};

const COMPARATOR_LABELS: Readonly<Record<string, string>> = {
  gt: 'over',
  gte: 'at least',
  lt: 'under',
  lte: 'at most',
};

const PRESET_LABELS: Readonly<Record<string, string>> = {
  TODAY: 'Today',
  YESTERDAY: 'Yesterday',
  LAST_7_DAYS: 'Last 7 days',
  LAST_14_DAYS: 'Last 14 days',
  LAST_30_DAYS: 'Last 30 days',
  LAST_90_DAYS: 'Last 90 days',
};

const SUPPLY_LABELS: Readonly<Record<string, string>> = {
  APPSTORE_SEARCH_RESULTS: 'Search results',
  APPSTORE_SEARCH_TAB: 'Search tab',
  APPSTORE_TODAY_TAB: 'Today tab',
  APPSTORE_PRODUCT_PAGES_BROWSE: 'Product pages',
};

function formatPredicateValue(metric: string, value: number): string {
  if (metric === 'spendCents' || metric === 'avgCPT' || metric === 'avgCPA' || metric === 'avgCPM') {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  if (metric === 'ttr' || metric === 'conversionRate') {
    return `${(value * 100).toFixed(2)}%`;
  }
  return value.toLocaleString('en-US');
}

/**
 * Builds the reviewable chip list. These labels are the actual review surface —
 * if a user cannot tell from this list what the filter will do, the
 * human-in-the-loop step is theatre.
 */
export function describeChanges(filter: CampaignFilter, sort: SortSpec): PlanChange[] {
  const changes: PlanChange[] = [];

  if (filter.search.trim() !== '') {
    changes.push({ path: 'search', label: `Name contains "${filter.search.trim()}"` });
  }
  for (const status of filter.statuses) {
    changes.push({
      path: 'statuses',
      label: `Status is ${status === 'ENABLED' ? 'Enabled' : 'Paused'}`,
    });
  }
  for (const serving of filter.servingStatuses) {
    changes.push({
      path: 'servingStatuses',
      label: serving === 'RUNNING' ? 'Currently running' : 'Not currently running',
    });
  }
  for (const supply of filter.supplySources) {
    changes.push({ path: 'supplySources', label: `Appears in ${SUPPLY_LABELS[supply] ?? supply}` });
  }
  if (filter.countriesOrRegions.length > 0) {
    changes.push({
      path: 'countriesOrRegions',
      label: `Targets ${filter.countriesOrRegions.join(', ')}`,
    });
  }
  filter.metricPredicates.forEach((predicate, index) => {
    const metric = METRIC_LABELS[predicate.metric] ?? predicate.metric;
    const comparator = COMPARATOR_LABELS[predicate.comparator] ?? predicate.comparator;
    changes.push({
      path: `metricPredicates[${index}]`,
      label: `${metric} ${comparator} ${formatPredicateValue(predicate.metric, predicate.value)}`,
    });
  });
  if (filter.dateRange.preset !== null) {
    changes.push({
      path: 'dateRange',
      label: PRESET_LABELS[filter.dateRange.preset] ?? filter.dateRange.preset,
    });
  } else if (filter.dateRange.start && filter.dateRange.end) {
    changes.push({
      path: 'dateRange',
      label: `${filter.dateRange.start} to ${filter.dateRange.end}`,
    });
  }
  changes.push({
    path: 'sort',
    label: `Sorted by ${METRIC_LABELS[sort.field] ?? sort.field}, ${
      sort.direction === 'desc' ? 'highest first' : 'lowest first'
    }`,
  });

  return changes;
}

/** Merges a validated raw plan with the filter currently in effect. */
export function toFilterPlan(raw: RawPlan, currentFilter: CampaignFilter, currentSort: SortSpec): FilterPlan {
  const filter: CampaignFilter = {
    search: raw.search,
    statuses: raw.statuses,
    servingStatuses: raw.servingStatuses,
    supplySources: raw.supplySources,
    countriesOrRegions: raw.countriesOrRegions
      .map((c) => coerceCountryCode(c))
      .filter((c): c is string => c !== null),
    metricPredicates: raw.metricPredicates,
    dateRange:
      raw.dateRangePreset === KEEP_CURRENT
        ? currentFilter.dateRange
        : { preset: raw.dateRangePreset, start: null, end: null },
  };

  const sort: SortSpec = {
    field: raw.sortField === KEEP_CURRENT ? currentSort.field : raw.sortField,
    direction: raw.sortDirection === KEEP_CURRENT ? currentSort.direction : raw.sortDirection,
  };

  return {
    filter,
    sort,
    changes: describeChanges(filter, sort),
    interpretation: raw.interpretation,
    unsupported: raw.unsupported,
    confidence: raw.confidence,
  };
}
