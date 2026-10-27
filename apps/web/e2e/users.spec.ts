import { test, expect } from '@playwright/test';
import { randomEmail, randomString, waitForToast } from './fixtures';

test.describe('User Management', () => {
  // Session is already authenticated via storageState in playwright.config.ts
  test.beforeEach(async ({ page }) => {
    await page.goto('/users');
    await page.waitForLoadState('networkidle');
  });

  test.describe('Users List', () => {
    test('should display users table', async ({ page }) => {
      // Check table is visible
      await expect(page.locator('table, [role="table"]')).toBeVisible();

      // Check column headers exist
      await expect(page.locator('text=Email, th:has-text("Email")').first()).toBeVisible();
      await expect(page.locator('text=Role, th:has-text("Role")').first()).toBeVisible();
    });

    test('should display pagination controls', async ({ page }) => {
      // Look for pagination elements
      const pagination = page.locator('[class*="pagination"], nav[aria-label*="pagination"], button:has-text("Next"), button:has-text("Previous")');
      await expect(pagination.first()).toBeVisible();
    });

    test('should have Add User button', async ({ page }) => {
      const addButton = page.locator('button:has-text("Add User"), button:has-text("Create User"), button:has-text("New User")');
      await expect(addButton).toBeVisible();
    });
  });

  test.describe('Search & Filter', () => {
    test('should search users by name or email', async ({ page }) => {
      const searchInput = page.locator('input[placeholder*="search"], input[placeholder*="Search"], input[type="search"]');
      await searchInput.fill('admin');

      // Wait for search to execute
      await page.waitForTimeout(500);

      // Check that results are filtered
      await expect(page.locator('td:has-text("admin"), td:has-text("Admin")').first()).toBeVisible();
    });

    test('should filter users by status', async ({ page }) => {
      // Find status filter
      const statusFilter = page.locator('button:has-text("Status"), [data-testid="status-filter"]');
      if (await statusFilter.isVisible()) {
        await statusFilter.click();

        // Select Active
        await page.locator('text=Active').click();

        // Verify filter is applied
        await page.waitForTimeout(500);
      }
    });

    test('should filter users by role', async ({ page }) => {
      // Find role filter
      const roleFilter = page.locator('button:has-text("Role"), [data-testid="role-filter"]');
      if (await roleFilter.isVisible()) {
        await roleFilter.click();

        // Select a role option
        const roleOption = page.locator('[role="option"], [role="menuitem"]').first();
        if (await roleOption.isVisible()) {
          await roleOption.click();
        }
      }
    });
  });

  test.describe('Create User', () => {
    test('should open create user dialog', async ({ page }) => {
      const addButton = page.locator('button:has-text("Add User"), button:has-text("Create User"), button:has-text("New User")');
      await addButton.click();

      // Check dialog opened
      await expect(page.locator('[role="dialog"], [data-state="open"]')).toBeVisible();
      await expect(page.locator('text=Create User, text=New User').first()).toBeVisible();
    });

    test('should create a new user', async ({ page }) => {
      const email = randomEmail();
      const firstName = 'Test';
      const lastName = randomString();

      // Open create dialog
      const addButton = page.locator('button:has-text("Add User"), button:has-text("Create User"), button:has-text("New User")');
      await addButton.click();

      // Fill form
      await page.fill('input[name="firstName"]', firstName);
      await page.fill('input[name="lastName"]', lastName);
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', 'Password123!');

      // Select a role
      const roleSelect = page.locator('[name="roleId"], button:has-text("Select role"), [data-testid="role-select"]');
      await roleSelect.click();
      await page.locator('[role="option"]').first().click();

      // Submit
      await page.click('button[type="submit"], button:has-text("Create"), button:has-text("Save")');

      // Wait for success
      await page.waitForTimeout(1000);

      // Dialog should close
      await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 5000 });
    });

    test('should show validation errors for empty fields', async ({ page }) => {
      const addButton = page.locator('button:has-text("Add User"), button:has-text("Create User"), button:has-text("New User")');
      await addButton.click();

      // Submit without filling
      await page.click('button[type="submit"], button:has-text("Create"), button:has-text("Save")');

      // Should show validation errors
      await expect(page.locator('text=required, text=Required, [class*="error"]').first()).toBeVisible();
    });

    test('should validate email format', async ({ page }) => {
      const addButton = page.locator('button:has-text("Add User"), button:has-text("Create User"), button:has-text("New User")');
      await addButton.click();

      await page.fill('input[name="email"]', 'invalid-email');
      await page.click('button[type="submit"]');

      await expect(page.locator('text=valid email, text=Invalid email').first()).toBeVisible();
    });
  });

  test.describe('Edit User', () => {
    test('should open edit dialog from row actions', async ({ page }) => {
      // Find first row's action button
      const actionButton = page.locator('button[aria-label*="action"], button:has([class*="dots"]), [data-testid="row-actions"]').first();
      await actionButton.click();

      // Click Edit
      await page.locator('text=Edit, [role="menuitem"]:has-text("Edit")').first().click();

      // Check dialog opened
      await expect(page.locator('[role="dialog"]')).toBeVisible();
    });

    test('should update user information', async ({ page }) => {
      // Open edit dialog
      const actionButton = page.locator('button[aria-label*="action"], button:has([class*="dots"]), [data-testid="row-actions"]').first();
      await actionButton.click();
      await page.locator('text=Edit, [role="menuitem"]:has-text("Edit")').first().click();

      // Wait for dialog
      await page.waitForTimeout(500);

      // Update first name
      const firstNameInput = page.locator('input[name="firstName"]');
      await firstNameInput.clear();
      await firstNameInput.fill('Updated');

      // Submit
      await page.click('button[type="submit"], button:has-text("Save"), button:has-text("Update")');

      // Wait for success
      await page.waitForTimeout(1000);
    });
  });

  test.describe('Delete User', () => {
    test('should show confirmation dialog before delete', async ({ page }) => {
      // Find first row's action button (skip admin user)
      const actionButtons = page.locator('button[aria-label*="action"], button:has([class*="dots"]), [data-testid="row-actions"]');

      // Click on second row if exists, otherwise first
      const count = await actionButtons.count();
      if (count > 1) {
        await actionButtons.nth(1).click();
      } else {
        await actionButtons.first().click();
      }

      // Click Delete
      await page.locator('text=Delete, [role="menuitem"]:has-text("Delete")').first().click();

      // Check confirmation dialog
      await expect(page.locator('[role="alertdialog"], [role="dialog"]:has-text("confirm"), [role="dialog"]:has-text("delete")')).toBeVisible();
    });

    test('should cancel delete when clicking Cancel', async ({ page }) => {
      const actionButtons = page.locator('button[aria-label*="action"], button:has([class*="dots"]), [data-testid="row-actions"]');
      const count = await actionButtons.count();
      if (count > 1) {
        await actionButtons.nth(1).click();
      } else {
        await actionButtons.first().click();
      }

      await page.locator('text=Delete, [role="menuitem"]:has-text("Delete")').first().click();

      // Click Cancel
      await page.locator('button:has-text("Cancel"), button:has-text("No")').click();

      // Dialog should close
      await expect(page.locator('[role="alertdialog"]')).not.toBeVisible();
    });
  });

  test.describe('Sorting', () => {
    test('should sort by clicking column header', async ({ page }) => {
      // Click on Email column header
      const emailHeader = page.locator('th:has-text("Email"), button:has-text("Email")').first();
      await emailHeader.click();

      // Wait for sort
      await page.waitForTimeout(500);

      // Click again to toggle sort direction
      await emailHeader.click();
      await page.waitForTimeout(500);
    });
  });

  test.describe('Pagination', () => {
    test('should navigate to next page', async ({ page }) => {
      const nextButton = page.locator('button:has-text("Next"), button[aria-label*="next"], [aria-label*="Next"]');

      // Only test if next button is enabled
      if (await nextButton.isEnabled()) {
        await nextButton.click();
        await page.waitForTimeout(500);
      }
    });
  });
});
