import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FilterPlan } from '@adsight/types';
import { EMPTY_FILTER } from '@adsight/types';

import { PlanReview } from './PlanReview';

/**
 * The review gate.
 *
 * The single most important property of the AI feature is that a plan does
 * nothing until a person accepts it. That is a behavioural claim, so it gets a
 * behavioural test: render a plan, assert no callback fires on its own, and
 * assert the user's decision is what triggers the change.
 */

function makePlan(overrides: Partial<FilterPlan> = {}): FilterPlan {
  return {
    filter: { ...EMPTY_FILTER, statuses: ['PAUSED'], countriesOrRegions: ['JP'] },
    sort: { field: 'avgCPA', direction: 'desc' },
    changes: [
      { path: 'statuses', label: 'Status is Paused' },
      { path: 'countriesOrRegions', label: 'Targets JP' },
      { path: 'sort', label: 'Sorted by Avg CPA, highest first' },
    ],
    interpretation: 'Read as a filter on status and country.',
    unsupported: [],
    confidence: 'high',
    ...overrides,
  };
}

describe('PlanReview', () => {
  it('does not apply anything on render', async () => {
    const onApply = vi.fn();
    render(<PlanReview plan={makePlan()} onApply={onApply} onDiscard={vi.fn()} />);

    // Rendering a proposal must never be the same as accepting it.
    expect(onApply).not.toHaveBeenCalled();
    expect(await screen.findByTestId('plan-review')).toBeInTheDocument();
  });

  it('shows every proposed change as a readable chip', () => {
    render(<PlanReview plan={makePlan()} onApply={vi.fn()} onDiscard={vi.fn()} />);

    // The chips are the review surface; field names would make them unreviewable.
    expect(screen.getByText('Status is Paused')).toBeInTheDocument();
    expect(screen.getByText('Targets JP')).toBeInTheDocument();
    expect(screen.getByText('Sorted by Avg CPA, highest first')).toBeInTheDocument();
  });

  it('states the interpretation and confidence', () => {
    render(<PlanReview plan={makePlan({ confidence: 'low' })} onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText('Read as a filter on status and country.')).toBeInTheDocument();
    expect(screen.getByText('low confidence')).toBeInTheDocument();
  });

  it('applies only when the user presses Apply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<PlanReview plan={makePlan()} onApply={onApply} onDiscard={vi.fn()} />);

    await user.click(screen.getByTestId('plan-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('discards without applying', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onDiscard = vi.fn();
    render(<PlanReview plan={makePlan()} onApply={onApply} onDiscard={onDiscard} />);

    await user.click(screen.getByTestId('plan-discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('surfaces what the planner could not do, as prominently as what it could', async () => {
    render(
      <PlanReview
        plan={makePlan({
          unsupported: ['This view can filter campaigns but not modify them'],
        })}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    // A planner that silently drops half a request is worse than one that says so.
    const panel = screen.getByTestId('plan-unsupported');
    expect(panel).toHaveTextContent('not modify them');
  });

  it('blocks Apply while the plan is still being generated', async () => {
    render(<PlanReview plan={makePlan()} onApply={vi.fn()} onDiscard={vi.fn()} isStreaming />);
    // Accepting a half-streamed plan would apply a filter the user has not seen.
    expect(screen.getByTestId('plan-apply')).toBeDisabled();
    expect(screen.getByText(/Still generating/)).toBeInTheDocument();
  });
});
