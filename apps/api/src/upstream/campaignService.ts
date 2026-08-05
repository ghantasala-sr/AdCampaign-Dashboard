/**
 * Upstream 1 of 4 — campaign configuration.
 *
 * Owns the campaign/ad group/keyword hierarchy. Knows nothing about metrics,
 * app metadata, or budget pacing.
 */

import type { AdGroup, Campaign, CreateCampaignInput, Keyword } from '@adsight/types';

import { loadDataset } from '../lib/fixtures.js';
import { simulateLatency } from './latency.js';

/**
 * Campaigns created through the API during this process's lifetime. A real
 * deployment would POST to the upstream; here the overlay keeps the create flow
 * end-to-end testable without a writable fixture file.
 */
const created: Campaign[] = [];

export interface ListResult {
  readonly campaigns: readonly Campaign[];
}

export async function listCampaigns(): Promise<ListResult> {
  await simulateLatency('campaignService.list');
  const dataset = loadDataset();
  // Newest first among created ones so a just-created campaign is easy to find.
  if (created.length === 0) return { campaigns: dataset.campaigns };
  return { campaigns: [...created, ...dataset.campaigns] };
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  await simulateLatency('campaignService.get');
  const fromCreated = created.find((c) => c.id === id);
  if (fromCreated) return fromCreated;
  return loadDataset().campaignsById.get(id) ?? null;
}

export async function getChildren(
  campaignId: string,
): Promise<{ adGroups: readonly AdGroup[]; keywords: readonly Keyword[] }> {
  await simulateLatency('campaignService.getChildren');
  const dataset = loadDataset();
  return {
    adGroups: dataset.adGroupsByCampaign.get(campaignId) ?? [],
    keywords: dataset.keywordsByCampaign.get(campaignId) ?? [],
  };
}

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  await simulateLatency('campaignService.create');
  const dataset = loadDataset();
  const now = new Date().toISOString();

  const campaign: Campaign = {
    id: `camp_new_${created.length + 1}_${Date.now().toString(36)}`,
    adamId: input.adamId,
    name: input.name,
    status: 'ENABLED',
    // A brand-new campaign has not begun delivering yet.
    servingStatus: 'NOT_RUNNING',
    servingStateReasons: ['CAMPAIGN_ON_HOLD'],
    adChannelType: 'SEARCH',
    supplySources: input.supplySources,
    countriesOrRegions: input.countriesOrRegions,
    billingEvent: input.billingEvent,
    budgetAmount: { amount: input.budgetAmount, currency: input.currency },
    dailyBudgetAmount: { amount: input.dailyBudgetAmount, currency: input.currency },
    startTime: dataset.manifest.endDate,
    endTime: null,
    createdAt: now,
    modifiedAt: now,
  };

  created.unshift(campaign);
  return campaign;
}

/** True when the campaign has no slot in the metrics fixture. */
export function isSynthetic(id: string): boolean {
  return created.some((c) => c.id === id);
}

/** Test hook. */
export function resetCreatedCampaigns(): void {
  created.length = 0;
}
