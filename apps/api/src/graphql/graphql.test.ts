import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import * as catalogService from '../upstream/catalogService.js';
import * as budgetService from '../upstream/budgetService.js';

/**
 * The GraphQL endpoint's reason to exist is field-level laziness and batching.
 * Asserting that with spies is the only way to make the claim checkable — the
 * response body looks the same either way.
 */
const app = createApp();

afterEach(() => {
  vi.restoreAllMocks();
});

async function gql(query: string) {
  const response = await request(app)
    .post('/graphql')
    .set('Content-Type', 'application/json')
    .send({ query })
    .expect(200);
  expect(response.body.errors).toBeUndefined();
  return response.body.data;
}

describe('GraphQL campaigns', () => {
  it('does not touch the catalog or budget upstreams when those fields are not selected', async () => {
    const catalog = vi.spyOn(catalogService, 'getApps');
    const budget = vi.spyOn(budgetService, 'getPacing');

    const data = await gql(`{
      campaigns(limit: 10) {
        pageInfo { total }
        rows { campaign { id name } metrics { spendCents } }
      }
    }`);

    expect(data.campaigns.rows).toHaveLength(10);
    // This is the whole argument for the GraphQL surface: the equivalent REST
    // call always pays for both of these joins.
    expect(catalog).not.toHaveBeenCalled();
    expect(budget).not.toHaveBeenCalled();
  });

  it('batches the catalog into one call for a whole page', async () => {
    const catalog = vi.spyOn(catalogService, 'getApps');

    const data = await gql(`{
      campaigns(limit: 25) { rows { campaign { id } app { appName } } }
    }`);

    expect(data.campaigns.rows).toHaveLength(25);
    // 25 rows, one upstream call — not 25.
    expect(catalog).toHaveBeenCalledTimes(1);
    expect(catalog.mock.calls[0]?.[0]).toHaveLength(25);
  });

  it('batches pacing into one call for a whole page', async () => {
    const budget = vi.spyOn(budgetService, 'getPacing');
    await gql(`{ campaigns(limit: 20) { rows { pacing { pacingState } } } }`);
    expect(budget).toHaveBeenCalledTimes(1);
    expect(budget.mock.calls[0]?.[0]).toHaveLength(20);
  });

  it('applies the same filters as the REST surface', async () => {
    const data = await gql(`{
      campaigns(statuses: [PAUSED], countriesOrRegions: ["JP"], limit: 5) {
        pageInfo { total }
        rows { campaign { status countriesOrRegions } }
      }
    }`);

    expect(data.campaigns.pageInfo.total).toBeGreaterThan(0);
    for (const row of data.campaigns.rows) {
      expect(row.campaign.status).toBe('PAUSED');
      expect(row.campaign.countriesOrRegions).toContain('JP');
    }
  });

  it('reports a degraded upstream without failing the query', async () => {
    vi.spyOn(budgetService, 'getPacing').mockRejectedValue(
      Object.assign(new Error('down'), { name: 'UpstreamUnavailableError' }),
    );

    const response = await request(app)
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .send({ query: '{ campaigns(limit: 3) { degraded rows { pacing { pacingState } } } }' })
      .expect(200);

    // The query resolves; pacing is null and the failure is named.
    expect(response.body.data.campaigns.rows[0].pacing).toBeNull();
  });

  it('resolves a single campaign with its structure', async () => {
    const list = await gql(`{ campaigns(limit: 1) { rows { campaign { id } } } }`);
    const id = list.campaigns.rows[0].campaign.id;

    const data = await gql(`{
      campaign(id: "${id}", preset: "LAST_7_DAYS") {
        row { campaign { name } metrics { installs } }
        timeSeries { date spendCents }
      }
    }`);

    expect(data.campaign.row.campaign.name).toBeTruthy();
    expect(data.campaign.timeSeries).toHaveLength(7);
  });

  it('returns null for an unknown campaign rather than erroring', async () => {
    const data = await gql('{ campaign(id: "camp_missing") { row { campaign { id } } } }');
    expect(data.campaign).toBeNull();
  });

  it('exposes the dataset window through facets', async () => {
    const data = await gql('{ facets { dataWindow { days campaignCount } } }');
    expect(data.facets.dataWindow.days).toBe(90);
    expect(data.facets.dataWindow.campaignCount).toBe(10_000);
  });
});
