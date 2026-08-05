'use client';

import type { DegradedUpstream } from '@adsight/types';

/**
 * Surfaces partial upstream failure without blocking the view.
 *
 * The BFF returns rows with `pacing: null` when the budget service is down and
 * names it in `meta.degraded`. Showing that explicitly is the difference between
 * "this column is empty" and "this column is empty *and we know why*" — the
 * alternative is a user filing a bug about missing data.
 */

const LABELS: Readonly<Record<DegradedUpstream, string>> = {
  campaignService: 'campaign configuration',
  reportingService: 'reporting',
  catalogService: 'app catalog',
  budgetService: 'budget pacing',
};

export function DegradedBanner({ degraded }: { readonly degraded: readonly DegradedUpstream[] }) {
  if (degraded.length === 0) return null;

  const names = degraded.map((d) => LABELS[d]).join(' and ');

  return (
    <div
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"
      role="status"
      data-testid="degraded-banner"
    >
      <span className="font-medium">Partial data.</span> The {names} service did not respond, so
      those columns are blank. Everything else is current.
    </div>
  );
}
