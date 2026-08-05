'use client';

import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FilterPlan, QueryStreamEvent, QuerySource } from '@adsight/types';

import { API_BASE, fetchAiStatus } from '@/lib/api';
import { useAppSelector } from '@/store/hooks';
import { selectFilter, selectSort } from '@/store/selectors';

/**
 * Drives the natural-language query stream.
 *
 * Deliberately *not* a React Query mutation: the value of this call is the
 * partial output that arrives while it runs, and a mutation only surfaces the
 * final result. `fetch` + a `ReadableStream` reader gives token-level updates;
 * React Query still owns the one cacheable part, which planner is configured.
 *
 * The plan is held here and never auto-applied. Applying it is a separate,
 * explicit dispatch from the component — the whole point of the feature.
 */

export interface AiQueryState {
  readonly status: 'idle' | 'streaming' | 'ready' | 'error';
  readonly rationale: string;
  readonly plan: FilterPlan | null;
  readonly source: QuerySource | null;
  readonly error: string | null;
}

const INITIAL: AiQueryState = {
  status: 'idle',
  rationale: '',
  plan: null,
  source: null,
  error: null,
};

export function useAiPlannerStatus() {
  return useQuery({
    queryKey: ['ai', 'status'],
    queryFn: ({ signal }) => fetchAiStatus(signal),
    staleTime: Infinity,
    retry: false,
  });
}

export function useAiQuery() {
  const [state, setState] = useState<AiQueryState>(INITIAL);
  const filter = useAppSelector(selectFilter);
  const sort = useAppSelector(selectSort);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  const submit = useCallback(
    async (query: string): Promise<void> => {
      // A second submit supersedes the first; without this the two streams
      // interleave tokens into the same rationale string.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ ...INITIAL, status: 'streaming' });

      try {
        const response = await fetch(`${API_BASE}/api/ai/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, currentFilter: filter, currentSort: sort }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          setState({
            ...INITIAL,
            status: 'error',
            error:
              response.status === 400
                ? 'That query was too short or too long to interpret.'
                : `The query service returned ${response.status}.`,
          });
          return;
        }

        await consumeEventStream(response.body, (event) => {
          setState((previous) => reduceEvent(previous, event));
        });
      } catch (error) {
        if (controller.signal.aborted) return; // superseded or unmounted
        setState({
          ...INITIAL,
          status: 'error',
          error: error instanceof Error ? error.message : 'The query failed.',
        });
      }
    },
    [filter, sort],
  );

  return { ...state, submit, reset };
}

function reduceEvent(previous: AiQueryState, event: QueryStreamEvent): AiQueryState {
  switch (event.type) {
    case 'start':
      return { ...previous, status: 'streaming', source: event.source };
    case 'token':
      return { ...previous, rationale: previous.rationale + event.text };
    case 'plan':
      return { ...previous, plan: event.plan, status: 'ready' };
    case 'error':
      // A recoverable error is followed by a fallback plan, so stay in
      // `streaming` and let the plan event finish the exchange.
      return event.recoverable
        ? { ...previous, error: event.message }
        : { ...previous, status: 'error', error: event.message };
    case 'done':
      return previous.status === 'ready' || previous.plan !== null
        ? { ...previous, status: 'ready' }
        : { ...previous, status: 'error', error: previous.error ?? 'No plan was produced.' };
  }
}

/**
 * Minimal SSE reader.
 *
 * `EventSource` cannot POST, and the request carries the current filter as a
 * body, so the stream is parsed by hand. Frames are separated by a blank line
 * and may be split across chunks, which is what the buffer is for.
 */
async function consumeEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: QueryStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const payload = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (payload !== '') {
        try {
          onEvent(JSON.parse(payload) as QueryStreamEvent);
        } catch {
          // A malformed frame is not worth tearing down the stream for.
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}
