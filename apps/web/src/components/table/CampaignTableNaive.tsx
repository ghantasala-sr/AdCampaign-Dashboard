'use client';

import type { CampaignRow, SortableField, SortSpec } from '@adsight/types';

import { COLUMNS, ROW_HEIGHT_COMFORTABLE, ROW_HEIGHT_COMPACT } from './columns';

/**
 * The baseline the optimized table is measured against.
 *
 * This is not a straw man — every choice here is one I have seen in production
 * React, and each is individually defensible until the row count grows:
 *
 *   1. Every row is rendered. Correct, simple, and works fine at 200 rows.
 *   2. Rows are a plain function component, not memoized. Nothing is obviously
 *      wrong until you notice the whole body re-renders on any parent update.
 *   3. `new Intl.NumberFormat(...)` per cell. This is what you get from writing
 *      the formatting inline where it is used, which is the natural first draft.
 *   4. The sparkline draws one `<circle>` per point. Easier to reason about than
 *      a path string, and 30 circles per row is nothing — until it is 300,000.
 *   5. Column visibility and the grid template are recomputed inline each render.
 *
 * It renders the same columns, the same data, and the same visual result as the
 * optimized table, so a measurement between the two isolates rendering strategy
 * rather than comparing different amounts of work. Numbers are in the README;
 * the harness is `/perf`.
 */

export interface CampaignTableNaiveProps {
  readonly rows: readonly CampaignRow[];
  readonly sort: SortSpec;
  readonly onSort: (field: SortableField) => void;
  readonly hiddenColumns: readonly string[];
  readonly density: 'comfortable' | 'compact';
}

function naiveFormatNumber(value: number): string {
  // A fresh formatter per call — the whole point of the baseline.
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

function naiveFormatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function naiveFormatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function NaiveSparkline({ values }: { readonly values: readonly number[] }) {
  const width = 80;
  const height = 18;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      {values.map((value, i) => (
        <circle
          key={i}
          cx={(i / Math.max(values.length - 1, 1)) * width}
          cy={height - ((value - min) / span) * height}
          r={1}
          fill="currentColor"
          className="text-emerald-500"
        />
      ))}
    </svg>
  );
}

function NaiveRow({
  row,
  hiddenColumns,
  height,
}: {
  readonly row: CampaignRow;
  readonly hiddenColumns: readonly string[];
  readonly height: number;
}) {
  // Recomputed per row, per render.
  const columns = COLUMNS.filter((column) => !hiddenColumns.includes(column.id));
  const template = columns.map((column) => `${column.width}px`).join(' ');

  return (
    <div
      className="grid items-center gap-4 border-b border-slate-100 px-4 text-sm text-slate-700"
      style={{ gridTemplateColumns: template, height }}
      data-testid="campaign-row-naive"
    >
      {columns.map((column) => {
        let content: React.ReactNode;
        switch (column.id) {
          case 'name':
            content = <span className="truncate font-medium">{row.campaign.name}</span>;
            break;
          case 'status':
            content = <span className="text-xs">{row.campaign.status}</span>;
            break;
          case 'serving':
            content = <span className="text-xs">{row.campaign.servingStatus}</span>;
            break;
          case 'app':
            content = <span className="truncate">{row.app?.appName ?? '—'}</span>;
            break;
          case 'spend':
            content = <span className="tabular-nums">{naiveFormatCurrency(row.metrics.spendCents)}</span>;
            break;
          case 'impressions':
            content = <span className="tabular-nums">{naiveFormatNumber(row.metrics.impressions)}</span>;
            break;
          case 'taps':
            content = <span className="tabular-nums">{naiveFormatNumber(row.metrics.taps)}</span>;
            break;
          case 'installs':
            content = <span className="tabular-nums">{naiveFormatNumber(row.metrics.installs)}</span>;
            break;
          case 'redownloads':
            content = <span className="tabular-nums">{naiveFormatNumber(row.metrics.redownloads)}</span>;
            break;
          case 'ttr':
            content = <span className="tabular-nums">{naiveFormatPercent(row.metrics.ttr)}</span>;
            break;
          case 'conversionRate':
            content = <span className="tabular-nums">{naiveFormatPercent(row.metrics.conversionRate)}</span>;
            break;
          case 'avgCPA':
            content = <span className="tabular-nums">{naiveFormatCurrency(row.metrics.avgCPA * 100)}</span>;
            break;
          case 'avgCPT':
            content = <span className="tabular-nums">{naiveFormatCurrency(row.metrics.avgCPT * 100)}</span>;
            break;
          case 'avgCPM':
            content = <span className="tabular-nums">{naiveFormatCurrency(row.metrics.avgCPM * 100)}</span>;
            break;
          case 'pacing':
            content = <span className="text-xs">{row.pacing?.pacingState ?? '—'}</span>;
            break;
          case 'trend':
            content = <NaiveSparkline values={row.sparkline} />;
            break;
          default:
            content = <span className="truncate">{column.value(row)}</span>;
        }
        return (
          <div
            key={column.id}
            className={column.align === 'right' ? 'min-w-0 truncate text-right' : 'min-w-0 truncate'}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function CampaignTableNaive({
  rows,
  sort,
  onSort,
  hiddenColumns,
  density,
}: CampaignTableNaiveProps) {
  const columns = COLUMNS.filter((column) => !hiddenColumns.includes(column.id));
  const template = columns.map((column) => `${column.width}px`).join(' ');
  const rowHeight = density === 'compact' ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_COMFORTABLE;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto" data-testid="campaign-table-scroll-naive">
        <div style={{ minWidth: columns.reduce((sum, c) => sum + c.width, 0) + 32 }}>
          <div
            className="sticky top-0 z-10 grid items-center gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((column) => (
              <div
                key={column.id}
                className={
                  column.align === 'right'
                    ? 'min-w-0 truncate text-right text-xs font-semibold uppercase text-slate-600'
                    : 'min-w-0 truncate text-xs font-semibold uppercase text-slate-600'
                }
              >
                {column.sortField ? (
                  <button
                    type="button"
                    className="uppercase"
                    onClick={() => onSort(column.sortField!)}
                  >
                    {column.header}
                    {sort.field === column.sortField ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                ) : (
                  column.header
                )}
              </div>
            ))}
          </div>

          <div data-testid="campaign-table-body-naive">
            {rows.map((row) => (
              <NaiveRow
                key={row.campaign.id}
                row={row}
                hiddenColumns={hiddenColumns}
                height={rowHeight}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
