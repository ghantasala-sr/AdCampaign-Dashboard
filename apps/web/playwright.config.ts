import { defineConfig, devices } from '@playwright/test';

/**
 * The E2E suite runs against a production build, not the dev server: the thing
 * being verified is what a user gets, and dev-only behaviour (hot reload,
 * unminified chunks, React double-invoking effects) has its own failure modes
 * that would show up here as flakes.
 *
 * Playwright starts both servers itself so `npm run e2e` works from a clean
 * checkout after one `npm run seed`. Upstream latency and the injected budget
 * failure are switched off — the degraded-upstream path is covered by the API's
 * unit tests, where it can be triggered deterministically instead of waited for.
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3210);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4210);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'npm run start --workspace=@adsight/api',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: 'production',
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        UPSTREAM_LATENCY_MIN_MS: '0',
        UPSTREAM_LATENCY_MAX_MS: '0',
        BUDGET_SERVICE_FAILURE_RATE: '0',
      },
    },
    {
      // The build is part of the command, not a prerequisite, because
      // NEXT_PUBLIC_* values are inlined at build time — setting the API URL
      // only for `next start` would leave the client calling whatever host the
      // last build happened to bake in.
      command: `npx next build && npx next start --port ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
