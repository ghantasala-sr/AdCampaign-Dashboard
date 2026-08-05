/**
 * Upstream 3 of 4 — app catalog.
 *
 * Owns App Store metadata. Batched by adamId because a page of 50 campaign rows
 * typically references only a handful of distinct apps; issuing 50 lookups where
 * 6 would do is the classic BFF N+1 this batching exists to avoid.
 */

import type { AppMetadata } from '@adsight/types';

import { loadDataset } from '../lib/fixtures.js';
import { simulateLatency } from './latency.js';

export async function getApps(adamIds: readonly string[]): Promise<Map<string, AppMetadata>> {
  const distinct = [...new Set(adamIds)];
  if (distinct.length === 0) return new Map();

  await simulateLatency('catalogService.getApps');
  const dataset = loadDataset();
  const out = new Map<string, AppMetadata>();
  for (const adamId of distinct) {
    const app = dataset.appsByAdamId.get(adamId);
    if (app) out.set(adamId, app);
  }
  return out;
}

export async function listApps(): Promise<readonly AppMetadata[]> {
  await simulateLatency('catalogService.listApps');
  return loadDataset().apps;
}
