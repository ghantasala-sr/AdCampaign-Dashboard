import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/**
 * Extends the div attributes so `data-*`, `id`, `role` and handlers reach the
 * element. Without the spread they are accepted by TypeScript and then silently
 * dropped — `<Card data-testid="…">` compiled fine and produced no attribute,
 * which cost a debugging session chasing a selector that could never match.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
  readonly className?: string;
}

export function Card({ children, className, ...rest }: CardProps) {
  return (
    <div
      className={cn('rounded-lg bg-white ring-1 ring-slate-200 ring-inset shadow-xs', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function CardHeader({ title, description, actions, className }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
