import express, { type Express } from 'express';
import cors from 'cors';

import { corsOrigins, getEnv } from './env.js';
import { loadDataset } from './lib/fixtures.js';
import { plannerModel, plannerSource } from './ai/planner.js';
import { campaignsRouter } from './routes/campaigns.js';
import { aiRouter } from './routes/ai.js';
import { errorHandler, notFoundHandler } from './routes/errors.js';
import { createGraphQLHandler } from './graphql/index.js';

/**
 * App factory rather than a module-level app: the test suite builds one per file
 * with its own env, and there is no listening socket to clean up.
 */
export function createApp(): Express {
  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigins(env) }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    const dataset = loadDataset();
    res.json({
      status: 'ok',
      campaigns: dataset.manifest.campaignCount,
      dataWindow: { start: dataset.manifest.startDate, end: dataset.manifest.endDate },
      datasetLoadMs: dataset.loadMs,
      planner: plannerSource(),
      plannerModel: plannerModel(),
    });
  });

  app.use('/api', campaignsRouter);
  app.use('/api', aiRouter);
  app.all('/graphql', createGraphQLHandler());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
