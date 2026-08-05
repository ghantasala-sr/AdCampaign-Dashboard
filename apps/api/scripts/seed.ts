/**
 * Fixture generator.
 *
 *   npm run seed                       # anchor the window on today (UTC)
 *   SEED_END_DATE=2026-08-04 npm run seed   # pin the window, used by tests/CI
 *
 * Deterministic given (SEED, endDate): every entity's randomness is derived from
 * a hash of its own id, so the same inputs always produce the same bytes. That
 * is why `apps/api/data/` is gitignored — CI regenerates it in about a second
 * rather than carrying 18MB of binary in the repo.
 */

import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

import type {
  AdGroup,
  AppMetadata,
  Campaign,
  CampaignStatus,
  Keyword,
  MatchType,
  ServingStateReason,
  SupplySource,
} from '@adsight/types';

import { createRng, hashString } from '../src/lib/rng.js';
import {
  CAMPAIGN_COUNT,
  DAYS,
  FILES,
  METRIC_ORDER,
  SEED,
  addDays,
  isoDate,
  metricIndex,
  totalMetricValues,
  type Manifest,
} from '../src/lib/dataset.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'data');

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const APP_DEFS: ReadonlyArray<readonly [name: string, developer: string, genre: string]> = [
  ['Lumen Journal', 'Northwind Labs', 'Productivity'],
  ['Trailhead', 'Wayfarer Studio', 'Health & Fitness'],
  ['Ledgerly', 'Fernwood Software', 'Finance'],
  ['Sunspot Weather', 'Halcyon Interactive', 'Weather'],
  ['Cadence Runner', 'Wayfarer Studio', 'Health & Fitness'],
  ['Mosaic Photo', 'Fernwood Software', 'Photo & Video'],
  ['Beacon VPN', 'Northwind Labs', 'Utilities'],
  ['Pantry Plan', 'Cobblestone Co', 'Food & Drink'],
  ['Verse Reader', 'Inkwell Digital', 'Books'],
  ['Tidepool Budget', 'Ledger House', 'Finance'],
  ['Nightowl Sleep', 'Halcyon Interactive', 'Health & Fitness'],
  ['Quarry Puzzle', 'Bright Anvil Games', 'Games'],
  ['Switchback Maps', 'Wayfarer Studio', 'Navigation'],
  ['Cinder Chat', 'Northwind Labs', 'Social Networking'],
  ['Kettle Recipes', 'Cobblestone Co', 'Food & Drink'],
  ['Atlas Habit', 'Fernwood Software', 'Productivity'],
  ['Pinegrove Kids', 'Inkwell Digital', 'Education'],
  ['Solstice Meditate', 'Halcyon Interactive', 'Health & Fitness'],
  ['Rampart Defense', 'Bright Anvil Games', 'Games'],
  ['Foldstack Notes', 'Northwind Labs', 'Productivity'],
  ['Marlin Fishing', 'Wayfarer Studio', 'Sports'],
  ['Cobalt Invest', 'Ledger House', 'Finance'],
  ['Harbor Podcast', 'Inkwell Digital', 'Entertainment'],
  ['Thicket Garden', 'Cobblestone Co', 'Lifestyle'],
  ['Onyx Editor', 'Fernwood Software', 'Photo & Video'],
  ['Silverline Bank', 'Ledger House', 'Finance'],
  ['Driftwood Travel', 'Wayfarer Studio', 'Travel'],
  ['Peakform Lift', 'Halcyon Interactive', 'Health & Fitness'],
  ['Copperfield Cards', 'Bright Anvil Games', 'Games'],
  ['Wren Language', 'Inkwell Digital', 'Education'],
  ['Vantage Scan', 'Northwind Labs', 'Utilities'],
  ['Bramble Grocery', 'Cobblestone Co', 'Shopping'],
  ['Echo Transcribe', 'Fernwood Software', 'Productivity'],
  ['Lantern Stories', 'Inkwell Digital', 'Books'],
  ['Basalt Racing', 'Bright Anvil Games', 'Games'],
  ['Glasshouse Home', 'Cobblestone Co', 'Lifestyle'],
  ['Northgate Tickets', 'Wayfarer Studio', 'Entertainment'],
  ['Prism Design', 'Fernwood Software', 'Graphics & Design'],
  ['Kestrel Fleet', 'Northwind Labs', 'Business'],
  ['Willowbrook Care', 'Halcyon Interactive', 'Medical'],
];

