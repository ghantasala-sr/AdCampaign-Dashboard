'use client';

import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CampaignListResponse, CreateCampaignInput } from '@adsight/types';
import { useSelector } from 'react-redux';

import { createCampaign, fetchCampaigns, fetchFacets } from '@/lib/api';
import { selectQueryString } from '@/store/selectors';

/**
 * Server state.
 *
 * The query key is the encoded filter string from Redux, so changing a filter is
 * a new cache entry rather than an imperative refetch — going back to a previous
 * filter is instant, and two components asking for the same view share one
 * request. Nothing here duplicates the filter into React state; the selector is
 * the only source.
 */

export const PAGE_SIZE = 500;

export const campaignKeys = {
  all: ['campaigns'] as const,
  list: (queryString: string) => ['campaigns', 'list', queryString] as const,
  detail: (id: string, queryString: string) => ['campaigns', 'detail', id, queryString] as const,
  facets: () => ['facets'] as const,
};

export function useCampaigns() {
  const queryString = useSelector(selectQueryString);

  const query = useInfiniteQuery({
    queryKey: campaignKeys.list(queryString),
    queryFn: ({ pageParam, signal }) => fetchCampaigns(queryString, pageParam, PAGE_SIZE, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage: CampaignListResponse) =>
      lastPage.pageInfo.hasMore ? lastPage.pageInfo.offset + lastPage.pageInfo.limit : undefined,
    // Keeps the previous view on screen while a new filter loads, so the table
    // does not flash empty on every keystroke.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });

  // Flattening on every render would allocate a new 10k array each time and
  // defeat the row memoization downstream; this only reruns when a page lands.
  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.rows) ?? [],
    [query.data?.pages],
  );

  const first = query.data?.pages[0];

  return {
    rows,
    totals: first?.totals,
    total: first?.pageInfo.total ?? 0,
    meta: first?.meta,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholder: query.isPlaceholderData,
    error: query.error,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}

export function useFacets() {
  return useQuery({
    queryKey: campaignKeys.facets(),
    queryFn: ({ signal }) => fetchFacets(signal),
    // Facets are effectively static for a session; don't refetch them per filter.
    staleTime: 10 * 60_000,
  });
}

export function useCreateCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCampaignInput) => createCampaign(input),
    onSuccess: () => {
      // The new campaign belongs in every cached list, and its metrics are zero
      // rather than absent, so invalidating is correct and cheap here.
      void client.invalidateQueries({ queryKey: campaignKeys.all });
    },
  });
}
