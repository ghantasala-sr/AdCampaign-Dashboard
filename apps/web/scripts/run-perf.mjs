#!/usr/bin/env node
/**
 * Drives the /perf harness in a real Chromium and records the numbers used in
 * the README.
 *
 *   npm run perf              # against an already-running dev/prod server
 *   PERF_BASE_URL=... npm run perf
 *
 * Two things are measured, both in the browser rather than from build output:
 *
 *   1. Render cost of the naive vs virtualized table at 1k/5k/10k rows, by
 *      calling the harness's own `window.__ADSIGHT_PERF__.run`.
 *   2. JavaScript actually transferred on a cold load of each route, summed from
 *      the network responses. This is the number a user pays, and unlike a build
 *      manifest it cannot be inflated by chunks that are registered but never
 *      fetched.
 *
 * Each render measurement is repeated and the median is kept, because a single
 * run on a laptop with other work happening is noise.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUT_DIR = join(ROOT, 'perf');

const BASE_URL = process.env.PERF_BASE_URL ?? 'http://localhost:3000';
const ROW_COUNTS = [1_000, 5_000, 10_000];
const REPEATS = Number(process.env.PERF_REPEATS ?? 3);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round(value) {
  return Math.round(value * 10) / 10;
}

async function measureRender(page) {
  const rows = [];

  for (const rowCount of ROW_COUNTS) {
    for (const variant of ['naive', 'optimized']) {
      const runs = [];
      for (let attempt = 0; attempt < REPEATS; attempt += 1) {
        const result = await page.evaluate(
          ([v, n]) => window.__ADSIGHT_PERF__.run(v, n),
          [variant, rowCount],
        );
        runs.push(result);
        process.stdout.write(
          `  ${variant.padEnd(10)} ${String(rowCount).padStart(6)} rows  ` +
            `mount ${String(result.mountMs).padStart(7)}ms  ` +
            `scroll ${String(result.scrollTotalMs).padStart(7)}ms  ` +
            `nodes ${String(result.domNodes).padStart(7)}\n`,
        );
      }

      rows.push({
        variant,
        rowCount,
        repeats: runs.length,
        mountMs: round(median(runs.map((r) => r.mountMs))),
        scrollTotalMs: round(median(runs.map((r) => r.scrollTotalMs))),
        medianFrameMs: round(median(runs.map((r) => r.medianFrameMs))),
        worstFrameMs: round(median(runs.map((r) => r.worstFrameMs))),
        framesOver16ms: Math.round(median(runs.map((r) => r.framesOver16ms))),
        frameCount: runs[0].frameCount,
        domNodes: runs[0].domNodes,
      });
    }
  }

  return rows;
}

/**
 * Cold-loads a route in a fresh context and sums transferred JS.
 *
 * Both numbers are recorded because they answer different questions:
 * `wireKb` is what crosses the network (gzip, from Content-Length) and is what a
 * user on a slow connection pays; `decodedKb` is what the main thread has to
 * parse and compile, which is closer to what shows up as blocking time.
 */
async function measureTransfer(browser, path) {
  const context = await browser.newContext();
  const page = await context.newPage();

  let wireBytes = 0;
  let decodedBytes = 0;
  let jsRequests = 0;
  const seen = new Set();
  const pending = [];

  page.on('response', (response) => {
    const url = response.url();
    if (seen.has(url)) return;
    if (response.request().resourceType() !== 'script') return;
    seen.add(url);

    pending.push(
      (async () => {
        try {
          const body = await response.body();
          decodedBytes += body.length;
          const contentLength = await response.headerValue('content-length');
          // Fall back to the decoded size when the response was not compressed
          // or was chunked without a Content-Length.
          wireBytes += contentLength ? Number(contentLength) : body.length;
          jsRequests += 1;
        } catch {
          // Redirects and aborted requests have no readable body.
        }
      })(),
    );
  });

  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
  // Give lazily-triggered chunks a chance to appear if they are fetched eagerly.
  await page.waitForTimeout(1_500);
  await Promise.all(pending);

  await context.close();
  return {
    path,
    wireKb: round(wireBytes / 1024),
    decodedKb: round(decodedBytes / 1024),
    jsRequests,
  };
}

