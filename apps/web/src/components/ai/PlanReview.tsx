'use client';

import type { FilterPlan } from '@adsight/types';
import { Badge, Button, cn } from '@adsight/ui';

/**
 * The review step.
 *
 * This component is the reason the feature is worth building. The model's output
 * is rendered as a list of plain-language chips describing exactly what will
 * change, and nothing happens to the view until the user presses Apply. Three
 * details make the review real rather than decorative:
 *
 *   - Every chip is derived from the *same* filter object that will be applied,
 *     so the preview cannot drift from the effect.
 *   - `unsupported` is shown as prominently as the chips. A planner that quietly
 *     drops half a request is worse than one that says it could not do it.
 *   - Low confidence is surfaced, not hidden, and does not change the mechanics —
 *     the user still decides.
 */

export interface PlanReviewProps {
  readonly plan: FilterPlan;
  readonly onApply: () => void;
  readonly onDiscard: () => void;
  readonly isStreaming?: boolean;
}

const CONFIDENCE_TONE = {
  high: 'positive',
  medium: 'warning',
  low: 'critical',
} as const;

export function PlanReview({ plan, onApply, onDiscard, isStreaming = false }: PlanReviewProps) {
  const hasUnsupported = plan.unsupported.length > 0;

  return (
    <div
      className="rounded-md border border-blue-200 bg-blue-50/60 p-3"
      data-testid="plan-review"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wide text-blue-900 uppercase">
              Proposed filter
            </span>
            <Badge tone={CONFIDENCE_TONE[plan.confidence]}>{plan.confidence} confidence</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-700">{plan.interpretation}</p>
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-1.5" data-testid="plan-chips">
        {plan.changes.map((change) => (
          <li key={`${change.path}:${change.label}`}>
            <span className="inline-flex items-center rounded bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200 ring-inset">
              {change.label}
            </span>
          </li>
        ))}
      </ul>

      {hasUnsupported ? (
        <div
          className="mt-3 rounded border border-amber-200 bg-amber-50 px-2.5 py-2"
          data-testid="plan-unsupported"
        >
          <p className="text-xs font-semibold text-amber-900">Not applied</p>
          <ul className="mt-1 space-y-0.5">
            {plan.unsupported.map((item) => (
              <li key={item} className="text-xs text-amber-800">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={onApply}
          disabled={isStreaming}
          data-testid="plan-apply"
        >
          Apply filter
        </Button>
        <Button variant="ghost" size="sm" onClick={onDiscard} data-testid="plan-discard">
          Discard
        </Button>
        <span className={cn('ml-auto text-xs text-slate-500', isStreaming && 'animate-pulse')}>
          {isStreaming ? 'Still generating…' : 'Nothing is applied until you choose'}
        </span>
      </div>
    </div>
  );
}
