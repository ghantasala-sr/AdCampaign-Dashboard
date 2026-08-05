'use client';

import { useRef, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { makeStore, type AppStore } from '@/store';

/**
 * Both providers, in one client boundary.
 *
 * The store and query client are created in refs rather than at module scope so
 * a server render never shares them across requests — the classic Next.js
 * singleton leak where one user's filters end up in another's initial HTML.
 */
export function Providers({ children }: { readonly children: ReactNode }) {
  const storeRef = useRef<AppStore | null>(null);
  storeRef.current ??= makeStore();

  const queryClientRef = useRef<QueryClient | null>(null);
  queryClientRef.current ??= new QueryClient({
    defaultOptions: {
      queries: {
        // The fixture data does not change under us, so aggressive refetching
        // would only add load. A real deployment would lower this.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Don't retry a validation error — the request itself is wrong.
          const status = (error as { status?: number }).status;
          if (status !== undefined && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });

  return (
    <Provider store={storeRef.current}>
      <QueryClientProvider client={queryClientRef.current}>{children}</QueryClientProvider>
    </Provider>
  );
}
