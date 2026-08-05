import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, EMPTY_FILTER, decodeListParams, encodeListParams } from '@adsight/types';

import { makeStore } from './index';
import { viewActions } from './viewSlice';
import { selectActiveFilterCount, selectQueryString } from './selectors';

/**
 * Client state and the query string it produces.
 *
 * The selector under test is the seam between Redux and React Query: its output
 * is simultaneously the cache key, the request URL, and the browser URL. Testing
 * it directly is cheaper and more meaningful than testing three components that
 * happen to consume it.
 */

describe('viewSlice', () => {
  it('toggles a status on and off', () => {
    const store = makeStore();
    store.dispatch(viewActions.statusToggled('PAUSED'));
    expect(store.getState().view.filter.statuses).toEqual(['PAUSED']);
    store.dispatch(viewActions.statusToggled('PAUSED'));
    expect(store.getState().view.filter.statuses).toEqual([]);
  });

  it('keeps one predicate per metric, with the newest winning', () => {
    const store = makeStore();
    store.dispatch(viewActions.metricPredicateAdded({ metric: 'spendCents', comparator: 'gt', value: 100 }));
    store.dispatch(viewActions.metricPredicateAdded({ metric: 'spendCents', comparator: 'lt', value: 50 }));
    store.dispatch(viewActions.metricPredicateAdded({ metric: 'installs', comparator: 'gte', value: 10 }));

    const predicates = store.getState().view.filter.metricPredicates;
    expect(predicates).toHaveLength(2);
    expect(predicates.find((p) => p.metric === 'spendCents')).toEqual({
      metric: 'spendCents',
      comparator: 'lt',
      value: 50,
    });
  });

  it('flips direction when the same column is sorted twice', () => {
    const store = makeStore();
    store.dispatch(viewActions.sortRequested('installs'));
    expect(store.getState().view.sort).toEqual({ field: 'installs', direction: 'desc' });
    store.dispatch(viewActions.sortRequested('installs'));
    expect(store.getState().view.sort).toEqual({ field: 'installs', direction: 'asc' });
    // A different column starts fresh rather than inheriting the flipped direction.
    store.dispatch(viewActions.sortRequested('taps'));
    expect(store.getState().view.sort).toEqual({ field: 'taps', direction: 'desc' });
  });

  it('preserves the date range when clearing filters', () => {
    // The date range is a lens on the data, not a filter on it — clearing
    // filters should not silently move the user to a different period.
    const store = makeStore();
    store.dispatch(viewActions.dateRangePresetChanged('LAST_7_DAYS'));
    store.dispatch(viewActions.statusToggled('PAUSED'));
    store.dispatch(viewActions.countryToggled('jp'));

    store.dispatch(viewActions.filtersCleared());

    const { filter } = store.getState().view;
    expect(filter.statuses).toEqual([]);
    expect(filter.countriesOrRegions).toEqual([]);
    expect(filter.dateRange.preset).toBe('LAST_7_DAYS');
  });

  it('upper-cases country codes on the way in', () => {
    const store = makeStore();
    store.dispatch(viewActions.countryToggled('jp'));
    expect(store.getState().view.filter.countriesOrRegions).toEqual(['JP']);
    // Toggling with the other casing must remove it, not add a duplicate.
    store.dispatch(viewActions.countryToggled('JP'));
    expect(store.getState().view.filter.countriesOrRegions).toEqual([]);
  });

  it('replaces the whole view when an AI plan is applied', () => {
    const store = makeStore();
    store.dispatch(viewActions.statusToggled('ENABLED'));

    store.dispatch(
      viewActions.viewReplaced({
        filter: { ...EMPTY_FILTER, statuses: ['PAUSED'], countriesOrRegions: ['JP'] },
        sort: { field: 'avgCPA', direction: 'desc' },
      }),
    );

    // Replace, not merge: the previously selected ENABLED status is gone.
    expect(store.getState().view.filter.statuses).toEqual(['PAUSED']);
    expect(store.getState().view.sort.field).toBe('avgCPA');
  });

  it('counts active filters without counting the date range', () => {
    const store = makeStore();
    expect(selectActiveFilterCount(store.getState())).toBe(0);

    store.dispatch(viewActions.searchChanged('brand'));
    store.dispatch(viewActions.statusToggled('PAUSED'));
    store.dispatch(viewActions.countryToggled('JP'));
    store.dispatch(viewActions.dateRangePresetChanged('LAST_7_DAYS'));

    expect(selectActiveFilterCount(store.getState())).toBe(3);
  });
});

