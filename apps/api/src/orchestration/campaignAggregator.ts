/**
 * The orchestration this BFF exists for.
 *
 * One client request fans out to four upstreams and returns a single shaped
 * payload. The ordering is the interesting part, because it decides how much
 * work the expensive upstreams have to do:
 *
 *   1. campaignService  — all configs (cheap, cacheable)
 *   2. filter on config — 10,000 rows to typically a few hundred
 *   3. reportingService — roll up only the survivors, for the resolved window
 *   4. filter on metrics, sort, then slice to one page
 *   5. catalogService + budgetService — page only, and in parallel
 *
 * Steps 1–4 are the reason a metric filter over 10,000 campaigns is affordable;
 * step 5 is the reason a 50-row page costs two batched upstream calls instead of
 * a hundred. Failures in the catalog and budget services degrade the response
 * rather than failing it.
 */

import type {
  CampaignDetailResponse,
  CampaignListQuery,
  CampaignListResponse,
  CampaignRow,
  DegradedUpstream,
  MetricSummary,
} from '@adsight/types';

import { loadDataset } from '../lib/fixtures.js';
import { UpstreamUnavailableError } from '../upstream/latency.js';
import * as campaignService from '../upstream/campaignService.js';
import * as reportingService from '../upstream/reportingService.js';
import * as catalogService from '../upstream/catalogService.js';
import * as budgetService from '../upstream/budgetService.js';
import { resolveDateRange, todayWindow } from './dateRange.js';
import { deriveSummary, sumCounters, ZERO_COUNTERS } from './derive.js';
import { applyConfigFilter, applyMetricFilter } from './filter.js';
import { sortRows } from './sort.js';

const MAX_LIMIT = 500;
const SPARKLINE_BUCKETS = 24;

export interface IntermediateRow {
  readonly campaign: import('@adsight/types').Campaign;
  readonly metrics: MetricSummary;
}

export interface CoreListResult {
  /** The rows for the requested page, already filtered and sorted. */
  readonly page: readonly IntermediateRow[];
  /** Size of the filtered set before paging. */
  readonly total: number;
  readonly totals: MetricSummary;
  readonly range: ReturnType<typeof resolveDateRange>;
  readonly offset: number;
  readonly limit: number;
}

/**
 * Steps 1–4: everything that does not need the catalog or budget upstreams.
 *
 * Split out so the GraphQL resolvers can stop here and fetch `app` and `pacing`
 * only when those fields are actually selected. The REST endpoint always joins
 * them because its response shape is fixed; that difference is the clearest
 * argument for having both surfaces in one BFF.
 */
export async function listCampaignsCore(query: CampaignListQuery): Promise<CoreListResult> {
  const dataset = loadDataset();
  const range = resolveDateRange(query.filter.dateRange, dataset.manifest);

  // 1 + 2 — config, then the cheap predicates.
  const { campaigns } = await campaignService.listCampaigns();
  const configMatches = applyConfigFilter(campaigns, query.filter);

  // 3 — roll up only what survived.
  const counters = await reportingService.rollup(
    configMatches.map((c) => c.id),
    range,
  );

  const withMetrics: IntermediateRow[] = configMatches.map((campaign) => ({
    campaign,
    metrics: deriveSummary(
      counters.get(campaign.id) ?? ZERO_COUNTERS,
      campaign.dailyBudgetAmount.currency,
    ),
  }));

  // 4 — metric predicates, sort, page. Totals are computed over the fully
  // filtered set, not the page, so the header reflects the current view.
  const metricMatches = applyMetricFilter(withMetrics, query.filter.metricPredicates);
  const totals = deriveSummary(sumCounters(metricMatches.map((r) => r.metrics)));

  const sorted = sortRows(metricMatches, query.sort);
  const limit = Math.min(Math.max(1, query.limit), MAX_LIMIT);
  const offset = Math.max(0, query.offset);

  return {
    page: sorted.slice(offset, offset + limit),
    total: sorted.length,
    totals,
    range,
    offset,
    limit,
  };
}