async function main() {
  const browser = await chromium.launch();

  console.log(`Measuring transferred JavaScript against ${BASE_URL}`);
  const transfer = [];
  for (const path of ['/', '/perf']) {
    const result = await measureTransfer(browser, path);
    transfer.push(result);
    console.log(
      `  ${path.padEnd(18)} ${String(result.wireKb).padStart(8)} KB wire  ` +
        `${String(result.decodedKb).padStart(8)} KB decoded  ${result.jsRequests} requests`,
    );
  }

  // The drill-in needs a real campaign id, so take the first row from the API.
  try {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    const response = await fetch(`${apiBase}/api/campaigns?limit=1`);
    const body = await response.json();
    const id = body.rows?.[0]?.campaign?.id;
    if (id) {
      const result = await measureTransfer(browser, `/campaigns/${id}`);
      transfer.push({ ...result, path: '/campaigns/[id]' });
      console.log(
        `  ${'/campaigns/[id]'.padEnd(18)} ${String(result.wireKb).padStart(8)} KB wire  ` +
          `${String(result.decodedKb).padStart(8)} KB decoded  ${result.jsRequests} requests`,
      );
    }
  } catch {
    console.log('  /campaigns/[id]  skipped (API not reachable)');
  }

  console.log(`\nMeasuring render cost (median of ${REPEATS} runs per cell)`);
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/perf`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ADSIGHT_PERF__?.ready === true, { timeout: 30_000 });

  const render = await measureRender(page);
  const userAgent = await page.evaluate(() => navigator.userAgent);

  await browser.close();

  const report = {
    measuredAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    node: process.version,
    userAgent,
    repeats: REPEATS,
    method: {
      render:
        'window.__ADSIGHT_PERF__.run() in the /perf harness: cold mount timed to the second ' +
        'requestAnimationFrame after commit, then a 30-step scripted scroll measuring frame ' +
        'intervals. Both variants receive the same row array.',
      transfer:
        'Sum of response bodies with resourceType "script" on a cold page load in a fresh ' +
        'browser context, waiting for networkidle plus 1.5s.',
    },
    transfer,
    render,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, 'render.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${outPath}`);

  printSummary(render);
}

function printSummary(render) {
  console.log('\nSummary at 10,000 rows');
  const at10k = render.filter((r) => r.rowCount === 10_000);
  const naive = at10k.find((r) => r.variant === 'naive');
  const optimized = at10k.find((r) => r.variant === 'optimized');
  if (!naive || !optimized) return;

  const rows = [
    ['Mount', `${naive.mountMs} ms`, `${optimized.mountMs} ms`, ratio(naive.mountMs, optimized.mountMs)],
    [
      'Scroll (30 frames)',
      `${naive.scrollTotalMs} ms`,
      `${optimized.scrollTotalMs} ms`,
      ratio(naive.scrollTotalMs, optimized.scrollTotalMs),
    ],
    [
      'Worst frame',
      `${naive.worstFrameMs} ms`,
      `${optimized.worstFrameMs} ms`,
      ratio(naive.worstFrameMs, optimized.worstFrameMs),
    ],
    [
      'DOM nodes',
      naive.domNodes.toLocaleString(),
      optimized.domNodes.toLocaleString(),
      ratio(naive.domNodes, optimized.domNodes),
    ],
  ];

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('metric', 20)}${pad('naive', 14)}${pad('optimized', 14)}improvement`);
  console.log('-'.repeat(62));
  for (const row of rows) {
    console.log(`${pad(row[0], 20)}${pad(row[1], 14)}${pad(row[2], 14)}${row[3]}`);
  }
}

function ratio(before, after) {
  if (after === 0) return '—';
  return `${(before / after).toFixed(1)}x`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
