import { createSelector } from '@reduxjs/toolkit';
import { countActiveFilters, encodeListParams } from '@adsight/types';

import type { RootState } from './index';

/**
 * The seam between the two state systems.
 *
 * Redux owns the filter; React Query owns the data. This selector turns the
 * former into the cache key for the latter. Because it is memoized on the filter
 * and sort slices, an unrelated Redux update (opening the filter panel, changing
 * density) produces the same string and React Query does not refetch.
 *
 * Everything downstream keys off `selectQueryString`: the fetch URL, the React
 * Query key, and the browser URL are all the same string, which is why a shared
 * link, the cache, and the address bar cannot disagree.
 */

export const selectFilter = (state: RootState) => state.view.filter;
export const selectSort = (state: RootState) => state.view.sort;
export const selectDensity = (state: RootState) => state.view.density;
export const selectHiddenColumns = (state: RootState) => state.view.hiddenColumns;
export const selectFilterPanelOpen = (state: RootState) => state.view.filterPanelOpen;
export const selectAiPanelOpen = (state: RootState) => state.view.aiPanelOpen;
export const selectHydratedFromUrl = (state: RootState) => state.view.hydratedFromUrl;
export const selectDateRange = (state: RootState) => state.view.filter.dateRange;

export const selectQueryString = createSelector(
  [selectFilter, selectSort],
  (filter, sort) => encodeListParams({ filter, sort }).toString(),
);

export const selectActiveFilterCount = createSelector([selectFilter], (filter) =>
  countActiveFilters(filter),
);

export const selectMetricPredicates = createSelector(
  [selectFilter],
  (filter) => filter.metricPredicates,
);
