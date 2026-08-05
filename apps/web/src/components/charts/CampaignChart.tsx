'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricPoint } from '@adsight/types';
import { cn, formatCompact, formatShortDate } from '@adsight/ui';

/**
 * Drill-in time series.
 *
 * Recharts is the single largest dependency in the app, and it is only ever
 * needed on this route — which is why it is reached through `lazy.tsx` rather
 * than imported directly. Isolating it in its own module is what makes that
 * split possible.
 */

type Series = 'spend' | 'installs' | 'taps' | 'impressions';

const SERIES: ReadonlyArray<{ key: Series; label: string; color: string }> = [
  { key: 'spend', label: 'Spend', color: 'var(--color-blue-500)' },
  { key: 'installs', label: 'Installs', color: 'var(--color-emerald-500)' },
  { key: 'taps', label: 'Taps', color: 'var(--color-amber-500)' },
  { key: 'impressions', label: 'Impressions', color: 'var(--color-slate-400)' },
];

export interface CampaignChartProps {
  readonly points: readonly MetricPoint[];
}

export function CampaignChart({ points }: CampaignChartProps) {
  const [active, setActive] = useState<Series>('spend');

  const data = useMemo(
    () =>
      points.map((point) => ({
        date: point.date,
        label: formatShortDate(point.date),
        spend: point.spendCents / 100,
        installs: point.installs,
        taps: point.taps,
        impressions: point.impressions,
      })),
    [points],
  );

  const series = SERIES.find((s) => s.key === active) ?? SERIES[0]!;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {SERIES.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setActive(option.key)}
            aria-pressed={active === option.key}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
              active === option.key
                ? 'bg-slate-900 text-white ring-slate-900'
                : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`fill-${series.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={series.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={series.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--color-slate-200)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--color-slate-500)' }}
              stroke="var(--color-slate-200)"
              // A 90-day window has too many labels to read; show every nth.
              interval={Math.max(0, Math.floor(data.length / 8) - 1)}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--color-slate-500)' }}
              stroke="var(--color-slate-200)"
              width={52}
              tickFormatter={(value: number) =>
                active === 'spend' ? `$${formatCompact(value)}` : formatCompact(value)
              }
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: 'var(--color-slate-200)' }}
              formatter={(value: number) => [
                active === 'spend'
                  ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                  : value.toLocaleString('en-US'),
                series.label,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area
              type="monotone"
              dataKey={series.key}
              name={series.label}
              stroke={series.color}
              fill={`url(#fill-${series.key})`}
              strokeWidth={1.75}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
