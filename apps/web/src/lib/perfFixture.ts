import type { CampaignRow } from '@adsight/types';

/**
 * Deterministic in-memory rows for the performance harness.
 *
 * Generated client-side rather than fetched so the measurement isolates render
 * cost: no network variance, no server time, no API paging, and both table
 * implementations receive the identical array instance. The shape matches what
 * the BFF returns, including a 24-point sparkline per row, so the work per row is
 * the same as in the real app.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GEOS = ['US', 'GB', 'JP', 'DE', 'FR', 'CA', 'AU', 'BR', 'KR', 'IN'];
const INTENTS = ['Brand', 'Generic', 'Competitor', 'Category', 'Discovery'];
const THEMES = ['Core', 'Exact', 'Broad', 'High Intent', 'Always On', 'Winback'];
const APPS = [
  'Lumen Journal',
  'Trailhead',
  'Ledgerly',
  'Sunspot Weather',
  'Cadence Runner',
  'Mosaic Photo',
  'Beacon VPN',
  'Pantry Plan',
];
const PACING = ['UNDER_PACING', 'ON_PACE', 'OVER_PACING', 'CAPPED'] as const;

export function generatePerfRows(count: number, seed = 1337): CampaignRow[] {
  const random = mulberry32(seed);
  const rows: CampaignRow[] = new Array<CampaignRow>(count);

  for (let i = 0; i < count; i += 1) {
    const impressions = Math.round(500 + random() * 400_000);
    const taps = Math.round(impressions * (0.015 + random() * 0.07));
    const installs = Math.round(taps * (0.15 + random() * 0.5));
    const redownloads = Math.round(installs * random() * 0.4);
    const spendCents = Math.round(taps * (30 + random() * 280));
    const spendDollars = spendCents / 100;

    const sparkline: number[] = new Array<number>(24);
    for (let d = 0; d < 24; d += 1) {
      sparkline[d] = Math.round((spendCents / 24) * (0.5 + random()));
    }

    const enabled = random() > 0.28;
    const geo = GEOS[i % GEOS.length]!;
    const appName = APPS[i % APPS.length]!;

    rows[i] = {
      campaign: {
        id: `perf_${String(i).padStart(6, '0')}`,
        adamId: `1${String(400000000 + i).padStart(9, '0')}`,
        name: `${geo} - ${INTENTS[i % INTENTS.length]} - ${THEMES[i % THEMES.length]} #${i}`,
        status: enabled ? 'ENABLED' : 'PAUSED',
        servingStatus: enabled && random() > 0.2 ? 'RUNNING' : 'NOT_RUNNING',
        servingStateReasons: [],
        adChannelType: 'SEARCH',
        supplySources: ['APPSTORE_SEARCH_RESULTS'],
        countriesOrRegions: [geo],
        billingEvent: 'TAPS',
        budgetAmount: { amount: (spendDollars * 3).toFixed(2), currency: 'USD' },
        dailyBudgetAmount: { amount: (spendDollars / 10 + 25).toFixed(2), currency: 'USD' },
        startTime: '2026-05-07',
        endTime: null,
        createdAt: '2026-05-01',
        modifiedAt: '2026-08-01',
      },
      app: {
        adamId: `1${String(400000000 + i).padStart(9, '0')}`,
        appName,
        developerName: 'Northwind Labs',
        genre: 'Productivity',
      },
      metrics: {
        impressions,
        taps,
        installs,
        redownloads,
        spendCents,
        localSpend: spendDollars.toFixed(2),
        ttr: impressions === 0 ? 0 : taps / impressions,
        conversionRate: taps === 0 ? 0 : installs / taps,
        avgCPT: taps === 0 ? 0 : spendDollars / taps,
        avgCPA: installs === 0 ? 0 : spendDollars / installs,
        avgCPM: impressions === 0 ? 0 : (spendDollars * 1000) / impressions,
      },
      sparkline,
      pacing: {
        campaignId: `perf_${String(i).padStart(6, '0')}`,
        dailySpendRatio: Number(random().toFixed(3)),
        pacingState: PACING[i % PACING.length]!,
        projectedDailySpend: { amount: (spendDollars / 10).toFixed(2), currency: 'USD' },
      },
    };
  }

  return rows;
}
