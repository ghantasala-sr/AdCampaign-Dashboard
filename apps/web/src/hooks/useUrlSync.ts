'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { decodeListParams } from '@adsight/types';

import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { viewActions } from '@/store/viewSlice';
import { selectHydratedFromUrl, selectQueryString } from '@/store/selectors';

/**
 * Two-way URL sync, ordered so the two directions cannot fight.
 *
 * On first mount the URL wins: a shared link must render the view it encodes.
 * Only after that hydration is recorded does the store start writing back. Both
 * directions use the shared codec, so the string compared here is the same
 * string the server will parse.
 */
export function useUrlSync(): void {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useAppSelector(selectHydratedFromUrl);
  const queryString = useAppSelector(selectQueryString);
  const lastWritten = useRef<string | null>(null);

  // Direction 1: URL -> store, once.
  useEffect(() => {
    if (hydrated) return;
    const incoming = searchParams.toString();
    if (incoming !== '') {
      const { filter, sort } = decodeListParams(new URLSearchParams(incoming));
      dispatch(viewActions.viewReplaced({ filter, sort }));
    }
    dispatch(viewActions.hydratedFromUrl());
  }, [dispatch, hydrated, searchParams]);

  // Direction 2: store -> URL, after hydration.
  useEffect(() => {
    if (!hydrated) return;
    if (lastWritten.current === queryString) return;
    lastWritten.current = queryString;

    const current = window.location.search.replace(/^\?/, '');
    if (current === queryString) return;

    // `replace` rather than `push`: typing in the search box should not add one
    // history entry per keystroke. Scroll position is preserved so the table
    // does not jump while the user is mid-scroll.
    router.replace(queryString === '' ? window.location.pathname : `?${queryString}`, {
      scroll: false,
    });
  }, [hydrated, queryString, router]);
}
