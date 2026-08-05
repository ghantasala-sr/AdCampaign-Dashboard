import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface StatTileProps {
  readonly label: string;
  readonly value: string;
  readonly secondary?: string;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function StatTile({ label, value, secondary, children, className }: StatTileProps) {
  return (
    <div className={cn('px-4 py-3', className)}>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-slate-900">{value}</span>
        {secondary ? <span className="text-xs text-slate-500">{secondary}</span> : null}
      </dd>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
