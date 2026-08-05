import type { CampaignRow, SortableField } from '@adsight/types';
import {
  formatCentsAsCurrency,
  formatCompact,
  formatRate,
  formatRatio,
} from '@adsight/ui';

/**
 * Column definitions, shared by the optimized table and the naive baseline so
 * the performance comparison is between rendering strategies and not between two
 * different amounts of work.
 *
 * `value` returns a string. Formatting a cell is therefore a pure function of the
 * row, which is what lets the row component be memoized on row identity alone.
 */

export interface ColumnDef {
  readonly id: string;
  readonly header: string;
  /** Set when the column can be sorted server-side. */
  readonly sortField?: SortableField;
  /** Fixed pixel width; the table is a CSS grid, not an auto-layout table. */
  readonly width: number;
  readonly align: 'left' | 'right';
  readonly value: (row: CampaignRow) => string;
  /** Hidden by default but available from the column menu. */
  readonly optional?: boolean;
}

export const COLUMNS: readonly ColumnDef[] = [
  {
    id: 'name',
    header: 'Campaign',
    sortField: 'name',
    width: 300,
    align: 'left',
    value: (row) => row.campaign.name,
  },
  {
    id: 'status',
    header: 'Status',
    sortField: 'status',
    width: 108,
    align: 'left',
    value: (row) => row.campaign.status,
  },
  {
    id: 'serving',
    header: 'Serving',
    width: 116,
    align: 'left',
    value: (row) => row.campaign.servingStatus,
  },
  {
    id: 'app',
    header: 'App',
    width: 150,
    align: 'left',
    value: (row) => row.app?.appName ?? '—',
  },
  {
    id: 'spend',
    header: 'Spend',
    sortField: 'spendCents',
    width: 110,
    align: 'right',
    value: (row) => formatCentsAsCurrency(row.metrics.spendCents),
  },
  {
    id: 'impressions',
    header: 'Impressions',
    sortField: 'impressions',
    width: 104,
    align: 'right',
    value: (row) => formatCompact(row.metrics.impressions),
  },
  {
    id: 'taps',
    header: 'Taps',
    sortField: 'taps',
    width: 88,
    align: 'right',
    value: (row) => formatCompact(row.metrics.taps),
  },
  {
    id: 'ttr',
    header: 'TTR',
    sortField: 'ttr',
    width: 84,
    align: 'right',
    value: (row) => formatRatio(row.metrics.ttr),
  },
  {
    id: 'installs',
    header: 'Installs',
    sortField: 'installs',
    width: 92,
    align: 'right',
    value: (row) => formatCompact(row.metrics.installs),
  },
  {
    id: 'conversionRate',
    header: 'CVR',
    sortField: 'conversionRate',
    width: 84,
    align: 'right',
    value: (row) => formatRatio(row.metrics.conversionRate),
  },
  {
    id: 'avgCPA',
    header: 'Avg CPA',
    sortField: 'avgCPA',
    width: 96,
    align: 'right',
    value: (row) => formatRate(row.metrics.avgCPA),
  },
  {
    id: 'avgCPT',
    header: 'Avg CPT',
    sortField: 'avgCPT',
    width: 96,
    align: 'right',
    value: (row) => formatRate(row.metrics.avgCPT),
    optional: true,
  },
  {
    id: 'avgCPM',
    header: 'Avg CPM',
    sortField: 'avgCPM',
    width: 96,
    align: 'right',
    value: (row) => formatRate(row.metrics.avgCPM),
    optional: true,
  },
  {
    id: 'redownloads',
    header: 'Redownloads',
    sortField: 'redownloads',
    width: 108,
    align: 'right',
    value: (row) => formatCompact(row.metrics.redownloads),
    optional: true,
  },
  {
    id: 'pacing',
    header: 'Pacing',
    width: 118,
    align: 'left',
    value: (row) => row.pacing?.pacingState ?? '—',
  },
  {
    id: 'trend',
    header: 'Spend trend',
    width: 96,
    align: 'left',
    value: () => '',
  },
];

export const DEFAULT_HIDDEN_COLUMNS: readonly string[] = COLUMNS.filter((c) => c.optional).map(
  (c) => c.id,
);

export function visibleColumns(hidden: readonly string[]): ColumnDef[] {
  return COLUMNS.filter((column) => !hidden.includes(column.id));
}

export function gridTemplate(columns: readonly ColumnDef[]): string {
  return columns.map((column) => `${column.width}px`).join(' ');
}

export const ROW_HEIGHT_COMFORTABLE = 44;
export const ROW_HEIGHT_COMPACT = 32;
