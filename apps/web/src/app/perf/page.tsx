'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SortableField, SortSpec } from '@adsight/types';
import { Button, Card, CardHeader } from '@adsight/ui';

import { generatePerfRows } from '@/lib/perfFixture';
import { CampaignTable } from '@/components/table/CampaignTable';
import { CampaignTableNaive } from '@/components/table/CampaignTableNaive';
import { DEFAULT_HIDDEN_COLUMNS } from '@/components/table/columns';

/**
 * Measurement harness for the numbers in the README.
 *
 * Both implementations receive the same row array and render the same columns, so
 * the difference is rendering strategy alone. Three things are measured:
 *
 *   - mount: time from the render that mounts the table to the frame after paint,
 *     via a double `requestAnimationFrame`. Single-rAF would fire before the
 *     browser has laid out and painted, which flatters the naive version.
 *   - scroll: median and worst frame interval over a scripted scroll, plus how
 *     many frames exceeded 16.7ms. Average frame time hides the jank that
 *     actually shows up as stutter.
 *   - DOM nodes: element count inside the scroll container. The most direct
 *     explanation of why the other two numbers differ.
 *
 * Results are written to `window.__ADSIGHT_PERF__` so Playwright can drive this
 * page and record them; `scripts/run-perf.mjs` does exactly that.
 */

type Variant = 'optimized' | 'naive';

export interface PerfResult {
  readonly variant: Variant;
  readonly rowCount: number;
  readonly mountMs: number;
  readonly scrollTotalMs: number;
  readonly medianFrameMs: number;
  readonly worstFrameMs: number;
  readonly framesOver16ms: number;
  readonly frameCount: number;
  readonly domNodes: number;
}

declare global {
  interface Window {
    __ADSIGHT_PERF__?: {
      results: PerfResult[];
      run: (variant: Variant, rowCount: number) => Promise<PerfResult>;
      ready: boolean;
    };
  }
}

const ROW_COUNT_OPTIONS = [1_000, 5_000, 10_000] as const;

