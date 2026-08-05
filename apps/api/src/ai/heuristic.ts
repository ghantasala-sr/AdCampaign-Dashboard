/**
 * Deterministic fallback planner.
 *
 * Runs when `ANTHROPIC_API_KEY` is unset, which means the feature demos and its
 * tests pass with no network and no credentials. It is also the reference for
 * what the plan output should look like: the model path and this path produce
 * the same `FilterPlan` type and go through the same validation, so the UI has
 * one code path regardless of which planner answered.
 *
 * It is a pattern matcher, not a parser, and it reports low confidence when it
 * has clearly only understood part of a request.
 */

import type { CampaignFilter, FilterPlan, MetricPredicate, SortSpec } from '@adsight/types';
import type { MetricComparator, SortableMetric } from '@adsight/types';

import { describeChanges } from './planShape.js';

interface Alias<T> {
  readonly pattern: RegExp;
  readonly value: T;
}

const METRIC_ALIASES: ReadonlyArray<Alias<SortableMetric>> = [
  { pattern: /\b(?:avg\s*)?cpa\b|cost per (?:install|acquisition|download)/g, value: 'avgCPA' },
  { pattern: /\b(?:avg\s*)?cpt\b|cost per tap/g, value: 'avgCPT' },
  { pattern: /\b(?:avg\s*)?cpm\b|cost per thousand/g, value: 'avgCPM' },
  { pattern: /\bconversion rate\b|\bcvr\b|\bconvert(?:s|ing)\b/g, value: 'conversionRate' },
  { pattern: /\btap[- ]?through(?: rate)?\b|\bttr\b|\bctr\b|\bclick[- ]?through(?: rate)?\b/g, value: 'ttr' },
  { pattern: /\bredownload(?:s)?\b|\bre-?download(?:s)?\b/g, value: 'redownloads' },
  { pattern: /\binstall(?:s|ed|ation)?\b|\bdownload(?:s)?\b|\bconversion(?:s)?\b/g, value: 'installs' },
  { pattern: /\bimpression(?:s)?\b/g, value: 'impressions' },
  { pattern: /\btap(?:s)?\b|\bclick(?:s)?\b/g, value: 'taps' },
  { pattern: /\bspend(?:ing)?\b|\bspent\b|\bcost(?:s)?\b|\bbudget used\b/g, value: 'spendCents' },
];

const COMPARATOR_ALIASES: ReadonlyArray<Alias<MetricComparator>> = [
  { pattern: /\bat least\b|\bno less than\b|\bminimum(?: of)?\b|>=/g, value: 'gte' },
  { pattern: /\bat most\b|\bno more than\b|\bmaximum(?: of)?\b|\bup to\b|<=/g, value: 'lte' },
  { pattern: /\b(?:over|above|more than|greater than|higher than|exceed(?:s|ing)?|beyond)\b|>/g, value: 'gt' },
  { pattern: /\b(?:under|below|less than|lower than|fewer than|beneath)\b|</g, value: 'lt' },
];

/** Only the countries the fixture actually targets, plus common synonyms. */
const COUNTRY_ALIASES: ReadonlyArray<Alias<string>> = [
  { pattern: /\bunited states\b|\bthe us\b|\busa\b|\bu\.s\.\b|\bamerica\b/g, value: 'US' },
  { pattern: /\bunited kingdom\b|\bbritain\b|\bengland\b|\buk\b/g, value: 'GB' },
  { pattern: /\bcanada\b|\bcanadian\b/g, value: 'CA' },
  { pattern: /\baustralia\b|\baussie\b/g, value: 'AU' },
  { pattern: /\bgermany\b|\bgerman\b|\bdeutschland\b/g, value: 'DE' },
  { pattern: /\bfrance\b|\bfrench\b/g, value: 'FR' },
  { pattern: /\bjapan\b|\bjapanese\b/g, value: 'JP' },
  { pattern: /\b(?:south )?korea\b|\bkorean\b/g, value: 'KR' },
  { pattern: /\bbrazil\b|\bbrazilian\b/g, value: 'BR' },
  { pattern: /\bmexico\b|\bmexican\b/g, value: 'MX' },
  { pattern: /\bindia\b|\bindian\b/g, value: 'IN' },
  { pattern: /\bitaly\b|\bitalian\b/g, value: 'IT' },
  { pattern: /\bspain\b|\bspanish\b/g, value: 'ES' },
  { pattern: /\bnetherlands\b|\bholland\b|\bdutch\b/g, value: 'NL' },
  { pattern: /\bsweden\b|\bswedish\b/g, value: 'SE' },
  { pattern: /\bsingapore\b/g, value: 'SG' },
  { pattern: /\buae\b|\bemirates\b|\bdubai\b/g, value: 'AE' },
  { pattern: /\bsouth africa\b/g, value: 'ZA' },
  { pattern: /\bpoland\b|\bpolish\b/g, value: 'PL' },
  { pattern: /\bturkey\b|\bturkish\b|\bt(?:ü|u)rkiye\b/g, value: 'TR' },
];

