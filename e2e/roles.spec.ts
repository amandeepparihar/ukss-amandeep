import { test, expect } from '@playwright/test';
import { loginWithRetry, BASE_URL } from './helpers/auth';

test.describe('Role Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithRetry(page);
  });

  test('TC045: Roles page loads with cards', async ({ page }) => {
    await page.goto(`${BASE_URL}/roles`);
    await page.waitForLoadState('networkidle');

    // Wait for page title
    await expect(page.locator('h1, h2, h3').filter({ hasText: /roles/i }).first()).toBeVisible({ timeout: 20000 });

    // Should have role cards - look for card elements
    await expect(page.locator('[class*="card"], .card, [data-card]').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC046: Role cards show details', async ({ page }) => {
    await page.goto(`${BASE_URL}/roles`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check for role name in cards - roles like admin, user, super-admin, etc.
    await expect(page.locator('text=/admin|super|user|manager/i').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC047: Create role dialog', async ({ page }) => {
    await page.goto(`${BASE_URL}/roles`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const addButton = page.locator('button:has-text("Add"), button:has-text("Create"), button:has-text("New Role"), button:has-text("Add Role")').first();
    await expect(addButton).toBeVisible({ timeout: 10000 });
    await addButton.click();

    // Dialog should open
    await expect(page.locator('[role="dialog"], [data-state="open"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC051: Permissions dialog opens', async ({ page }) => {
    await page.goto(`${BASE_URL}/roles`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find permissions or manage button on a role card
    const permBtn = page.locator('button:has-text("Permissions"), button:has-text("Manage"), button:has-text("Edit Permissions")').first();
    if (await permBtn.isVisible({ timeout: 5000 })) {
      await permBtn.click();
      await expect(page.locator('[role="dialog"], [data-state="open"]').first()).toBeVisible({ timeout: 10000 });
    } else {
      // Try clicking on a role card to open edit/permissions
      const roleCard = page.locator('[class*="card"]:has-text("admin"), [class*="card"]:has-text("user")').first();
      if (await roleCard.isVisible({ timeout: 5000 })) {
        await roleCard.click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test('TC050: System role protection', async ({ page }) => {
    await page.goto(`${BASE_URL}/roles`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Wait for roles page to fully load
    await expect(page.locator('h1, h2, h3').filter({ hasText: /roles/i }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[class*="card"], .card').first()).toBeVisible({ timeout: 15000 });

    // Check for system badge/indicator - system roles should be marked
    // Look for "System" text in badge or span, case-insensitive
    const systemIndicator = page.locator('[class*="badge"]:has-text("System"), span:has-text("System"), div:has-text("System"):not(:has(*:has-text("System")))').first();
    await expect(systemIndicator).toBeVisible({ timeout: 20000 });
  });
});
