import { cn } from '../lib/cn.js';

export interface SkeletonProps {
  readonly className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded bg-slate-200', className)} aria-hidden />;
}

export interface TableSkeletonProps {
  readonly rows?: number;
  readonly columns?: number;
}

export function TableSkeleton({ rows = 12, columns = 8 }: TableSkeletonProps) {
  return (
    <div className="divide-y divide-slate-100" role="status" aria-label="Loading campaigns">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-2.5">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn('h-3', c === 0 ? 'w-56' : 'w-16')} />
          ))}
        </div>
      ))}
    </div>
  );
}
