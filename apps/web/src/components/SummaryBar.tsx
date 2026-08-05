'use client';

import type { MetricSummary, ResponseMeta } from '@adsight/types';
import { Skeleton, StatTile, formatCentsAsCurrency, formatCompact, formatRate, formatRatio } from '@adsight/ui';

/**
 * Totals across the whole filtered set, not just the loaded pages — the BFF
 * computes them before paging, which is why they stay correct as you scroll.
 */
export interface SummaryBarProps {
  readonly totals?: MetricSummary;
  readonly total: number;
  readonly meta?: ResponseMeta;
  readonly isLoading: boolean;
}

export function SummaryBar({ totals, total, meta, isLoading }: SummaryBarProps) {
  if (isLoading || !totals) {
    return (
      <dl className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-6 w-24" />
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl
      className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-6"
      data-testid="summary-bar"
    >
      <StatTile
        label="Campaigns"
        value={total.toLocaleString('en-US')}
        secondary={meta ? `${meta.durationMs}ms` : undefined}
      />
      <StatTile label="Spend" value={formatCentsAsCurrency(totals.spendCents)} />
      <StatTile label="Impressions" value={formatCompact(totals.impressions)} />
      <StatTile label="Taps" value={formatCompact(totals.taps)} secondary={formatRatio(totals.ttr)} />
      <StatTile
        label="Installs"
        value={formatCompact(totals.installs)}
        secondary={formatRatio(totals.conversionRate)}
      />
      <StatTile label="Avg CPA" value={formatRate(totals.avgCPA)} />
    </dl>
  );
}
