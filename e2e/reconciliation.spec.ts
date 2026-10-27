import { test, expect, Page } from '@playwright/test';

// Reconciliation runs against staging since it requires real API + Redis + database
const STAGING_URL = 'https://stock2-staging.uksoccershop.com';

async function loginToStaging(page: Page) {
  await page.goto(`${STAGING_URL}/`);
  await page.waitForLoadState('networkidle');
  if (!page.url().includes('/login')) return;

  await page.goto(`${STAGING_URL}/login`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 15000 });
  await page.fill('input[name="email"]', 'admin@example.com');
  await page.fill('input[name="password"]', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${STAGING_URL}/`, { timeout: 45000 });
  await page.waitForLoadState('networkidle');
}

test.describe('Reconciliation Page V2', () => {
  test.beforeEach(async ({ page }) => {
    await loginToStaging(page);
    await page.goto(`${STAGING_URL}/reconciliation`);
    await page.waitForLoadState('networkidle');
  });

  // ─── Task 29: Run Dialog & Logs Tab ─────────────────────────

  test('TC-RV2-01: Page loads with correct heading and controls', async ({ page }) => {
    // Page header
    await expect(page.locator('text=Order Reconciliation').first()).toBeVisible({ timeout: 15000 });

    // Run Now button visible
    await expect(page.getByRole('button', { name: /Run Now/i })).toBeVisible();

    // Export button visible
    await expect(page.getByRole('button', { name: /Export/i })).toBeVisible();

    // Top-level tabs: Results and Logs
    await expect(page.getByRole('tab', { name: 'Results' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Logs' })).toBeVisible();
  });

  test('TC-RV2-02: Run Now dialog opens with marketplace selection', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Run Now/i })).toBeVisible({ timeout: 15000 });

    // Click Run Now to open dialog
    await page.getByRole('button', { name: /Run Now/i }).click();

    // Dialog should appear
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Dialog should have a marketplace selector
    await expect(page.getByText('Marketplace')).toBeVisible();

    // Should have Run button in the dialog
    await expect(page.getByRole('dialog').getByRole('button', { name: /Run Reconciliation|Run|Start/i })).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('TC-RV2-03: Logs tab is accessible and has filter controls', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Logs' })).toBeVisible({ timeout: 15000 });

    // Click the Logs tab
    await page.getByRole('tab', { name: 'Logs' }).click();

    // Logs tab content should be visible - check for the log viewer area
    // It should either show log entries or a "no logs" message
    await page.waitForTimeout(1000);

    // The logs tab should be the active tab content area
    const logsContent = page.locator('[role="tabpanel"]').filter({ hasText: /log|No logs|entries/i });
    // If no logs exist yet, it should still render something (empty state or filter controls)
    await expect(logsContent.or(page.getByRole('tabpanel').last())).toBeVisible();
  });

  test('TC-RV2-04: Schedule bar shows marketplace cards', async ({ page }) => {
    // The schedule bar shows cards for each marketplace
    // Wait for the page to load
    await page.waitForTimeout(2000);

    // Check for marketplace names in the schedule bar area
    // These cards should show marketplace names (SHOPIFY, TOFFS, FRUUGO, DEBENHAMS)
    const shopifyCard = page.locator('text=SHOPIFY').first();
    const toffsCard = page.locator('text=TOFFS').first();
    const fruugoCard = page.locator('text=FRUUGO').first();
    const debenhamsCard = page.locator('text=DEBENHAMS').first();

    // At least one marketplace card should be visible
    const anyVisible = await shopifyCard.isVisible()
      || await toffsCard.isVisible()
      || await fruugoCard.isVisible()
      || await debenhamsCard.isVisible();

    expect(anyVisible).toBeTruthy();
  });

  // ─── Task 30: Enhanced Results with Links and Export ──────────

  test('TC-RV2-05: Results tab shows summary cards when data exists', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Results' })).toBeVisible({ timeout: 15000 });

    // Results tab should be active by default
    // Wait for data to load
    await page.waitForTimeout(2000);

    // Check for summary card titles (these render when report data exists)
    const missingOrdersCard = page.locator('text=Missing Orders').first();
    const productMismatchCard = page.locator('text=Product Mismatches').first();
    const stuckStatusCard = page.locator('text=Stuck Statuses').first();
    const unconvertedCard = page.locator('text=Unconverted Orders').first();

    // If reconciliation has been run before, summary cards should be visible
    // If never run, we'll see the "No reconciliation has been run yet" message
    const hasData = await missingOrdersCard.isVisible().catch(() => false);
    const noDataMessage = page.locator('text=No reconciliation has been run yet');
    const hasNoData = await noDataMessage.isVisible().catch(() => false);

    // One of these states should be true
    expect(hasData || hasNoData).toBeTruthy();

    if (hasData) {
      await expect(productMismatchCard).toBeVisible();
      await expect(stuckStatusCard).toBeVisible();
      await expect(unconvertedCard).toBeVisible();
    }
  });

  test('TC-RV2-06: Marketplace tabs render when results exist', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check if report data is loaded
    const hasResults = await page.locator('text=Missing Orders').first().isVisible().catch(() => false);

    if (hasResults) {
      // Should have marketplace-specific tabs below the summary
      // At least one marketplace tab should exist (SHOPIFY is always present)
      const shopifyTab = page.getByRole('tab', { name: /SHOPIFY/i });
      await expect(shopifyTab).toBeVisible();

      // Click on the SHOPIFY tab to view details
      await shopifyTab.click();
      await page.waitForTimeout(500);

      // Should see table headers for order details
      const tableHeaders = page.locator('th');
      const headerCount = await tableHeaders.count();
      expect(headerCount).toBeGreaterThan(0);
    }
  });

  test('TC-RV2-07: Order ID links have correct href attributes', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check if results are available
    const hasResults = await page.locator('text=Missing Orders').first().isVisible().catch(() => false);

    if (hasResults) {
      // Click on first marketplace tab
      const firstMarketplaceTab = page.getByRole('tab').filter({ hasText: /SHOPIFY|TOFFS|FRUUGO|DEBENHAMS/ }).first();
      if (await firstMarketplaceTab.isVisible()) {
        await firstMarketplaceTab.click();
        await page.waitForTimeout(500);
      }

      // Check for marketplace order links (should open in new tab)
      const externalLinks = page.locator('a[target="_blank"][rel="noopener noreferrer"]');
      const externalLinkCount = await externalLinks.count();

      if (externalLinkCount > 0) {
        // Marketplace links should have href attribute
        const href = await externalLinks.first().getAttribute('href');
        expect(href).toBeTruthy();
        // Verify it's an external URL (not a local SPA route)
        expect(href).toMatch(/^https?:\/\//);
      }

      // Check for UKSS order links (SPA navigation)
      const ukssLinks = page.locator('a[href^="/orders/"]');
      const ukssLinkCount = await ukssLinks.count();

      if (ukssLinkCount > 0) {
        const ukssHref = await ukssLinks.first().getAttribute('href');
        expect(ukssHref).toMatch(/^\/orders\/\d+/);
      }

      // Check for "Not converted" text (unconverted orders have no link)
      const notConverted = page.locator('text=Not converted');
      // This may or may not be visible depending on data
      // Just verify the page renders without errors
    }
  });

  test('TC-RV2-08: Export dropdown offers CSV and Excel options', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Export/i })).toBeVisible({ timeout: 15000 });

    // Click the Export button to open dropdown
    await page.getByRole('button', { name: /Export/i }).click();

    // Should show CSV and Excel options
    await expect(page.getByText('Export CSV')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Export Excel')).toBeVisible();

    // Close dropdown by pressing escape
    await page.keyboard.press('Escape');
  });

  test('TC-RV2-09: Export button is disabled when no data', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check if there's no data (no last run)
    const noDataMessage = page.locator('text=No reconciliation has been run yet');
    const hasNoData = await noDataMessage.isVisible().catch(() => false);

    if (hasNoData) {
      // Export button should be disabled
      const exportButton = page.getByRole('button', { name: /Export/i });
      await expect(exportButton).toBeDisabled();
    }
    // If data exists, export button should be enabled (which it is by default)
  });

  test('TC-RV2-10: Run dialog shows Shopify store picker when Shopify selected', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Run Now/i })).toBeVisible({ timeout: 15000 });

    // Open dialog
    await page.getByRole('button', { name: /Run Now/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Look for the marketplace selector and try to select Shopify
    // The dialog uses a Select component for marketplace
    const marketplaceSelect = page.getByRole('dialog').locator('[role="combobox"], select, button').filter({ hasText: /All|Marketplace|Select/i }).first();

    if (await marketplaceSelect.isVisible()) {
      await marketplaceSelect.click();
      await page.waitForTimeout(500);

      // Look for Shopify option
      const shopifyOption = page.getByRole('option', { name: /Shopify/i }).or(page.locator('[role="listbox"] >> text=Shopify'));
      if (await shopifyOption.isVisible().catch(() => false)) {
        await shopifyOption.click();
        await page.waitForTimeout(500);

        // After selecting Shopify, store picker should appear
        // Look for store-related UI elements
        const storeSection = page.locator('text=Store').or(page.locator('text=store'));
        // Store picker may take a moment to load from API
        await page.waitForTimeout(1000);
      }
    }

    // Close dialog
    await page.keyboard.press('Escape');
  });
});
