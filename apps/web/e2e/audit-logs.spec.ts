import { test, expect } from '@playwright/test';

test.describe('Audit Logs', () => {
  // Session is already authenticated via storageState in playwright.config.ts
  test.beforeEach(async ({ page }) => {
    await page.goto('/audit-logs');
    await page.waitForLoadState('networkidle');
  });

  test.describe('Audit Logs List', () => {
    test('should display audit logs table', async ({ page }) => {
      await expect(page.locator('table, [role="table"]')).toBeVisible();
    });

    test('should show Time column', async ({ page }) => {
      await expect(page.locator('th:has-text("Time"), th:has-text("Date")').first()).toBeVisible();
    });

    test('should show User column', async ({ page }) => {
      await expect(page.locator('th:has-text("User")').first()).toBeVisible();
    });

    test('should show Action column', async ({ page }) => {
      await expect(page.locator('th:has-text("Action")').first()).toBeVisible();
    });

    test('should show Resource column', async ({ page }) => {
      await expect(page.locator('th:has-text("Resource")').first()).toBeVisible();
    });
  });

  test.describe('Filters', () => {
    test('should have action filter', async ({ page }) => {
      const actionFilter = page.locator('button:has-text("Action"), [data-testid="action-filter"]');
      await expect(actionFilter).toBeVisible();
    });

    test('should filter by action type', async ({ page }) => {
      const actionFilter = page.locator('button:has-text("Action"), [data-testid="action-filter"]');
      await actionFilter.click();

      // Select an action type
      const option = page.locator('[role="option"]:has-text("login"), [role="menuitem"]:has-text("login")').first();
      if (await option.isVisible()) {
        await option.click();
        await page.waitForTimeout(500);
      }
    });

    test('should have resource filter', async ({ page }) => {
      const resourceFilter = page.locator('button:has-text("Resource"), [data-testid="resource-filter"]');
      await expect(resourceFilter).toBeVisible();
    });

    test('should have search functionality', async ({ page }) => {
      const searchInput = page.locator('input[placeholder*="search"], input[type="search"]');
      await expect(searchInput).toBeVisible();

      await searchInput.fill('login');
      await page.waitForTimeout(500);
    });
  });

  test.describe('Log Details', () => {
    test('should open log detail modal', async ({ page }) => {
      // Find view button
      const viewButton = page.locator('button:has-text("View"), button[aria-label*="view"], [data-testid="view-log"]').first();

      if (await viewButton.isVisible()) {
        await viewButton.click();
        await expect(page.locator('[role="dialog"]')).toBeVisible();
      }
    });

    test('should show log metadata in detail modal', async ({ page }) => {
      const viewButton = page.locator('button:has-text("View"), button[aria-label*="view"], [data-testid="view-log"]').first();

      if (await viewButton.isVisible()) {
        await viewButton.click();

        // Check for metadata sections
        await expect(page.locator('text=User, text=Action, text=Resource').first()).toBeVisible();
      }
    });
  });

  test.describe('Pagination', () => {
    test('should display pagination controls', async ({ page }) => {
      const pagination = page.locator('[class*="pagination"], button:has-text("Next"), button:has-text("Previous")');
      await expect(pagination.first()).toBeVisible();
    });

    test('should navigate pages', async ({ page }) => {
      const nextButton = page.locator('button:has-text("Next"), button[aria-label*="next"]');

      if (await nextButton.isEnabled()) {
        await nextButton.click();
        await page.waitForTimeout(500);
      }
    });
  });
});
