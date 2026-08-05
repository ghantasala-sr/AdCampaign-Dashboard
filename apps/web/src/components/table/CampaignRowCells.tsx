'use client';

import { memo } from 'react';
import Link from 'next/link';
import type { CampaignRow } from '@adsight/types';
import {
  CampaignStatusBadge,
  PacingBadge,
  ServingStatusBadge,
  Sparkline,
  cn,
} from '@adsight/ui';

import type { ColumnDef } from './columns';

/**
 * One table row.
 *
 * `memo` here is the single highest-leverage change in the optimized table.
 * Scrolling, sorting, hovering, and every unrelated store update re-render the
 * table body; without memoization each of those re-renders every mounted row's
 * cells. The comparison is by reference and the props are only `row`, `columns`,
 * and two primitives, so it holds as long as the caller does not rebuild those
 * arrays per render — which is why `visibleColumns` is memoized upstream and the
 * row array comes from a memoized flatten.
 */

export interface CampaignRowCellsProps {
  readonly row: CampaignRow;
  readonly columns: readonly ColumnDef[];
  readonly template: string;
  readonly height: number;
  /** 1-based position in the full result set, including the header row. */
  readonly rowIndex: number;
}

function renderCell(column: ColumnDef, row: CampaignRow) {
  switch (column.id) {
    case 'name':
      return (
        <Link
          href={`/campaigns/${row.campaign.id}`}
          className="truncate font-medium text-slate-900 hover:text-blue-700 hover:underline"
          title={row.campaign.name}
        >
          {row.campaign.name}
        </Link>
      );
    case 'status':
      return <CampaignStatusBadge status={row.campaign.status} />;
    case 'serving':
      return <ServingStatusBadge status={row.campaign.servingStatus} />;
    case 'pacing':
      return row.pacing ? (
        <PacingBadge state={row.pacing.pacingState} />
      ) : (
        <span className="text-xs text-slate-400">—</span>
      );
    case 'trend':
      return (
        <Sparkline
          values={row.sparkline}
          label={`Spend trend for ${row.campaign.name}`}
          width={80}
          height={18}
        />
      );
    default:
      return <span className="truncate tabular-nums">{column.value(row)}</span>;
  }
}

export const CampaignRowCells = memo(function CampaignRowCells({
  row,
  columns,
  template,
  height,
  rowIndex,
}: CampaignRowCellsProps) {
  return (
    <div
      role="row"
      // Absolute position in the result set, so virtualization does not make a
      // screen reader announce every row as if it were near the top.
      aria-rowindex={rowIndex}
      className="grid items-center gap-4 border-b border-slate-100 px-4 text-sm text-slate-700 hover:bg-slate-50"
      style={{ gridTemplateColumns: template, height }}
      data-testid="campaign-row"
      data-campaign-id={row.campaign.id}
    >
      {columns.map((column, columnIndex) => (
        <div
          key={column.id}
          role="gridcell"
          aria-colindex={columnIndex + 1}
          className={cn('min-w-0 truncate', column.align === 'right' && 'text-right')}
        >
          {renderCell(column, row)}
        </div>
      ))}
    </div>
  );
});
