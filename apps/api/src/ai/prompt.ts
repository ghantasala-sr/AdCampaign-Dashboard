/**
 * Prompt and tool schema for the natural-language filter planner.
 *
 * The model's only affordance is one tool that *proposes* a filter. It cannot
 * apply one, read anything else, or mutate state — the UI holds the proposal
 * until the user accepts it. Constraining the model to a single typed tool call
 * is what makes that review step meaningful: there is exactly one artifact to
 * show, and it is already validated against the same schema the BFF enforces.
 */

import type { CampaignFilter } from '@adsight/types';
import { SORTABLE_FIELDS, SORTABLE_METRICS } from '@adsight/types';

export const PLANNER_TOOL_NAME = 'propose_filter';

/**
 * Sentinels instead of nullable fields: a strict tool schema requires every
 * property to be present, and "the user didn't mention this" is easier for the
 * model to express as an explicit token than as an omitted key.
 */
export const KEEP_CURRENT = 'KEEP_CURRENT';

export const plannerToolSchema = {
  type: 'object' as const,
  properties: {
    interpretation: {
      type: 'string',
      description:
        'One sentence, addressed to the user, describing how you read their request. ' +
        'Plain language, no field names.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description:
        'high when the request maps cleanly onto the available fields; low when you had to guess.',
    },
    unsupported: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Parts of the request that cannot be expressed as a filter over the available fields ' +
        '(for example a request to change a budget, or to group by week). Empty array if none.',
    },
    search: {
      type: 'string',
      description:
        'Free-text match against campaign name. Empty string for no name filter. ' +
        'Use this only for words that are plausibly part of a campaign name, not for ' +
        'concepts that map to a structured field.',
    },
    statuses: {
      type: 'array',
      items: { type: 'string', enum: ['ENABLED', 'PAUSED'] },
      description: 'Empty array means any status.',
    },
    servingStatuses: {
      type: 'array',
      items: { type: 'string', enum: ['RUNNING', 'NOT_RUNNING'] },
      description:
        'Whether the campaign is actually delivering right now. A campaign can be ENABLED but ' +
        'NOT_RUNNING (out of budget, past its end date). Empty array means any.',
    },
    supplySources: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'APPSTORE_SEARCH_RESULTS',
          'APPSTORE_SEARCH_TAB',
          'APPSTORE_TODAY_TAB',
          'APPSTORE_PRODUCT_PAGES_BROWSE',
        ],
      },
      description: 'Where the ad appears. Empty array means any.',
    },
    countriesOrRegions: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Two-letter uppercase ISO country codes, e.g. ["US","JP"]. Convert country names ' +
        'yourself. Empty array means any.',
    },
    metricPredicates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: [...SORTABLE_METRICS] },
          comparator: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte'] },
          value: {
            type: 'number',
            description:
              'ALWAYS in display units, never storage units. The metric named ' +
              '"spendCents" is the one exception worth stating twice: give it in ' +
              'WHOLE DOLLARS, not cents. For "spend over $2,000" send value 2000, ' +
              'NOT 200000. Likewise avgCPT/avgCPA/avgCPM are dollars ($4.50 -> 4.5). ' +
              'ttr and conversionRate are fractions (5% -> 0.05). Counts are integers.',
          },
        },
        required: ['metric', 'comparator', 'value'],
        additionalProperties: false,
      },
      description: 'Thresholds on performance. Empty array means no metric filter.',
    },
    dateRangePreset: {
      type: 'string',
      enum: [
        'TODAY',
        'YESTERDAY',
        'LAST_7_DAYS',
        'LAST_14_DAYS',
        'LAST_30_DAYS',
        'LAST_90_DAYS',
        KEEP_CURRENT,
      ],
      description: `Use ${KEEP_CURRENT} when the request says nothing about a time window.`,
    },
    sortField: {
      type: 'string',
      enum: [...SORTABLE_FIELDS, KEEP_CURRENT],
      description: `Use ${KEEP_CURRENT} unless the request implies an ordering ("top", "worst", "highest").`,
    },
    sortDirection: {
      type: 'string',
      enum: ['asc', 'desc', KEEP_CURRENT],
    },
  },
  required: [
    'interpretation',
    'confidence',
    'unsupported',
    'search',
    'statuses',
    'servingStatuses',
    'supplySources',
    'countriesOrRegions',
    'metricPredicates',
    'dateRangePreset',
    'sortField',
    'sortDirection',
  ],
  additionalProperties: false,
};

/**
 * The same schema with `additionalProperties` removed.
 *
 * Gemini's function-declaration validator rejects the keyword outright rather
 * than ignoring it. Dropping it costs nothing here: every property is declared
 * and required, and the arguments are validated against zod on the way out
 * regardless, so an extra key the model invented would be caught there.
 */
function stripAdditionalProperties(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripAdditionalProperties);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'additionalProperties') continue;
    out[key] = stripAdditionalProperties(value);
  }
  return out;
}

export const geminiToolSchema = stripAdditionalProperties(plannerToolSchema) as Record<
  string,
  unknown
>;

export function buildSystemPrompt(): string {
  return [
    'You turn a natural-language request about App Store ad campaigns into a filter over a',
    'campaign table. You do not answer questions about the data and you do not apply anything —',
    'a person reviews your proposal before it takes effect.',
    '',
    'Always call the propose_filter tool exactly once. Before calling it, write one or two short',
    'sentences of plain prose explaining what you are about to do; that text is streamed to the',
    'user as it is generated, so keep it brief and free of field names and JSON.',
    '',
    'Available data: campaign name, status, serving status, supply source, target countries, and',
    'per-campaign metrics (impressions, taps, installs, redownloads, spend, tap-through rate,',
    'conversion rate, average CPT/CPA/CPM) rolled up over a date range.',
    '',
    'Rules:',
    '- Return a complete filter, not a delta. Carry over anything from the current filter that the',
    '  request does not contradict.',
    '- Prefer a structured field over free-text search whenever one exists. "paused" is a status,',
    '  not a name fragment.',
    '- If the request asks for something the filter cannot express — editing a budget, grouping,',
    '  aggregating, comparing two periods — put it in `unsupported` and filter as close as you can.',
    '- Do not invent thresholds. If a request says "high spend" with no number, either sort by',
    '  spend descending or say in `unsupported` that no threshold was given. Never make one up.',
    '- Set confidence honestly. A vague request with a guessed interpretation is low confidence.',
  ].join('\n');
}

export function buildUserPrompt(query: string, currentFilter: CampaignFilter): string {
  return [
    'Current filter (JSON):',
    JSON.stringify(currentFilter),
    '',
    'Request:',
    query,
  ].join('\n');
}
