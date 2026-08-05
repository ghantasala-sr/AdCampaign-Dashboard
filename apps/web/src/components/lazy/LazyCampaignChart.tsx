'use client';

import dynamic from 'next/dynamic';

import { IS_BASELINE_BUILD } from './baseline';

type Module = typeof import('../charts/CampaignChart');

/**
 * Recharts is the largest dependency in the app at ~108 KB gzip. It is only ever
 * rendered on the drill-in route, and this module is the only thing that
 * references it — which is what keeps it out of every other route's payload.
 */
export const LazyCampaignChart: Module['CampaignChart'] = IS_BASELINE_BUILD
  ? (require('../charts/CampaignChart') as Module).CampaignChart
  : (dynamic(() => import('../charts/CampaignChart').then((m) => m.CampaignChart), {
      ssr: false,
      loading: () => <div className="h-64 w-full animate-pulse rounded bg-slate-100" />,
    }) as Module['CampaignChart']);
