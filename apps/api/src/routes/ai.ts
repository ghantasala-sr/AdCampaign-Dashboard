import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_SORT, EMPTY_FILTER, SORTABLE_FIELDS } from '@adsight/types';
import type { CampaignFilter, QueryStreamEvent, SortSpec } from '@adsight/types';

import { planQuery, plannerSource } from '../ai/planner.js';
import { sendValidationError } from './errors.js';

/**
 * SSE rather than a websocket: the stream is one-directional, short-lived, and
 * needs to survive a proxy — and `EventSource` semantics mean the client gets
 * reconnect handling for free. The response is a sequence of
 * `QueryStreamEvent` frames, the same discriminated union the client switches on.
 */
export const aiRouter: Router = Router();

const filterSchema = z.object({
  search: z.string().max(200).default(''),
  statuses: z.array(z.enum(['ENABLED', 'PAUSED'])).default([]),
  servingStatuses: z.array(z.enum(['RUNNING', 'NOT_RUNNING'])).default([]),
  supplySources: z
    .array(
      z.enum([
        'APPSTORE_SEARCH_RESULTS',
        'APPSTORE_SEARCH_TAB',
        'APPSTORE_TODAY_TAB',
        'APPSTORE_PRODUCT_PAGES_BROWSE',
      ]),
    )
    .default([]),
  countriesOrRegions: z.array(z.string()).default([]),
  metricPredicates: z
    .array(
      z.object({
        metric: z.string(),
        comparator: z.enum(['gt', 'gte', 'lt', 'lte']),
        value: z.number(),
      }),
    )
    .default([]),
  dateRange: z
    .object({
      preset: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
    })
    .default(EMPTY_FILTER.dateRange),
});

const requestSchema = z.object({
  query: z.string().trim().min(2, 'Enter a question or filter').max(500),
  currentFilter: filterSchema.optional(),
  currentSort: z
    .object({
      field: z.string(),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
});

function coerceSort(input: { field: string; direction: 'asc' | 'desc' } | undefined): SortSpec {
  if (!input) return DEFAULT_SORT;
  if (!(SORTABLE_FIELDS as readonly string[]).includes(input.field)) return DEFAULT_SORT;
  return { field: input.field as SortSpec['field'], direction: input.direction };
}

aiRouter.get('/ai/status', (_req, res) => {
  res.json({
    source: plannerSource(),
    // The UI labels the panel differently depending on which planner answers, so
    // it needs to know before the first query rather than after.
    model: plannerSource() === 'model' ? 'claude-opus-5' : null,
  });
});

aiRouter.post('/ai/query', async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    sendValidationError(res, first?.message ?? 'Invalid request', {
      query: first?.message ?? 'Invalid request',
    });
    return;
  }

  const currentFilter = (parsed.data.currentFilter ?? EMPTY_FILTER) as CampaignFilter;
  const currentSort = coerceSort(parsed.data.currentSort);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Defeats nginx response buffering, which otherwise delivers the whole stream
  // at once and makes token-by-token rendering pointless behind a proxy.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Must be `res`, not `req`: a request whose body has been fully read emits
  // 'close' immediately, which would suppress every frame before it is written.
  // `res` closes only when the connection actually goes away.
  let clientGone = false;
  res.on('close', () => {
    clientGone = true;
  });

  const send = (event: QueryStreamEvent): void => {
    if (clientGone) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    for await (const event of planQuery(parsed.data.query, currentFilter, currentSort)) {
      if (clientGone) break;
      send(event);
    }
  } catch (error) {
    // Headers are already sent, so a 500 is not an option — report in-band.
    process.stderr.write(
      `[ai] stream aborted: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    send({ type: 'error', message: 'The query stream ended unexpectedly.', recoverable: false });
  } finally {
    if (!clientGone) res.end();
  }
});
