/**
 * Upstream 2 of 4 — reporting.
 *
 * Owns the daily counter series. Every read is a contiguous scan over the flat
 * Int32 array, which is the whole reason the fixture is stored that way: a
 * 10,000-campaign rollup over a 30-day window is 1.5M array reads with no
 * allocation, so the list endpoint can filter on metrics without paging first.
 */

import type { MetricCounters, MetricPoint } from '@adsight/types';

import { loadDataset } from '../lib/fixtures.js';
import { DAYS, METRIC_ORDER, addDays, metricIndex } from '../lib/dataset.js';
import { simulateLatency } from './latency.js';

const ZERO: MetricCounters = {
  impressions: 0,
  taps: 0,
  installs: 0,
  redownloads: 0,
  spendCents: 0,
};

export interface DayWindow {
  /** Inclusive day index into the fixture window, 0-based. */
  readonly startDay: number;
  /** Inclusive day index into the fixture window. */
  readonly endDay: number;
}

/** Sums each counter over the window for every requested campaign. */
export async function rollup(
  campaignIds: readonly string[],
  window: DayWindow,
): Promise<Map<string, MetricCounters>> {
  await simulateLatency('reportingService.rollup');
  const dataset = loadDataset();
  const { metrics, slotById, manifest } = dataset;
  const campaignCount = manifest.campaignCount;
  const out = new Map<string, MetricCounters>();

  for (const id of campaignIds) {
    const slot = slotById.get(id);
    if (slot === undefined) {
      out.set(id, ZERO);
      continue;
    }

    let impressions = 0;
    let taps = 0;
    let installs = 0;
    let redownloads = 0;
    let spendCents = 0;

    // Metric-major layout means each of these is one contiguous run.
    const impBase = metricIndex(0, slot, 0, campaignCount, DAYS);
    const tapBase = metricIndex(1, slot, 0, campaignCount, DAYS);
    const insBase = metricIndex(2, slot, 0, campaignCount, DAYS);
    const redBase = metricIndex(3, slot, 0, campaignCount, DAYS);
    const spdBase = metricIndex(4, slot, 0, campaignCount, DAYS);

    for (let d = window.startDay; d <= window.endDay; d += 1) {
      impressions += metrics[impBase + d]!;
      taps += metrics[tapBase + d]!;
      installs += metrics[insBase + d]!;
      redownloads += metrics[redBase + d]!;
      spendCents += metrics[spdBase + d]!;
    }

    out.set(id, { impressions, taps, installs, redownloads, spendCents });
  }

  return out;
}

/** Daily series for one campaign — powers the drill-in chart. */
export async function series(campaignId: string, window: DayWindow): Promise<MetricPoint[]> {
  await simulateLatency('reportingService.series');
  const dataset = loadDataset();
  const slot = dataset.slotById.get(campaignId);
  const points: MetricPoint[] = [];

  for (let d = window.startDay; d <= window.endDay; d += 1) {
    const date = addDays(dataset.manifest.startDate, d);
    if (slot === undefined) {
      points.push({ date, ...ZERO });
      continue;
    }
    const counters = METRIC_ORDER.map(
      (_, m) => dataset.metrics[metricIndex(m, slot, d, dataset.manifest.campaignCount, DAYS)]!,
    );
    points.push({
      date,
      impressions: counters[0]!,
      taps: counters[1]!,
      installs: counters[2]!,
      redownloads: counters[3]!,
      spendCents: counters[4]!,
    });
  }

  return points;
}

/**
 * Downsampled spend series for row sparklines.
 *
 * Bucketing happens here rather than in the browser so the wire payload is
 * bounded: `buckets` values per row regardless of how wide the date range is.
 * A 90-day range therefore costs the same bytes as a 7-day one.
 */
export function sparklines(
  campaignIds: readonly string[],
  window: DayWindow,
  buckets = 24,
): Map<string, number[]> {
  const dataset = loadDataset();
  const { metrics, slotById, manifest } = dataset;
  const spendMetricSlot = METRIC_ORDER.indexOf('spendCents');
  const dayCount = window.endDay - window.startDay + 1;
  const out = new Map<string, number[]>();

  for (const id of campaignIds) {
    const slot = slotById.get(id);
    if (slot === undefined) {
      out.set(id, new Array<number>(Math.min(buckets, dayCount)).fill(0));
      continue;
    }

    const base = metricIndex(spendMetricSlot, slot, 0, manifest.campaignCount, DAYS);
    const size = Math.min(buckets, dayCount);
    const values = new Array<number>(size).fill(0);
    const perBucket = dayCount / size;

    for (let d = 0; d < dayCount; d += 1) {
      const bucket = Math.min(size - 1, Math.floor(d / perBucket));
      values[bucket] = values[bucket]! + metrics[base + window.startDay + d]!;
    }
    out.set(id, values);
  }

  return out;
}