const VALID_CODES = new Set(COUNTRY_ALIASES.map((a) => a.value));

interface Located<T> {
  readonly index: number;
  readonly value: T;
  readonly length: number;
}

function locateAll<T>(text: string, aliases: ReadonlyArray<Alias<T>>): Array<Located<T>> {
  const found: Array<Located<T>> = [];
  for (const alias of aliases) {
    // Aliases carry /g, so reset lastIndex before each scan.
    alias.pattern.lastIndex = 0;
    let match: RegExpExecArray | null = alias.pattern.exec(text);
    while (match !== null) {
      found.push({ index: match.index, value: alias.value, length: match[0].length });
      match = alias.pattern.exec(text);
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** `$1,200`, `5k`, `1.2m`, `4.5%` — returns the numeric value and whether it was a percentage. */
const NUMBER_PATTERN = /\$?\s?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(%|k\b|m\b)?/gi;

interface ParsedNumber {
  readonly index: number;
  readonly value: number;
  readonly isPercent: boolean;
}

function locateNumbers(text: string): ParsedNumber[] {
  const out: ParsedNumber[] = [];
  NUMBER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = NUMBER_PATTERN.exec(text);
  while (match !== null) {
    const digits = Number(match[1]!.replace(/,/g, ''));
    if (Number.isFinite(digits)) {
      const suffix = match[2]?.toLowerCase();
      const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1;
      out.push({
        index: match.index,
        value: digits * multiplier,
        isPercent: suffix === '%',
      });
    }
    match = NUMBER_PATTERN.exec(text);
  }
  return out;
}

/** Metrics expressed as fractions internally but written as percentages by people. */
const RATE_METRICS = new Set<SortableMetric>(['ttr', 'conversionRate']);

function normalizeValue(metric: SortableMetric, parsed: ParsedNumber): number {
  if (RATE_METRICS.has(metric)) {
    // "5%" and a bare "5" both mean five percent for a rate metric; 0.05 is
    // already a fraction and is left alone.
    if (parsed.isPercent || parsed.value > 1) return parsed.value / 100;
    return parsed.value;
  }
  return parsed.value;
}

function nearest<T>(items: ReadonlyArray<Located<T>>, index: number, maxDistance: number): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    // Distance to the alias span, not its start, so a long alias isn't penalised.
    const distance =
      index < item.index ? item.index - index : Math.max(0, index - (item.index + item.length));
    if (distance < bestDistance && distance <= maxDistance) {
      bestDistance = distance;
      best = item.value;
    }
  }
  return best;
}

/**
 * First number starting after `from`, within `maxDistance` characters.
 *
 * Comparators are matched to the number that *follows* them rather than the
 * nearest number in either direction, because that is the English word order —
 * "below 2%", not "2% below". Searching both ways lets an unrelated number
 * upstream win: in "not running last 7 days with ttr below 2%", the 7 is closer
 * to "below" than the 2 is, and the filter silently becomes "ttr under 7%".
 */
function firstNumberAfter(
  numbers: readonly ParsedNumber[],
  from: number,
  maxDistance: number,
): ParsedNumber | null {
  let best: ParsedNumber | null = null;
  for (const number of numbers) {
    if (number.index < from) continue;
    if (number.index - from > maxDistance) continue;
    if (best === null || number.index < best.index) best = number;
  }
  return best;
}

const DATE_PATTERNS: ReadonlyArray<Alias<CampaignFilter['dateRange']['preset']>> = [
  { pattern: /\byesterday\b/g, value: 'YESTERDAY' },
  { pattern: /\btoday\b/g, value: 'TODAY' },
  { pattern: /\blast 7 days\b|\bpast 7 days\b|\blast week\b|\bpast week\b|\bweekly\b/g, value: 'LAST_7_DAYS' },
  { pattern: /\blast 14 days\b|\bpast 14 days\b|\blast two weeks\b|\bfortnight\b/g, value: 'LAST_14_DAYS' },
  { pattern: /\blast 30 days\b|\bpast 30 days\b|\blast month\b|\bpast month\b|\bmonthly\b/g, value: 'LAST_30_DAYS' },
  {
    pattern: /\blast 90 days\b|\bpast 90 days\b|\blast quarter\b|\bpast quarter\b|\blast 3 months\b|\bthis quarter\b/g,
    value: 'LAST_90_DAYS',
  },
];

/**
 * Sort intent comes in two flavours and conflating them gets the direction
 * wrong. Magnitude words ("top", "lowest") mean literally high or low. Quality
 * words ("best", "worst") depend on the metric: the worst CPA is the *highest*
 * one, while the worst install count is the lowest. Cost metrics invert.
 */
// The lookbehinds keep "at most"/"at least" out of this: those are comparators,
// already consumed as thresholds, and reading them as sort intent invents an
// ordering the user never asked for.
const MAGNITUDE_DESC = /\btop\b|\bhighest\b|\bbiggest\b|(?<!at )\bmost\b|\blargest\b/;
const MAGNITUDE_ASC = /\bbottom\b|\blowest\b|\bsmallest\b|(?<!at )\bleast\b|\bfewest\b|\bcheapest\b/;
const QUALITY_BEST = /\bbest\b|\bstrongest\b|\btop performing\b|\bbest performing\b/;
const QUALITY_WORST = /\bworst\b|\bweakest\b|\bpoorest\b|\bworst performing\b|\bunderperforming\b/;

/** Metrics where a higher number is a worse outcome. */
const COST_METRICS = new Set<SortableMetric>(['spendCents', 'avgCPT', 'avgCPA', 'avgCPM']);

function resolveSortDirection(metric: SortableMetric, text: string): 'asc' | 'desc' | null {
  const isCost = COST_METRICS.has(metric);
  if (QUALITY_WORST.test(text)) return isCost ? 'desc' : 'asc';
  if (QUALITY_BEST.test(text)) return isCost ? 'asc' : 'desc';
  if (MAGNITUDE_DESC.test(text)) return 'desc';
  if (MAGNITUDE_ASC.test(text)) return 'asc';
  return null;
}

export function planFromHeuristic(
  query: string,
  currentFilter: CampaignFilter,
  currentSort: SortSpec,
): FilterPlan {
  const text = query.toLowerCase();
  const understood: string[] = [];

  // --- statuses -----------------------------------------------------------
  const statuses: CampaignFilter['statuses'][number][] = [];
  if (/\bpaused\b|\bstopped by\b|\bturned off\b|\binactive\b/.test(text)) {
    statuses.push('PAUSED');
    understood.push('status');
  }
  if (/\benabled\b|\bactive\b|\blive\b|\bturned on\b/.test(text) && !/\bnot (?:enabled|active|live)\b/.test(text)) {
    statuses.push('ENABLED');
    understood.push('status');
  }

  // --- serving status -----------------------------------------------------
  const servingStatuses: CampaignFilter['servingStatuses'][number][] = [];
  if (/\bnot (?:running|serving|delivering)\b|\bnot_running\b|\bstalled\b|\bout of budget\b|\bcapped\b/.test(text)) {
    servingStatuses.push('NOT_RUNNING');
    understood.push('serving status');
  } else if (/\b(?:currently )?(?:running|serving|delivering)\b/.test(text)) {
    servingStatuses.push('RUNNING');
    understood.push('serving status');
  }

  // --- supply sources ----------------------------------------------------
  const supplySources: CampaignFilter['supplySources'][number][] = [];
  if (/\bsearch results?\b/.test(text)) supplySources.push('APPSTORE_SEARCH_RESULTS');
  if (/\bsearch tab\b/.test(text)) supplySources.push('APPSTORE_SEARCH_TAB');
  if (/\btoday tab\b/.test(text)) supplySources.push('APPSTORE_TODAY_TAB');
  if (/\bproduct page(?:s)?\b|\bbrowse\b/.test(text)) supplySources.push('APPSTORE_PRODUCT_PAGES_BROWSE');
  if (supplySources.length > 0) understood.push('supply source');

  // --- countries ---------------------------------------------------------
  const countries = new Set<string>();
  for (const located of locateAll(text, COUNTRY_ALIASES)) countries.add(located.value);
  // Bare uppercase codes in the original casing, e.g. "JP" or "in US, GB".
  for (const match of query.matchAll(/\b([A-Z]{2})\b/g)) {
    if (VALID_CODES.has(match[1]!)) countries.add(match[1]!);
  }
  if (countries.size > 0) understood.push('country');

  // --- metric predicates -------------------------------------------------
  const metricLocations = locateAll(text, METRIC_ALIASES);
  const comparatorLocations = locateAll(text, COMPARATOR_ALIASES);
  const numbers = locateNumbers(text);
  const predicates: MetricPredicate[] = [];
  const usedMetrics = new Set<SortableMetric>();

  const claimedNumbers = new Set<number>();
  for (const comparator of comparatorLocations) {
    const number = firstNumberAfter(numbers, comparator.index + comparator.length, 20);
    if (number === null || claimedNumbers.has(number.index)) continue;
    // The metric can sit on either side ("spend over 500", "over 500 in spend").
    const metric = nearest(metricLocations, number.index, 40);
    if (metric === null || usedMetrics.has(metric)) continue;
    claimedNumbers.add(number.index);
    usedMetrics.add(metric);
    predicates.push({
      metric,
      comparator: comparator.value,
      value: normalizeValue(metric, number),
    });
  }
  if (predicates.length > 0) understood.push('threshold');

  // --- date range --------------------------------------------------------
  let preset = currentFilter.dateRange.preset;
  let matchedDate = false;
  for (const alias of DATE_PATTERNS) {
    alias.pattern.lastIndex = 0;
    if (alias.pattern.test(text)) {
      preset = alias.value;
      matchedDate = true;
      understood.push('date range');
      break;
    }
  }

  // --- sort --------------------------------------------------------------
  let sort: SortSpec = currentSort;
  // Prefer a metric not already pinned by a threshold, so "spend over $500,
  // worst CPA" sorts by CPA rather than by the metric it just filtered on.
  const sortMetric =
    metricLocations.find((m) => !usedMetrics.has(m.value))?.value ?? metricLocations[0]?.value ?? null;
  if (sortMetric !== null) {
    const direction = resolveSortDirection(sortMetric, text);
    if (direction !== null) {
      sort = { field: sortMetric, direction };
      understood.push('sort order');
    }
  }

  // --- free-text search --------------------------------------------------
  // Only quoted text becomes a name filter. Guessing which unquoted words are
  // campaign names produces confidently wrong filters.
  let search = currentFilter.search;
  const quoted = query.match(/["'“”]([^"'“”]{2,60})["'“”]/);
  if (quoted) {
    search = quoted[1]!.trim();
    understood.push('name');
  } else if (/\bnamed?\s+(\S+)/i.test(query)) {
    search = /\bnamed?\s+(\S+)/i.exec(query)![1]!.trim();
    understood.push('name');
  }

  const filter: CampaignFilter = {
    search,
    statuses,
    servingStatuses,
    supplySources,
    countriesOrRegions: [...countries].sort(),
    metricPredicates: predicates,
    dateRange: matchedDate ? { preset, start: null, end: null } : currentFilter.dateRange,
  };

  const unsupported: string[] = [];
  // Requests for aggregation or mutation are outside what a filter can express.
  if (/\b(?:group|breakdown|break down|pivot|compare|versus|vs\.?)\b/.test(text)) {
    unsupported.push('Grouping and period-over-period comparison are not available in this view');
  }
  if (/\b(?:pause|enable|set|change|increase|decrease|raise|lower|update|delete)\b/.test(text)) {
    unsupported.push('This view can filter campaigns but not modify them');
  }

  // A date range on its own does not narrow *which* campaigns are shown, only the
  // period they are measured over. Counting it as comprehension would report
  // medium confidence for "what is the weather today" purely because of "today".
  const substantive = understood.filter((item) => item !== 'date range' && item !== 'sort order');
  if (substantive.length === 0) {
    unsupported.push('No filterable criteria were recognised in this request');
  }

  const confidence: FilterPlan['confidence'] =
    substantive.length === 0
      ? 'low'
      : unsupported.length > 0
        ? 'medium'
        : substantive.length >= 2
          ? 'high'
          : 'medium';

  const interpretation =
    substantive.length === 0
      ? 'I could not find anything to filter on in that request.'
      : `Read as a filter on ${dedupe(understood).join(', ')}.`;

  return {
    filter,
    sort,
    changes: describeChanges(filter, sort),
    interpretation,
    unsupported,
    confidence,
  };
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}
