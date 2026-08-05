'use client';

import dynamic from 'next/dynamic';

import { IS_BASELINE_BUILD } from './baseline';

type Module = typeof import('../ai/AiQueryBar');

/**
 * The AI panel is only rendered once the user opens it, so it does not belong in
 * the initial payload of the campaigns route.
 */
export const LazyAiQueryBar: Module['AiQueryBar'] = IS_BASELINE_BUILD
  ? (require('../ai/AiQueryBar') as Module).AiQueryBar
  : (dynamic(() => import('../ai/AiQueryBar').then((m) => m.AiQueryBar), {
      ssr: false,
      loading: () => (
        <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200 ring-inset">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
          <p className="mt-2 text-xs text-slate-400">Loading query panel…</p>
        </div>
      ),
    }) as Module['AiQueryBar']);
