import { Suspense } from 'react';

import { CampaignDetailView } from '@/components/CampaignDetailView';

export default async function CampaignDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading campaign…</div>}>
      <CampaignDetailView id={id} />
    </Suspense>
  );
}
