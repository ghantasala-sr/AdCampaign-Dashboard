/**
 * Model-backed planner.
 *
 * Streams the rationale as it is generated, then emits one validated
 * `FilterPlan`. The rationale arrives as ordinary text blocks; the filter
 * arrives as a single strict tool call, which the SDK accumulates and parses for
 * us — so this file never hand-parses partial JSON.
 *
 * Falls back to the deterministic parser when no API key is configured, and also
 * when the model errors or refuses, so the query bar never dead-ends.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CampaignFilter, FilterPlan, QueryStreamEvent, SortSpec } from '@adsight/types';

import { getEnv } from '../env.js';
import { planFromHeuristic } from './heuristic.js';
import { rawPlanSchema, toFilterPlan } from './planShape.js';
import {
  PLANNER_TOOL_NAME,
  buildSystemPrompt,
  buildUserPrompt,
  plannerToolSchema,
} from './prompt.js';

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 2048;
/** Server-side refusal fallback. Opt-in per Anthropic's guidance for Opus 5. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let client: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

export function plannerSource(): 'model' | 'heuristic' {
  return getEnv().ANTHROPIC_API_KEY ? 'model' : 'heuristic';
}

/**
 * Yields stream events for one query.
 *
 * An async generator rather than a callback: the route can pipe it straight to
 * SSE, and the tests can collect it into an array without a fake server.
 */
export async function* planQuery(
  query: string,
  currentFilter: CampaignFilter,
  currentSort: SortSpec,
): AsyncGenerator<QueryStreamEvent> {
  const apiKey = getEnv().ANTHROPIC_API_KEY;

  if (!apiKey) {
    yield* heuristicStream(query, currentFilter, currentSort);
    return;
  }

  yield { type: 'start', source: 'model' };

  try {
    const plan = yield* streamFromModel(apiKey, query, currentFilter, currentSort);
    if (plan) {
      yield { type: 'plan', plan };
      yield { type: 'done' };
      return;
    }
    // The model produced no usable tool call (refusal, or it just wrote prose).
    yield {
      type: 'error',
      message: 'The assistant did not return a usable filter. Falling back to keyword matching.',
      recoverable: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ai] planner failed, falling back to heuristic: ${message}\n`);
    yield {
      type: 'error',
      message: 'The assistant is unavailable. Falling back to keyword matching.',
      recoverable: true,
    };
  }

  // Either path above that did not return still owes the caller a plan.
  const fallback = planFromHeuristic(query, currentFilter, currentSort);
  yield { type: 'plan', plan: fallback };
  yield { type: 'done' };
}

async function* heuristicStream(
  query: string,
  currentFilter: CampaignFilter,
  currentSort: SortSpec,
): AsyncGenerator<QueryStreamEvent> {
  yield { type: 'start', source: 'heuristic' };
  const plan = planFromHeuristic(query, currentFilter, currentSort);

  // Paced so the streaming UI is exercised identically with and without a key —
  // otherwise the no-key path would silently skip the code that renders tokens.
  for (const chunk of chunkText(plan.interpretation)) {
    yield { type: 'token', text: chunk };
    await new Promise((resolve) => setTimeout(resolve, 12));
  }

  yield { type: 'plan', plan };
  yield { type: 'done' };
}

/** Splits on word boundaries so the paced output reads like generated text. */
function chunkText(text: string): string[] {
  return text.split(/(?<=\s)/);
}

async function* streamFromModel(
  apiKey: string,
  query: string,
  currentFilter: CampaignFilter,
  currentSort: SortSpec,
): AsyncGenerator<QueryStreamEvent, FilterPlan | null> {
  const anthropic = getClient(apiKey);

  const params = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(),
    messages: [{ role: 'user' as const, content: buildUserPrompt(query, currentFilter) }],
    // `strict` guarantees the tool input validates against the schema, which
    // removes a whole class of "the model returned a string for value" handling.
    tools: [
      {
        name: PLANNER_TOOL_NAME,
        description:
          'Propose a campaign filter for the user to review. Call exactly once.',
        input_schema: plannerToolSchema,
        strict: true,
      },
    ],
    tool_choice: { type: 'tool' as const, name: PLANNER_TOOL_NAME },
    // Low effort keeps a query bar responsive. Thinking is deliberately left at
    // its default (on): disabling it on Opus 5 can make the model emit a tool
    // call as plain text, which would silently break this planner.
    output_config: { effort: 'low' as const },
  };

  const stream = await openStream(anthropic, params);

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta' &&
      event.delta.text !== ''
    ) {
      yield { type: 'token', text: event.delta.text };
    }
  }

  // `openStream` can return either the beta or the non-beta stream, whose
  // content unions differ even though the wire shape is identical. Rather than
  // branch on SDK types, narrow once to the two fields this function reads.
  const message = (await stream.finalMessage()) as unknown as {
    stop_reason: string | null;
    content: ReadonlyArray<{ type: string; name?: string; input?: unknown }>;
  };

  if (message.stop_reason === 'refusal') {
    process.stderr.write('[ai] planner request was refused by safety classifiers\n');
    return null;
  }

  const toolUse = message.content.find(
    (block) => block.type === 'tool_use' && block.name === PLANNER_TOOL_NAME,
  );
  if (!toolUse) return null;

  const parsed = rawPlanSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    process.stderr.write(
      `[ai] tool input failed validation: ${parsed.error.issues.map((i) => i.message).join('; ')}\n`,
    );
    return null;
  }

  return toFilterPlan(parsed.data, currentFilter, currentSort);
}

type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];

/**
 * Opens the stream with server-side refusal fallback enabled, retrying once
 * without it if the beta is not available on this account. The feature is a
 * recommended default for Opus 5, but an account that lacks it should degrade to
 * a working query bar rather than a 400.
 */
async function openStream(anthropic: Anthropic, params: Record<string, unknown>) {
  try {
    return anthropic.beta.messages.stream({
      ...params,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    } as unknown as StreamParams);
  } catch (error) {
    process.stderr.write(
      `[ai] refusal fallback unavailable (${
        error instanceof Error ? error.message : String(error)
      }); retrying without it\n`,
    );
    return anthropic.messages.stream(params as never);
  }
}

/** Test hook. */
export function resetPlannerClient(): void {
  client = null;
}
