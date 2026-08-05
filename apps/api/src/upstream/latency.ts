import { getEnv } from '../env.js';
import { createRng, hashString } from '../lib/rng.js';

/**
 * Simulated network cost for the fixture upstream clients.
 *
 * The point is not realism for its own sake: without it the BFF's fan-out is
 * indistinguishable from four function calls, and the client never shows a
 * loading state. With it, `Promise.all` vs. sequential awaits is a measurable
 * difference, and the React Query cache visibly earns its keep.
 */
export async function simulateLatency(label: string): Promise<void> {
  const env = getEnv();
  if (env.UPSTREAM_LATENCY_MAX_MS === 0) return;

  const min = Math.min(env.UPSTREAM_LATENCY_MIN_MS, env.UPSTREAM_LATENCY_MAX_MS);
  const max = Math.max(env.UPSTREAM_LATENCY_MIN_MS, env.UPSTREAM_LATENCY_MAX_MS);
  // Jitter is keyed on the label plus wall-clock so repeated calls differ, but a
  // single request's timing profile stays in a believable band.
  const rng = createRng(hashString(label) ^ (Date.now() & 0xffff));
  const delay = min + rng.next() * (max - min);
  await new Promise((resolve) => setTimeout(resolve, Math.round(delay)));
}

/** Error type the aggregator recognises as "degrade, don't fail". */
export class UpstreamUnavailableError extends Error {
  constructor(
    public readonly upstream: string,
    message?: string,
  ) {
    super(message ?? `${upstream} is unavailable`);
    this.name = 'UpstreamUnavailableError';
  }
}

/** Rolls the configured failure rate for a flaky upstream. */
export function maybeFail(upstream: string, rate: number): void {
  if (rate <= 0) return;
  if (Math.random() < rate) throw new UpstreamUnavailableError(upstream);
}
