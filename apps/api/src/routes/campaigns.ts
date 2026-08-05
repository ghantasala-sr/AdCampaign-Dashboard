import { Router } from 'express';
import { z } from 'zod';
import { decodeListParams, EMPTY_FILTER, type CreateCampaignInput } from '@adsight/types';

import { getCampaignDetail, listCampaigns } from '../orchestration/campaignAggregator.js';
import { DateRangeError } from '../orchestration/dateRange.js';
import * as campaignService from '../upstream/campaignService.js';
import * as catalogService from '../upstream/catalogService.js';
import { loadDataset } from '../lib/fixtures.js';
import { sendValidationError } from './errors.js';

/**
 * REST surface. The list endpoint is a GET with flat query parameters rather
 * than a POST with a JSON body: it keeps every filtered view a shareable URL,
 * lets React Query key straight off the search string, and stays cacheable.
 * Decoding uses the shared codec in `@adsight/types`, so the URL the browser
 * builds and the one the server reads cannot drift.
 */
export const campaignsRouter: Router = Router();

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name must be 120 characters or fewer'),
  adamId: z.string().trim().min(1, 'Select an app'),
  dailyBudgetAmount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 250 or 250.00')
    .refine((v) => Number(v) > 0, 'Daily budget must be greater than zero'),
  budgetAmount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 5000 or 5000.00')
    .refine((v) => Number(v) > 0, 'Total budget must be greater than zero'),
  currency: z.string().length(3).default('USD'),
  countriesOrRegions: z
    .array(z.string().regex(/^[A-Z]{2}$/, 'Use two-letter country codes'))
    .min(1, 'Select at least one country or region'),
  supplySources: z
    .array(
      z.enum([
        'APPSTORE_SEARCH_RESULTS',
        'APPSTORE_SEARCH_TAB',
        'APPSTORE_TODAY_TAB',
        'APPSTORE_PRODUCT_PAGES_BROWSE',
      ]),
    )
    .min(1, 'Select at least one supply source'),
  billingEvent: z.enum(['TAPS', 'IMPRESSIONS']).default('TAPS'),
});

/**
 * A total budget below the daily budget is the one cross-field rule worth
 * enforcing; everything else is independently valid.
 */
const createSchemaWithBudgetRule = createSchema.refine(
  (v) => Number(v.budgetAmount) >= Number(v.dailyBudgetAmount),
  { message: 'Total budget must be at least the daily budget', path: ['budgetAmount'] },
);

campaignsRouter.get('/campaigns', async (req, res) => {
  const params = new URLSearchParams(
    Object.entries(req.query).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value] as [string, string]] : [],
    ),
  );

  try {
    const { filter, sort, offset, limit } = decodeListParams(params);
    const result = await listCampaigns({ filter, sort, offset, limit });
    res.json(result);
  } catch (error) {
    if (error instanceof DateRangeError) {
      sendValidationError(res, error.message, { [error.field]: error.message });
      return;
    }
    throw error;
  }
});

campaignsRouter.get('/campaigns/:id', async (req, res) => {
  const params = new URLSearchParams(
    Object.entries(req.query).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value] as [string, string]] : [],
    ),
  );
  const { filter } = decodeListParams(params);

  try {
    const detail = await getCampaignDetail(req.params.id, filter.dateRange);
    if (!detail) {
      res.status(404).json({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: `No campaign with id "${req.params.id}"` },
      });
      return;
    }
    res.json(detail);
  } catch (error) {
    if (error instanceof DateRangeError) {
      sendValidationError(res, error.message, { [error.field]: error.message });
      return;
    }
    throw error;
  }
});

campaignsRouter.post('/campaigns', async (req, res) => {
  const parsed = createSchemaWithBudgetRule.safeParse(req.body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || 'root';
      // Keep the first message per field; later ones are usually consequences.
      if (!(path in fields)) fields[path] = issue.message;
    }
    sendValidationError(res, 'The campaign could not be created', fields);
    return;
  }

  const apps = await catalogService.listApps();
  if (!apps.some((app) => app.adamId === parsed.data.adamId)) {
    sendValidationError(res, 'The campaign could not be created', {
      adamId: 'That app is not in the catalog',
    });
    return;
  }

  const campaign = await campaignService.createCampaign(parsed.data as CreateCampaignInput);
  res.status(201).json({ campaign });
});

/** Distinct values for the filter panel, plus the window the data covers. */
campaignsRouter.get('/facets', async (_req, res) => {
  const dataset = loadDataset();
  const apps = await catalogService.listApps();

  const countries = new Set<string>();
  for (const campaign of dataset.campaigns) {
    for (const country of campaign.countriesOrRegions) countries.add(country);
  }

  res.json({
    countriesOrRegions: [...countries].sort(),
    supplySources: [
      'APPSTORE_SEARCH_RESULTS',
      'APPSTORE_SEARCH_TAB',
      'APPSTORE_TODAY_TAB',
      'APPSTORE_PRODUCT_PAGES_BROWSE',
    ],
    apps,
    dataWindow: { start: dataset.manifest.startDate, end: dataset.manifest.endDate },
    defaultFilter: EMPTY_FILTER,
  });
});
