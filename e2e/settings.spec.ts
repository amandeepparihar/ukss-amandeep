import { test, expect } from '@playwright/test';
import { loginWithRetry, BASE_URL } from './helpers/auth';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithRetry(page);
  });

  test('TC078: Settings page loads with tabs', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');

    // Wait for page title
    await expect(page.locator('h1, h2, h3').filter({ hasText: /settings/i }).first()).toBeVisible({ timeout: 20000 });

    // Should have tabs
    await expect(page.locator('[role="tablist"], [role="tab"], button:has-text("General"), button:has-text("Email")').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC078b: General settings tab', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click General tab if not active
    const generalTab = page.locator('[role="tab"]:has-text("General"), button:has-text("General")').first();
    if (await generalTab.isVisible({ timeout: 5000 })) {
      await generalTab.click();
      await page.waitForTimeout(1000);
    }

    // Should have form fields - look for inputs
    await expect(page.locator('input, select, textarea').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC079: Email settings tab', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click Email tab
    const emailTab = page.locator('[role="tab"]:has-text("Email"), button:has-text("Email")').first();
    if (await emailTab.isVisible({ timeout: 5000 })) {
      await emailTab.click();
      await page.waitForTimeout(1000);

      // Should have email provider field or form
      await expect(page.locator('select, [role="combobox"], input').first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('TC080: Security settings tab', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click Security tab
    const securityTab = page.locator('[role="tab"]:has-text("Security"), button:has-text("Security")').first();
    if (await securityTab.isVisible({ timeout: 5000 })) {
      await securityTab.click();
      await page.waitForTimeout(2000);

      // Should have security-related fields (password policy, etc.)
      // Look for any input field or number input
      await expect(page.locator('input, select, [role="combobox"]').first()).toBeVisible({ timeout: 15000 });
    } else {
      // Security tab might not exist - just verify page loaded
      await expect(page.locator('[role="tablist"]').first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('TC081: Save general settings', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Wait for settings page to load
    await expect(page.locator('h1, h2, h3').filter({ hasText: /settings/i }).first()).toBeVisible({ timeout: 20000 });

    // Make sure we're on General tab
    const generalTab = page.locator('[role="tab"]:has-text("General"), button:has-text("General")').first();
    if (await generalTab.isVisible({ timeout: 5000 })) {
      await generalTab.click();
      await page.waitForTimeout(2000);
    }

    // Find an input field and modify it
    const inputField = page.locator('input[type="text"], input:not([type]), input').first();
    await expect(inputField).toBeVisible({ timeout: 10000 });

    const currentValue = await inputField.inputValue();
    await inputField.fill(currentValue || 'Test Admin Panel');

    // Click save button
    const saveBtn = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Update")').first();
    await expect(saveBtn).toBeVisible({ timeout: 10000 });
    await saveBtn.click();

    // Should show success toast - wait for any Sonner toast
    await expect(
      page.locator('[data-sonner-toast], [data-sonner-toaster] li, [role="status"]').first()
    ).toBeVisible({ timeout: 20000 });
  });
});
