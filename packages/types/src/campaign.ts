/**
 * Domain model for the campaign surface.
 *
 * Vocabulary deliberately mirrors the Apple Search Ads Campaign Management API
 * (supply sources, serving state reasons, billing events, tap-through rate) so
 * that anyone who has used that product recognises the shape immediately.
 */

export type CampaignStatus = 'ENABLED' | 'PAUSED';

/** Derived server-side from status + budget pacing + schedule. Never set by the client. */
export type ServingStatus = 'RUNNING' | 'NOT_RUNNING';

export type ServingStateReason =
  | 'CAMPAIGN_ON_HOLD'
  | 'CAMPAIGN_END_DATE_REACHED'
  | 'DAILY_CAP_EXHAUSTED'
  | 'TOTAL_BUDGET_EXHAUSTED'
  | 'PAUSED_BY_USER'
  | 'APP_NOT_ELIGIBLE';

export type AdChannelType = 'SEARCH' | 'DISPLAY';

export type SupplySource =
  | 'APPSTORE_SEARCH_RESULTS'
  | 'APPSTORE_SEARCH_TAB'
  | 'APPSTORE_TODAY_TAB'
  | 'APPSTORE_PRODUCT_PAGES_BROWSE';

export type BillingEvent = 'TAPS' | 'IMPRESSIONS';

export type MatchType = 'EXACT' | 'BROAD';

/** Currency amounts are transported as decimal strings to avoid float drift. */
export interface Money {
  readonly amount: string;
  readonly currency: string;
}

export interface Campaign {
  readonly id: string;
  /** App Store app identifier the campaign promotes. */
  readonly adamId: string;
  readonly name: string;
  readonly status: CampaignStatus;
  readonly servingStatus: ServingStatus;
  readonly servingStateReasons: readonly ServingStateReason[];
  readonly adChannelType: AdChannelType;
  readonly supplySources: readonly SupplySource[];
  readonly countriesOrRegions: readonly string[];
  readonly billingEvent: BillingEvent;
  readonly budgetAmount: Money;
  readonly dailyBudgetAmount: Money;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly createdAt: string;
  readonly modifiedAt: string;
}

export interface AdGroup {
  readonly id: string;
  readonly campaignId: string;
  readonly name: string;
  readonly status: CampaignStatus;
  readonly defaultBidAmount: Money;
  readonly cpaGoal: Money | null;
  readonly startTime: string;
}

export interface Keyword {
  readonly id: string;
  readonly adGroupId: string;
  readonly campaignId: string;
  readonly text: string;
  readonly matchType: MatchType;
  readonly status: CampaignStatus;
  readonly bidAmount: Money;
}

/** App catalog metadata, owned by a different upstream than campaign config. */
export interface AppMetadata {
  readonly adamId: string;
  readonly appName: string;
  readonly developerName: string;
  readonly genre: string;
}

/** Real-time budget pacing, owned by the budget service. Degrades independently. */
export interface BudgetPacing {
  readonly campaignId: string;
  /** Fraction of the daily budget consumed today, 0–1+. */
  readonly dailySpendRatio: number;
  readonly pacingState: 'UNDER_PACING' | 'ON_PACE' | 'OVER_PACING' | 'CAPPED';
  readonly projectedDailySpend: Money;
}
