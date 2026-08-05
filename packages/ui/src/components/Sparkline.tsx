import { memo } from 'react';
import { cn } from '../lib/cn.js';

export interface SparklineProps {
  readonly values: readonly number[];
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
  /** Rendered as the accessible label; the SVG itself is presentational. */
  readonly label?: string;
}

/**
 * Builds a single SVG path string. One `<path>` per row rather than one element
 * per point: at 10k rows a 30-point-per-row circle-based sparkline would add
 * 300k DOM nodes, which is the difference between a table that scrolls and one
 * that doesn't.
 */
function buildPath(values: readonly number[], width: number, height: number): string {
  const n = values.length;
  if (n === 0) return '';
  if (n === 1) {
    const y = (height / 2).toFixed(2);
    return `M0,${y}L${width},${y}`;
  }

  let min = values[0]!;
  let max = values[0]!;
  for (let i = 1; i < n; i += 1) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // A flat series should render as a centred line, not divide by zero.
  const span = max - min;
  const stepX = width / (n - 1);
  // Inset by 1px top and bottom so a peak isn't clipped by the viewBox edge.
  const usableHeight = height - 2;

  let path = '';
  for (let i = 0; i < n; i += 1) {
    const x = i * stepX;
    const normalized = span === 0 ? 0.5 : (values[i]! - min) / span;
    const y = 1 + (1 - normalized) * usableHeight;
    path += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return path;
}

export const Sparkline = memo(function Sparkline({
  values,
  width = 72,
  height = 20,
  className,
  label,
}: SparklineProps) {
  const path = buildPath(values, width, height);
  const trendingUp = values.length > 1 && values[values.length - 1]! >= values[0]!;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={trendingUp ? 'text-emerald-500' : 'text-rose-400'}
      />
    </svg>
  );
});
