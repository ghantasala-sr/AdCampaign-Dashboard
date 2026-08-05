/**
 * Wire contract between the BFF and the web app.
 *
 * The BFF's job is to return rows the table can render without further joining,
 * deriving, or formatting decisions. `CampaignRow` is therefore a view model,
 * not a database record: it flattens campaign config, rolled-up metrics, app
 * catalog metadata, and budget pacing into one object.
 */

import type {
  AdGroup,
  AppMetadata,
  BudgetPacing,
  Campaign,
  Keyword,
} from './campaign.js';
import type { MetricPoint, MetricSummary } from './metrics.js';
import type { CampaignFilter, SortSpec } from './filters.js';

export interface CampaignRow {
  readonly campaign: Campaign;
  readonly app: AppMetadata | null;
  readonly metrics: MetricSummary;
  /** Pre-aggregated daily series for the row sparkline. Bounded length. */
  readonly sparkline: readonly number[];
  /** Null when the budget service is degraded — the row still renders. */
  readonly pacing: BudgetPacing | null;
}

export interface PageInfo {
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
  readonly hasMore: boolean;
}

/**
 * Names the upstreams that failed for this request. The UI surfaces these as a
 * non-blocking banner rather than an error page — a degraded budget service
 * should not take the campaign list down.
 */
export type DegradedUpstream = 'campaignService' | 'reportingService' | 'catalogService' | 'budgetService';

export interface ResponseMeta {
  readonly degraded: readonly DegradedUpstream[];
  /** Server-side duration in ms, surfaced in the UI's debug footer. */
  readonly durationMs: number;
  readonly resolvedDateRange: { readonly start: string; readonly end: string };
}

export interface CampaignListResponse {
  readonly rows: readonly CampaignRow[];
  readonly pageInfo: PageInfo;
  readonly totals: MetricSummary;
  readonly meta: ResponseMeta;
}

export interface CampaignDetailResponse {
  readonly row: CampaignRow;
  readonly adGroups: readonly AdGroup[];
  readonly keywords: readonly Keyword[];
  readonly timeSeries: readonly MetricPoint[];
  readonly meta: ResponseMeta;
}

export interface CampaignListQuery {
  readonly filter: CampaignFilter;
  readonly sort: SortSpec;
  readonly offset: number;
  readonly limit: number;
}

export interface CreateCampaignInput {
  readonly name: string;
  readonly adamId: string;
  readonly dailyBudgetAmount: string;
  readonly budgetAmount: string;
  readonly currency: string;
  readonly countriesOrRegions: readonly string[];
  readonly supplySources: readonly Campaign['supplySources'][number][];
  readonly billingEvent: Campaign['billingEvent'];
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    /** Field-level validation problems, keyed by dotted path. */
    readonly fields?: Readonly<Record<string, string>>;
  };
}

/** Distinct-value lists for the filter panel, served from one endpoint. */
export interface FacetsResponse {
  readonly countriesOrRegions: readonly string[];
  readonly supplySources: readonly Campaign['supplySources'][number][];
  readonly apps: readonly AppMetadata[];
}
