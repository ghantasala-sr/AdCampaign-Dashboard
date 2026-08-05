/**
 * The filter model is the single most-shared type in the repo. It is:
 *   - held in Redux on the client,
 *   - serialised into the URL for shareable views,
 *   - validated and applied by the BFF,
 *   - and produced by the AI planner as a tool-call argument.
 *
 * Keeping one definition is the concrete reason `packages/types` exists: a new
 * filter field is a single edit that the compiler then enforces across both apps.
 */

import type { CampaignStatus, ServingStatus, SupplySource } from './campaign.js';
import type { SortableField, SortableMetric, SortDirection } from './metrics.js';

export type MetricComparator = 'gt' | 'gte' | 'lt' | 'lte';

export interface MetricPredicate {
  readonly metric: SortableMetric;
  readonly comparator: MetricComparator;
  readonly value: number;
}

/** Named ranges resolve server-side so "last 7 days" means the same thing everywhere. */
export type DateRangePreset =
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_7_DAYS'
  | 'LAST_14_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS';

export interface DateRange {
  readonly preset: DateRangePreset | null;
  /** Inclusive ISO date (YYYY-MM-DD). Present when preset is null. */
  readonly start: string | null;
  /** Inclusive ISO date (YYYY-MM-DD). Present when preset is null. */
  readonly end: string | null;
}

export interface CampaignFilter {
  readonly search: string;
  readonly statuses: readonly CampaignStatus[];
  readonly servingStatuses: readonly ServingStatus[];
  readonly supplySources: readonly SupplySource[];
  readonly countriesOrRegions: readonly string[];
  readonly metricPredicates: readonly MetricPredicate[];
  readonly dateRange: DateRange;
}

export interface SortSpec {
  readonly field: SortableField;
  readonly direction: SortDirection;
}

export const EMPTY_FILTER: CampaignFilter = {
  search: '',
  statuses: [],
  servingStatuses: [],
  supplySources: [],
  countriesOrRegions: [],
  metricPredicates: [],
  dateRange: { preset: 'LAST_30_DAYS', start: null, end: null },
};

export const DEFAULT_SORT: SortSpec = { field: 'spendCents', direction: 'desc' };

/** True when the filter would not narrow the result set at all. */
export function isFilterEmpty(filter: CampaignFilter): boolean {
  return (
    filter.search.trim() === '' &&
    filter.statuses.length === 0 &&
    filter.servingStatuses.length === 0 &&
    filter.supplySources.length === 0 &&
    filter.countriesOrRegions.length === 0 &&
    filter.metricPredicates.length === 0
  );
}

/** Count of active constraints — drives the "N filters" badge in the UI. */
export function countActiveFilters(filter: CampaignFilter): number {
  return (
    (filter.search.trim() === '' ? 0 : 1) +
    filter.statuses.length +
    filter.servingStatuses.length +
    filter.supplySources.length +
    filter.countriesOrRegions.length +
    filter.metricPredicates.length
  );
}
