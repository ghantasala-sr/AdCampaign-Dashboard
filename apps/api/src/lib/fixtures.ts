/**
 * Loads the generated fixture set once per process.
 *
 * Each upstream client reads from here, but only through the narrow slice it
 * owns — the reporting service never touches campaign config, the catalog
 * service never sees metrics. That keeps the "four separate systems" story
 * honest even though they share one process in this fixture implementation.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AdGroup, AppMetadata, Campaign, Keyword } from '@adsight/types';

import { FILES, type Manifest } from './dataset.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Resolves whether running from `src/` under tsx or `dist/` after a build. */
function resolveDataDir(): string {
  const candidates = [
    join(HERE, '..', '..', 'data'), // dist/lib -> apps/api/data
    join(HERE, '..', '..', '..', 'data'), // dist/src/lib -> apps/api/data
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, FILES.manifest))) return dir;
  }
  throw new Error(
    'Fixture data not found. Run `npm run seed` at the repo root before starting the API.',
  );
}

function readNdjson<T>(path: string): T[] {
  const raw = readFileSync(path, 'utf8');
  const out: T[] = [];
  let start = 0;
  // Manual scan rather than split() — avoids allocating a 100k-element string
  // array for the keywords file on every boot.
  while (start < raw.length) {
    const end = raw.indexOf('\n', start);
    const stop = end === -1 ? raw.length : end;
    if (stop > start) out.push(JSON.parse(raw.slice(start, stop)) as T);
    if (end === -1) break;
    start = end + 1;
  }
  return out;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export interface Dataset {
  readonly manifest: Manifest;
  readonly campaigns: readonly Campaign[];
  readonly campaignsById: ReadonlyMap<string, Campaign>;
  /** Position of each campaign in the metrics array. */
  readonly slotById: ReadonlyMap<string, number>;
  readonly appsByAdamId: ReadonlyMap<string, AppMetadata>;
  readonly apps: readonly AppMetadata[];
  readonly adGroupsByCampaign: ReadonlyMap<string, readonly AdGroup[]>;
  readonly keywordsByCampaign: ReadonlyMap<string, readonly Keyword[]>;
  /** Flat Int32 view: [metric][campaign][day]. */
  readonly metrics: Int32Array;
  readonly loadMs: number;
}

let cached: Dataset | null = null;

export function loadDataset(): Dataset {
  if (cached) return cached;

  const startedAt = Date.now();
  const dir = resolveDataDir();

  const manifest = JSON.parse(readFileSync(join(dir, FILES.manifest), 'utf8')) as Manifest;
  const apps = JSON.parse(readFileSync(join(dir, FILES.apps), 'utf8')) as AppMetadata[];
  const campaigns = readNdjson<Campaign>(join(dir, FILES.campaigns));
  const adGroups = readNdjson<AdGroup>(join(dir, FILES.adGroups));
  const keywords = readNdjson<Keyword>(join(dir, FILES.keywords));

  const buffer = readFileSync(join(dir, FILES.metrics));
  // Zero-copy view over the file bytes; Int32Array requires 4-byte alignment,
  // which readFileSync satisfies for a freshly allocated buffer.
  const metrics = new Int32Array(
    buffer.buffer,
    buffer.byteOffset,
    Math.floor(buffer.byteLength / 4),
  );

  const slotById = new Map<string, number>();
  manifest.campaignIds.forEach((id, index) => slotById.set(id, index));

  cached = {
    manifest,
    campaigns,
    campaignsById: new Map(campaigns.map((c) => [c.id, c])),
    slotById,
    apps,
    appsByAdamId: new Map(apps.map((a) => [a.adamId, a])),
    adGroupsByCampaign: groupBy(adGroups, (g) => g.campaignId),
    keywordsByCampaign: groupBy(keywords, (k) => k.campaignId),
    metrics,
    loadMs: Date.now() - startedAt,
  };

  return cached;
}

/** Test hook: forces the next `loadDataset()` to re-read from disk. */
export function resetDatasetCache(): void {
  cached = null;
}
