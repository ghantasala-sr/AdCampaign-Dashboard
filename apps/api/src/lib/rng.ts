/**
 * Deterministic PRNG (mulberry32). The seed script and the fixture loader both
 * use this so `npm run seed` produces byte-identical output on every machine —
 * which is what lets CI regenerate the 18MB metrics file instead of committing it.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a. Used to derive a stable per-entity seed from its id. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniform element. Throws on an empty list so a bad fixture fails loudly. */
  pick<T>(items: readonly T[]): T;
  /** `count` distinct elements, or all of them if count exceeds the list. */
  sample<T>(items: readonly T[], count: number): T[];
  /** Approximately normal via sum of uniforms (Irwin–Hall, n=4). */
  normal(mean: number, stdDev: number): number;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);

  const rng: Rng = {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min, max) {
      return min + next() * (max - min);
    },
    chance(p) {
      return next() < p;
    },
    pick(items) {
      if (items.length === 0) throw new Error('rng.pick called with an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    sample(items, count) {
      if (count >= items.length) return [...items];
      const pool = [...items];
      const out: typeof pool = [];
      for (let i = 0; i < count; i += 1) {
        const idx = Math.floor(next() * pool.length);
        out.push(pool[idx]!);
        pool.splice(idx, 1);
      }
      return out;
    },
    normal(mean, stdDev) {
      const sum = next() + next() + next() + next();
      // Irwin–Hall(4) has mean 2 and variance 1/3.
      return mean + ((sum - 2) / Math.sqrt(1 / 3)) * stdDev;
    },
  };

  return rng;
}
