'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SortableField } from '@adsight/types';
import { Button, TableSkeleton } from '@adsight/ui';

import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { viewActions } from '@/store/viewSlice';
import {
  selectAiPanelOpen,
  selectDensity,
  selectFilterPanelOpen,
  selectHiddenColumns,
  selectSort,
} from '@/store/selectors';
import { useCampaigns, useFacets } from '@/hooks/useCampaigns';
import { useUrlSync } from '@/hooks/useUrlSync';
import { Toolbar } from './Toolbar';
import { FilterPanel } from './FilterPanel';
import { SummaryBar } from './SummaryBar';
import { DegradedBanner } from './DegradedBanner';
import { CampaignTable } from './table/CampaignTable';
import { LazyAiQueryBar } from './lazy/LazyAiQueryBar';
import { LazyCreateCampaignDialog } from './lazy/LazyCreateCampaignDialog';

export function CampaignsView() {
  useUrlSync();

  const router = useRouter();
  const dispatch = useAppDispatch();
  const sort = useAppSelector(selectSort);
  const density = useAppSelector(selectDensity);
  const hiddenColumns = useAppSelector(selectHiddenColumns);
  const filterPanelOpen = useAppSelector(selectFilterPanelOpen);
  const aiPanelOpen = useAppSelector(selectAiPanelOpen);

  const [createOpen, setCreateOpen] = useState(false);
  const facets = useFacets();
  const {
    rows,
    totals,
    total,
    meta,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useCampaigns();

  // Stable across renders so the table's memoized rows are not invalidated by a
  // fresh callback identity on every parent render.
  const onSort = useCallback(
    (field: SortableField) => dispatch(viewActions.sortRequested(field)),
    [dispatch],
  );
  const onLoadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  if (error) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-lg rounded-lg border border-rose-200 bg-rose-50 p-4">
          <h2 className="text-sm font-semibold text-rose-900">Could not load campaigns</h2>
          <p className="mt-1 text-sm text-rose-800">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <p className="mt-2 text-xs text-rose-700">
            Start the API with <code className="font-mono">npm run dev</code> at the repo root, and
            make sure <code className="font-mono">npm run seed</code> has been run once.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar onNewCampaign={() => setCreateOpen(true)} dataWindow={facets.data?.dataWindow} />

      {meta ? <DegradedBanner degraded={meta.degraded} /> : null}

      <SummaryBar totals={totals} total={total} meta={meta} isLoading={isLoading} />

      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <Button
          variant={aiPanelOpen ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => dispatch(viewActions.aiPanelToggled())}
          aria-expanded={aiPanelOpen}
          data-testid="toggle-ai"
        >
          Ask a question
        </Button>
        <span className="text-xs text-slate-400">
          Describe what you want to see; review the filter before it applies.
        </span>
      </div>

      {aiPanelOpen ? (
        <div className="border-b border-slate-200 bg-slate-50 p-4">
          <LazyAiQueryBar />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {filterPanelOpen ? <FilterPanel /> : null}

        <div className="flex min-h-0 flex-1 flex-col bg-white">
          {isLoading ? (
            <TableSkeleton rows={16} columns={9} />
          ) : (
            <CampaignTable
              rows={rows}
              sort={sort}
              onSort={onSort}
              hiddenColumns={hiddenColumns}
              density={density}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={onLoadMore}
              className="min-h-0 flex-1"
            />
          )}

          <footer className="flex shrink-0 items-center gap-3 border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
            <span data-testid="row-count">
              {rows.length.toLocaleString('en-US')} of {total.toLocaleString('en-US')} loaded
            </span>
            {meta ? (
              <span className="text-slate-400">
                {meta.resolvedDateRange.start} → {meta.resolvedDateRange.end}
              </span>
            ) : null}
            {hasNextPage ? (
              <span className="text-slate-400">Scroll to load more</span>
            ) : (
              <span className="text-slate-400">All rows loaded</span>
            )}
          </footer>
        </div>
      </div>

      <LazyCreateCampaignDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => router.push(`/campaigns/${id}`)}
      />
    </div>
  );
}
