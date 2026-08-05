import type { Metadata } from 'next';
import Link from 'next/link';

import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'AdSight — campaign performance',
  description:
    'Ad campaign performance dashboard over 10,000 campaigns, with a natural-language query bar.',
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-full flex-col">
        <Providers>
          <header className="flex h-12 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded bg-slate-900 text-xs font-bold text-white">
                A
              </span>
              <span className="text-sm font-semibold text-slate-900">AdSight</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/" className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100">
                Campaigns
              </Link>
              <Link href="/perf" className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100">
                Performance
              </Link>
            </nav>
          </header>
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
