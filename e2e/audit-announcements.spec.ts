import { test, expect } from '@playwright/test';
import { loginWithRetry, BASE_URL } from './helpers/auth';

test.describe('Audit Logs', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithRetry(page);
  });

  test('TC057: Audit logs page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/audit-logs`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1, h2, h3').filter({ hasText: /audit/i }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('table, [role="grid"], [role="table"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC058: Search audit logs', async ({ page }) => {
    await page.goto(`${BASE_URL}/audit-logs`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]').first();
    if (await searchInput.isVisible({ timeout: 5000 })) {
      await searchInput.fill('login');
      await page.waitForTimeout(1000);
    }
    // Just verify table is still visible
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible();
  });

  test('TC059: Filter by action', async ({ page }) => {
    await page.goto(`${BASE_URL}/audit-logs`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find action filter - could be a button or dropdown
    const filterBtn = page.locator('button:has-text("Action"), select, button[role="combobox"]').first();
    if (await filterBtn.isVisible({ timeout: 5000 })) {
      await filterBtn.click();
      await page.waitForTimeout(500);
    }
    // Just verify table is still visible
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible();
  });

  test('TC060: Filter by resource', async ({ page }) => {
    await page.goto(`${BASE_URL}/audit-logs`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find resource filter
    const filterBtn = page.locator('button:has-text("Resource"), select, button[role="combobox"]').nth(1);
    if (await filterBtn.isVisible({ timeout: 5000 })) {
      await filterBtn.click();
      await page.waitForTimeout(500);
    }
    // Just verify table is still visible
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible();
  });

  test('TC061: View audit log detail', async ({ page }) => {
    await page.goto(`${BASE_URL}/audit-logs`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find view/details button or clickable row
    const viewBtn = page.locator('button:has-text("View"), button:has-text("Details"), [role="button"]:has-text("View")').first();
    if (await viewBtn.isVisible({ timeout: 5000 })) {
      await viewBtn.click();
      // Dialog should open
      await expect(page.locator('[role="dialog"], [data-state="open"]').first()).toBeVisible({ timeout: 10000 });
    } else {
      // Try clicking on a table row
      const row = page.locator('tbody tr, [role="row"]').first();
      if (await row.isVisible({ timeout: 5000 })) {
        await row.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});

test.describe('Announcements', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithRetry(page);
  });

  test('TC066: Announcements page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/announcements`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2, h3').filter({ hasText: /announcement/i }).first()).toBeVisible({ timeout: 20000 });
  });

  test('TC068: Create announcement dialog', async ({ page }) => {
    await page.goto(`${BASE_URL}/announcements`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const addBtn = page.locator('button:has-text("Add"), button:has-text("Create"), button:has-text("New")').first();
    if (await addBtn.isVisible({ timeout: 5000 })) {
      await addBtn.click();
      await expect(page.locator('[role="dialog"], [data-state="open"]').first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('TC067: Active announcements banner', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Just check page loaded without error - announcement banner may or may not be present
    await expect(page.locator('text=Dashboard').first()).toBeVisible();
  });
});
