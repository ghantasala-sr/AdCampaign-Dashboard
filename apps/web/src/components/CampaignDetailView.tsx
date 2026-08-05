'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Keyword } from '@adsight/types';
import {
  Badge,
  Card,
  CardHeader,
  CampaignStatusBadge,
  PacingBadge,
  ServingStatusBadge,
  Skeleton,
  StatTile,
  formatCentsAsCurrency,
  formatCount,
  formatRate,
  formatRatio,
  humanizeEnum,
} from '@adsight/ui';

import { useCampaignDetail } from '@/hooks/useCampaignDetail';
import { DegradedBanner } from './DegradedBanner';
import { LazyCampaignChart } from './lazy/LazyCampaignChart';

export function CampaignDetailView({ id }: { readonly id: string }) {
  const { data, isLoading, error } = useCampaignDetail(id);
  const [tab, setTab] = useState<'adGroups' | 'keywords'>('adGroups');

  // Keywords are grouped once rather than filtered inside the render of each ad
  // group row, which would be quadratic over a campaign with many keywords.
  const keywordsByAdGroup = useMemo(() => {
    const map = new Map<string, Keyword[]>();
    if (!data) return map;
    for (const keyword of data.keywords) {
      const bucket = map.get(keyword.adGroupId);
      if (bucket) bucket.push(keyword);
      else map.set(keyword.adGroupId, [keyword]);
    }
    return map;
  }, [data]);

  if (error) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-lg rounded-lg border border-rose-200 bg-rose-50 p-4">
          <h2 className="text-sm font-semibold text-rose-900">Could not load this campaign</h2>
          <p className="mt-1 text-sm text-rose-800">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <Link href="/" className="mt-3 inline-block text-sm text-rose-900 underline">
            Back to campaigns
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { row, adGroups, timeSeries, meta } = data;
  const { campaign, app, metrics, pacing } = row;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <DegradedBanner degraded={meta.degraded} />

      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <Link href="/" className="text-xs text-slate-500 hover:text-slate-900">
          ← All campaigns
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-900">{campaign.name}</h1>
          <CampaignStatusBadge status={campaign.status} />
          <ServingStatusBadge status={campaign.servingStatus} />
          {pacing ? <PacingBadge state={pacing.pacingState} /> : null}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {app ? `${app.appName} · ${app.developerName} · ${app.genre}` : campaign.adamId} ·{' '}
          {campaign.countriesOrRegions.join(', ')} · Billed on {humanizeEnum(campaign.billingEvent)}
        </p>
        {campaign.servingStateReasons.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {campaign.servingStateReasons.map((reason) => (
              <Badge key={reason} tone="warning">
                {humanizeEnum(reason)}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 bg-white md:grid-cols-4 lg:grid-cols-7">
        <StatTile label="Spend" value={formatCentsAsCurrency(metrics.spendCents)} />
        <StatTile label="Impressions" value={formatCount(metrics.impressions)} />
        <StatTile label="Taps" value={formatCount(metrics.taps)} secondary={formatRatio(metrics.ttr)} />
        <StatTile
          label="Installs"
          value={formatCount(metrics.installs)}
          secondary={formatRatio(metrics.conversionRate)}
        />
        <StatTile label="Redownloads" value={formatCount(metrics.redownloads)} />
        <StatTile label="Avg CPA" value={formatRate(metrics.avgCPA)} />
        <StatTile label="Avg CPT" value={formatRate(metrics.avgCPT)} />
      </dl>

      <div className="grid gap-4 p-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Daily performance"
            description={`${meta.resolvedDateRange.start} → ${meta.resolvedDateRange.end}`}
          />
          <div className="p-4">
            <LazyCampaignChart points={timeSeries} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Budget" />
          <dl className="divide-y divide-slate-100">
            <Row label="Daily budget" value={`$${campaign.dailyBudgetAmount.amount}`} />
            <Row label="Total budget" value={`$${campaign.budgetAmount.amount}`} />
            {pacing ? (
              <>
                <Row
                  label="Today's pace"
                  value={`${(pacing.dailySpendRatio * 100).toFixed(0)}% of daily budget`}
                />
                <Row label="Projected today" value={`$${pacing.projectedDailySpend.amount}`} />
              </>
            ) : (
              <Row label="Today's pace" value="Unavailable" />
            )}
            <Row label="Supply sources" value={campaign.supplySources.map(humanizeEnum).join(', ')} />
            <Row label="Started" value={campaign.startTime} />
            <Row label="Ends" value={campaign.endTime ?? 'No end date'} />
          </dl>
        </Card>
      </div>

      <div className="px-4 pb-6">
        <Card>
          <CardHeader
            title="Structure"
            actions={
              <div className="flex rounded-md ring-1 ring-slate-300 ring-inset">
                {(['adGroups', 'keywords'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTab(option)}
                    aria-pressed={tab === option}
                    className={
                      tab === option
                        ? 'h-7 bg-slate-900 px-2.5 text-xs font-medium text-white first:rounded-l-md last:rounded-r-md'
                        : 'h-7 px-2.5 text-xs font-medium text-slate-600 first:rounded-l-md last:rounded-r-md hover:bg-slate-50'
                    }
                  >
                    {option === 'adGroups'
                      ? `Ad groups (${adGroups.length})`
                      : `Keywords (${data.keywords.length})`}
                  </button>
                ))}
              </div>
            }
          />

          {tab === 'adGroups' ? (
            <ul className="divide-y divide-slate-100">
              {adGroups.map((adGroup) => (
                <li key={adGroup.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                    {adGroup.name}
                  </span>
                  <CampaignStatusBadge status={adGroup.status} />
                  <span className="w-28 text-right text-xs text-slate-500 tabular-nums">
                    Bid ${adGroup.defaultBidAmount.amount}
                  </span>
                  <span className="w-28 text-right text-xs text-slate-500 tabular-nums">
                    {adGroup.cpaGoal ? `CPA goal $${adGroup.cpaGoal.amount}` : 'No CPA goal'}
                  </span>
                  <span className="w-20 text-right text-xs text-slate-400">
                    {keywordsByAdGroup.get(adGroup.id)?.length ?? 0} kw
                  </span>
                </li>
              ))}
              {adGroups.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-slate-500">
                  This campaign has no ad groups yet.
                </li>
              ) : null}
            </ul>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.keywords.map((keyword) => (
                <li key={keyword.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-slate-800">{keyword.text}</span>
                  <Badge tone={keyword.matchType === 'EXACT' ? 'info' : 'neutral'}>
                    {humanizeEnum(keyword.matchType)}
                  </Badge>
                  <CampaignStatusBadge status={keyword.status} />
                  <span className="w-24 text-right text-xs text-slate-500 tabular-nums">
                    ${keyword.bidAmount.amount}
                  </span>
                </li>
              ))}
              {data.keywords.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-slate-500">
                  This campaign has no keywords yet.
                </li>
              ) : null}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  );
}
