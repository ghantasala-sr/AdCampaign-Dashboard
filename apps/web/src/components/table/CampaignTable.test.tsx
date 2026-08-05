import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CampaignTable } from './CampaignTable';
import { CampaignTableNaive } from './CampaignTableNaive';
import { DEFAULT_HIDDEN_COLUMNS } from './columns';
import { generatePerfRows } from '@/lib/perfFixture';

/**
 * Virtualization is a claim about how many rows reach the DOM, so it is asserted
 * directly rather than inferred from a timing. The naive table is rendered from
 * the same fixture in the same test file to make the contrast a checked fact
 * rather than a comment.
 */

const rows = generatePerfRows(500);
const sort = { field: 'spendCents' as const, direction: 'desc' as const };

function renderTable(count = 500) {
  return render(
    <CampaignTable
      rows={rows.slice(0, count)}
      sort={sort}
      onSort={vi.fn()}
      hiddenColumns={DEFAULT_HIDDEN_COLUMNS}
      density="comfortable"
    />,
  );
}

describe('CampaignTable', () => {
  it('renders only a viewport-sized window of rows', () => {
    renderTable(500);
    const rendered = screen.getAllByTestId('campaign-row');

    // A 600px viewport at 44px per row is ~14 rows plus overscan. The exact
    // number depends on the virtualizer, so the assertion is a bound, not a
    // value — what matters is that it is nowhere near 500.
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(60);
  });

  it('renders every row in the naive baseline, from the same data', () => {
    render(
      <CampaignTableNaive
        rows={rows.slice(0, 500)}
        sort={sort}
        onSort={vi.fn()}
        hiddenColumns={DEFAULT_HIDDEN_COLUMNS}
        density="comfortable"
      />,
    );
    expect(screen.getAllByTestId('campaign-row-naive')).toHaveLength(500);
  });

  it('shows the first row so the top of the table is not blank', () => {
    renderTable(500);
    const first = rows[0]!;
    expect(screen.getByText(first.campaign.name)).toBeInTheDocument();
  });

  it('reports sort state on the column header, where aria-sort is valid', () => {
    renderTable(20);
    // aria-sort belongs on the columnheader; on a button it is silently ignored.
    const spendHeader = screen.getByRole('columnheader', { name: /Spend$/ });
    expect(spendHeader).toHaveAttribute('aria-sort', 'descending');
  });

  it('exposes the full result size to assistive technology, not the rendered window', () => {
    renderTable(500);
    // Without this a screen reader would announce "row 12 of 25" on a 10,000-row set.
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '501');
  });

  it('requests a sort when a sortable header is clicked', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(
      <CampaignTable
        rows={rows.slice(0, 20)}
        sort={sort}
        onSort={onSort}
        hiddenColumns={DEFAULT_HIDDEN_COLUMNS}
        density="comfortable"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Installs/ }));
    expect(onSort).toHaveBeenCalledWith('installs');
  });

  it('does not offer a sort control for columns the server cannot sort', () => {
    renderTable(20);
    // "Serving" is derived from several fields and has no server-side ordering.
    expect(screen.queryByRole('button', { name: /^Serving/ })).not.toBeInTheDocument();
    expect(screen.getByText('Serving')).toBeInTheDocument();
  });

  it('hides columns the user has turned off', () => {
    render(
      <CampaignTable
        rows={rows.slice(0, 10)}
        sort={sort}
        onSort={vi.fn()}
        hiddenColumns={[...DEFAULT_HIDDEN_COLUMNS, 'installs']}
        density="comfortable"
      />,
    );
    expect(screen.queryByRole('button', { name: /Installs/ })).not.toBeInTheDocument();
  });

  it('explains an empty result instead of showing a blank table', () => {
    render(
      <CampaignTable
        rows={[]}
        sort={sort}
        onSort={vi.fn()}
        hiddenColumns={DEFAULT_HIDDEN_COLUMNS}
        density="comfortable"
      />,
    );
    const empty = screen.getByTestId('campaign-table-empty');
    expect(empty).toHaveTextContent('No campaigns match these filters');
  });

  it('asks for the next page only when scrolled near the end', () => {
    const onLoadMore = vi.fn();
    render(
      <CampaignTable
        rows={rows.slice(0, 500)}
        sort={sort}
        onSort={vi.fn()}
        hiddenColumns={DEFAULT_HIDDEN_COLUMNS}
        density="comfortable"
        hasNextPage
        onLoadMore={onLoadMore}
      />,
    );
    // At the top of a 500-row list, the last visible index is nowhere near the end.
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('prefetches when the loaded set is smaller than the trigger window', () => {
    // With only 20 rows loaded and more available, the last rendered index is
    // already inside the trigger window, so the next page should be requested.
    const onLoadMore = vi.fn();
    render(
      <CampaignTable
        rows={rows.slice(0, 20)}
        sort={sort}
        onSort={vi.fn()}
        hiddenColumns={DEFAULT_HIDDEN_COLUMNS}
        density="comfortable"
        hasNextPage
        onLoadMore={onLoadMore}
      />,
    );
    expect(onLoadMore).toHaveBeenCalled();
  });
});