describe('selectQueryString', () => {
  it('is empty for the default view, so an unfiltered URL stays clean', () => {
    const store = makeStore();
    expect(selectQueryString(store.getState())).toBe('');
  });

  it('does not change when unrelated UI state changes', () => {
    // This is what stops React Query refetching when the filter panel opens.
    const store = makeStore();
    store.dispatch(viewActions.statusToggled('PAUSED'));
    const before = selectQueryString(store.getState());

    store.dispatch(viewActions.filterPanelToggled());
    store.dispatch(viewActions.densityChanged('compact'));
    store.dispatch(viewActions.columnToggled('avgCPM'));
    store.dispatch(viewActions.aiPanelToggled());

    expect(selectQueryString(store.getState())).toBe(before);
  });

  it('encodes a filter into a readable query string', () => {
    const store = makeStore();
    store.dispatch(viewActions.statusToggled('PAUSED'));
    store.dispatch(viewActions.countryToggled('JP'));
    store.dispatch(viewActions.metricPredicateAdded({ metric: 'spendCents', comparator: 'gt', value: 2000 }));

    const query = selectQueryString(store.getState());
    expect(query).toContain('status=PAUSED');
    expect(query).toContain('country=JP');
    expect(query).toContain('metric=spendCents%3Agt%3A2000');
  });
});

describe('URL codec round trip', () => {
  it('survives encode then decode unchanged', () => {
    // The encoder is used by the browser and the decoder by the server; a
    // mismatch here means a shared link silently loses a filter.
    const filter = {
      ...EMPTY_FILTER,
      search: 'brand core',
      statuses: ['PAUSED'] as const,
      servingStatuses: ['NOT_RUNNING'] as const,
      supplySources: ['APPSTORE_SEARCH_TAB'] as const,
      countriesOrRegions: ['JP', 'KR'],
      metricPredicates: [
        { metric: 'spendCents' as const, comparator: 'gt' as const, value: 2000 },
        { metric: 'ttr' as const, comparator: 'lt' as const, value: 0.02 },
      ],
      dateRange: { preset: 'LAST_7_DAYS' as const, start: null, end: null },
    };
    const sort = { field: 'avgCPA' as const, direction: 'asc' as const };

    const encoded = encodeListParams({ filter, sort });
    const decoded = decodeListParams(encoded);

    expect(decoded.filter).toEqual(filter);
    expect(decoded.sort).toEqual(sort);
  });

  it('round-trips a custom date range', () => {
    const filter = {
      ...EMPTY_FILTER,
      dateRange: { preset: null, start: '2026-06-01', end: '2026-06-30' },
    };
    const decoded = decodeListParams(encodeListParams({ filter, sort: DEFAULT_SORT }));
    expect(decoded.filter.dateRange).toEqual(filter.dateRange);
  });

  it('falls back to defaults for a hand-mangled query string', () => {
    const decoded = decodeListParams(
      new URLSearchParams('status=BOGUS&country=z,123,usa&metric=nope&sort=nonsense&limit=-5'),
    );
    expect(decoded.filter.statuses).toEqual([]);
    // Country codes are validated on shape only, so none of these survive.
    expect(decoded.filter.countriesOrRegions).toEqual([]);
    expect(decoded.filter.metricPredicates).toEqual([]);
    expect(decoded.sort).toEqual(DEFAULT_SORT);
    expect(decoded.limit).toBeGreaterThan(0);
  });

  it('accepts any well-formed country code rather than checking a list', () => {
    // Deliberate: the server filter simply matches nothing for an unknown code,
    // which is better than 400ing a link because a market was renamed.
    const decoded = decodeListParams(new URLSearchParams('country=zz'));
    expect(decoded.filter.countriesOrRegions).toEqual(['ZZ']);
  });
});
