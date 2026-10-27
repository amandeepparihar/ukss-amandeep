import { Page, expect } from '@playwright/test';

export const BASE_URL = 'https://js-admin.veldev.com';

export async function login(page: Page, email = 'admin@example.com', password = 'Admin@123') {
  // Go to login page
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');

  // Wait for form to be ready
  await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 15000 });

  // Fill credentials
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);

  // Click and wait for navigation - use a more robust approach
  await page.click('button[type="submit"]');

  // Wait for either dashboard or an error
  try {
    // Wait for URL to change to dashboard
    await page.waitForURL(`${BASE_URL}/`, { timeout: 45000 });
  } catch {
    // Check if we're still on login page - might be an error
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      // Check for error toast
      const hasError = await page.locator('[data-sonner-toast][data-type="error"]').isVisible().catch(() => false);
      if (hasError) {
        throw new Error('Login failed - error toast displayed');
      }
      throw new Error('Login failed - still on login page after timeout');
    }
  }

  // Wait for dashboard to fully load
  await page.waitForLoadState('networkidle');

  // Verify we're on the dashboard
  await expect(page.locator('text=Dashboard').first()).toBeVisible({ timeout: 15000 });
}

export async function loginAndNavigate(page: Page, targetUrl: string) {
  await login(page);
  await page.goto(targetUrl);
  await page.waitForLoadState('networkidle');
}

// Retry login if it fails (for flaky network conditions)
export async function loginWithRetry(page: Page, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await login(page);
      return; // Success
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      // Clear cookies and try again
      await page.context().clearCookies();
      await page.waitForTimeout(1000);
    }
  }
}
