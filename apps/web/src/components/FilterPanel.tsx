'use client';

import { useState } from 'react';
import type { MetricComparator, SortableMetric } from '@adsight/types';
import { Button, cn, humanizeEnum } from '@adsight/ui';

import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { viewActions } from '@/store/viewSlice';
import { selectFilter } from '@/store/selectors';
import { useFacets } from '@/hooks/useCampaigns';
import { COLUMNS } from './table/columns';
import { useAppSelector as useSel } from '@/store/hooks';
import { selectHiddenColumns } from '@/store/selectors';

const METRIC_OPTIONS: ReadonlyArray<{ value: SortableMetric; label: string; hint: string }> = [
  { value: 'spendCents', label: 'Spend', hint: 'dollars' },
  { value: 'impressions', label: 'Impressions', hint: 'count' },
  { value: 'taps', label: 'Taps', hint: 'count' },
  { value: 'installs', label: 'Installs', hint: 'count' },
  { value: 'redownloads', label: 'Redownloads', hint: 'count' },
  { value: 'ttr', label: 'Tap-through rate', hint: '%' },
  { value: 'conversionRate', label: 'Conversion rate', hint: '%' },
  { value: 'avgCPT', label: 'Avg CPT', hint: 'dollars' },
  { value: 'avgCPA', label: 'Avg CPA', hint: 'dollars' },
  { value: 'avgCPM', label: 'Avg CPM', hint: 'dollars' },
];

const COMPARATORS: ReadonlyArray<{ value: MetricComparator; label: string }> = [
  { value: 'gt', label: 'over' },
  { value: 'gte', label: 'at least' },
  { value: 'lt', label: 'under' },
  { value: 'lte', label: 'at most' },
];

const RATE_METRICS = new Set<SortableMetric>(['ttr', 'conversionRate']);

export function FilterPanel() {
  const dispatch = useAppDispatch();
  const filter = useAppSelector(selectFilter);
  const hiddenColumns = useSel(selectHiddenColumns);
  const facets = useFacets();

  return (
    <aside
      className="w-72 shrink-0 space-y-5 overflow-y-auto border-r border-slate-200 bg-white p-4"
      aria-label="Filters"
      data-testid="filter-panel"
    >
      <Group label="Status">
        {(['ENABLED', 'PAUSED'] as const).map((status) => (
          <CheckRow
            key={status}
            label={humanizeEnum(status)}
            checked={filter.statuses.includes(status)}
            onChange={() => dispatch(viewActions.statusToggled(status))}
          />
        ))}
      </Group>

      <Group label="Serving" hint="Enabled campaigns can still be not delivering">
        {(['RUNNING', 'NOT_RUNNING'] as const).map((status) => (
          <CheckRow
            key={status}
            label={humanizeEnum(status)}
            checked={filter.servingStatuses.includes(status)}
            onChange={() => dispatch(viewActions.servingStatusToggled(status))}
          />
        ))}
      </Group>

      <Group label="Supply source">
        {(facets.data?.supplySources ?? []).map((source) => (
          <CheckRow
            key={source}
            label={humanizeEnum(source)}
            checked={filter.supplySources.includes(source)}
            onChange={() => dispatch(viewActions.supplySourceToggled(source))}
          />
        ))}
      </Group>

      <Group label="Country or region">
        <div className="flex flex-wrap gap-1">
          {(facets.data?.countriesOrRegions ?? []).map((country) => {
            const active = filter.countriesOrRegions.includes(country);
            return (
              <button
                key={country}
                type="button"
                onClick={() => dispatch(viewActions.countryToggled(country))}
                aria-pressed={active}
                className={cn(
                  'rounded px-2 py-1 text-xs font-medium ring-1 ring-inset',
                  active
                    ? 'bg-blue-600 text-white ring-blue-600'
                    : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50',
                )}
              >
                {country}
              </button>
            );
          })}
        </div>
      </Group>

      <Group label="Performance thresholds">
        <MetricPredicateEditor />
        {filter.metricPredicates.length > 0 ? (
          <ul className="mt-2 space-y-1" data-testid="active-predicates">
            {filter.metricPredicates.map((predicate, index) => {
              const meta = METRIC_OPTIONS.find((m) => m.value === predicate.metric);
              const comparator = COMPARATORS.find((c) => c.value === predicate.comparator);
              const display = RATE_METRICS.has(predicate.metric)
                ? `${(predicate.value * 100).toFixed(2)}%`
                : meta?.hint === 'dollars'
                  ? `$${predicate.value.toLocaleString('en-US')}`
                  : predicate.value.toLocaleString('en-US');
              return (
                <li
                  key={`${predicate.metric}-${index}`}
                  className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs"
                >
                  <span className="text-slate-700">
                    {meta?.label} {comparator?.label} {display}
                  </span>
                  <button
                    type="button"
                    onClick={() => dispatch(viewActions.metricPredicateRemoved(index))}
                    className="ml-2 text-slate-400 hover:text-rose-600"
                    aria-label={`Remove ${meta?.label} threshold`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Group>

      <Group label="Columns">
        {COLUMNS.map((column) => (
          <CheckRow
            key={column.id}
            label={column.header}
            checked={!hiddenColumns.includes(column.id)}
            onChange={() => dispatch(viewActions.columnToggled(column.id))}
          />
        ))}
      </Group>
    </aside>
  );
}

function MetricPredicateEditor() {
  const dispatch = useAppDispatch();
  const [metric, setMetric] = useState<SortableMetric>('spendCents');
  const [comparator, setComparator] = useState<MetricComparator>('gt');
  const [value, setValue] = useState('');

  const isRate = RATE_METRICS.has(metric);
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        dispatch(
          viewActions.metricPredicateAdded({
            metric,
            comparator,
            // Rates are stored as fractions; the input collects percentages.
            value: isRate ? parsed / 100 : parsed,
          }),
        );
        setValue('');
      }}
    >
      <select
        value={metric}
        onChange={(event) => setMetric(event.target.value as SortableMetric)}
        aria-label="Metric"
        className="h-8 w-full rounded border-0 bg-white px-2 text-xs ring-1 ring-slate-300 ring-inset"
      >
        {METRIC_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="flex gap-1.5">
        <select
          value={comparator}
          onChange={(event) => setComparator(event.target.value as MetricComparator)}
          aria-label="Comparator"
          className="h-8 w-24 rounded border-0 bg-white px-2 text-xs ring-1 ring-slate-300 ring-inset"
        >
          {COMPARATORS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="decimal"
          placeholder={isRate ? '2.5' : '1000'}
          aria-label="Threshold value"
          className="h-8 min-w-0 flex-1 rounded bg-white px-2 text-xs ring-1 ring-slate-300 ring-inset"
          data-testid="predicate-value"
        />
        <span className="flex h-8 items-center text-xs text-slate-400">
          {isRate ? '%' : METRIC_OPTIONS.find((m) => m.value === metric)?.hint === 'dollars' ? '$' : '#'}
        </span>
      </div>
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        disabled={!valid}
        className="w-full"
        data-testid="add-predicate"
      >
        Add threshold
      </Button>
    </form>
  );
}

function Group({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</h3>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
      <div className="mt-1.5 space-y-1">{children}</div>
    </section>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}
