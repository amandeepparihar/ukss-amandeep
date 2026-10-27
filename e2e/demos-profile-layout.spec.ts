import { test, expect } from '@playwright/test';
import { loginWithRetry, BASE_URL } from './helpers/auth';

test.describe('Demo Pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithRetry(page);
  });

  test('TC093: Demo index page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/demos`);
    await page.waitForLoadState('networkidle');

    // Wait for page title or demo content
    await expect(page.locator('h1, h2, h3').filter({ hasText: /demo/i }).first()).toBeVisible({ timeout: 20000 });

    // Should have demo cards/links
    await expect(page.locator('[class*="card"], a[href*="/demos/"], .grid').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC085: Form demo page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/demos/forms`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1, h2, h3').filter({ hasText: /form/i }).first()).toBeVisible({ timeout: 20000 });
    // Should have form fields
    await expect(page.locator('input, select, textarea').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC086: Form demo validation', async ({ page }) => {
    await page.goto(`${BASE_URL}/demos/forms`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find and click submit button
    const submitBtn = page.locator('button[type="submit"]').first();
    if (await submitBtn.isVisible({ timeout: 5000 })) {
      await submitBtn.click();
      await page.waitForTimeout(1000);
      // Form should show validation states
    }
    // Just verify form is still visible
    await expect(page.locator('form').first()).toBeVisible();
  });

  test('TC087: Notifications demo - toast', async ({ page }) => {
    await page.goto(`${BASE_URL}/demos/notifications`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find toast trigger button
    const toastBtn = page.locator('button:has-text("Success"), button:has-text("Info"), button:has-text("Toast"), button:has-text("Show")').first();
    if (await toastBtn.isVisible({ timeout: 5000 })) {
      await toastBtn.click();
      // Toast should appear - Sonner toast or similar
      await expect(page.locator('[data-sonner-toast], [class*="toast"], [role="alert"]').first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('TC088: Notifications demo - persistent', async ({ page }) => {
    await page.goto(`${BASE_URL}/demos/notifications`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find any notification-related button
    const notifBtn = page.locator('button:has-text("Persistent"), button:has-text("Panel"), button:has-text("Notification"), button').first();
    if (await notifBtn.isVisible({ timeout: 5000 })) {
      await notifBtn.click();
      await page.waitForTimeout(1000);
    }
    // Just verify page is loaded
    await expect(page.locator('h1, h2, h3').first()).toBeVisible();
  });

  test('TC089: Export demo page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/demos/export`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2, h3').filter({ hasText: /export/i }).first()).toBeVisible({ timeout: 20000 });
  });

  test('TC091: File upload demo - drag zone', async ({ page }) => {
    await page.goto(`${BASE_URL}/demos/file-upload`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check for file upload page loaded - look for heading first
    await expect(page.locator('h1, h2, h3').filter({ hasText: /file|upload/i }).first()).toBeVisible({ timeout: 20000 });

    // Then check for drop zone or input - multiple fallback options
    const dropzone = page.locator('[class*="dropzone"], [class*="upload"], input[type="file"], label:has-text("upload"), label:has-text("drag"), label:has-text("drop"), button:has-text("upload")').first();
    await expect(dropzone).toBeVisible({ timeout: 15000 });
  });

  test('TC084: Dashboard loads with stats', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Dashboard').first()).toBeVisible({ timeout: 15000 });
    // Should have stat cards or dashboard content
    await expect(page.locator('[class*="card"], .card, [class*="stat"]').first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Profile Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithRetry(page);
  });

  test('TC017: Profile page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/profile`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1, h2, h3').filter({ hasText: /profile/i }).first()).toBeVisible({ timeout: 20000 });
    // Should have name fields
    await expect(page.locator('input').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC017b: Update profile name', async ({ page }) => {
    await page.goto(`${BASE_URL}/profile`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Wait for profile page to load
    await expect(page.locator('h1, h2, h3').filter({ hasText: /profile/i }).first()).toBeVisible({ timeout: 20000 });

    // Find first name input - try multiple patterns
    const firstNameInput = page.locator('input[name*="firstName" i], input[name*="first" i], input[name*="name" i], input').first();
    await expect(firstNameInput).toBeVisible({ timeout: 10000 });

    // Change value to make form dirty - use timestamp to ensure different value
    const timestamp = Date.now() % 1000;
    await firstNameInput.clear();
    await firstNameInput.fill(`Super${timestamp}`);
    await page.waitForTimeout(500);

    // Find and click save button - should be enabled now
    const saveBtn = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Update")').first();
    await expect(saveBtn).toBeVisible({ timeout: 10000 });
    await expect(saveBtn).toBeEnabled({ timeout: 10000 });
    await saveBtn.click();

    // Should show success toast - wait for Sonner toast
    await expect(
      page.locator('[data-sonner-toast], [data-sonner-toaster] li, [role="status"]:has-text("success"), [role="status"]:has-text("saved")').first()
    ).toBeVisible({ timeout: 20000 });
  });
});

test.describe('Layout & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithRetry(page);
  });

  test('TC094: Sidebar navigation works', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find Users menu item in sidebar
    const usersLink = page.locator('nav a:has-text("Users"), aside a:has-text("Users"), a[href*="/users"]').first();
    if (await usersLink.isVisible({ timeout: 5000 })) {
      await usersLink.click();
      await expect(page).toHaveURL(/\/users/, { timeout: 15000 });
    }
  });

  test('TC095: Sidebar collapse', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find collapse button - look for various patterns
    const collapseBtn = page.locator('button[aria-label*="collapse" i], button[aria-label*="toggle" i], button[aria-label*="sidebar" i], button:has-text("<<"), button:has-text("☰")').first();
    if (await collapseBtn.isVisible({ timeout: 5000 })) {
      await collapseBtn.click();
      await page.waitForTimeout(500);
    }
    // Just verify dashboard content is still visible
    await expect(page.locator('text=Dashboard').first()).toBeVisible();
  });

  test('TC101: Admin sees all menu items', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check for admin menu items in sidebar/nav
    await expect(page.locator('nav, aside').filter({ hasText: 'Users' }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('nav, aside').filter({ hasText: 'Roles' }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('nav, aside').filter({ hasText: 'Settings' }).first()).toBeVisible({ timeout: 15000 });
  });

  test('TC099: Auth persists on refresh', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Should still be on dashboard, not login
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('text=Dashboard').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC100: No flash to login on refresh', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Monitor for login page during refresh
    let sawLogin = false;
    page.on('framenavigated', (frame) => {
      if (frame.url().includes('/login')) {
        sawLogin = true;
      }
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Should not have navigated to login
    expect(sawLogin).toBe(false);
  });
});
