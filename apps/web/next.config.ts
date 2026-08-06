import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * `PERF_BASELINE=1` builds the deliberately un-optimized variant: the heavy
 * chart and AI panels are imported statically instead of lazily, and the table
 * renders every row. Two real builds is how the before/after bundle numbers in
 * the README were produced — see scripts/measure-bundle.mjs.
 */
const isBaseline = process.env.NEXT_PUBLIC_PERF_BASELINE === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  /**
   * Emits a self-contained server bundle with only the node_modules actually
   * reached at runtime. In this monorepo that matters twice over: the container
   * image drops from the full workspace install to tens of megabytes, and the
   * workspace packages get copied in rather than left as symlinks that break
   * once the build stage is discarded.
   */
  output: 'standalone',
  /** The workspace root, so tracing follows @adsight/* out of apps/web. */
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  env: {
    NEXT_PUBLIC_PERF_BASELINE: isBaseline ? '1' : '0',
  },
  experimental: {
    // Rewrites deep barrel imports to direct paths so tree-shaking actually
    // drops the unused half of these packages.
    optimizePackageImports: isBaseline ? [] : ['recharts', '@adsight/ui'],
  },
  eslint: {
    // Lint is a separate CI job; don't fail the perf builds on style.
    ignoreDuringBuilds: true,
  },
};

function withOptionalAnalyzer(config: NextConfig): NextConfig {
  if (process.env.ANALYZE !== 'true') return config;
  // Required lazily so the analyzer is not a hard dependency of a normal build.
  const withBundleAnalyzer = require('@next/bundle-analyzer')({
    enabled: true,
    openAnalyzer: false,
  });
  return withBundleAnalyzer(config) as NextConfig;
}

export default withOptionalAnalyzer(nextConfig);
