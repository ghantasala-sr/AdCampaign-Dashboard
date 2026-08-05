/**
 * Whether this build is the un-optimized baseline. See `lazy/README.md`.
 *
 * Next inlines `process.env.NEXT_PUBLIC_PERF_BASELINE` as a string literal at
 * build time, so this constant folds and the untaken branch in each lazy module
 * is eliminated.
 */
export const IS_BASELINE_BUILD = process.env.NEXT_PUBLIC_PERF_BASELINE === '1';
