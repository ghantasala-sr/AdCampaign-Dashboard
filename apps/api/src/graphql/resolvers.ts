/**
 * Root resolvers.
 *
 * Rows are returned with `app` and `pacing` as thunks. graphql-js's default
 * field resolver calls a function-valued property and awaits its promise, so
 * those upstreams are only touched when the query selects them — the laziness
 * the schema comment promises, without hand-writing a resolver map per type.
 */

import type {
  CampaignFilter,
  CampaignStatus,
  DateRangePreset,
  MetricPredicate,
  ServingStatus,
  SortableField,
  SortDirection,
  SupplySource,
} from '@adsight/types';
import { EMPTY_FILTER, SORTABLE_FIELDS } from '@adsight/types';

import { getCampaignDetail, listCampaignsCore } from '../orchestration/campaignAggregator.js';
import * as reportingService from '../upstream/reportingService.js';
import * as catalogService from '../upstream/catalogService.js';
import { loadDataset } from '../lib/fixtures.js';
import { createLoaders, type RequestLoaders } from './loaders.js';

/**
 * The index signature satisfies graphql-http's `OperationContext` constraint;
 * `loaders` is the only key ever set.
 */
export interface GraphQLContext extends Record<PropertyKey, unknown> {
  readonly loaders: RequestLoaders;
}

export function createContext(): GraphQLContext {
  return { loaders: createLoaders() };
}

interface CampaignsArgs {
  search?: string | null;
  statuses?: CampaignStatus[] | null;
  servingStatuses?: ServingStatus[] | null;
  supplySources?: SupplySource[] | null;
  countriesOrRegions?: string[] | null;
  metricPredicates?: MetricPredicate[] | null;
  preset?: string | null;
  start?: string | null;
  end?: string | null;
  sort?: string | null;
  direction?: SortDirection | null;
  offset?: number | null;
  limit?: number | null;
}

function buildFilter(args: CampaignsArgs): CampaignFilter {
  const hasCustomRange = Boolean(args.start && args.end);
  return {
    search: args.search ?? '',
    statuses: args.statuses ?? [],
    servingStatuses: args.servingStatuses ?? [],
    supplySources: args.supplySources ?? [],
    countriesOrRegions: (args.countriesOrRegions ?? []).map((c) => c.toUpperCase()),
    metricPredicates: args.metricPredicates ?? [],
    dateRange: hasCustomRange
      ? { preset: null, start: args.start ?? null, end: args.end ?? null }
      : {
          preset: (args.preset as DateRangePreset | null) ?? EMPTY_FILTER.dateRange.preset,
          start: null,
          end: null,
        },
  };
}

function buildSort(args: CampaignsArgs): { field: SortableField; direction: SortDirection } {
  const field = (SORTABLE_FIELDS as readonly string[]).includes(args.sort ?? '')
    ? (args.sort as SortableField)
    : 'spendCents';
  return { field, direction: args.direction === 'asc' ? 'asc' : 'desc' };
}

const SPARKLINE_BUCKETS = 24;

export const rootValue = {
  async campaigns(args: CampaignsArgs, context: GraphQLContext) {
    const filter = buildFilter(args);
    const sort = buildSort(args);
    const core = await listCampaignsCore({
      filter,
      sort,
      offset: args.offset ?? 0,
      limit: args.limit ?? 50,
    });

    const sparklines = reportingService.sparklines(
      core.page.map((r) => r.campaign.id),
      core.range,
      SPARKLINE_BUCKETS,
    );

    return {
      rows: core.page.map((row) => ({
        campaign: row.campaign,
        metrics: row.metrics,
        sparkline: sparklines.get(row.campaign.id) ?? [],
        // Thunks: not invoked unless the query selects the field.
        app: () => context.loaders.loadApp(row.campaign.adamId),
        pacing: () => context.loaders.loadPacing(row.campaign),
      })),
      pageInfo: {
        offset: core.offset,
        limit: core.limit,
        total: core.total,
        hasMore: core.offset + core.page.length < core.total,
      },
      totals: core.totals,
      resolvedDateRange: { start: core.range.start, end: core.range.end },
      // Read at serialisation time, after the row thunks have run.
      degraded: () => context.loaders.degraded,
    };
  },

  async campaign(args: { id: string; preset?: string | null; start?: string | null; end?: string | null }) {
    const filter = buildFilter(args);
    const detail = await getCampaignDetail(args.id, filter.dateRange);
    if (!detail) return null;
    // The detail view always shows both columns, so eager resolution here is
    // the correct call — laziness would just add a round of microtasks.
    return {
      row: detail.row,
      adGroups: detail.adGroups,
      keywords: detail.keywords,
      timeSeries: detail.timeSeries,
    };
  },

  async facets() {
    const dataset = loadDataset();
    const apps = await catalogService.listApps();
    const countries = new Set<string>();
    for (const campaign of dataset.campaigns) {
      for (const country of campaign.countriesOrRegions) countries.add(country);
    }
    return {
      countriesOrRegions: [...countries].sort(),
      supplySources: [
        'APPSTORE_SEARCH_RESULTS',
        'APPSTORE_SEARCH_TAB',
        'APPSTORE_TODAY_TAB',
        'APPSTORE_PRODUCT_PAGES_BROWSE',
      ],
      apps,
      dataWindow: {
        start: dataset.manifest.startDate,
        end: dataset.manifest.endDate,
        days: dataset.manifest.days,
        campaignCount: dataset.manifest.campaignCount,
      },
    };
  },
};
