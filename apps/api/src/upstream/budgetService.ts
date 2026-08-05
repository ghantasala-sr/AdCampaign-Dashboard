/**
 * Upstream 4 of 4 — real-time budget pacing.
 *
 * Deliberately the flaky one. Pacing is a nice-to-have column; a campaign list
 * that 500s because the pacing service is having a bad afternoon is a bad BFF.
 * The aggregator catches `UpstreamUnavailableError` from here, returns
 * `pacing: null` per row, and names the failure in `meta.degraded` so the client
 * can show a banner instead of an error page.
 */

import type { BudgetPacing, Campaign, MetricCounters } from '@adsight/types';

import { getEnv } from '../env.js';
import { createRng, hashString } from '../lib/rng.js';
import { maybeFail, simulateLatency } from './latency.js';

export interface PacingInput {
  readonly campaign: Campaign;
  /** Today's counters, used to compute the spend ratio. */
  readonly todaySpendCents: number;
}

function classify(ratio: number, capped: boolean): BudgetPacing['pacingState'] {
  if (capped || ratio >= 1) return 'CAPPED';
  if (ratio >= 0.85) return 'OVER_PACING';
  if (ratio >= 0.4) return 'ON_PACE';
  return 'UNDER_PACING';
}

export async function getPacing(
  inputs: readonly PacingInput[],
): Promise<Map<string, BudgetPacing>> {
  if (inputs.length === 0) return new Map();

  await simulateLatency('budgetService.getPacing');
  maybeFail('budgetService', getEnv().BUDGET_SERVICE_FAILURE_RATE);

  const out = new Map<string, BudgetPacing>();
  for (const { campaign, todaySpendCents } of inputs) {
    const dailyBudgetCents = Math.round(Number(campaign.dailyBudgetAmount.amount) * 100);
    const rng = createRng(hashString(`${campaign.id}:pacing`));

    // Pacing blends actual spend with a small projection so the column is not a
    // pure restatement of the spend metric.
    const observed = dailyBudgetCents > 0 ? todaySpendCents / dailyBudgetCents : 0;
    const ratio = campaign.status === 'PAUSED' ? 0 : Math.max(0, observed * rng.float(0.85, 1.2));
    const capped = campaign.servingStateReasons.includes('DAILY_CAP_EXHAUSTED');

    out.set(campaign.id, {
      campaignId: campaign.id,
      dailySpendRatio: Number(ratio.toFixed(3)),
      pacingState: classify(ratio, capped),
      projectedDailySpend: {
        amount: (Math.min(ratio, 1.15) * (dailyBudgetCents / 100)).toFixed(2),
        currency: campaign.dailyBudgetAmount.currency,
      },
    });
  }

  return out;
}

/** Convenience for callers that already have a counters map. */
export function todaySpendFrom(counters: MetricCounters | undefined): number {
  return counters?.spendCents ?? 0;
}
