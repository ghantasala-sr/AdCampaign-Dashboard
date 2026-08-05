import { createApp } from './app.js';
import { getEnv } from './env.js';
import { loadDataset } from './lib/fixtures.js';

const env = getEnv();

// Load the fixture set before binding the port so the first request does not pay
// for it and a missing `npm run seed` fails loudly at boot.
const dataset = loadDataset();

const app = createApp();

const server = app.listen(env.PORT, () => {
  process.stdout.write(
    `[api] listening on http://localhost:${env.PORT}\n` +
      `[api] ${dataset.manifest.campaignCount.toLocaleString()} campaigns, ` +
      `window ${dataset.manifest.startDate}..${dataset.manifest.endDate}, ` +
      `loaded in ${dataset.loadMs}ms\n` +
      `[api] planner: ${env.ANTHROPIC_API_KEY ? 'claude-opus-5' : 'heuristic (no ANTHROPIC_API_KEY)'}\n`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
