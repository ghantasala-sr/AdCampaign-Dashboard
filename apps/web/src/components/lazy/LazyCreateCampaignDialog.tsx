'use client';

import dynamic from 'next/dynamic';

import { IS_BASELINE_BUILD } from './baseline';

type Module = typeof import('../CreateCampaignDialog');

/** Only mounted after "New campaign" is pressed. */
export const LazyCreateCampaignDialog: Module['CreateCampaignDialog'] = IS_BASELINE_BUILD
  ? (require('../CreateCampaignDialog') as Module).CreateCampaignDialog
  : (dynamic(() => import('../CreateCampaignDialog').then((m) => m.CreateCampaignDialog), {
      ssr: false,
    }) as Module['CreateCampaignDialog']);
