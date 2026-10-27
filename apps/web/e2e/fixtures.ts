import { test as base, expect, Page } from '@playwright/test';

// Test user credentials (seeded in database)
export const TEST_ADMIN = {
  email: 'admin@example.com',
  password: 'Admin@123',
  firstName: 'Super',
  lastName: 'Admin',
};

// Extended test fixture with authentication
export const test = base.extend<{
  authenticatedPage: typeof base;
}>({
  authenticatedPage: async ({ page }, use) => {
    await login(page);
    await use(base);
  },
});

export { expect };

// Robust login helper with retry logic
export async function login(
  page: Page,
  email = TEST_ADMIN.email,
  password = TEST_ADMIN.password,
  maxRetries = 3
) {
  // Check if already on dashboard (already logged in)
  const currentUrl = page.url();
  if (currentUrl.endsWith('/') && !currentUrl.includes('login')) {
    // Already logged in, verify by checking for user menu
    const userMenu = page.locator('button.rounded-full');
    if (await userMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
      return; // Already logged in
    }
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Navigate to login page
      await page.goto('/login', { waitUntil: 'networkidle', timeout: 30000 });

      // Wait for login form to be ready
      await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 10000 });

      // Clear and fill email
      await page.fill('input[name="email"]', '');
      await page.fill('input[name="email"]', email);

      // Clear and fill password
      await page.fill('input[name="password"]', '');
      await page.fill('input[name="password"]', password);

      // Click submit and wait for navigation
      await Promise.all([
        page.waitForURL('/', { timeout: 30000 }),
        page.click('button[type="submit"]'),
      ]);

      // Wait for dashboard to load
      await page.waitForLoadState('networkidle', { timeout: 15000 });

      // Verify login succeeded by checking for user avatar
      const userAvatar = page.locator('button.rounded-full');
      await userAvatar.waitFor({ state: 'visible', timeout: 10000 });

      return; // Login successful
    } catch (error) {
      console.log(`Login attempt ${attempt}/${maxRetries} failed:`, error);

      if (attempt === maxRetries) {
        throw new Error(`Login failed after ${maxRetries} attempts: ${error}`);
      }

      // Wait before retry (exponential backoff)
      await page.waitForTimeout(1000 * attempt);
    }
  }
}

export async function logout(page: Page) {
  // Click user avatar to open dropdown
  await page.locator('button.rounded-full').click();

  // Click "Log out" in dropdown
  await page.locator('text=Log out').click();

  // Wait for redirect to login
  await page.waitForURL(/login/, { timeout: 15000 });
}

// Wait for toast notification
export async function waitForToast(page: Page, text?: string) {
  if (text) {
    await expect(page.locator(`[data-sonner-toast]:has-text("${text}")`)).toBeVisible({ timeout: 10000 });
  } else {
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 10000 });
  }
}

// Generate random email
export function randomEmail() {
  return `test-${Date.now()}@example.com`;
}

// Generate random string
export function randomString(length = 8) {
  return Math.random().toString(36).substring(2, 2 + length);
}
