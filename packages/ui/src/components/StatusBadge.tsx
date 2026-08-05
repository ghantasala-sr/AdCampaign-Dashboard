import type { CampaignStatus, ServingStatus, BudgetPacing } from '@adsight/types';
import { Badge, type BadgeTone } from './Badge.js';
import { humanizeEnum } from '../lib/format.js';

/**
 * Maps domain enums to visual tone in one place. Lives in `packages/ui` rather
 * than in the web app because it depends on `@adsight/types` and is used by both
 * the campaign table and the drill-in view.
 */

const STATUS_TONE: Readonly<Record<CampaignStatus, BadgeTone>> = {
  ENABLED: 'positive',
  PAUSED: 'neutral',
};

const SERVING_TONE: Readonly<Record<ServingStatus, BadgeTone>> = {
  RUNNING: 'positive',
  NOT_RUNNING: 'warning',
};

const PACING_TONE: Readonly<Record<BudgetPacing['pacingState'], BadgeTone>> = {
  UNDER_PACING: 'info',
  ON_PACE: 'positive',
  OVER_PACING: 'warning',
  CAPPED: 'critical',
};

export function CampaignStatusBadge({ status }: { readonly status: CampaignStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {humanizeEnum(status)}
    </Badge>
  );
}

export function ServingStatusBadge({ status }: { readonly status: ServingStatus }) {
  return <Badge tone={SERVING_TONE[status]}>{humanizeEnum(status)}</Badge>;
}

export function PacingBadge({ state }: { readonly state: BudgetPacing['pacingState'] }) {
  return <Badge tone={PACING_TONE[state]}>{humanizeEnum(state)}</Badge>;
}
