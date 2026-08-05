'use client';

import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { encodeListParams } from '@adsight/types';

import { fetchCampaignDetail } from '@/lib/api';
import { selectDateRange, selectSort } from '@/store/selectors';
import { campaignKeys } from './useCampaigns';

/**
 * The drill-in shares the list's date range so navigating in and out keeps the
 * same period, but ignores its other filters — a campaign's own numbers should
 * not change because a status filter is set on the list behind it.
 */
export function useCampaignDetail(id: string) {
  const dateRange = useSelector(selectDateRange);
  const sort = useSelector(selectSort);

  const queryString = encodeListParams({
    filter: {
      search: '',
      statuses: [],
      servingStatuses: [],
      supplySources: [],
      countriesOrRegions: [],
      metricPredicates: [],
      dateRange,
    },
    sort,
  }).toString();

  return useQuery({
    queryKey: campaignKeys.detail(id, queryString),
    queryFn: ({ signal }) => fetchCampaignDetail(id, queryString, signal),
    staleTime: 30_000,
  });
}
