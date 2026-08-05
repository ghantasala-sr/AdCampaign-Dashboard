/**
 * Per-request batch loaders.
 *
 * Without these, a 50-row GraphQL query that selects `app` would issue 50
 * catalog calls — the N+1 that gives GraphQL BFFs a bad name. Each loader
 * collects keys within a microtask tick, issues one batched upstream call, and
 * fans the result back out. Scoped per request so nothing leaks between users.
 */

import type { AppMetadata, BudgetPacing, Campaign, DegradedUpstream } from '@adsight/types';

import * as catalogService from '../upstream/catalogService.js';
import * as budgetService from '../upstream/budgetService.js';
import * as reportingService from '../upstream/reportingService.js';
import { UpstreamUnavailableError } from '../upstream/latency.js';
import { loadDataset } from '../lib/fixtures.js';
import { todayWindow } from '../orchestration/dateRange.js';

interface Pending<K, V> {
  readonly keys: K[];
  readonly resolvers: Array<(value: V | null) => void>;
  readonly rejecters: Array<(error: unknown) => void>;
}

export interface RequestLoaders {
  loadApp(adamId: string): Promise<AppMetadata | null>;
  loadPacing(campaign: Campaign): Promise<BudgetPacing | null>;
  readonly degraded: DegradedUpstream[];
}

export function createLoaders(): RequestLoaders {
  const degraded: DegradedUpstream[] = [];

  let appBatch: Pending<string, AppMetadata> | null = null;
  let pacingBatch: (Pending<string, BudgetPacing> & { campaigns: Campaign[] }) | null = null;

  function noteDegraded(upstream: DegradedUpstream): void {
    if (!degraded.includes(upstream)) degraded.push(upstream);
  }

  async function flushApps(batch: Pending<string, AppMetadata>): Promise<void> {
    try {
      const apps = await catalogService.getApps(batch.keys);
      batch.keys.forEach((key, i) => batch.resolvers[i]!(apps.get(key) ?? null));
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        noteDegraded('catalogService');
        // Degrade to null rather than failing the whole query.
        batch.resolvers.forEach((resolve) => resolve(null));
        return;
      }
      batch.rejecters.forEach((reject) => reject(error));
    }
  }

  async function flushPacing(
    batch: Pending<string, BudgetPacing> & { campaigns: Campaign[] },
  ): Promise<void> {
    try {
      const today = todayWindow(loadDataset().manifest);
      const todayCounters = await reportingService.rollup(batch.keys, today);
      const pacing = await budgetService.getPacing(
        batch.campaigns.map((campaign) => ({
          campaign,
          todaySpendCents: budgetService.todaySpendFrom(todayCounters.get(campaign.id)),
        })),
      );
      batch.keys.forEach((key, i) => batch.resolvers[i]!(pacing.get(key) ?? null));
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        noteDegraded('budgetService');
        batch.resolvers.forEach((resolve) => resolve(null));
        return;
      }
      batch.rejecters.forEach((reject) => reject(error));
    }
  }

  return {
    degraded,

    loadApp(adamId) {
      return new Promise<AppMetadata | null>((resolve, reject) => {
        if (!appBatch) {
          appBatch = { keys: [], resolvers: [], rejecters: [] };
          const batch = appBatch;
          // queueMicrotask lets every resolver in this execution layer enqueue
          // before the upstream call goes out.
          queueMicrotask(() => {
            appBatch = null;
            void flushApps(batch);
          });
        }
        appBatch.keys.push(adamId);
        appBatch.resolvers.push(resolve);
        appBatch.rejecters.push(reject);
      });
    },

    loadPacing(campaign) {
      return new Promise<BudgetPacing | null>((resolve, reject) => {
        if (!pacingBatch) {
          pacingBatch = { keys: [], resolvers: [], rejecters: [], campaigns: [] };
          const batch = pacingBatch;
          queueMicrotask(() => {
            pacingBatch = null;
            void flushPacing(batch);
          });
        }
        pacingBatch.keys.push(campaign.id);
        pacingBatch.campaigns.push(campaign);
        pacingBatch.resolvers.push(resolve);
        pacingBatch.rejecters.push(reject);
      });
    },
  };
}