export default function PerfPage() {
  const [variant, setVariant] = useState<Variant>('optimized');
  const [rowCount, setRowCount] = useState<number>(10_000);
  const [mounted, setMounted] = useState(false);
  const [results, setResults] = useState<PerfResult[]>([]);
  const [status, setStatus] = useState('Idle');
  const [sort, setSort] = useState<SortSpec>({ field: 'spendCents', direction: 'desc' });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mountStartRef = useRef<number>(0);
  const mountResolveRef = useRef<((ms: number) => void) | null>(null);

  // Generated once per row count and shared by both variants.
  const rows = useMemo(() => generatePerfRows(rowCount), [rowCount]);

  const onSort = useCallback((field: SortableField) => {
    setSort((previous) => ({
      field,
      direction: previous.field === field && previous.direction === 'desc' ? 'asc' : 'desc',
    }));
  }, []);

  // Fires after the table has been committed and painted.
  useEffect(() => {
    if (!mounted) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const elapsed = performance.now() - mountStartRef.current;
        mountResolveRef.current?.(elapsed);
        mountResolveRef.current = null;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [mounted]);

  const measure = useCallback(
    async (nextVariant: Variant, nextRowCount: number): Promise<PerfResult> => {
      setStatus(`Measuring ${nextVariant} at ${nextRowCount.toLocaleString()} rows…`);

      // Unmount first so each run measures a cold mount rather than an update.
      setMounted(false);
      setVariant(nextVariant);
      setRowCount(nextRowCount);
      await nextFrame();
      await nextFrame();

      const mountMs = await new Promise<number>((resolve) => {
        mountResolveRef.current = resolve;
        mountStartRef.current = performance.now();
        setMounted(true);
      });

      // Let layout settle before touching scrollTop.
      await nextFrame();

      const scroll = await measureScroll(containerRef.current, nextVariant);
      const domNodes = countDomNodes(containerRef.current, nextVariant);

      const result: PerfResult = {
        variant: nextVariant,
        rowCount: nextRowCount,
        mountMs: round(mountMs),
        scrollTotalMs: round(scroll.totalMs),
        medianFrameMs: round(scroll.medianFrameMs),
        worstFrameMs: round(scroll.worstFrameMs),
        framesOver16ms: scroll.framesOver16ms,
        frameCount: scroll.frameCount,
        domNodes,
      };

      setResults((previous) => [...previous.filter((r) => !(r.variant === nextVariant && r.rowCount === nextRowCount)), result]);
      setStatus('Done');
      return result;
    },
    [],
  );

  // Expose the driver for the Playwright runner.
  useEffect(() => {
    window.__ADSIGHT_PERF__ = {
      results,
      run: measure,
      ready: true,
    };
    return () => {
      delete window.__ADSIGHT_PERF__;
    };
  }, [measure, results]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <Card>
        <CardHeader
          title="Render performance harness"
          description="Same rows, same columns, two rendering strategies. Numbers land in the README."
        />
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex rounded-md ring-1 ring-slate-300 ring-inset">
            {(['optimized', 'naive'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMounted(false);
                  setVariant(option);
                }}
                aria-pressed={variant === option}
                className={
                  variant === option
                    ? 'h-8 bg-slate-900 px-3 text-xs font-medium text-white first:rounded-l-md last:rounded-r-md'
                    : 'h-8 px-3 text-xs font-medium text-slate-600 first:rounded-l-md last:rounded-r-md hover:bg-slate-50'
                }
              >
                {option === 'optimized' ? 'Virtualized + memoized' : 'Naive (all rows)'}
              </button>
            ))}
          </div>

          <div className="flex rounded-md ring-1 ring-slate-300 ring-inset">
            {ROW_COUNT_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMounted(false);
                  setRowCount(option);
                }}
                aria-pressed={rowCount === option}
                className={
                  rowCount === option
                    ? 'h-8 bg-slate-900 px-3 text-xs font-medium text-white first:rounded-l-md last:rounded-r-md'
                    : 'h-8 px-3 text-xs font-medium text-slate-600 first:rounded-l-md last:rounded-r-md hover:bg-slate-50'
                }
              >
                {option.toLocaleString()}
              </button>
            ))}
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => void measure(variant, rowCount)}
            data-testid="perf-run"
          >
            Measure this variant
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await measure('naive', rowCount);
              await measure('optimized', rowCount);
            }}
            data-testid="perf-run-both"
          >
            Measure both
          </Button>

          <span className="text-xs text-slate-500" data-testid="perf-status">
            {status}
          </span>
        </div>

        {results.length > 0 ? (
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="w-full text-sm" data-testid="perf-results">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 font-semibold">Variant</th>
                  <th className="px-4 py-2 font-semibold">Rows</th>
                  <th className="px-4 py-2 text-right font-semibold">Mount</th>
                  <th className="px-4 py-2 text-right font-semibold">Scroll total</th>
                  <th className="px-4 py-2 text-right font-semibold">Median frame</th>
                  <th className="px-4 py-2 text-right font-semibold">Worst frame</th>
                  <th className="px-4 py-2 text-right font-semibold">Frames &gt;16ms</th>
                  <th className="px-4 py-2 text-right font-semibold">DOM nodes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.map((result) => (
                  <tr key={`${result.variant}-${result.rowCount}`}>
                    <td className="px-4 py-2">{result.variant}</td>
                    <td className="px-4 py-2 tabular-nums">{result.rowCount.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{result.mountMs} ms</td>
                    <td className="px-4 py-2 text-right tabular-nums">{result.scrollTotalMs} ms</td>
                    <td className="px-4 py-2 text-right tabular-nums">{result.medianFrameMs} ms</td>
                    <td className="px-4 py-2 text-right tabular-nums">{result.worstFrameMs} ms</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {result.framesOver16ms}/{result.frameCount}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {result.domNodes.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div ref={containerRef} className="flex min-h-0 flex-1 flex-col" data-testid="perf-host">
          {mounted ? (
            variant === 'optimized' ? (
              <CampaignTable
                rows={rows}
                sort={sort}
                onSort={onSort}
                hiddenColumns={DEFAULT_HIDDEN_COLUMNS}
                density="comfortable"
                className="min-h-0 flex-1"
              />
            ) : (
              <CampaignTableNaive
                rows={rows}
                sort={sort}
                onSort={onSort}
                hiddenColumns={DEFAULT_HIDDEN_COLUMNS}
                density="comfortable"
              />
            )
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-sm text-slate-500">
              Table unmounted. Press a measure button to mount and time it.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function scrollSelector(variant: Variant): string {
  return variant === 'optimized'
    ? '[data-testid="campaign-table-scroll"]'
    : '[data-testid="campaign-table-scroll-naive"]';
}

function countDomNodes(host: HTMLElement | null, variant: Variant): number {
  const scroller = host?.querySelector(scrollSelector(variant));
  if (!scroller) return 0;
  return scroller.querySelectorAll('*').length;
}

interface ScrollMeasurement {
  readonly totalMs: number;
  readonly medianFrameMs: number;
  readonly worstFrameMs: number;
  readonly framesOver16ms: number;
  readonly frameCount: number;
}

/**
 * Scripted scroll: 30 steps down the scrollable height, one per animation frame,
 * recording the interval between frames. Driving it from rAF means the numbers
 * reflect what the browser could actually deliver rather than how fast a loop
 * can set `scrollTop`.
 */
async function measureScroll(
  host: HTMLElement | null,
  variant: Variant,
): Promise<ScrollMeasurement> {
  const scroller = host?.querySelector(scrollSelector(variant)) as HTMLElement | null;
  const empty: ScrollMeasurement = {
    totalMs: 0,
    medianFrameMs: 0,
    worstFrameMs: 0,
    framesOver16ms: 0,
    frameCount: 0,
  };
  if (!scroller) return empty;

  const distance = scroller.scrollHeight - scroller.clientHeight;
  if (distance <= 0) return empty;

  const steps = 30;
  const intervals: number[] = [];
  const startedAt = performance.now();
  let previous = startedAt;

  for (let step = 1; step <= steps; step += 1) {
    scroller.scrollTop = Math.round((distance * step) / steps);
    await nextFrame();
    const now = performance.now();
    intervals.push(now - previous);
    previous = now;
  }

  const totalMs = performance.now() - startedAt;
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;

  return {
    totalMs,
    medianFrameMs: median,
    worstFrameMs: sorted[sorted.length - 1] ?? 0,
    framesOver16ms: intervals.filter((ms) => ms > 16.7).length,
    frameCount: intervals.length,
  };
}
