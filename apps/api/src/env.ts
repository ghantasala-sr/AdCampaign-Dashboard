import { z } from 'zod';

/**
 * Config is read once at boot and validated, so a typo in an env var fails at
 * startup rather than on the first request that happens to touch it.
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Comma-separated allowlist. `*` allows any origin (dev only). */
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  /**
   * Claude is reached through Vertex AI, so there is no API key: authentication
   * is Google Application Default Credentials — the runtime service account on
   * Cloud Run, or `gcloud auth application-default login` locally.
   *
   * Absent project id means the AI query bar falls back to the deterministic
   * parser, which is why the app runs with no configuration at all.
   */
  VERTEX_PROJECT_ID: z.string().min(1).optional(),
  /** Verified region for the Gemini Flash models; `global` also works. */
  VERTEX_REGION: z.string().min(1).default('us-central1'),

  /**
   * Alternative to Vertex: an API key from aistudio.google.com, which has a
   * genuinely free tier. Same SDK, same model family, no GCP project required —
   * useful for running the planner locally without touching cloud credentials.
   *
   * Checked before Vertex, so setting it overrides the ADC path.
   */
  GEMINI_API_KEY: z.string().min(1).optional(),

  /**
   * Flash rather than Pro: this is a short structured-extraction task where
   * latency is what the user feels. `gemini-2.5-flash-lite` is cheaper again if
   * the query bar is getting heavy use.
   */
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  /**
   * Simulated upstream latency. Set both to 0 in tests so the suite is fast and
   * not flaky; the default values make the loading states visible in dev.
   */
  UPSTREAM_LATENCY_MIN_MS: z.coerce.number().int().min(0).default(8),
  UPSTREAM_LATENCY_MAX_MS: z.coerce.number().int().min(0).default(45),
  /** Probability the budget service fails, exercising the degraded-banner path. */
  BUDGET_SERVICE_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.06),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test hook: re-reads `process.env` on the next `getEnv()`. */
export function resetEnvCache(): void {
  cached = null;
}

export function corsOrigins(env: Env): string[] | true {
  if (env.CORS_ORIGIN.trim() === '*') return true;
  return env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}
