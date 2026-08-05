import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

/**
 * `graphql` v16 ships both a CommonJS build (`main`) and an ESM one (`module`)
 * with no `exports` map. Node ignores `module`, so at runtime both this app's
 * `import ... from 'graphql'` and `graphql-http`'s internal `require('graphql')`
 * resolve to the same CommonJS instance. Vite honours `module`, so under Vitest
 * they resolve to two different instances and graphql-js throws
 * "Cannot use GraphQLSchema from another module or realm".
 *
 * Pinning the alias to the CommonJS entry makes the test environment resolve it
 * the way Node does, rather than papering over the difference.
 */
const graphqlCjs = require.resolve('graphql');

export default defineConfig({
  resolve: {
    alias: { graphql: graphqlCjs },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Zero latency and no injected failures: the suite tests orchestration logic,
    // and simulated network jitter would only make it slow and flaky. The
    // degradation path is tested by throwing from a mocked upstream instead.
    env: {
      NODE_ENV: 'test',
      UPSTREAM_LATENCY_MIN_MS: '0',
      UPSTREAM_LATENCY_MAX_MS: '0',
      BUDGET_SERVICE_FAILURE_RATE: '0',
    },
  },
});
