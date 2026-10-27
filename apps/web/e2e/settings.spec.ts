import { test, expect } from '@playwright/test';

test.describe('Settings Page', () => {
  // Session is already authenticated via storageState in playwright.config.ts
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
  });

  test.describe('Settings Navigation', () => {
    test('should display settings tabs', async ({ page }) => {
      // Check for tab navigation
      await expect(page.locator('[role="tablist"], [class*="tabs"]')).toBeVisible();
    });

    test('should have General tab', async ({ page }) => {
      const generalTab = page.locator('button:has-text("General"), [role="tab"]:has-text("General")');
      await expect(generalTab).toBeVisible();
    });

    test('should have Email tab', async ({ page }) => {
      const emailTab = page.locator('button:has-text("Email"), [role="tab"]:has-text("Email")');
      await expect(emailTab).toBeVisible();
    });

    test('should have Notifications tab', async ({ page }) => {
      const notificationsTab = page.locator('button:has-text("Notification"), [role="tab"]:has-text("Notification")');
      await expect(notificationsTab).toBeVisible();
    });

    test('should have Security tab', async ({ page }) => {
      const securityTab = page.locator('button:has-text("Security"), [role="tab"]:has-text("Security")');
      await expect(securityTab).toBeVisible();
    });
  });

  test.describe('General Settings', () => {
    test('should display site name field', async ({ page }) => {
      const siteNameInput = page.locator('input[name="siteName"], input[name="general.siteName"]');
      await expect(siteNameInput).toBeVisible();
    });

    test('should display site description field', async ({ page }) => {
      const siteDescInput = page.locator('input[name="siteDescription"], textarea[name="siteDescription"], input[name="general.siteDescription"]');
      await expect(siteDescInput).toBeVisible();
    });

    test('should display maintenance mode toggle', async ({ page }) => {
      const maintenanceToggle = page.locator('[name*="maintenance"], [data-testid="maintenance-toggle"]');
      await expect(maintenanceToggle).toBeVisible();
    });

    test('should display debug mode toggle', async ({ page }) => {
      const debugToggle = page.locator('[name*="debug"], [data-testid="debug-toggle"]');
      await expect(debugToggle).toBeVisible();
    });

    test('should have save button', async ({ page }) => {
      const saveButton = page.locator('button:has-text("Save"), button[type="submit"]');
      await expect(saveButton).toBeVisible();
    });
  });

  test.describe('Tab Switching', () => {
    test('should switch to Email tab', async ({ page }) => {
      const emailTab = page.locator('button:has-text("Email"), [role="tab"]:has-text("Email")');
      await emailTab.click();

      // Email tab content should be visible
      await expect(page.locator('text=SMTP, text=Email Server, input[name*="email"]').first()).toBeVisible();
    });

    test('should switch to Security tab', async ({ page }) => {
      const securityTab = page.locator('button:has-text("Security"), [role="tab"]:has-text("Security")');
      await securityTab.click();

      // Security content should be visible
      await expect(page.locator('text=Password, text=Session, text=security').first()).toBeVisible();
    });
  });

  test.describe('Settings Update', () => {
    test('should update site name', async ({ page }) => {
      const siteNameInput = page.locator('input[name="siteName"], input[name="general.siteName"]');
      const originalValue = await siteNameInput.inputValue();

      // Update
      await siteNameInput.clear();
      await siteNameInput.fill('Updated Site Name');

      // Save
      await page.click('button:has-text("Save"), button[type="submit"]');

      // Wait
      await page.waitForTimeout(1000);

      // Revert
      await siteNameInput.clear();
      await siteNameInput.fill(originalValue);
      await page.click('button:has-text("Save"), button[type="submit"]');
    });
  });
});
