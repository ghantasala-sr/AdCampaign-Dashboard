/**
 * Model-backed planner, running Gemini Flash.
 *
 * Streams the rationale as it is generated, then emits one validated
 * `FilterPlan`. The rationale arrives as text parts; the filter arrives as a
 * function call, which the SDK parses for us — so this file never hand-parses
 * partial JSON.
 *
 * Two ways in, both through the same SDK:
 *
 *   - Vertex AI (`VERTEX_PROJECT_ID`) — authenticates as the Cloud Run runtime
 *     service account via Application Default Credentials. No API key exists
 *     anywhere, and Gemini needs no Model Garden grant, unlike Claude.
 *   - AI Studio (`GEMINI_API_KEY`) — a genuinely free tier, no GCP project.
 *
 * Falls back to the deterministic parser when neither is configured, and also
 * when the model errors or returns no usable call, so the bar never dead-ends.
 */

import { GoogleGenAI } from '@google/genai';
import type { CampaignFilter, FilterPlan, QueryStreamEvent, SortSpec } from '@adsight/types';

import { getEnv } from '../env.js';
import { planFromHeuristic } from './heuristic.js';
import { rawPlanSchema, toFilterPlan } from './planShape.js';
import {
  PLANNER_TOOL_NAME,
  buildSystemPrompt,
  buildUserPrompt,
  geminiToolSchema,
} from './prompt.js';

let client: GoogleGenAI | null = null;

interface PlannerConfig {
  readonly client: GoogleGenAI;
  readonly model: string;
}

/**
 * Null when no credentials are configured, which is the signal to use the
 * keyword planner. Cached because the Vertex constructor resolves Application
 * Default Credentials, a metadata-server round trip on Cloud Run.
 */
function getPlanner(): PlannerConfig | null {
  const env = getEnv();

  if (!client) {
    if (env.GEMINI_API_KEY) {
      client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    } else if (env.VERTEX_PROJECT_ID) {
      client = new GoogleGenAI({
        vertexai: true,
        project: env.VERTEX_PROJECT_ID,
        location: env.VERTEX_REGION,
      });
    } else {
      return null;
    }
  }

  return { client, model: env.GEMINI_MODEL };
}

export function plannerSource(): 'model' | 'heuristic' {
  const env = getEnv();
  return env.GEMINI_API_KEY || env.VERTEX_PROJECT_ID ? 'model' : 'heuristic';
}

/** Model identifier for `/api/ai/status`, or null when the heuristic answers. */
export function plannerModel(): string | null {
  return plannerSource() === 'model' ? getEnv().GEMINI_MODEL : null;
}

/** Which credential path is in use, for the boot banner. */
export function plannerTransport(): 'vertex' | 'ai-studio' | 'none' {
  const env = getEnv();
  if (env.GEMINI_API_KEY) return 'ai-studio';
  if (env.VERTEX_PROJECT_ID) return 'vertex';
  return 'none';
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
  const planner = getPlanner();

  if (!planner) {
    yield* heuristicStream(query, currentFilter, currentSort);
    return;
  }

  yield { type: 'start', source: 'model' };

  try {
    const plan = yield* streamFromModel(planner, query, currentFilter, currentSort);
    if (plan) {
      yield { type: 'plan', plan };
      yield { type: 'done' };
      return;
    }
    yield {
      type: 'error',
      message: 'The assistant did not return a usable filter. Falling back to keyword matching.',
      recoverable: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ai] Gemini planner failed, falling back to heuristic: ${message}\n`);
    yield {
      type: 'error',
      message: 'The assistant is unavailable. Falling back to keyword matching.',
      recoverable: true,
    };
  }

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

  // Paced so the streaming UI is exercised identically with and without a model —
  // otherwise the no-credentials path would silently skip the token rendering.
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
  { client: ai, model }: PlannerConfig,
  query: string,
  currentFilter: CampaignFilter,
  currentSort: SortSpec,
): AsyncGenerator<QueryStreamEvent, FilterPlan | null> {
  const stream = await ai.models.generateContentStream({
    model,
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(query, currentFilter) }] }],
    config: {
      systemInstruction: buildSystemPrompt(),
      maxOutputTokens: 2048,
      tools: [
        {
          functionDeclarations: [
            {
              name: PLANNER_TOOL_NAME,
              description: 'Propose a campaign filter for the user to review. Call exactly once.',
              // `parametersJsonSchema` takes real JSON Schema, unlike the older
              // `parameters` field which wants Gemini's own OpenAPI subset.
              parametersJsonSchema: geminiToolSchema,
            },
          ],
        },
      ],
      // Deliberately not forcing the call with `functionCallingConfig.mode: ANY`.
      // Forcing it suppresses the text parts, and the streamed prose is the whole
      // point of the feature — a plan that appears with no explanation is not
      // reviewable. The prompt asks for prose then a call, and the fallback below
      // covers the case where the model skips the call anyway.
    },
  });

  const calls: Array<{ name?: string; args?: unknown }> = [];

  for await (const chunk of stream) {
    // Reading `.text` when a chunk also carries a functionCall makes the SDK log
    // a warning, so the parts are walked directly instead.
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part.text === 'string' && part.text !== '') {
        yield { type: 'token', text: part.text };
      }
      if (part.functionCall) calls.push(part.functionCall);
    }
  }

  const call = calls.find((c) => c.name === PLANNER_TOOL_NAME);
  if (!call) return null;

  const parsed = rawPlanSchema.safeParse(call.args);
  if (!parsed.success) {
    process.stderr.write(
      `[ai] tool input failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}\n`,
    );
    return null;
  }

  return toFilterPlan(parsed.data, currentFilter, currentSort);
}

/** Test hook. */
export function resetPlannerClient(): void {
  client = null;
}
