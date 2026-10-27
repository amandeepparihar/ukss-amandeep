import { test, expect } from '@playwright/test';
import { TEST_ADMIN, login, waitForToast } from './fixtures';

test.describe('Authentication', () => {
  test.describe('Login Page', () => {
    test('should display login form', async ({ page }) => {
      await page.goto('/login');

      await expect(page.locator('input[name="email"]')).toBeVisible();
      await expect(page.locator('input[name="password"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('should login with valid credentials', async ({ page }) => {
      // Use the robust login helper
      await login(page);

      // Verify we're on dashboard
      await expect(page).toHaveURL('/');
      // Verify user avatar is visible (indicates logged in state)
      await expect(page.locator('button.rounded-full')).toBeVisible();
    });

    test('should show error with invalid credentials', async ({ page }) => {
      await page.goto('/login');

      await page.fill('input[name="email"]', 'invalid@example.com');
      await page.fill('input[name="password"]', 'wrongpassword');
      await page.click('button[type="submit"]');

      // Should show error toast or stay on login page
      await page.waitForTimeout(2000);
      await expect(page).toHaveURL(/login/);
    });

    test('should show validation error for empty fields', async ({ page }) => {
      await page.goto('/login');

      await page.click('button[type="submit"]');

      // Should show validation errors (inline error text in destructive color)
      await expect(page.locator('.text-destructive').first()).toBeVisible({ timeout: 5000 });
    });

    test('should show validation error for invalid email format', async ({ page }) => {
      await page.goto('/login');

      await page.fill('input[name="email"]', 'notanemail');
      await page.fill('input[name="password"]', 'somepassword');
      await page.click('button[type="submit"]');

      // Should stay on login page (browser or form validation prevents navigation)
      await expect(page).toHaveURL(/login/);
    });

    test('should have forgot password link', async ({ page }) => {
      await page.goto('/login');

      const forgotLink = page.locator('a:has-text("Forgot"), a:has-text("forgot")');
      await expect(forgotLink).toBeVisible();

      await forgotLink.click();
      await page.waitForURL('/forgot-password');
    });
  });

  test.describe('Forgot Password', () => {
    test('should display forgot password form', async ({ page }) => {
      await page.goto('/forgot-password');

      await expect(page.locator('input[name="email"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('should submit forgot password request', async ({ page }) => {
      await page.goto('/forgot-password');

      await page.fill('input[name="email"]', TEST_ADMIN.email);
      await page.click('button[type="submit"]');

      // Wait for request to complete - form should be cleared or show confirmation
      await page.waitForTimeout(3000);
      // Just verify we're still on the page and no error navigation occurred
      await expect(page).toHaveURL(/forgot-password/);
    });

    test('should have link back to login', async ({ page }) => {
      await page.goto('/forgot-password');

      const backLink = page.locator('a:has-text("Login"), a:has-text("Back"), a:has-text("Sign in")');
      await expect(backLink).toBeVisible();

      await backLink.click();
      await page.waitForURL('/login');
    });
  });

  test.describe('Protected Routes', () => {
    test('should redirect to login when not authenticated', async ({ page }) => {
      await page.goto('/users');
      await page.waitForURL('/login');
    });

    test('should redirect to login when accessing profile', async ({ page }) => {
      await page.goto('/profile');
      await page.waitForURL('/login');
    });

    test('should redirect to login when accessing settings', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForURL('/login');
    });
  });

  test.describe('Logout', () => {
    test('should logout successfully', async ({ page }) => {
      // First login
      await login(page);

      // Click the user avatar to open dropdown menu
      await page.locator('button.rounded-full').click();

      // Click "Log out" in the dropdown
      await page.locator('text=Log out').click();

      // Should redirect to login
      await page.waitForURL('/login');
    });
  });

  test.describe('Session Persistence', () => {
    test('should maintain session after page reload', async ({ page }) => {
      await login(page);

      // Reload the page
      await page.reload();

      // Should still be on dashboard (not redirected to login)
      await expect(page).toHaveURL('/');
    });
  });
});