const COUNTRIES = [
  'US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'KR', 'BR', 'MX',
  'IN', 'IT', 'ES', 'NL', 'SE', 'SG', 'AE', 'ZA', 'PL', 'TR',
] as const;

const SUPPLY_SOURCES: readonly SupplySource[] = [
  'APPSTORE_SEARCH_RESULTS',
  'APPSTORE_SEARCH_TAB',
  'APPSTORE_TODAY_TAB',
  'APPSTORE_PRODUCT_PAGES_BROWSE',
];

/** Campaign naming follows the usual account convention: geo - intent - theme. */
const INTENTS = ['Brand', 'Generic', 'Competitor', 'Category', 'Discovery', 'Retargeting'] as const;
const THEMES = [
  'Core', 'Exact', 'Broad', 'Prospecting', 'High Intent', 'Long Tail',
  'Tentpole', 'Always On', 'Q3 Push', 'Winback',
] as const;

const AD_GROUP_THEMES = [
  'Exact Match', 'Broad Match', 'Discovery', 'Brand Terms', 'Competitor Terms',
  'Category Terms', 'High CPA Guard', 'Tier 1 Geo',
] as const;

const KEYWORD_STEMS = [
  'budget app', 'expense tracker', 'habit tracker', 'sleep sounds', 'photo editor',
  'running app', 'meal planner', 'vpn fast', 'audiobooks free', 'puzzle game',
  'offline maps', 'group chat', 'language learning', 'invoice maker', 'stock tracker',
  'weather radar', 'workout plan', 'note taking', 'grocery list', 'podcast player',
  'meditation timer', 'card game', 'photo collage', 'pdf scanner', 'travel deals',
];

const KEYWORD_MODIFIERS = ['', ' free', ' pro', ' 2026', ' best', ' offline', ' for iphone', ' app'];

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function money(amount: number, currency: string) {
  return { amount: amount.toFixed(2), currency };
}

interface CampaignPlan {
  readonly campaign: Campaign;
  /** Drives the metric volume for this campaign. */
  readonly scale: number;
  /** Day index after which this campaign stopped delivering, or DAYS if never. */
  readonly stoppedAtDay: number;
  readonly baseTtr: number;
  readonly baseConversionRate: number;
  readonly baseCptCents: number;
}

function buildApps(): AppMetadata[] {
  return APP_DEFS.map((def, i) => ({
    adamId: `1${pad(400000000 + i * 7919, 9)}`,
    appName: def[0],
    developerName: def[1],
    genre: def[2],
  }));
}

