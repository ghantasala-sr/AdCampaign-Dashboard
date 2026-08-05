import type { Campaign, MetricSummary, SortSpec } from '@adsight/types';

/**
 * Sorting happens server-side because the client only ever holds one page.
 * Comparators are total — ties break on campaign id — so paging is stable and a
 * row cannot appear on two consecutive pages.
 */

export interface SortableRow {
  readonly campaign: Campaign;
  readonly metrics: MetricSummary;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function sortRows<T extends SortableRow>(rows: T[], sort: SortSpec): T[] {
  const dir = sort.direction === 'asc' ? 1 : -1;

  const compare = (a: T, b: T): number => {
    let primary: number;
    switch (sort.field) {
      case 'name':
        primary = collator.compare(a.campaign.name, b.campaign.name);
        break;
      case 'status':
        primary = collator.compare(a.campaign.status, b.campaign.status);
        break;
      case 'createdAt':
        primary = a.campaign.createdAt < b.campaign.createdAt ? -1 : a.campaign.createdAt > b.campaign.createdAt ? 1 : 0;
        break;
      default:
        primary = a.metrics[sort.field] - b.metrics[sort.field];
        break;
    }
    if (primary !== 0) return primary * dir;
    // Stable tiebreaker, always ascending, so direction flips don't reshuffle ties.
    return collator.compare(a.campaign.id, b.campaign.id);
  };

  return rows.sort(compare);
}
