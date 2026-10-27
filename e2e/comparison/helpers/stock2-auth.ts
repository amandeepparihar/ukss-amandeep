import { Page, BrowserContext, Browser } from '@playwright/test';

const STOCK2_BASE_URL = 'https://stock2-staging.uksoccershop.com';
const STOCK2_EMAIL = 'admin@example.com';
const STOCK2_PASSWORD = 'Admin@123';

/**
 * Log in to Stock2 on the given page.
 * Used both for initial auth and for re-authentication when the session expires.
 */
async function loginToStock2(page: Page): Promise<void> {
  await page.goto(`${STOCK2_BASE_URL}/login`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 10000 });

  await page.fill('input[name="email"]', STOCK2_EMAIL);
  await page.fill('input[name="password"]', STOCK2_PASSWORD);

  await Promise.all([
    page.waitForURL(`${STOCK2_BASE_URL}/`, { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);

  await page.waitForLoadState('networkidle', { timeout: 15000 });
}

/**
 * Create an authenticated Stock2 page.
 */
export async function createStock2Page(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await loginToStock2(page);

  return { context, page };
}

/**
 * Navigate to Stock2 orders listing page.
 */
export async function navigateToStock2Orders(page: Page, params?: Record<string, string>): Promise<void> {
  const url = new URL(`${STOCK2_BASE_URL}/orders`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 30000 });
}

/**
 * Navigate to Stock2 order edit page.
 * Handles session expiry: if the page redirects to /login, re-authenticates
 * and navigates again. This is necessary because the JWT access token is stored
 * in memory and is lost on full-page navigations; the app relies on a refresh
 * token cookie to restore the session, but that can fail under certain conditions
 * (e.g. the SPA's auth flow does not complete within the networkidle window).
 */
export async function navigateToStock2OrderEdit(page: Page, orderId: number): Promise<void> {
  await page.goto(`${STOCK2_BASE_URL}/orders/${orderId}`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Extra buffer for the SPA's auth-refresh flow to complete
  await page.waitForTimeout(2000);

  // Detect redirect to login (session expired or auth flow did not complete)
  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    // Re-authenticate and navigate back to the order
    await loginToStock2(page);
    await page.goto(`${STOCK2_BASE_URL}/orders/${orderId}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
  }
}

export { STOCK2_BASE_URL };
