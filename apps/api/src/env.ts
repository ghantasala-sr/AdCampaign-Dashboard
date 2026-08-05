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
  /** Absent means the AI query bar falls back to the deterministic parser. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
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
