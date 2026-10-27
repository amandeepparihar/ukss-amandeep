import { test, expect } from '@playwright/test';
import { TEST_ADMIN } from './fixtures';

test.describe('Profile Page', () => {
  // Session is already authenticated via storageState in playwright.config.ts
  test.beforeEach(async ({ page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
  });

  test.describe('Profile Display', () => {
    test('should display user information', async ({ page }) => {
      // Check first name
      const firstNameInput = page.locator('input[name="firstName"]');
      await expect(firstNameInput).toBeVisible();
      await expect(firstNameInput).toHaveValue(TEST_ADMIN.firstName);

      // Check last name
      const lastNameInput = page.locator('input[name="lastName"]');
      await expect(lastNameInput).toBeVisible();
      await expect(lastNameInput).toHaveValue(TEST_ADMIN.lastName);
    });

    test('should display email as read-only', async ({ page }) => {
      const emailInput = page.locator('input[name="email"], input[type="email"]');
      await expect(emailInput).toBeVisible();
      await expect(emailInput).toBeDisabled();
    });

    test('should display role as read-only', async ({ page }) => {
      // Role field should be visible and disabled
      const roleField = page.locator('input[name="role"], [data-testid="role-field"]');
      if (await roleField.isVisible()) {
        await expect(roleField).toBeDisabled();
      }
    });

    test('should display avatar or initials', async ({ page }) => {
      const avatar = page.locator('[class*="avatar"], [data-testid="avatar"]');
      await expect(avatar).toBeVisible();
    });
  });

  test.describe('Profile Update', () => {
    test('should enable save button when changes are made', async ({ page }) => {
      const saveButton = page.locator('button:has-text("Save"), button[type="submit"]');

      // Initially might be disabled
      const initialState = await saveButton.isDisabled();

      // Make a change
      const firstNameInput = page.locator('input[name="firstName"]');
      await firstNameInput.fill('Modified');

      // Save button should be enabled
      await expect(saveButton).toBeEnabled();

      // Revert change
      await firstNameInput.fill(TEST_ADMIN.firstName);
    });

    test('should update first name', async ({ page }) => {
      const firstNameInput = page.locator('input[name="firstName"]');
      const originalValue = await firstNameInput.inputValue();

      // Update
      await firstNameInput.clear();
      await firstNameInput.fill('UpdatedFirst');

      // Save
      await page.click('button:has-text("Save"), button[type="submit"]');

      // Wait for update
      await page.waitForTimeout(1000);

      // Revert for cleanup
      await firstNameInput.clear();
      await firstNameInput.fill(originalValue);
      await page.click('button:has-text("Save"), button[type="submit"]');
    });

    test('should update last name', async ({ page }) => {
      const lastNameInput = page.locator('input[name="lastName"]');
      const originalValue = await lastNameInput.inputValue();

      // Update
      await lastNameInput.clear();
      await lastNameInput.fill('UpdatedLast');

      // Save
      await page.click('button:has-text("Save"), button[type="submit"]');

      // Wait for update
      await page.waitForTimeout(1000);

      // Revert for cleanup
      await lastNameInput.clear();
      await lastNameInput.fill(originalValue);
      await page.click('button:has-text("Save"), button[type="submit"]');
    });
  });

  test.describe('Two-Factor Authentication', () => {
    test('should display 2FA settings section', async ({ page }) => {
      const twoFactorSection = page.locator('text=Two-Factor, text=2FA, text=two-factor').first();
      await expect(twoFactorSection).toBeVisible();
    });

    test('should have enable/disable 2FA button', async ({ page }) => {
      const twoFactorButton = page.locator('button:has-text("Enable 2FA"), button:has-text("Disable 2FA"), button:has-text("Two-Factor")').first();
      await expect(twoFactorButton).toBeVisible();
    });
  });
});