export async function listCampaigns(query: CampaignListQuery): Promise<CampaignListResponse> {
  const startedAt = performance.now();
  const dataset = loadDataset();
  const degraded: DegradedUpstream[] = [];

  const { page, total, totals, range, offset, limit } = await listCampaignsCore(query);

  // 5 — per-page enrichment, both upstreams in flight at once.
  const sparklines = reportingService.sparklines(
    page.map((r) => r.campaign.id),
    range,
    SPARKLINE_BUCKETS,
  );

  const todayCounters = await reportingService.rollup(
    page.map((r) => r.campaign.id),
    todayWindow(dataset.manifest),
  );

  const [apps, pacing] = await Promise.all([
    catalogService
      .getApps(page.map((r) => r.campaign.adamId))
      .catch(withDegradation(degraded, 'catalogService', new Map())),
    budgetService
      .getPacing(
        page.map((r) => ({
          campaign: r.campaign,
          todaySpendCents: budgetService.todaySpendFrom(todayCounters.get(r.campaign.id)),
        })),
      )
      .catch(withDegradation(degraded, 'budgetService', new Map())),
  ]);

  const rows: CampaignRow[] = page.map((row) => ({
    campaign: row.campaign,
    app: apps.get(row.campaign.adamId) ?? null,
    metrics: row.metrics,
    sparkline: sparklines.get(row.campaign.id) ?? [],
    pacing: pacing.get(row.campaign.id) ?? null,
  }));

  return {
    rows,
    pageInfo: {
      offset,
      limit,
      total,
      hasMore: offset + page.length < total,
    },
    totals,
    meta: {
      degraded,
      durationMs: Math.round(performance.now() - startedAt),
      resolvedDateRange: { start: range.start, end: range.end },
    },
  };
}

export async function getCampaignDetail(
  campaignId: string,
  dateRange: CampaignListQuery['filter']['dateRange'],
): Promise<CampaignDetailResponse | null> {
  const startedAt = performance.now();
  const dataset = loadDataset();
  const degraded: DegradedUpstream[] = [];
  const range = resolveDateRange(dateRange, dataset.manifest);

  const campaign = await campaignService.getCampaign(campaignId);
  if (!campaign) return null;

  // Nothing here depends on anything else, so all four go out together.
  const [children, counters, timeSeries, todayCounters] = await Promise.all([
    campaignService.getChildren(campaignId),
    reportingService.rollup([campaignId], range),
    reportingService.series(campaignId, range),
    reportingService.rollup([campaignId], todayWindow(dataset.manifest)),
  ]);

  const [apps, pacing] = await Promise.all([
    catalogService
      .getApps([campaign.adamId])
      .catch(withDegradation(degraded, 'catalogService', new Map())),
    budgetService
      .getPacing([
        {
          campaign,
          todaySpendCents: budgetService.todaySpendFrom(todayCounters.get(campaignId)),
        },
      ])
      .catch(withDegradation(degraded, 'budgetService', new Map())),
  ]);

  const metrics = deriveSummary(
    counters.get(campaignId) ?? ZERO_COUNTERS,
    campaign.dailyBudgetAmount.currency,
  );

  return {
    row: {
      campaign,
      app: apps.get(campaign.adamId) ?? null,
      metrics,
      sparkline: timeSeries.map((p) => p.spendCents),
      pacing: pacing.get(campaignId) ?? null,
    },
    adGroups: children.adGroups,
    keywords: children.keywords,
    timeSeries,
    meta: {
      degraded,
      durationMs: Math.round(performance.now() - startedAt),
      resolvedDateRange: { start: range.start, end: range.end },
    },
  };
}

/**
 * Converts an upstream outage into a recorded degradation plus a safe empty
 * value. Anything that is not an `UpstreamUnavailableError` is a real bug and is
 * rethrown so it surfaces as a 500 rather than a silently missing column.
 */
function withDegradation<T>(
  sink: DegradedUpstream[],
  upstream: DegradedUpstream,
  fallback: T,
): (error: unknown) => T {
  return (error: unknown) => {
    if (error instanceof UpstreamUnavailableError) {
      if (!sink.includes(upstream)) sink.push(upstream);
      return fallback;
    }
    throw error;
  };
}
