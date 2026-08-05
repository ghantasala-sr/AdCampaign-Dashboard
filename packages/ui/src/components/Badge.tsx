import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type BadgeTone = 'neutral' | 'positive' | 'warning' | 'critical' | 'info';

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  positive: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  critical: 'bg-rose-50 text-rose-700 ring-rose-200',
  info: 'bg-blue-50 text-blue-700 ring-blue-200',
};

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
  /** Renders a small leading dot. Useful for status badges. */
  readonly dot?: boolean;
}

export function Badge({ tone = 'neutral', children, className, dot = false }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden /> : null}
      {children}
    </span>
  );
}
