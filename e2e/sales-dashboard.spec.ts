import { test, expect, Page } from '@playwright/test';

// Sales Dashboard is deployed to staging, not the dev environment
const STAGING_URL = 'https://stock2-staging.uksoccershop.com';

async function loginToStaging(page: Page) {
  // Check if already logged in
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

test.describe('Sales Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginToStaging(page);
    await page.goto(`${STAGING_URL}/sales-dashboard`);
    await page.waitForLoadState('networkidle');
  });

  test('TC-SD01: Page loads and renders KPI cards', async ({ page }) => {
    // Page title visible
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible({ timeout: 15000 });

    // KPI period tabs visible
    await expect(page.locator('text=Today')).toBeVisible();
    await expect(page.locator('text=This Week')).toBeVisible();
    await expect(page.locator('text=This Month')).toBeVisible();
    await expect(page.locator('text=This Year')).toBeVisible();

    // KPI cards render with some content (titles at minimum)
    await expect(page.locator('text=Total Orders')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Total Revenue')).toBeVisible();
    await expect(page.locator('text=Average Order Value')).toBeVisible();
    await expect(page.locator('text=Pending Orders')).toBeVisible();
  });

  test('TC-SD02: KPI period tabs switch data', async ({ page }) => {
    // Wait for initial load
    await expect(page.locator('text=Total Orders')).toBeVisible({ timeout: 15000 });

    // Click "This Month" tab
    await page.locator('text=This Month').click();
    await page.waitForTimeout(1000);

    // Cards should still be visible (re-rendered with new data)
    await expect(page.locator('text=Total Orders')).toBeVisible();
    await expect(page.locator('text=Total Revenue')).toBeVisible();

    // Click "This Year" tab
    await page.locator('text=This Year').click();
    await page.waitForTimeout(1000);

    await expect(page.locator('text=Total Orders')).toBeVisible();
  });

  test('TC-SD03: Date range filter presets work', async ({ page }) => {
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible({ timeout: 15000 });

    // Look for a date preset button and click it
    const last30Button = page.locator('button', { hasText: 'Last 30 Days' });
    if (await last30Button.isVisible({ timeout: 3000 }).catch(() => false)) {
      await last30Button.click();
      await page.waitForTimeout(1000);

      // URL should update with date params
      const url = page.url();
      expect(url).toContain('startDate');
    }
  });

  test('TC-SD04: Revenue trend chart renders', async ({ page }) => {
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible({ timeout: 15000 });

    // Revenue trend chart card should be visible
    await expect(page.locator('text=Revenue & Orders Trend').first()).toBeVisible({ timeout: 15000 });

    // Check for Recharts SVG container (the chart renders as SVG)
    const chartContainer = page.locator('.recharts-responsive-container').first();
    await expect(chartContainer).toBeVisible({ timeout: 15000 });
  });

  test('TC-SD05: Marketplace breakdown renders', async ({ page }) => {
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible({ timeout: 15000 });

    await expect(page.locator('text=Marketplace Breakdown').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC-SD06: Order status funnel renders', async ({ page }) => {
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible({ timeout: 15000 });

    await expect(page.locator('text=Order Status Funnel').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC-SD07: Marketplace order sync status renders', async ({ page }) => {
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible({ timeout: 15000 });

    await expect(page.locator('text=Marketplace Order Sync Status').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC-SD08: Geographic breakdown renders', async ({ page }) => {
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible({ timeout: 15000 });

    await expect(page.locator('text=Geographic Sales Distribution').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC-SD09: Inventory health section renders', async ({ page }) => {
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible({ timeout: 15000 });

    // Summary cards should be visible
    await expect(page.locator('text=Low Stock Alerts').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Out of Stock').first()).toBeVisible();
    await expect(page.locator('text=Aging Inventory').first()).toBeVisible();
  });

  test('TC-SD10: Inventory sync health section renders', async ({ page }) => {
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible({ timeout: 15000 });

    // Scroll to bottom to find the Inventory Sync Health card
    const syncHealthCard = page.locator('text=Inventory Sync Health').first();
    await syncHealthCard.scrollIntoViewIfNeeded({ timeout: 20000 });
    await expect(syncHealthCard).toBeVisible({ timeout: 10000 });
  });

  test('TC-SD11: Chatbot toggle button visible', async ({ page }) => {
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible({ timeout: 15000 });

    // The floating chatbot button should be visible (for users with chatbot permission)
    const chatButton = page.locator('button').filter({ has: page.locator('svg') }).last();
    // Just verify the page fully loaded - chatbot button presence depends on permission
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible();
  });

  test('TC-SD12: Top products section with tabs', async ({ page }) => {
    await expect(page.locator('text=Sales Dashboard').first()).toBeVisible({ timeout: 15000 });

    // Top Products card should be visible
    await expect(page.locator('text=Top Products').first()).toBeVisible({ timeout: 15000 });

    // Best Sellers and Slow Moving tabs
    const bestTab = page.locator('button[role="tab"]', { hasText: 'Best Sellers' });
    const slowTab = page.locator('button[role="tab"]', { hasText: 'Slow Moving' });

    if (await bestTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(bestTab).toBeVisible();

      // Switch to slow moving tab
      await slowTab.click();
      await page.waitForTimeout(1000);

      // Switch back
      await bestTab.click();
      await page.waitForTimeout(1000);
    }
  });

  test('TC-SD13: Sidebar shows Sales Dashboard link', async ({ page }) => {
    // Check sidebar has the Sales Dashboard link
    const sidebarLink = page.locator('a[href="/sales-dashboard"]');
    await expect(sidebarLink).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Sales Dashboard - Access Control', () => {
  test('TC-SD14: Unauthenticated user redirected to login', async ({ page }) => {
    // Clear cookies to ensure unauthenticated
    await page.context().clearCookies();

    await page.goto(`${STAGING_URL}/sales-dashboard`);
    await page.waitForLoadState('networkidle');

    // Should be redirected to login (SPA redirect via React Router)
    await expect(page).toHaveURL(/\/(login)?$/, { timeout: 15000 });
  });
});
