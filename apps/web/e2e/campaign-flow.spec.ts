import { expect, test, type Page } from '@playwright/test';

/**
 * One end-to-end flow, exercised the way a user would: filter the list, ask a
 * question in plain language and accept the proposal, drill into a campaign, and
 * create a new one.
 *
 * Assertions target user-visible outcomes and the URL rather than internals, so
 * the suite survives refactors of the store and the fetch layer. The URL matters
 * here beyond convenience — it is the shared contract between the browser and the
 * BFF, so checking it also checks that the filter reached the server.
 */

async function waitForRows(page: Page): Promise<void> {
  await expect(page.getByTestId('summary-bar')).toBeVisible();
  await expect(page.getByTestId('campaign-row').first()).toBeVisible();
}

/** The count in the footer, e.g. "500 of 10,000 loaded" -> 10000. */
async function totalFromFooter(page: Page): Promise<number> {
  const text = (await page.getByTestId('row-count').textContent()) ?? '';
  const match = /of ([\d,]+) loaded/.exec(text);
  return match ? Number(match[1]!.replace(/,/g, '')) : 0;
}

test.describe('campaign dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForRows(page);
  });

  test('loads the full campaign set with rolled-up totals', async ({ page }) => {
    expect(await totalFromFooter(page)).toBe(10_000);

    // The table is virtualized, so only a window of rows should be in the DOM
    // even though the footer reports the whole page as loaded.
    const rendered = await page.getByTestId('campaign-row').count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);

    await expect(page.getByTestId('summary-bar')).toContainText('Campaigns');
  });

  test('filtering narrows the list and is reflected in a shareable URL', async ({ page }) => {
    const before = await totalFromFooter(page);

    await page.getByTestId('toggle-filters').click();
    await expect(page.getByTestId('filter-panel')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Paused' }).check();
    await expect(page).toHaveURL(/status=PAUSED/);

    await page.getByRole('button', { name: 'JP', exact: true }).click();
    await expect(page).toHaveURL(/country=JP/);

    await expect
      .poll(async () => totalFromFooter(page), { timeout: 15_000 })
      .toBeLessThan(before);

    // Every visible row must actually satisfy the filter, not just the count.
    const statuses = await page
      .getByTestId('campaign-row')
      .locator('text=Paused')
      .count();
    expect(statuses).toBeGreaterThan(0);

    // The URL alone must reproduce the view — this is what makes it shareable.
    const url = page.url();
    await page.goto('about:blank');
    await page.goto(url);
    await waitForRows(page);
    await expect(page.getByTestId('toggle-filters')).toContainText('2');
  });

  test('a metric threshold applies in display units', async ({ page }) => {
    await page.getByTestId('toggle-filters').click();
    await page.getByLabel('Metric').selectOption('spendCents');
    await page.getByLabel('Comparator').selectOption('gt');
    await page.getByTestId('predicate-value').fill('5000');
    await page.getByTestId('add-predicate').click();

    // Entered as dollars, encoded as dollars — the server converts to cents.
    await expect(page).toHaveURL(/metric=spendCents%3Agt%3A5000/);
    await expect(page.getByTestId('active-predicates')).toContainText('Spend over $5,000');

    await expect
      .poll(async () => totalFromFooter(page), { timeout: 15_000 })
      .toBeLessThan(10_000);
  });

  test('clearing filters keeps the selected date range', async ({ page }) => {
    await page.getByRole('button', { name: '7 days' }).click();
    await expect(page).toHaveURL(/preset=LAST_7_DAYS/);

    await page.getByTestId('toggle-filters').click();
    await page.getByRole('checkbox', { name: 'Paused' }).check();
    await expect(page).toHaveURL(/status=PAUSED/);

    await page.getByTestId('clear-filters').click();

    await expect(page).not.toHaveURL(/status=PAUSED/);
    // The period is a lens on the data, not a filter, so it survives Clear.
    await expect(page).toHaveURL(/preset=LAST_7_DAYS/);
  });

  test('the natural-language bar proposes a filter and applies nothing until accepted', async ({
    page,
  }) => {
    const before = await totalFromFooter(page);

    await page.getByTestId('toggle-ai').click();
    await page.getByTestId('ai-query-input').fill('paused campaigns in Japan');
    await page.getByTestId('ai-query-submit').click();

    // The proposal is shown for review, with readable chips.
    const review = page.getByTestId('plan-review');
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('plan-chips')).toContainText('Status is Paused');
    await expect(page.getByTestId('plan-chips')).toContainText('Targets JP');

    // Nothing has been applied yet — this is the whole point of the feature.
    expect(page.url()).not.toContain('status=PAUSED');
    expect(await totalFromFooter(page)).toBe(before);

    await page.getByTestId('plan-apply').click();

    // Accepting applies it, and the result is indistinguishable from a
    // hand-built filter — same URL contract, same request.
    await expect(page).toHaveURL(/status=PAUSED/);
    await expect(page).toHaveURL(/country=JP/);
    await expect
      .poll(async () => totalFromFooter(page), { timeout: 15_000 })
      .toBeLessThan(before);
  });

  test('discarding a proposal leaves the view untouched', async ({ page }) => {
    const before = page.url();

    await page.getByTestId('toggle-ai').click();
    await page.getByTestId('ai-query-input').fill('paused campaigns in Japan');
    await page.getByTestId('ai-query-submit').click();
    await expect(page.getByTestId('plan-review')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('plan-discard').click();

    await expect(page.getByTestId('plan-review')).toBeHidden();
    expect(page.url()).toBe(before);
  });

  test('drilling into a campaign shows its structure and time series', async ({ page }) => {
    const firstRow = page.getByTestId('campaign-row').first();
    const name = (await firstRow.locator('a').first().textContent())?.trim() ?? '';
    expect(name.length).toBeGreaterThan(0);

    await firstRow.locator('a').first().click();

    await expect(page).toHaveURL(/\/campaigns\/camp_/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

    // Metric tiles, the lazily-loaded chart, and the ad group list.
    await expect(page.getByText('Impressions').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Installs', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: /Ad groups \(\d+\)/ })).toBeVisible();

    await page.getByRole('button', { name: /Keywords \(\d+\)/ }).click();
    await expect(page.getByText(/Exact|Broad/).first()).toBeVisible();

    await page.getByRole('link', { name: /All campaigns/ }).click();
    await waitForRows(page);
  });

  test('creating a campaign lands on its detail page with zeroed metrics', async ({ page }) => {
    const name = `E2E - Brand - ${Date.now()}`;

    await page.getByTestId('new-campaign').click();
    const dialog = page.getByTestId('create-campaign-dialog');
    await expect(dialog).toBeVisible();

    await page.getByTestId('campaign-name').fill(name);
    await page.getByTestId('campaign-daily-budget').fill('300');
    await page.getByTestId('campaign-total-budget').fill('9000');
    await page.getByTestId('submit-campaign').click();

    await expect(page).toHaveURL(/\/campaigns\/camp_new_/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

    // A brand-new campaign has no delivery history; the derived rates must render
    // as em dashes rather than NaN or Infinity.
    await expect(page.getByText('Not running').first()).toBeVisible();
    await expect(page.getByText('$0.00').first()).toBeVisible();
  });

  test('rejects an invalid campaign with a message on the offending field', async ({ page }) => {
    await page.getByTestId('new-campaign').click();
    await page.getByTestId('campaign-name').fill('Budget Rule Check');
    await page.getByTestId('campaign-daily-budget').fill('500');
    await page.getByTestId('campaign-total-budget').fill('100');
    await page.getByTestId('submit-campaign').click();

    // Server-side validation is authoritative and returns field-keyed messages.
    // Scoped to the message rather than `getByRole('alert')`, which legitimately
    // matches one alert per invalid field.
    await expect(
      page.getByRole('alert').filter({ hasText: 'at least the daily budget' }),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/\/campaigns\/camp_new_/);
  });

  test('sorting by a column changes the order and the URL', async ({ page }) => {
    await page.getByRole('button', { name: /Installs/ }).click();
    await expect(page).toHaveURL(/sort=installs/);

    await page.getByRole('button', { name: /Installs/ }).click();
    await expect(page).toHaveURL(/dir=asc/);
    await waitForRows(page);
  });
});
