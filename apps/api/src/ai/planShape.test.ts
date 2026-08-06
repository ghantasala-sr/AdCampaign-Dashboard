import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, EMPTY_FILTER } from '@adsight/types';

import { coerceCountryCode, describeChanges, rawPlanSchema, toFilterPlan } from './planShape.js';
import { geminiToolSchema } from './prompt.js';

/**
 * Validation and normalisation of model output.
 *
 * The model's arguments are untrusted input like any other. These cases are
 * mostly regressions from watching a real model answer real queries — each one
 * produced a wrong filter before it was fixed.
 */

describe('coerceCountryCode', () => {
  it('passes through a real ISO code', () => {
    expect(coerceCountryCode('JP')).toBe('JP');
    expect(coerceCountryCode('jp')).toBe('JP');
    expect(coerceCountryCode(' de ')).toBe('DE');
  });

  it('maps UK to GB', () => {
    // Regression: "campaigns in the UK" returned "UK", which passes a
    // two-letter shape check but matches nothing — the data uses the ISO code
    // GB, so the filter silently returned zero rows.
    expect(coerceCountryCode('UK')).toBe('GB');
    expect(coerceCountryCode('uk')).toBe('GB');
  });

  it('converts a country name the model returned instead of a code', () => {
    // Regression: asked for ISO codes, a model answered ["Japan"]. Dropping it
    // would lose the only constraint the user actually asked for.
    expect(coerceCountryCode('Japan')).toBe('JP');
    expect(coerceCountryCode('united states')).toBe('US');
    expect(coerceCountryCode('South Korea')).toBe('KR');
  });

  it('drops something genuinely unrecognisable', () => {
    expect(coerceCountryCode('Atlantis')).toBeNull();
    expect(coerceCountryCode('')).toBeNull();
    expect(coerceCountryCode('123')).toBeNull();
  });
});

describe('rawPlanSchema', () => {
  const valid = {
    interpretation: 'Paused campaigns in Japan.',
    confidence: 'high' as const,
    unsupported: [],
    search: '',
    statuses: ['PAUSED' as const],
    servingStatuses: [],
    supplySources: [],
    countriesOrRegions: ['JP'],
    metricPredicates: [{ metric: 'spendCents' as const, comparator: 'gt' as const, value: 2000 }],
    dateRangePreset: 'KEEP_CURRENT' as const,
    sortField: 'KEEP_CURRENT' as const,
    sortDirection: 'KEEP_CURRENT' as const,
  };

  it('accepts a well-formed plan', () => {
    expect(rawPlanSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a hallucinated metric name', () => {
    const result = rawPlanSchema.safeParse({
      ...valid,
      metricPredicates: [{ metric: 'roas', comparator: 'gt', value: 2 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric threshold', () => {
    const result = rawPlanSchema.safeParse({
      ...valid,
      metricPredicates: [{ metric: 'spendCents', comparator: 'gt', value: '2000' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invented status', () => {
    expect(rawPlanSchema.safeParse({ ...valid, statuses: ['ARCHIVED'] }).success).toBe(false);
  });
});

describe('toFilterPlan', () => {
  const base = {
    interpretation: 'x',
    confidence: 'high' as const,
    unsupported: [],
    search: '',
    statuses: [],
    servingStatuses: [],
    supplySources: [],
    countriesOrRegions: [],
    metricPredicates: [],
    dateRangePreset: 'KEEP_CURRENT' as const,
    sortField: 'KEEP_CURRENT' as const,
    sortDirection: 'KEEP_CURRENT' as const,
  };

  it('keeps the current date range and sort when the model says so', () => {
    const current = {
      ...EMPTY_FILTER,
      dateRange: { preset: 'LAST_7_DAYS' as const, start: null, end: null },
    };
    const plan = toFilterPlan(base, current, { field: 'installs', direction: 'asc' });
    expect(plan.filter.dateRange.preset).toBe('LAST_7_DAYS');
    expect(plan.sort).toEqual({ field: 'installs', direction: 'asc' });
  });

  it('normalises country values on the way into the filter', () => {
    const plan = toFilterPlan(
      { ...base, countriesOrRegions: ['UK', 'Japan', 'ca', 'Narnia'] },
      EMPTY_FILTER,
      DEFAULT_SORT,
    );
    expect(plan.filter.countriesOrRegions).toEqual(['GB', 'JP', 'CA']);
  });
});

describe('describeChanges', () => {
  it('renders spend thresholds in dollars, matching the unit the model is asked for', () => {
    // Guards the other half of the $2,000-vs-$200,000 bug: if the label ever
    // disagrees with the stored value, the review step is showing the user
    // something different from what will be applied.
    const changes = describeChanges(
      {
        ...EMPTY_FILTER,
        metricPredicates: [{ metric: 'spendCents', comparator: 'gt', value: 2000 }],
      },
      DEFAULT_SORT,
    );
    expect(changes.map((c) => c.label)).toContain('Spend over $2,000');
  });

  it('renders rate metrics as percentages', () => {
    const changes = describeChanges(
      { ...EMPTY_FILTER, metricPredicates: [{ metric: 'ttr', comparator: 'lt', value: 0.02 }] },
      DEFAULT_SORT,
    );
    expect(changes.map((c) => c.label)).toContain('Tap-through rate under 2.00%');
  });
});

describe('geminiToolSchema', () => {
  it('has no additionalProperties anywhere', () => {
    // Gemini's function-declaration validator rejects the keyword rather than
    // ignoring it, so a nested one would break every model call.
    const seen: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${path}[${i}]`));
        return;
      }
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'additionalProperties') seen.push(`${path}.${key}`);
        walk(value, `${path}.${key}`);
      }
    };
    walk(geminiToolSchema, '$');
    expect(seen).toEqual([]);
  });

  it('still declares every field the validator expects', () => {
    // Stripping must not have removed anything load-bearing.
    const props = (geminiToolSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toContain('metricPredicates');
    expect(Object.keys(props)).toContain('countriesOrRegions');
    expect((geminiToolSchema as { required: string[] }).required).toContain('interpretation');
  });
});
