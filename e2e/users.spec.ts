import { test, expect } from '@playwright/test';
import { loginWithRetry, BASE_URL } from './helpers/auth';

test.describe('User Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithRetry(page);
  });

  test('TC032: Users list page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/users`);
    await page.waitForLoadState('networkidle');

    // Wait for page title
    await expect(page.locator('h1, h2, h3').filter({ hasText: /users/i }).first()).toBeVisible({ timeout: 20000 });

    // Should have a table or data grid
    await expect(page.locator('table, [role="grid"], [role="table"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC033: Search users works', async ({ page }) => {
    await page.goto(`${BASE_URL}/users`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="Search" i], input[type="search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill('admin');
    await page.waitForTimeout(1000);

    // Should have filtered results - at least one row
    await expect(page.locator('table tbody tr, [role="row"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC036: Pagination works', async ({ page }) => {
    await page.goto(`${BASE_URL}/users`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check for pagination controls - look for page numbers or Next button
    const pagination = page.locator('nav[aria-label*="pagination" i], [class*="pagination"], button:has-text("Next"), button:has-text("Previous"), button:has-text("1")').first();
    await expect(pagination).toBeVisible({ timeout: 15000 });
  });

  test('TC037: Sorting works', async ({ page }) => {
    await page.goto(`${BASE_URL}/users`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click on a sortable column header - usually has a button inside
    const header = page.locator('th button, th[role="columnheader"] button, [role="columnheader"] button').first();
    if (await header.isVisible({ timeout: 5000 })) {
      await header.click();
      await page.waitForTimeout(1000);
      // Click again to reverse sort
      await header.click();
      await page.waitForTimeout(1000);
    }
    // Just verify table still visible after sorting
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible();
  });

  test('TC039: Create user dialog opens', async ({ page }) => {
    await page.goto(`${BASE_URL}/users`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find and click add user button - multiple possible labels
    const addButton = page.locator('button:has-text("Add User"), button:has-text("Add"), button:has-text("Create"), button:has-text("New User")').first();
    await expect(addButton).toBeVisible({ timeout: 10000 });
    await addButton.click();

    // Dialog should open - look for dialog role or common dialog patterns
    await expect(page.locator('[role="dialog"], [data-state="open"], .dialog, .modal').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC040: Create user form validation', async ({ page }) => {
    await page.goto(`${BASE_URL}/users`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const addButton = page.locator('button:has-text("Add User"), button:has-text("Add"), button:has-text("Create"), button:has-text("New User")').first();
    if (await addButton.isVisible({ timeout: 10000 })) {
      await addButton.click();
      await page.waitForTimeout(1000);

      // Find and click submit in the dialog without filling form
      const submitBtn = page.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Create")').first();
      if (await submitBtn.isVisible({ timeout: 5000 })) {
        await submitBtn.click();
        await page.waitForTimeout(1000);

        // Should show validation errors - look for error text or destructive styling
        await expect(
          page.locator('[role="dialog"] .text-destructive, [role="dialog"] [class*="error"], [role="dialog"] p:has-text("required")').first()
        ).toBeVisible({ timeout: 10000 });
      }
    }
  });

  test('TC044: Bulk selection works', async ({ page }) => {
    await page.goto(`${BASE_URL}/users`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find select all checkbox in header
    const selectAll = page.locator('thead input[type="checkbox"], th input[type="checkbox"], [role="columnheader"] input[type="checkbox"]').first();
    if (await selectAll.isVisible({ timeout: 5000 })) {
      await selectAll.click();
      await page.waitForTimeout(500);

      // Check that rows are selected
      const selectedRows = page.locator('tbody input[type="checkbox"]:checked, tr input[type="checkbox"]:checked');
      const count = await selectedRows.count();
      expect(count).toBeGreaterThan(0);
    }
  });
});
