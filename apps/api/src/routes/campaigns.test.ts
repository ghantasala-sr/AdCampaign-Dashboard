import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { UpstreamUnavailableError } from '../upstream/latency.js';
import * as budgetService from '../upstream/budgetService.js';
import * as catalogService from '../upstream/catalogService.js';
import { resetCreatedCampaigns } from '../upstream/campaignService.js';

/**
 * Integration tests against the real fixture set, through the real Express app.
 *
 * `createApp()` rather than a running server, so there is no port to bind and no
 * teardown to get wrong. These run against the seeded 10,000-campaign dataset —
 * they will fail loudly if `npm run seed` has not been run, which is the correct
 * behaviour for a suite whose whole subject is data shaping.
 */
const app = createApp();

afterEach(() => {
  vi.restoreAllMocks();
  resetCreatedCampaigns();
});

describe('GET /api/campaigns', () => {
  it('returns a page of shaped rows with totals over the whole filtered set', async () => {
    const response = await request(app).get('/api/campaigns?limit=25').expect(200);

    expect(response.body.rows).toHaveLength(25);
    expect(response.body.pageInfo.total).toBe(10_000);
    expect(response.body.pageInfo.hasMore).toBe(true);

    const row = response.body.rows[0];
    // One row carries config, metrics, catalog, and pacing — the join the BFF exists for.
    expect(row.campaign.id).toMatch(/^camp_/);
    expect(row.app.appName).toBeTruthy();
    expect(row.metrics).toHaveProperty('avgCPA');
    expect(row.pacing).toHaveProperty('pacingState');
    expect(row.sparkline.length).toBeGreaterThan(0);

    // Totals must reflect the filtered set, not the 25 returned rows.
    const pageSpend = response.body.rows.reduce(
      (sum: number, r: { metrics: { spendCents: number } }) => sum + r.metrics.spendCents,
      0,
    );
    expect(response.body.totals.spendCents).toBeGreaterThan(pageSpend);
  });

  it('sorts descending by spend by default and honours an explicit sort', async () => {
    const desc = await request(app).get('/api/campaigns?limit=5').expect(200);
    const spends = desc.body.rows.map((r: { metrics: { spendCents: number } }) => r.metrics.spendCents);
    expect([...spends].sort((a, b) => b - a)).toEqual(spends);

    const asc = await request(app).get('/api/campaigns?sort=installs&dir=asc&limit=5').expect(200);
    const installs = asc.body.rows.map((r: { metrics: { installs: number } }) => r.metrics.installs);
    expect([...installs].sort((a, b) => a - b)).toEqual(installs);
  });

  it('pages without repeating or skipping a row', async () => {
    // A non-total comparator plus an unstable sort would let a row appear on two
    // pages; the id tiebreaker is what prevents it.
    const first = await request(app).get('/api/campaigns?limit=50').expect(200);
    const second = await request(app).get('/api/campaigns?limit=50&offset=50').expect(200);

    const ids = new Set([
      ...first.body.rows.map((r: { campaign: { id: string } }) => r.campaign.id),
      ...second.body.rows.map((r: { campaign: { id: string } }) => r.campaign.id),
    ]);
    expect(ids.size).toBe(100);
  });

  it('applies config filters from the query string', async () => {
    const response = await request(app)
      .get('/api/campaigns?status=PAUSED&country=JP&limit=20')
      .expect(200);

    expect(response.body.pageInfo.total).toBeGreaterThan(0);
    expect(response.body.pageInfo.total).toBeLessThan(10_000);
    for (const row of response.body.rows) {
      expect(row.campaign.status).toBe('PAUSED');
      expect(row.campaign.countriesOrRegions).toContain('JP');
    }
  });

  it('applies a metric threshold in display units', async () => {
    const response = await request(app)
      .get('/api/campaigns?metric=spendCents:gt:5000&limit=20')
      .expect(200);
    for (const row of response.body.rows) {
      expect(row.metrics.spendCents).toBeGreaterThan(500_000);
    }
  });

  it('narrows the result set as the date range shrinks', async () => {
    const wide = await request(app)
      .get('/api/campaigns?preset=LAST_90_DAYS&metric=spendCents:gt:1000&limit=1')
      .expect(200);
    const narrow = await request(app)
      .get('/api/campaigns?preset=LAST_7_DAYS&metric=spendCents:gt:1000&limit=1')
      .expect(200);

    expect(narrow.body.pageInfo.total).toBeLessThan(wide.body.pageInfo.total);
    expect(narrow.body.meta.resolvedDateRange.start > wide.body.meta.resolvedDateRange.start).toBe(true);
  });

  it('clamps an oversized limit rather than serving it', async () => {
    const response = await request(app).get('/api/campaigns?limit=99999').expect(200);
    expect(response.body.pageInfo.limit).toBeLessThanOrEqual(500);
  });

  it('ignores a malformed metric predicate instead of erroring', async () => {
    // A hand-edited URL should degrade to "no metric filter", not a 400.
    const response = await request(app).get('/api/campaigns?metric=bogus:xx:nope').expect(200);
    expect(response.body.pageInfo.total).toBe(10_000);
  });

  it('returns a field-keyed validation error for an out-of-window date range', async () => {
    const response = await request(app)
      .get('/api/campaigns?start=2019-01-01&end=2019-02-01')
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.fields).toHaveProperty('dateRange.start');
  });

  describe('upstream degradation', () => {
    it('still returns rows when the budget service fails, and says so', async () => {
      vi.spyOn(budgetService, 'getPacing').mockRejectedValue(
        new UpstreamUnavailableError('budgetService'),
      );

      const response = await request(app).get('/api/campaigns?limit=5').expect(200);

      expect(response.body.rows).toHaveLength(5);
      expect(response.body.meta.degraded).toEqual(['budgetService']);
      // The column is blank, not missing, and the rest of the row is intact.
      expect(response.body.rows[0].pacing).toBeNull();
      expect(response.body.rows[0].metrics.spendCents).toBeGreaterThanOrEqual(0);
    });

    it('degrades the catalog service independently', async () => {
      vi.spyOn(catalogService, 'getApps').mockRejectedValue(
        new UpstreamUnavailableError('catalogService'),
      );

      const response = await request(app).get('/api/campaigns?limit=3').expect(200);
      expect(response.body.meta.degraded).toEqual(['catalogService']);
      expect(response.body.rows[0].app).toBeNull();
      expect(response.body.rows[0].pacing).not.toBeNull();
    });

    it('does not swallow an unexpected error as degradation', async () => {
      // Only UpstreamUnavailableError means "degrade"; a real bug must surface.
      vi.spyOn(budgetService, 'getPacing').mockRejectedValue(new TypeError('bug in pacing math'));
      const response = await request(app).get('/api/campaigns?limit=3').expect(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});

describe('GET /api/campaigns/:id', () => {
  it('returns the campaign with its structure and time series', async () => {
    const list = await request(app).get('/api/campaigns?limit=1').expect(200);
    const id = list.body.rows[0].campaign.id;

    const response = await request(app).get(`/api/campaigns/${id}?preset=LAST_7_DAYS`).expect(200);
    expect(response.body.row.campaign.id).toBe(id);
    expect(response.body.timeSeries).toHaveLength(7);
    expect(Array.isArray(response.body.adGroups)).toBe(true);
    expect(response.body.meta.resolvedDateRange.start).toBeTruthy();
  });

  it('404s for an unknown id', async () => {
    const response = await request(app).get('/api/campaigns/camp_does_not_exist').expect(404);
    expect(response.body.error.code).toBe('CAMPAIGN_NOT_FOUND');
  });
});

describe('POST /api/campaigns', () => {
  const valid = {
    name: 'US - Brand - Test',
    dailyBudgetAmount: '250',
    budgetAmount: '7500',
    currency: 'USD',
    countriesOrRegions: ['US'],
    supplySources: ['APPSTORE_SEARCH_RESULTS'],
    billingEvent: 'TAPS',
  };

  async function firstAdamId(): Promise<string> {
    const facets = await request(app).get('/api/facets').expect(200);
    return facets.body.apps[0].adamId;
  }

  it('creates a campaign that then appears in the list', async () => {
    const adamId = await firstAdamId();
    const created = await request(app)
      .post('/api/campaigns')
      .send({ ...valid, adamId })
      .expect(201);

    expect(created.body.campaign.id).toBeTruthy();
    // A brand-new campaign has not started delivering.
    expect(created.body.campaign.servingStatus).toBe('NOT_RUNNING');

    const list = await request(app)
      .get(`/api/campaigns?search=${encodeURIComponent('US - Brand - Test')}`)
      .expect(200);
    expect(list.body.pageInfo.total).toBeGreaterThanOrEqual(1);
  });

  it('reports zeroed metrics for a campaign with no history rather than failing', async () => {
    const adamId = await firstAdamId();
    const created = await request(app)
      .post('/api/campaigns')
      .send({ ...valid, name: 'Zero History Campaign', adamId })
      .expect(201);

    const detail = await request(app)
      .get(`/api/campaigns/${created.body.campaign.id}`)
      .expect(200);
    expect(detail.body.row.metrics.spendCents).toBe(0);
    expect(detail.body.row.metrics.avgCPA).toBe(0);
  });

  it('returns one message per invalid field', async () => {
    const response = await request(app)
      .post('/api/campaigns')
      .send({ ...valid, adamId: 'nope', name: '', countriesOrRegions: [] })
      .expect(400);

    expect(response.body.error.fields).toMatchObject({
      name: expect.any(String),
      countriesOrRegions: expect.any(String),
    });
  });

  it('rejects a total budget below the daily budget', async () => {
    const adamId = await firstAdamId();
    const response = await request(app)
      .post('/api/campaigns')
      .send({ ...valid, adamId, dailyBudgetAmount: '500', budgetAmount: '100' })
      .expect(400);
    expect(response.body.error.fields.budgetAmount).toMatch(/at least the daily budget/);
  });

  it('rejects an app that is not in the catalog', async () => {
    const response = await request(app)
      .post('/api/campaigns')
      .send({ ...valid, adamId: '9999999999' })
      .expect(400);
    expect(response.body.error.fields.adamId).toMatch(/not in the catalog/);
  });
});

describe('GET /health', () => {
  it('reports the dataset window and which planner is configured', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.campaigns).toBe(10_000);
    expect(response.body.planner).toMatch(/model|heuristic/);
  });
});
