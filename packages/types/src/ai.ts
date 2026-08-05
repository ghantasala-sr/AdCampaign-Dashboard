/**
 * Natural-language query protocol.
 *
 * The design point: the model never mutates the view. It proposes a
 * `FilterPlan`, the UI renders that plan as reviewable chips, and the filter is
 * applied only after the user accepts. The SSE event stream below is what makes
 * that reviewable — the rationale streams as prose while the structured filter
 * arrives as a separate, typed event.
 */

import type { CampaignFilter, SortSpec } from './filters.js';

/** A single change the model wants to make, in language the user can check. */
export interface PlanChange {
  /** Dotted path into CampaignFilter, e.g. "statuses" or "metricPredicates[0]". */
  readonly path: string;
  /** Human-readable description of the change, e.g. "Status is Paused". */
  readonly label: string;
}

export interface FilterPlan {
  /** The complete filter to apply if accepted. Replaces, never merges. */
  readonly filter: CampaignFilter;
  readonly sort: SortSpec;
  readonly changes: readonly PlanChange[];
  /** One sentence on how the query was read. Shown above the chips. */
  readonly interpretation: string;
  /** Parts of the query the planner could not express as a filter. */
  readonly unsupported: readonly string[];
  readonly confidence: 'high' | 'medium' | 'low';
}

export type QuerySource = 'model' | 'heuristic';

/** SSE frames, discriminated on `type`. */
export type QueryStreamEvent =
  | { readonly type: 'start'; readonly source: QuerySource }
  /** Incremental rationale text. Concatenate in arrival order. */
  | { readonly type: 'token'; readonly text: string }
  /** The structured proposal. Arrives once, after the rationale. */
  | { readonly type: 'plan'; readonly plan: FilterPlan }
  | { readonly type: 'error'; readonly message: string; readonly recoverable: boolean }
  | { readonly type: 'done' };

export interface QueryRequest {
  readonly query: string;
  /** Current filter, so the planner can express relative edits ("also exclude…"). */
  readonly currentFilter: CampaignFilter;
}