function buildCampaign(slot: number, apps: readonly AppMetadata[], endDate: string): CampaignPlan {
  const id = `camp_${pad(slot, 6)}`;
  const rng = createRng(hashString(id) ^ SEED);

  const app = apps[slot % apps.length]!;
  const countries = rng.sample(COUNTRIES, rng.int(1, 4));
  const primaryGeo = countries[0]!;
  const intent = rng.pick(INTENTS);
  const theme = rng.pick(THEMES);
  const currency = 'USD';

  // Volume is long-tailed: a handful of campaigns carry most of the spend, which
  // is what makes sorting by spend and the "top 1%" filters interesting.
  const scale = Math.exp(rng.normal(0, 1.15)) * 850;

  const status: CampaignStatus = rng.chance(0.72) ? 'ENABLED' : 'PAUSED';

  // ~4% of campaigns have already ended within the window.
  const hasEndDate = rng.chance(0.12);
  const endOffset = hasEndDate ? rng.int(-40, 60) : null;
  const endTime = endOffset === null ? null : addDays(endDate, endOffset);
  const endedInWindow = endOffset !== null && endOffset < 0;

  const startTime = addDays(endDate, -rng.int(30, 420));
  const createdAt = addDays(startTime, -rng.int(0, 5));

  const reasons: ServingStateReason[] = [];
  let stoppedAtDay = DAYS;

  if (status === 'PAUSED') {
    reasons.push('PAUSED_BY_USER');
    // Paused campaigns went quiet partway through the window.
    stoppedAtDay = rng.int(0, DAYS - 1);
  }
  if (endedInWindow) {
    reasons.push('CAMPAIGN_END_DATE_REACHED');
    stoppedAtDay = Math.min(stoppedAtDay, DAYS + endOffset!);
  }
  const capped = status === 'ENABLED' && !endedInWindow && rng.chance(0.09);
  if (capped) reasons.push('DAILY_CAP_EXHAUSTED');
  if (status === 'ENABLED' && rng.chance(0.015)) reasons.push('APP_NOT_ELIGIBLE');

  // A small slice never delivered at all — exercises the divide-by-zero paths in
  // the derived-rate formatters.
  const neverDelivered = rng.chance(0.02);
  if (neverDelivered) stoppedAtDay = 0;

  const servingStatus =
    status === 'ENABLED' && reasons.length === 0 ? 'RUNNING' : ('NOT_RUNNING' as const);

  const dailyBudget = Math.round(Math.max(25, scale * rng.float(0.02, 0.08)) * 100) / 100;
  const totalBudget = Math.round(dailyBudget * rng.int(30, 180) * 100) / 100;

  const campaign: Campaign = {
    id,
    adamId: app.adamId,
    name: `${primaryGeo} - ${intent} - ${theme}${rng.chance(0.25) ? ` (${app.appName})` : ''}`,
    status,
    servingStatus,
    servingStateReasons: reasons,
    adChannelType: rng.chance(0.85) ? 'SEARCH' : 'DISPLAY',
    supplySources: rng.sample(SUPPLY_SOURCES, rng.int(1, 3)),
    countriesOrRegions: countries,
    billingEvent: rng.chance(0.9) ? 'TAPS' : 'IMPRESSIONS',
    budgetAmount: money(totalBudget, currency),
    dailyBudgetAmount: money(dailyBudget, currency),
    startTime,
    endTime,
    createdAt,
    modifiedAt: addDays(endDate, -rng.int(0, 45)),
  };

  return {
    campaign,
    scale,
    stoppedAtDay,
    baseTtr: rng.float(0.015, 0.085),
    baseConversionRate: rng.float(0.18, 0.62),
    baseCptCents: rng.float(28, 310),
  };
}

function buildAdGroupsAndKeywords(plan: CampaignPlan): {
  adGroups: AdGroup[];
  keywords: Keyword[];
} {
  const { campaign } = plan;
  const rng = createRng(hashString(`${campaign.id}:children`) ^ SEED);
  const adGroups: AdGroup[] = [];
  const keywords: Keyword[] = [];

  const groupCount = rng.int(1, 4);
  for (let g = 0; g < groupCount; g += 1) {
    const adGroupId = `${campaign.id}_ag${g}`;
    const defaultBid = Math.round(plan.baseCptCents * rng.float(1.1, 2.2)) / 100;
    adGroups.push({
      id: adGroupId,
      campaignId: campaign.id,
      name: rng.pick(AD_GROUP_THEMES),
      status: campaign.status === 'PAUSED' ? 'PAUSED' : rng.chance(0.88) ? 'ENABLED' : 'PAUSED',
      defaultBidAmount: money(defaultBid, campaign.dailyBudgetAmount.currency),
      cpaGoal: rng.chance(0.4)
        ? money(Math.round(defaultBid * rng.float(3, 9) * 100) / 100, campaign.dailyBudgetAmount.currency)
        : null,
      startTime: campaign.startTime,
    });

    const keywordCount = rng.int(2, 6);
    for (let k = 0; k < keywordCount; k += 1) {
      const matchType: MatchType = rng.chance(0.55) ? 'EXACT' : 'BROAD';
      keywords.push({
        id: `${adGroupId}_kw${k}`,
        adGroupId,
        campaignId: campaign.id,
        text: `${rng.pick(KEYWORD_STEMS)}${rng.pick(KEYWORD_MODIFIERS)}`,
        matchType,
        status: rng.chance(0.92) ? 'ENABLED' : 'PAUSED',
        bidAmount: money(
          Math.round(defaultBid * rng.float(0.7, 1.6) * 100) / 100,
          campaign.dailyBudgetAmount.currency,
        ),
      });
    }
  }

  return { adGroups, keywords };
}

