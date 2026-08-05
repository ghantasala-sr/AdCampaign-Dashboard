'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CampaignRow, SortableField, SortSpec } from '@adsight/types';
import { cn } from '@adsight/ui';

import {
  ROW_HEIGHT_COMFORTABLE,
  ROW_HEIGHT_COMPACT,
  gridTemplate,
  visibleColumns,
  type ColumnDef,
} from './columns';
import { CampaignRowCells } from './CampaignRowCells';

/**
 * The optimized table.
 *
 * Four things make it fast at 10,000 rows, in rough order of impact:
 *
 *   1. Virtualization — only the ~20 rows in view plus overscan are in the DOM.
 *      This is the difference between 10,000 row elements (each with 12 cells and
 *      an SVG) and about 25.
 *   2. Memoized rows — `CampaignRowCells` is `memo`'d, and the props it receives
 *      are referentially stable across renders, so scrolling re-renders the
 *      container but not the row contents.
 *   3. Module-level Intl formatters — see `@adsight/ui` format.ts. The naive
 *      version constructs a formatter per cell.
 *   4. A fixed row height — the virtualizer never has to measure, so there is no
 *      layout read in the scroll path.
 *
 * The baseline this is measured against lives in `CampaignTableNaive.tsx`.
 */

export interface CampaignTableProps {
  readonly rows: readonly CampaignRow[];
  readonly sort: SortSpec;
  readonly onSort: (field: SortableField) => void;
  readonly hiddenColumns: readonly string[];
  readonly density: 'comfortable' | 'compact';
  readonly hasNextPage?: boolean;
  readonly isFetchingNextPage?: boolean;
  readonly onLoadMore?: () => void;
  readonly className?: string;
}

export function CampaignTable({
  rows,
  sort,
  onSort,
  hiddenColumns,
  density,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  className,
}: CampaignTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Both memoized so `CampaignRowCells`'s memo comparison holds: a new array or
  // template string every render would make every row re-render regardless.
  const columns = useMemo(() => visibleColumns(hiddenColumns), [hiddenColumns]);
  const template = useMemo(() => gridTemplate(columns), [columns]);

  const rowHeight = density === 'compact' ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_COMFORTABLE;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // Constant, so the virtualizer never measures a row and the scroll path
    // contains no forced layout.
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 8,
  });

  const virtualRows = virtualizer.getVirtualItems();

  // Fetch the next page when the last rendered row is near the end, rather than
  // wiring a scroll listener — the virtualizer already knows the position.
  const lastIndex = virtualRows[virtualRows.length - 1]?.index ?? 0;
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || !onLoadMore) return;
    if (rows.length > 0 && lastIndex >= rows.length - 60) onLoadMore();
  }, [hasNextPage, isFetchingNextPage, lastIndex, onLoadMore, rows.length]);

  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0) + 32;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
        data-testid="campaign-table-scroll"
      >
        {/*
          A real ARIA grid rather than a bag of divs. `aria-rowcount` is the
          *total* row count, not the number currently in the DOM, so a screen
          reader reports "row 12 of 10,000" instead of "row 12 of 25" — the one
          piece of context virtualization would otherwise destroy.
        */}
        <div
          role="grid"
          aria-rowcount={rows.length + 1}
          aria-colcount={columns.length}
          style={{ minWidth: totalWidth }}
        >
          <TableHeader columns={columns} template={template} sort={sort} onSort={onSort} />

          {rows.length === 0 ? (
            <EmptyState />
          ) : (
            <div
              style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
              data-testid="campaign-table-body"
            >
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                return (
                  <div
                    key={row.campaign.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      // translateY rather than `top` keeps row positioning on the
                      // compositor instead of triggering layout on every frame.
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <CampaignRowCells
                      row={row}
                      columns={columns}
                      template={template}
                      height={rowHeight}
                      // 1-based, and offset by the header row.
                      rowIndex={virtualRow.index + 2}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {isFetchingNextPage ? (
            <div className="px-4 py-3 text-xs text-slate-500">Loading more campaigns…</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface TableHeaderProps {
  readonly columns: readonly ColumnDef[];
  readonly template: string;
  readonly sort: SortSpec;
  readonly onSort: (field: SortableField) => void;
}

function TableHeader({ columns, template, sort, onSort }: TableHeaderProps) {
  return (
    <div
      className="sticky top-0 z-10 grid items-center gap-4 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur-sm"
      style={{ gridTemplateColumns: template }}
      role="row"
      aria-rowindex={1}
    >
      {columns.map((column) => {
        const active = column.sortField !== undefined && sort.field === column.sortField;
        const sortable = column.sortField !== undefined;
        return (
          <div
            key={column.id}
            role="columnheader"
            // `aria-sort` is a columnheader property. Putting it on the inner
            // button — which has an implicit `button` role that does not support
            // it — means assistive technology never announces the sort at all.
            aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={cn(
              'min-w-0 truncate text-xs font-semibold tracking-wide text-slate-600 uppercase',
              column.align === 'right' && 'text-right',
            )}
          >
            {sortable ? (
              <button
                type="button"
                onClick={() => onSort(column.sortField!)}
                className={cn(
                  // `uppercase` is repeated here on purpose: Tailwind's preflight
                  // sets `text-transform: none` on button, so a sortable header
                  // would render mixed-case next to its non-sortable neighbours.
                  'inline-flex items-center gap-1 rounded uppercase hover:text-slate-900',
                  active && 'text-blue-700',
                )}
              >
                <span className="truncate">{column.header}</span>
                <span aria-hidden className={cn('text-[10px]', !active && 'opacity-0')}>
                  {sort.direction === 'asc' ? '▲' : '▼'}
                </span>
              </button>
            ) : (
              column.header
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-4 py-16 text-center" data-testid="campaign-table-empty">
      <p className="text-sm font-medium text-slate-700">No campaigns match these filters</p>
      <p className="mt-1 text-xs text-slate-500">
        Try widening the date range or clearing a metric threshold.
      </p>
    </div>
  );
}
