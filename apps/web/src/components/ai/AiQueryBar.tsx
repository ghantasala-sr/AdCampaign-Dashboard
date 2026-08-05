'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { Badge, Button, Card, CardHeader } from '@adsight/ui';

import { useAiPlannerStatus, useAiQuery } from '@/hooks/useAiQuery';
import { useAppDispatch } from '@/store/hooks';
import { viewActions } from '@/store/viewSlice';
import { PlanReview } from './PlanReview';

/**
 * Natural-language query bar.
 *
 * The rationale renders token-by-token as it streams, then the structured plan
 * appears below it for review. Applying dispatches a single `viewReplaced`
 * action — the same action URL hydration uses — so an AI-applied filter is
 * indistinguishable from a hand-built one downstream, including in the URL.
 */

const EXAMPLES = [
  'paused campaigns in Japan with spend over $2,000',
  'search tab campaigns with TTR below 2% last 7 days',
  'worst CPA in the US and Canada',
  'at least 5k impressions, at most 2% tap-through',
];

export function AiQueryBar() {
  const dispatch = useAppDispatch();
  const [input, setInput] = useState('');
  const { status, rationale, plan, source, error, submit, reset } = useAiQuery();
  const plannerStatus = useAiPlannerStatus();

  const onSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const trimmed = input.trim();
      if (trimmed.length < 2) return;
      void submit(trimmed);
    },
    [input, submit],
  );

  const onApply = useCallback(() => {
    if (!plan) return;
    dispatch(viewActions.viewReplaced({ filter: plan.filter, sort: plan.sort }));
    reset();
    setInput('');
  }, [dispatch, plan, reset]);

  const isStreaming = status === 'streaming';

  /**
   * The keyword planner streams exactly its own interpretation, so once the plan
   * lands the same sentence would appear twice — once here and once inside the
   * review panel. Claude streams a longer rationale that genuinely differs, so
   * the check is on the text rather than on which planner answered.
   */
  const showRationale =
    rationale.trim() !== '' && rationale.trim() !== (plan?.interpretation.trim() ?? '');

  const plannerLabel =
    plannerStatus.data?.source === 'model'
      ? (plannerStatus.data.model ?? 'model')
      : 'keyword fallback';

  return (
    <Card data-testid="ai-query-bar">
      <CardHeader
        title="Ask in plain language"
        description="The proposed filter is shown for review before anything changes."
        actions={
          <Badge tone={plannerStatus.data?.source === 'model' ? 'info' : 'neutral'}>
            {plannerLabel}
          </Badge>
        }
      />

      <div className="space-y-3 p-4">
        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="e.g. paused campaigns in Japan with spend over $2,000"
            aria-label="Natural language campaign query"
            className="h-9 min-w-0 flex-1 rounded-md bg-white px-3 text-sm ring-1 ring-slate-300 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            data-testid="ai-query-input"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={isStreaming || input.trim().length < 2}
            data-testid="ai-query-submit"
          >
            {isStreaming ? 'Thinking…' : 'Ask'}
          </Button>
        </form>

        {status === 'idle' ? (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setInput(example);
                  void submit(example);
                }}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200"
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}

        {showRationale ? (
          <p
            className="text-sm text-slate-600"
            data-testid="ai-rationale"
            aria-live="polite"
            aria-busy={isStreaming}
          >
            {rationale}
            {isStreaming ? (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-slate-400 align-middle" />
            ) : null}
          </p>
        ) : null}

        {error !== null ? (
          <p className="text-xs text-amber-700" data-testid="ai-error">
            {error}
          </p>
        ) : null}

        {plan !== null ? (
          <PlanReview
            plan={plan}
            onApply={onApply}
            onDiscard={() => {
              reset();
            }}
            isStreaming={isStreaming}
          />
        ) : null}

        {source === 'heuristic' && plan !== null ? (
          <p className="text-xs text-slate-400">
            Answered by the built-in keyword parser. Set <code>ANTHROPIC_API_KEY</code> on the API to
            use Claude.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
