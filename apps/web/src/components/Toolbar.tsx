'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DateRangePreset } from '@adsight/types';
import { Badge, Button, cn } from '@adsight/ui';

import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { viewActions } from '@/store/viewSlice';
import {
  selectActiveFilterCount,
  selectDateRange,
  selectDensity,
  selectFilter,
  selectFilterPanelOpen,
} from '@/store/selectors';

const PRESETS: ReadonlyArray<{ value: DateRangePreset; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'LAST_7_DAYS', label: '7 days' },
  { value: 'LAST_14_DAYS', label: '14 days' },
  { value: 'LAST_30_DAYS', label: '30 days' },
  { value: 'LAST_90_DAYS', label: '90 days' },
];

export interface ToolbarProps {
  readonly onNewCampaign: () => void;
  readonly dataWindow?: { readonly start: string; readonly end: string };
}

export function Toolbar({ onNewCampaign, dataWindow }: ToolbarProps) {
  const dispatch = useAppDispatch();
  const filter = useAppSelector(selectFilter);
  const dateRange = useAppSelector(selectDateRange);
  const density = useAppSelector(selectDensity);
  const filterPanelOpen = useAppSelector(selectFilterPanelOpen);
  const activeFilters = useAppSelector(selectActiveFilterCount);

  // Stable identity: `SearchInput` debounces in an effect keyed on this callback,
  // so an inline arrow would re-arm the timer on every unrelated re-render and
  // could postpone the search indefinitely while the user types.
  const onSearchChange = useCallback(
    (value: string) => dispatch(viewActions.searchChanged(value)),
    [dispatch],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
      <SearchInput value={filter.search} onChange={onSearchChange} />

      <div className="flex items-center rounded-md ring-1 ring-slate-300 ring-inset" role="group" aria-label="Date range">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => dispatch(viewActions.dateRangePresetChanged(preset.value))}
            aria-pressed={dateRange.preset === preset.value}
            className={cn(
              'h-8 px-2.5 text-xs font-medium first:rounded-l-md last:rounded-r-md',
              dateRange.preset === preset.value
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-50',
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <Button
        variant={filterPanelOpen ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => dispatch(viewActions.filterPanelToggled())}
        aria-expanded={filterPanelOpen}
        data-testid="toggle-filters"
      >
        Filters
        {activeFilters > 0 ? (
          <Badge tone={filterPanelOpen ? 'neutral' : 'info'} className="ml-1">
            {activeFilters}
          </Badge>
        ) : null}
      </Button>

      {activeFilters > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dispatch(viewActions.filtersCleared())}
          data-testid="clear-filters"
        >
          Clear
        </Button>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {dataWindow ? (
          <span className="hidden text-xs text-slate-400 lg:inline">
            Data through {dataWindow.end}
          </span>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            dispatch(
              viewActions.densityChanged(density === 'compact' ? 'comfortable' : 'compact'),
            )
          }
          aria-label={`Switch to ${density === 'compact' ? 'comfortable' : 'compact'} rows`}
        >
          {density === 'compact' ? 'Comfortable' : 'Compact'}
        </Button>

        <Button variant="primary" size="sm" onClick={onNewCampaign} data-testid="new-campaign">
          New campaign
        </Button>
      </div>
    </div>
  );
}

/**
 * Debounced locally so each keystroke does not become a Redux dispatch, a new
 * query key, a refetch, and a URL write. The input stays controlled by local
 * state for responsiveness; the store receives the settled value.
 */
function SearchInput({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // Keeps the box in sync when the value changes from elsewhere — URL hydration,
  // an applied AI plan, or Clear.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = useCallback(
    (next: string) => {
      setDraft(next);
    },
    [],
  );

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), 250);
    return () => clearTimeout(timer);
  }, [draft, onChange, value]);

  return (
    <input
      value={draft}
      onChange={(event) => commit(event.target.value)}
      placeholder="Search campaigns"
      aria-label="Search campaigns by name"
      className="h-8 w-56 rounded-md bg-white px-2.5 text-sm ring-1 ring-slate-300 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
      data-testid="search-input"
    />
  );
}
