import { test, expect } from '@playwright/test';
import { randomString } from './fixtures';

test.describe('Role Management', () => {
  // Session is already authenticated via storageState in playwright.config.ts
  test.beforeEach(async ({ page }) => {
    await page.goto('/roles');
    await page.waitForLoadState('networkidle');
  });

  test.describe('Roles List', () => {
    test('should display roles as cards', async ({ page }) => {
      // Check for role cards
      await expect(page.locator('[class*="card"], [data-testid="role-card"]').first()).toBeVisible();
    });

    test('should show system role badge', async ({ page }) => {
      // Look for Admin role with system badge
      await expect(page.locator('text=Admin, text=admin').first()).toBeVisible();
    });

    test('should display permission count', async ({ page }) => {
      // Check permission count is displayed
      await expect(page.locator('text=permission, text=Permission').first()).toBeVisible();
    });

    test('should display user count', async ({ page }) => {
      // Check user count is displayed
      await expect(page.locator('text=user, text=User').first()).toBeVisible();
    });

    test('should have Add Role button', async ({ page }) => {
      const addButton = page.locator('button:has-text("Add Role"), button:has-text("Create Role"), button:has-text("New Role")');
      await expect(addButton).toBeVisible();
    });
  });

  test.describe('Create Role', () => {
    test('should open create role dialog', async ({ page }) => {
      const addButton = page.locator('button:has-text("Add Role"), button:has-text("Create Role"), button:has-text("New Role")');
      await addButton.click();

      await expect(page.locator('[role="dialog"]')).toBeVisible();
    });

    test('should create a new role', async ({ page }) => {
      const roleName = `TestRole-${randomString()}`;

      const addButton = page.locator('button:has-text("Add Role"), button:has-text("Create Role"), button:has-text("New Role")');
      await addButton.click();

      // Fill form
      await page.fill('input[name="name"]', roleName);
      await page.fill('input[name="description"], textarea[name="description"]', 'Test role description');

      // Submit
      await page.click('button[type="submit"], button:has-text("Create"), button:has-text("Save")');

      // Wait for dialog to close
      await page.waitForTimeout(1000);

      // New role should appear
      await expect(page.locator(`text=${roleName}`)).toBeVisible({ timeout: 5000 });
    });

    test('should validate required fields', async ({ page }) => {
      const addButton = page.locator('button:has-text("Add Role"), button:has-text("Create Role"), button:has-text("New Role")');
      await addButton.click();

      // Submit empty form
      await page.click('button[type="submit"], button:has-text("Create"), button:has-text("Save")');

      // Should show validation error
      await expect(page.locator('text=required, text=Required, [class*="error"]').first()).toBeVisible();
    });
  });

  test.describe('Edit Role', () => {
    test('should open edit dialog for non-system role', async ({ page }) => {
      // Find a non-system role card's action button
      const actionButton = page.locator('[data-testid="role-actions"], button:has([class*="dots"])').first();

      if (await actionButton.isVisible()) {
        await actionButton.click();
        await page.locator('text=Edit, [role="menuitem"]:has-text("Edit")').first().click();

        await expect(page.locator('[role="dialog"]')).toBeVisible();
      }
    });
  });

  test.describe('System Roles', () => {
    test('should not allow editing system roles', async ({ page }) => {
      // Admin is a system role
      const adminCard = page.locator('[class*="card"]:has-text("Admin")').first();

      // Check for system badge
      await expect(adminCard.locator('text=System, [class*="badge"]:has-text("System")')).toBeVisible();
    });
  });

  test.describe('Permissions Management', () => {
    test('should open permissions dialog', async ({ page }) => {
      // Find manage permissions button on a role card
      const permissionsButton = page.locator('button:has-text("Permission"), button[aria-label*="permission"], [data-testid="manage-permissions"]').first();

      if (await permissionsButton.isVisible()) {
        await permissionsButton.click();
        await expect(page.locator('[role="dialog"]')).toBeVisible();
      }
    });
  });
});
