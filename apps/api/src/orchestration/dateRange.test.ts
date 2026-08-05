import { describe, expect, it } from 'vitest';
import type { DateRange } from '@adsight/types';

import { DateRangeError, resolveDateRange, todayWindow } from './dateRange.js';
import { METRIC_ORDER, type Manifest } from '../lib/dataset.js';

/**
 * Presets resolve against the dataset's last day rather than the wall clock, so
 * these tests pin a manifest and assert exact day indices — the alternative is a
 * suite that changes meaning at midnight.
 */
const manifest: Manifest = {
  seed: 1,
  generatedAt: '2026-08-04T00:00:00.000Z',
  startDate: '2026-05-07',
  endDate: '2026-08-04',
  days: 90,
  campaignCount: 10,
  metricOrder: METRIC_ORDER,
  campaignIds: [],
};

function preset(value: DateRange['preset']): DateRange {
  return { preset: value, start: null, end: null };
}

describe('resolveDateRange', () => {
  it('anchors LAST_30_DAYS on the dataset end date, inclusive', () => {
    const range = resolveDateRange(preset('LAST_30_DAYS'), manifest);
    expect(range.endDay).toBe(89);
    expect(range.startDay).toBe(60);
    expect(range.end).toBe('2026-08-04');
    expect(range.start).toBe('2026-07-06');
    // 30 days inclusive.
    expect(range.endDay - range.startDay + 1).toBe(30);
  });

  it('resolves TODAY to a single day', () => {
    const range = resolveDateRange(preset('TODAY'), manifest);
    expect(range.startDay).toBe(89);
    expect(range.endDay).toBe(89);
  });

  it('resolves YESTERDAY to the single day before the last', () => {
    const range = resolveDateRange(preset('YESTERDAY'), manifest);
    expect(range.startDay).toBe(88);
    expect(range.endDay).toBe(88);
    expect(range.end).toBe('2026-08-03');
  });

  it('clamps LAST_90_DAYS to the window rather than going negative', () => {
    const range = resolveDateRange(preset('LAST_90_DAYS'), manifest);
    expect(range.startDay).toBe(0);
    expect(range.endDay).toBe(89);
  });

  it('accepts a custom range inside the window', () => {
    const range = resolveDateRange(
      { preset: null, start: '2026-06-01', end: '2026-06-30' },
      manifest,
    );
    expect(range.start).toBe('2026-06-01');
    expect(range.end).toBe('2026-06-30');
    expect(range.endDay - range.startDay + 1).toBe(30);
  });

  it('clamps a partially overlapping range instead of rejecting it', () => {
    // A link that was valid last month should still render something.
    const range = resolveDateRange(
      { preset: null, start: '2026-04-01', end: '2026-05-20' },
      manifest,
    );
    expect(range.startDay).toBe(0);
    expect(range.start).toBe('2026-05-07');
    expect(range.end).toBe('2026-05-20');
  });

  it('rejects a range entirely outside the window', () => {
    expect(() =>
      resolveDateRange({ preset: null, start: '2020-01-01', end: '2020-02-01' }, manifest),
    ).toThrow(DateRangeError);
  });

  it('rejects a reversed range', () => {
    expect(() =>
      resolveDateRange({ preset: null, start: '2026-07-01', end: '2026-06-01' }, manifest),
    ).toThrow(/start must not be after end/);
  });

  it('rejects a malformed date with the offending field named', () => {
    try {
      resolveDateRange({ preset: null, start: '07/01/2026', end: '2026-07-31' }, manifest);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DateRangeError);
      expect((error as DateRangeError).field).toBe('dateRange.start');
    }
  });

  it('rejects a half-specified custom range', () => {
    expect(() =>
      resolveDateRange({ preset: null, start: '2026-07-01', end: null }, manifest),
    ).toThrow(/requires both start and end/);
  });

  it('reports the dataset last day as today', () => {
    expect(todayWindow(manifest)).toEqual({ startDay: 89, endDay: 89 });
  });
});
