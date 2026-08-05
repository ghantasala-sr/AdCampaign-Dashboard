'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupplySource } from '@adsight/types';
import { Button, humanizeEnum } from '@adsight/ui';

import { useCreateCampaign, useFacets } from '@/hooks/useCampaigns';
import { ApiError } from '@/lib/api';

/**
 * Create flow.
 *
 * Server validation is authoritative: the BFF returns field-keyed messages and
 * they are rendered against the matching input. Client-side checks exist only to
 * keep the submit button honest — duplicating the full rule set here is how the
 * two drift apart.
 */

const SUPPLY_SOURCES: readonly SupplySource[] = [
  'APPSTORE_SEARCH_RESULTS',
  'APPSTORE_SEARCH_TAB',
  'APPSTORE_TODAY_TAB',
  'APPSTORE_PRODUCT_PAGES_BROWSE',
];

export interface CreateCampaignDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (id: string) => void;
}

export function CreateCampaignDialog({ open, onClose, onCreated }: CreateCampaignDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const facets = useFacets();
  const mutation = useCreateCampaign();

  const [name, setName] = useState('');
  const [adamId, setAdamId] = useState('');
  const [dailyBudget, setDailyBudget] = useState('250');
  const [totalBudget, setTotalBudget] = useState('7500');
  const [countries, setCountries] = useState<string[]>(['US']);
  const [sources, setSources] = useState<SupplySource[]>(['APPSTORE_SEARCH_RESULTS']);

  // `showModal` gives focus trapping and Escape handling from the platform
  // rather than a hand-rolled focus manager.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  /**
   * Depends on `mutation.reset`, not `mutation`.
   *
   * `useMutation` returns a fresh object every render, so listing `mutation` here
   * re-runs the effect on every render; `reset()` then notifies its observers,
   * which renders again, which re-runs the effect. That is an unbounded loop, and
   * because this dialog stays mounted while closed it fires on page load — it
   * showed up as React error #185 with the URL never updating, since the loop
   * starved every other effect.
   *
   * `reset` itself is referentially stable, so pulling it out fixes the cycle.
   */
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) return;
    resetMutation();
    setName('');
  }, [open, resetMutation]);

  const firstApp = facets.data?.apps[0]?.adamId;
  useEffect(() => {
    if (adamId === '' && firstApp) setAdamId(firstApp);
  }, [adamId, firstApp]);

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fields : undefined;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate(
      {
        name: name.trim(),
        adamId,
        dailyBudgetAmount: dailyBudget,
        budgetAmount: totalBudget,
        currency: 'USD',
        countriesOrRegions: countries,
        supplySources: sources,
        billingEvent: 'TAPS',
      },
      {
        onSuccess: (result) => {
          onCreated(result.campaign.id);
          onClose();
        },
      },
    );
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="w-[32rem] max-w-[92vw] rounded-lg p-0 backdrop:bg-slate-900/40"
      data-testid="create-campaign-dialog"
    >
      <form onSubmit={onSubmit}>
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">New campaign</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Created campaigns start on hold with no delivery history.
          </p>
        </div>

        <div className="space-y-3 px-4 py-4">
          <Field label="Campaign name" error={fieldErrors?.name}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="US - Brand - Core"
              className="h-9 w-full rounded-md bg-white px-2.5 text-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-blue-500 focus:outline-none"
              data-testid="campaign-name"
            />
          </Field>

          <Field label="App" error={fieldErrors?.adamId}>
            <select
              value={adamId}
              onChange={(event) => setAdamId(event.target.value)}
              className="h-9 w-full rounded-md bg-white px-2 text-sm ring-1 ring-slate-300 ring-inset"
              data-testid="campaign-app"
            >
              {(facets.data?.apps ?? []).map((app) => (
                <option key={app.adamId} value={app.adamId}>
                  {app.appName} — {app.developerName}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Daily budget (USD)" error={fieldErrors?.dailyBudgetAmount}>
              <input
                value={dailyBudget}
                onChange={(event) => setDailyBudget(event.target.value)}
                inputMode="decimal"
                className="h-9 w-full rounded-md bg-white px-2.5 text-sm tabular-nums ring-1 ring-slate-300 ring-inset"
                data-testid="campaign-daily-budget"
              />
            </Field>
            <Field label="Total budget (USD)" error={fieldErrors?.budgetAmount}>
              <input
                value={totalBudget}
                onChange={(event) => setTotalBudget(event.target.value)}
                inputMode="decimal"
                className="h-9 w-full rounded-md bg-white px-2.5 text-sm tabular-nums ring-1 ring-slate-300 ring-inset"
                data-testid="campaign-total-budget"
              />
            </Field>
          </div>

          <Field label="Countries or regions" error={fieldErrors?.countriesOrRegions}>
            <div className="flex flex-wrap gap-1">
              {(facets.data?.countriesOrRegions ?? []).slice(0, 12).map((country) => {
                const active = countries.includes(country);
                return (
                  <button
                    key={country}
                    type="button"
                    onClick={() =>
                      setCountries((prev) =>
                        prev.includes(country) ? prev.filter((c) => c !== country) : [...prev, country],
                      )
                    }
                    aria-pressed={active}
                    className={
                      active
                        ? 'rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white'
                        : 'rounded bg-white px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-300 ring-inset hover:bg-slate-50'
                    }
                  >
                    {country}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Supply sources" error={fieldErrors?.supplySources}>
            <div className="space-y-1">
              {SUPPLY_SOURCES.map((source) => (
                <label key={source} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={sources.includes(source)}
                    onChange={() =>
                      setSources((prev) =>
                        prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source],
                      )
                    }
                    className="size-3.5 rounded border-slate-300 text-blue-600"
                  />
                  {humanizeEnum(source)}
                </label>
              ))}
            </div>
          </Field>

          {mutation.error && !fieldErrors ? (
            <p className="text-xs text-rose-600" data-testid="create-error">
              {mutation.error instanceof Error ? mutation.error.message : 'Could not create campaign'}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={mutation.isPending || name.trim() === ''}
            data-testid="submit-campaign"
          >
            {mutation.isPending ? 'Creating…' : 'Create campaign'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function Field({
  label,
  error,
  children,
}: {
  readonly label: string;
  readonly error?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      <div className="mt-1">{children}</div>
      {error ? (
        <p className="mt-1 text-xs text-rose-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