/** Writes the 90-day counter series for one campaign into the shared array. */
function fillMetrics(
  plan: CampaignPlan,
  slot: number,
  values: Int32Array,
  startDate: string,
): void {
  const rng = createRng(hashString(`${plan.campaign.id}:metrics`) ^ SEED);
  // A gentle multiplicative trend, so time series are not flat noise.
  const trendPerDay = rng.float(-0.004, 0.006);

  for (let day = 0; day < DAYS; day += 1) {
    if (day >= plan.stoppedAtDay) continue; // leaves zeros

    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + day);
    const dow = date.getUTCDay();
    // App Store search traffic dips on weekends.
    const weekly = dow === 0 || dow === 6 ? 0.78 : 1 + (dow === 3 ? 0.06 : 0);

    const trend = 1 + trendPerDay * day;
    const noise = Math.max(0.25, rng.normal(1, 0.18));

    const impressions = Math.max(0, Math.round(plan.scale * weekly * trend * noise));
    const ttr = Math.max(0.002, plan.baseTtr * Math.max(0.4, rng.normal(1, 0.14)));
    const taps = Math.min(impressions, Math.round(impressions * ttr));
    const cvr = Math.max(0.02, Math.min(0.95, plan.baseConversionRate * Math.max(0.4, rng.normal(1, 0.16))));
    const installs = Math.round(taps * cvr);
    const redownloads = Math.round(installs * rng.float(0.08, 0.45));
    const cpt = Math.max(5, plan.baseCptCents * Math.max(0.5, rng.normal(1, 0.12)));
    const spendCents = Math.round(taps * cpt);

    const counters = [impressions, taps, installs, redownloads, spendCents];
    for (let m = 0; m < METRIC_ORDER.length; m += 1) {
      values[metricIndex(m, slot, day, CAMPAIGN_COUNT, DAYS)] = counters[m]!;
    }
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function writeNdjson(path: string, records: Iterable<unknown>): Promise<void> {
  const stream = createWriteStream(path, { encoding: 'utf8' });
  let buffer = '';
  for (const record of records) {
    buffer += `${JSON.stringify(record)}\n`;
    if (buffer.length > 1 << 20) {
      if (!stream.write(buffer)) await once(stream, 'drain');
      buffer = '';
    }
  }
  if (buffer.length > 0) stream.write(buffer);
  stream.end();
  await once(stream, 'finish');
}

async function main(): Promise<void> {
  const startedAt = Date.now();

  const endDate = process.env.SEED_END_DATE ?? isoDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error(`SEED_END_DATE must be YYYY-MM-DD, received "${endDate}"`);
  }
  const startDate = addDays(endDate, -(DAYS - 1));

  mkdirSync(DATA_DIR, { recursive: true });

  const apps = buildApps();
  writeFileSync(join(DATA_DIR, FILES.apps), JSON.stringify(apps, null, 2));

  const campaigns: Campaign[] = [];
  const adGroups: AdGroup[] = [];
  const keywords: Keyword[] = [];
  const values = new Int32Array(totalMetricValues(CAMPAIGN_COUNT, DAYS));

  for (let slot = 0; slot < CAMPAIGN_COUNT; slot += 1) {
    const plan = buildCampaign(slot, apps, endDate);
    campaigns.push(plan.campaign);

    const children = buildAdGroupsAndKeywords(plan);
    adGroups.push(...children.adGroups);
    keywords.push(...children.keywords);

    fillMetrics(plan, slot, values, startDate);
  }

  await writeNdjson(join(DATA_DIR, FILES.campaigns), campaigns);
  await writeNdjson(join(DATA_DIR, FILES.adGroups), adGroups);
  await writeNdjson(join(DATA_DIR, FILES.keywords), keywords);

  writeFileSync(join(DATA_DIR, FILES.metrics), Buffer.from(values.buffer, 0, values.byteLength));

  const manifest: Manifest = {
    seed: SEED,
    generatedAt: new Date().toISOString(),
    startDate,
    endDate,
    days: DAYS,
    campaignCount: CAMPAIGN_COUNT,
    metricOrder: METRIC_ORDER,
    campaignIds: campaigns.map((c) => c.id),
  };
  writeFileSync(join(DATA_DIR, FILES.manifest), JSON.stringify(manifest));

  const elapsed = Date.now() - startedAt;
  const metricsMb = (values.byteLength / 1024 / 1024).toFixed(1);
  process.stdout.write(
    `seeded ${campaigns.length.toLocaleString()} campaigns, ` +
      `${adGroups.length.toLocaleString()} ad groups, ` +
      `${keywords.length.toLocaleString()} keywords\n` +
      `window ${startDate} .. ${endDate} (${DAYS} days), metrics ${metricsMb}MB\n` +
      `done in ${elapsed}ms -> apps/api/data/\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
