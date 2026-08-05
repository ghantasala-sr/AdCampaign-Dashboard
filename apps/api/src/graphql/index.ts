import { createHandler } from 'graphql-http/lib/use/express';
import type { RequestHandler } from 'express';

import { getSchema } from './schema.js';
import { createContext, rootValue } from './resolvers.js';

/**
 * `graphql-http` rather than Apollo Server: this endpoint is a few hundred lines
 * of schema over an aggregator that already exists, and does not need a
 * gateway's worth of dependencies to prove the point.
 */
export function createGraphQLHandler(): RequestHandler {
  return createHandler({
    schema: getSchema(),
    rootValue,
    // A fresh loader set per request — batching must never span users.
    context: () => createContext(),
    formatError: (error) => {
      if (process.env.NODE_ENV !== 'production') {
        process.stderr.write(`[graphql] ${String(error)}\n`);
      }
      return error;
    },
  });
}
