/**
 * One definition of how a filter becomes a query string.
 *
 * The web app uses it to keep the URL in sync (so a filtered view is a
 * shareable link and back/forward work), and the BFF uses the decoder to parse
 * incoming requests. Two implementations of this would drift immediately — a
 * new filter field added to the UI would silently stop reaching the server.
 *
 * The encoding is deliberately flat and human-readable rather than a base64 blob,
 * because a URL you can read is a URL you can debug.
 */

import type { CampaignStatus, ServingStatus, SupplySource } from './campaign.js';
import {
  EMPTY_FILTER,
  type CampaignFilter,
  type DateRangePreset,
  type MetricComparator,
  type MetricPredicate,
  type SortSpec,
} from './filters.js';
import {
  SORTABLE_FIELDS,
  SORTABLE_METRICS,
  type SortableField,
  type SortableMetric,
} from './metrics.js';

export interface ListParams {
  readonly filter: CampaignFilter;
  readonly sort: SortSpec;
  readonly offset: number;
  readonly limit: number;
}

const CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['ENABLED', 'PAUSED'];
const SERVING_STATUSES: readonly ServingStatus[] = ['RUNNING', 'NOT_RUNNING'];
const SUPPLY_SOURCES: readonly SupplySource[] = [
  'APPSTORE_SEARCH_RESULTS',
  'APPSTORE_SEARCH_TAB',
  'APPSTORE_TODAY_TAB',
  'APPSTORE_PRODUCT_PAGES_BROWSE',
];
const PRESETS: readonly DateRangePreset[] = [
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_14_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
];
const COMPARATORS: readonly MetricComparator[] = ['gt', 'gte', 'lt', 'lte'];

/** Keeps only values that are members of `allowed`, preserving order. */
function keepValid<T extends string>(values: readonly string[], allowed: readonly T[]): T[] {
  const set = new Set<string>(allowed);
  const out: T[] = [];
  for (const value of values) {
    if (set.has(value) && !out.includes(value as T)) out.push(value as T);
  }
  return out;
}

function splitList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** `spendCents:gt:1000` -> a predicate. Returns null for anything malformed. */
export function decodeMetricPredicate(raw: string): MetricPredicate | null {
  const parts = raw.split(':');
  if (parts.length !== 3) return null;
  const [metric, comparator, rawValue] = parts as [string, string, string];
  if (!(SORTABLE_METRICS as readonly string[]).includes(metric)) return null;
  if (!(COMPARATORS as readonly string[]).includes(comparator)) return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;
  return {
    metric: metric as SortableMetric,
    comparator: comparator as MetricComparator,
    value,
  };
}

export function encodeMetricPredicate(predicate: MetricPredicate): string {
  return `${predicate.metric}:${predicate.comparator}:${predicate.value}`;
}

/** Reads params from anything with URLSearchParams' `get` shape. */
export interface ParamReader {
  get(key: string): string | null | undefined;
}

export function decodeListParams(params: ParamReader): ListParams {
  const presetRaw = params.get('preset');
  const start = params.get('start') ?? null;
  const end = params.get('end') ?? null;

  const preset =
    presetRaw && (PRESETS as readonly string[]).includes(presetRaw)
      ? (presetRaw as DateRangePreset)
      : // A custom range is only honoured when both ends are present; otherwise
        // fall back to the default preset rather than erroring on a half-built URL.
        start && end
        ? null
        : EMPTY_FILTER.dateRange.preset;

  const metricPredicates = splitList(params.get('metric'))
    .map(decodeMetricPredicate)
    .filter((p): p is MetricPredicate => p !== null);

  const filter: CampaignFilter = {
    search: (params.get('search') ?? '').slice(0, 200),
    statuses: keepValid(splitList(params.get('status')), CAMPAIGN_STATUSES),
    servingStatuses: keepValid(splitList(params.get('serving')), SERVING_STATUSES),
    supplySources: keepValid(splitList(params.get('supply')), SUPPLY_SOURCES),
    // Country codes are open-ended, so only shape is validated.
    countriesOrRegions: splitList(params.get('country'))
      .map((c) => c.toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c)),
    metricPredicates,
    dateRange: {
      preset,
      start: preset === null ? start : null,
      end: preset === null ? end : null,
    },
  };

  const sortField = params.get('sort');
  const sortDir = params.get('dir');
  const sort: SortSpec = {
    field: (SORTABLE_FIELDS as readonly string[]).includes(sortField ?? '')
      ? (sortField as SortableField)
      : 'spendCents',
    direction: sortDir === 'asc' ? 'asc' : 'desc',
  };

  const offset = Math.max(0, Math.trunc(Number(params.get('offset') ?? 0)) || 0);
  const rawLimit = Math.trunc(Number(params.get('limit') ?? 50)) || 50;
  const limit = Math.min(500, Math.max(1, rawLimit));

  return { filter, sort, offset, limit };
}

/**
 * Inverse of `decodeListParams`. Omits anything at its default so the URL stays
 * short — an unfiltered view has a clean address.
 */
export function encodeListParams(input: {
  readonly filter: CampaignFilter;
  readonly sort: SortSpec;
  readonly offset?: number;
  readonly limit?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  const { filter, sort } = input;

  if (filter.search.trim() !== '') params.set('search', filter.search.trim());
  if (filter.statuses.length > 0) params.set('status', filter.statuses.join(','));
  if (filter.servingStatuses.length > 0) params.set('serving', filter.servingStatuses.join(','));
  if (filter.supplySources.length > 0) params.set('supply', filter.supplySources.join(','));
  if (filter.countriesOrRegions.length > 0) {
    params.set('country', filter.countriesOrRegions.join(','));
  }
  if (filter.metricPredicates.length > 0) {
    params.set('metric', filter.metricPredicates.map(encodeMetricPredicate).join(','));
  }

  if (filter.dateRange.preset !== null) {
    if (filter.dateRange.preset !== EMPTY_FILTER.dateRange.preset) {
      params.set('preset', filter.dateRange.preset);
    }
  } else if (filter.dateRange.start && filter.dateRange.end) {
    params.set('start', filter.dateRange.start);
    params.set('end', filter.dateRange.end);
  }

  if (sort.field !== 'spendCents') params.set('sort', sort.field);
  if (sort.direction !== 'desc') params.set('dir', sort.direction);
  if (input.offset !== undefined && input.offset > 0) params.set('offset', String(input.offset));
  if (input.limit !== undefined && input.limit !== 50) params.set('limit', String(input.limit));

  return params;
}
