import { buildSchema, type GraphQLSchema } from 'graphql';

/**
 * A deliberately small schema over the same orchestration the REST routes use.
 *
 * It is not a second API — it is the same aggregator with field-level laziness.
 * `app` and `pacing` are resolved per row only when selected, so a query that
 * asks for name and spend never touches the catalog or budget upstreams, while
 * the equivalent REST call always does. That is the concrete tradeoff between
 * the two surfaces in this codebase.
 */
export const typeDefs = /* GraphQL */ `
  scalar DateString

  enum CampaignStatus {
    ENABLED
    PAUSED
  }

  enum ServingStatus {
    RUNNING
    NOT_RUNNING
  }

  enum SupplySource {
    APPSTORE_SEARCH_RESULTS
    APPSTORE_SEARCH_TAB
    APPSTORE_TODAY_TAB
    APPSTORE_PRODUCT_PAGES_BROWSE
  }

  enum SortDirection {
    asc
    desc
  }

  type Money {
    amount: String!
    currency: String!
  }

  type Campaign {
    id: ID!
    adamId: String!
    name: String!
    status: CampaignStatus!
    servingStatus: ServingStatus!
    servingStateReasons: [String!]!
    adChannelType: String!
    supplySources: [SupplySource!]!
    countriesOrRegions: [String!]!
    billingEvent: String!
    budgetAmount: Money!
    dailyBudgetAmount: Money!
    startTime: DateString!
    endTime: DateString
    createdAt: DateString!
    modifiedAt: DateString!
  }

  type AppMetadata {
    adamId: String!
    appName: String!
    developerName: String!
    genre: String!
  }

  type BudgetPacing {
    campaignId: ID!
    dailySpendRatio: Float!
    pacingState: String!
    projectedDailySpend: Money!
  }

  type MetricSummary {
    impressions: Int!
    taps: Int!
    installs: Int!
    redownloads: Int!
    spendCents: Int!
    localSpend: String!
    ttr: Float!
    conversionRate: Float!
    avgCPT: Float!
    avgCPA: Float!
    avgCPM: Float!
  }

  type MetricPoint {
    date: DateString!
    impressions: Int!
    taps: Int!
    installs: Int!
    redownloads: Int!
    spendCents: Int!
  }

  type AdGroup {
    id: ID!
    campaignId: ID!
    name: String!
    status: CampaignStatus!
    defaultBidAmount: Money!
    cpaGoal: Money
    startTime: DateString!
  }

  type Keyword {
    id: ID!
    adGroupId: ID!
    campaignId: ID!
    text: String!
    matchType: String!
    status: CampaignStatus!
    bidAmount: Money!
  }

  """
  A campaign plus everything the dashboard shows alongside it. \`app\` and
  \`pacing\` hit separate upstreams and are only fetched when selected.
  """
  type CampaignRow {
    campaign: Campaign!
    metrics: MetricSummary!
    sparkline: [Int!]!
    app: AppMetadata
    pacing: BudgetPacing
  }

  type PageInfo {
    offset: Int!
    limit: Int!
    total: Int!
    hasMore: Boolean!
  }

  type ResolvedDateRange {
    start: DateString!
    end: DateString!
  }

  type CampaignConnection {
    rows: [CampaignRow!]!
    pageInfo: PageInfo!
    totals: MetricSummary!
    resolvedDateRange: ResolvedDateRange!
    """
    Upstreams that failed while serving this query. Non-empty means some fields
    are null by degradation rather than by absence.
    """
    degraded: [String!]!
  }

  type CampaignDetail {
    row: CampaignRow!
    adGroups: [AdGroup!]!
    keywords: [Keyword!]!
    timeSeries: [MetricPoint!]!
  }

  type DataWindow {
    start: DateString!
    end: DateString!
    days: Int!
    campaignCount: Int!
  }

  type Facets {
    countriesOrRegions: [String!]!
    supplySources: [SupplySource!]!
    apps: [AppMetadata!]!
    dataWindow: DataWindow!
  }

  input MetricPredicateInput {
    metric: String!
    comparator: String!
    value: Float!
  }

  type Query {
    campaigns(
      search: String
      statuses: [CampaignStatus!]
      servingStatuses: [ServingStatus!]
      supplySources: [SupplySource!]
      countriesOrRegions: [String!]
      metricPredicates: [MetricPredicateInput!]
      preset: String
      start: DateString
      end: DateString
      sort: String
      direction: SortDirection
      offset: Int
      limit: Int
    ): CampaignConnection!

    campaign(id: ID!, preset: String, start: DateString, end: DateString): CampaignDetail

    facets: Facets!
  }
`;

let cached: GraphQLSchema | null = null;

export function getSchema(): GraphQLSchema {
  if (!cached) cached = buildSchema(typeDefs);
  return cached;
}
