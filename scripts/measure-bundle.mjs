#!/usr/bin/env node
/**
 * Measures initial JavaScript per route, for the two builds compared in the README.
 *
 *   node scripts/measure-bundle.mjs
 *
 * Runs two real `next build`s — one with NEXT_PUBLIC_PERF_BASELINE=1, which
 * statically imports the chart, AI, and dialog panels, and one without, where
 * they are separate chunks behind `next/dynamic` — then reports the difference.
 *
 * Byte totals come from `.next/app-build-manifest.json`, which lists the exact
 * files a route loads, rather than from the build summary. The summary rolls up
 * shared chunks in a way that is easy to misread; summing the manifest's file
 * list is unambiguous and reproducible. Both raw and gzip are reported because
 * gzip is what a user actually downloads.
 */

import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'apps', 'web');
const OUT_DIR = join(ROOT, 'perf');

/** Routes worth reporting; `/layout` is merged into each of them by Next. */
const ROUTES = ['/page', '/campaigns/[id]/page', '/perf/page'];

function build(baseline) {
  rmSync(join(WEB, '.next'), { recursive: true, force: true });
  execFileSync('npx', ['next', 'build'], {
    cwd: WEB,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      NEXT_PUBLIC_PERF_BASELINE: baseline ? '1' : '0',
      NODE_ENV: 'production',
    },
  });
}

function measureRoutes() {
  const manifest = JSON.parse(readFileSync(join(WEB, '.next', 'app-build-manifest.json'), 'utf8'));
  const layoutFiles = manifest.pages['/layout'] ?? [];
  const results = {};

  for (const route of ROUTES) {
    const routeFiles = manifest.pages[route];
    if (!routeFiles) continue;

    // A route's initial payload is its own files plus the shared layout's, deduped.
    const files = [...new Set([...layoutFiles, ...routeFiles])].filter((f) => f.endsWith('.js'));

    let raw = 0;
    let gzip = 0;
    const perFile = [];
    for (const file of files) {
      const path = join(WEB, '.next', file);
      let bytes;
      try {
        bytes = readFileSync(path);
      } catch {
        continue; // referenced but not emitted (dev-only entries)
      }
      const rawSize = statSync(path).size;
      const gzipSize = gzipSync(bytes, { level: 9 }).length;
      raw += rawSize;
      gzip += gzipSize;
      perFile.push({ file, rawKb: kb(rawSize), gzipKb: kb(gzipSize) });
    }

    perFile.sort((a, b) => b.gzipKb - a.gzipKb);
    results[route] = { fileCount: files.length, rawKb: kb(raw), gzipKb: kb(gzip), files: perFile };
  }

  return results;
}

function kb(bytes) {
  return Math.round((bytes / 1024) * 10) / 10;
}

function pct(before, after) {
  if (before === 0) return '0%';
  const change = ((after - before) / before) * 100;
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
}

console.log('Building baseline (static imports)…');
build(true);
const baseline = measureRoutes();

console.log('Building optimized (dynamic imports + optimizePackageImports)…');
build(false);
const optimized = measureRoutes();

const report = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  method:
    'Sum of unique .js files listed for each route in .next/app-build-manifest.json, ' +
    'including the shared layout. Gzip at level 9.',
  routes: {},
};

console.log('\nInitial JavaScript per route\n');
const pad = (s, n) => String(s).padEnd(n);
console.log(
  `${pad('route', 22)}${pad('baseline raw', 15)}${pad('opt raw', 12)}${pad('baseline gzip', 16)}${pad('opt gzip', 12)}change (gzip)`,
);
console.log('-'.repeat(92));

for (const route of ROUTES) {
  const before = baseline[route];
  const after = optimized[route];
  if (!before || !after) continue;
  report.routes[route] = {
    baseline: { rawKb: before.rawKb, gzipKb: before.gzipKb, fileCount: before.fileCount },
    optimized: { rawKb: after.rawKb, gzipKb: after.gzipKb, fileCount: after.fileCount },
    gzipChangePct: pct(before.gzipKb, after.gzipKb),
    largestOptimizedFiles: after.files.slice(0, 5),
  };
  console.log(
    `${pad(route, 22)}${pad(`${before.rawKb} KB`, 15)}${pad(`${after.rawKb} KB`, 12)}` +
      `${pad(`${before.gzipKb} KB`, 16)}${pad(`${after.gzipKb} KB`, 12)}${pct(before.gzipKb, after.gzipKb)}`,
  );
}

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, 'bundle.json');
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nWrote ${outPath}`);
