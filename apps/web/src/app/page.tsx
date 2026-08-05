import { Suspense } from 'react';

import { CampaignsView } from '@/components/CampaignsView';

/**
 * `useSearchParams` inside the view requires a Suspense boundary for static
 * rendering; without it Next bails the whole route out to dynamic.
 */
export default function CampaignsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading campaigns…</div>}>
      <CampaignsView />
    </Suspense>
  );
}
