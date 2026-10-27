import { chromium, FullConfig } from '@playwright/test';
import { TEST_ADMIN } from './fixtures';

const STORAGE_STATE_PATH = 'e2e/.auth/user.json';

async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0].use;

  console.log(`Global setup: Authenticating against ${baseURL}...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Enable console logging for debugging
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`Browser console error: ${msg.text()}`);
    }
  });

  page.on('pageerror', (error) => {
    console.log(`Browser page error: ${error.message}`);
  });

  let success = false;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Global setup: Attempt ${attempt}/${maxRetries}...`);

      // Navigate to login page
      console.log('Navigating to login page...');
      await page.goto(`${baseURL}/login`, { timeout: 60000 });
      await page.waitForLoadState('domcontentloaded');
      console.log(`Current URL after navigation: ${page.url()}`);

      // Wait for login form
      console.log('Waiting for login form...');
      await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 15000 });
      console.log('Login form found');

      // Fill credentials
      console.log('Filling credentials...');
      await page.fill('input[name="email"]', '');
      await page.fill('input[name="email"]', TEST_ADMIN.email);
      await page.fill('input[name="password"]', '');
      await page.fill('input[name="password"]', TEST_ADMIN.password);

      // Click submit
      console.log('Clicking submit button...');
      await page.click('button[type="submit"]');

      // Wait a bit for the response
      await page.waitForTimeout(2000);
      console.log(`URL after submit: ${page.url()}`);

      // Check for any network requests
      const response = await page.waitForResponse(
        (resp) => resp.url().includes('/api/auth/login'),
        { timeout: 15000 }
      ).catch(() => null);

      if (response) {
        console.log(`Login API response status: ${response.status()}`);
        if (response.status() !== 200) {
          const body = await response.text().catch(() => 'Unable to get body');
          console.log(`Login API response body: ${body}`);
          throw new Error(`Login API returned ${response.status()}`);
        }
      } else {
        console.log('No login API response received, checking current state...');
      }

      // Wait for navigation to complete or avatar to appear
      console.log('Waiting for login to complete...');

      // Give time for redirect
      await page.waitForTimeout(3000);
      console.log(`URL after wait: ${page.url()}`);

      // Check if we're on dashboard
      const currentUrl = page.url();
      const isOnDashboard = !currentUrl.includes('login');

      if (isOnDashboard) {
        console.log('Redirected away from login page');

        // Wait for user avatar
        const userAvatar = page.locator('button.rounded-full');
        const isVisible = await userAvatar.isVisible({ timeout: 15000 }).catch(() => false);

        if (isVisible) {
          console.log('User avatar is visible - login successful!');
          success = true;
          break;
        } else {
          console.log('Avatar not visible, checking page content...');
          const pageContent = await page.content();
          console.log(`Page title: ${await page.title()}`);

          // Maybe the selector is wrong, let's see what buttons exist
          const buttons = await page.locator('button').all();
          console.log(`Found ${buttons.length} buttons on page`);
          for (let i = 0; i < Math.min(buttons.length, 5); i++) {
            const className = await buttons[i].getAttribute('class');
            console.log(`Button ${i}: ${className}`);
          }

          // Check for any user-related elements
          const anyAvatar = await page.locator('[class*="avatar"], [class*="Avatar"]').isVisible().catch(() => false);
          if (anyAvatar) {
            console.log('Found avatar element with different selector');
            success = true;
            break;
          }
        }
      } else {
        console.log('Still on login page, checking for errors...');
        const errorMsg = await page.locator('[class*="error"], [role="alert"]').textContent().catch(() => null);
        if (errorMsg) {
          console.log(`Error message on page: ${errorMsg}`);
        }
      }

      if (!success) {
        throw new Error('Login did not complete successfully');
      }
    } catch (error) {
      console.log(`Global setup: Login attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt < maxRetries) {
        await page.waitForTimeout(3000 * attempt);
      }
    }
  }

  if (!success) {
    await browser.close();
    throw new Error('Global setup: Failed to authenticate after all retries');
  }

  // Save authentication state
  await context.storageState({ path: STORAGE_STATE_PATH });
  console.log(`Global setup: Session saved to ${STORAGE_STATE_PATH}`);

  await browser.close();
}

export default globalSetup;
