import { Page, BrowserContext, Browser } from '@playwright/test';

/**
 * ZenCart webadmin is at www.uksoccershop.com/webadmin/ (not stock.uksoccershop.com).
 * The stock.uksoccershop.com is a CakePHP stock management system.
 * Orders edit/listing is in the ZenCart webadmin.
 */
const ZENC_BASE_URL = 'https://www.uksoccershop.com';
const BASIC_AUTH_USER = 'footykit';
const BASIC_AUTH_PASS = 'worldcup2017';
const ADMIN_NAME = 'nsrivastava2';
const ADMIN_PASS = 'tEst@#987xy';

/**
 * Check if the zenc session is still valid (not redirected to login page).
 */
export async function isZencSessionValid(page: Page): Promise<boolean> {
  const url = page.url();
  return !url.includes('login.php');
}

/**
 * Re-authenticate zenc if the session has expired.
 * Returns true if re-authentication was performed.
 */
export async function reAuthenticateZencIfNeeded(page: Page): Promise<boolean> {
  if (await isZencSessionValid(page)) return false;

  console.log('ZENC: Session expired, re-authenticating...');
  await page.goto(`${ZENC_BASE_URL}/webadmin/login.php`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await page.waitForSelector('input[name="admin_name"]', { state: 'visible', timeout: 15000 });
  await page.fill('input[name="admin_name"]', ADMIN_NAME);
  await page.fill('input[name="admin_pass"]', ADMIN_PASS);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    page.click('input[type="submit"][name="submit"]'),
  ]);

  const url = page.url();
  if (url.includes('login.php')) {
    throw new Error(`Zenc re-authentication failed — still on login page: ${url}`);
  }

  console.log('ZENC: Re-authentication successful');
  return true;
}

/**
 * Create an authenticated zenc page with basic auth + ZenCart webadmin login.
 * Two-step auth:
 * 1. Set HTTP basic auth headers
 * 2. Login via ZenCart webadmin form (admin_name, admin_pass + securityToken)
 */
export async function createZencPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    httpCredentials: {
      username: BASIC_AUTH_USER,
      password: BASIC_AUTH_PASS,
    },
  });

  const page = await context.newPage();

  // Navigate to webadmin login page (orders.php redirects to login if not authenticated)
  await page.goto(`${ZENC_BASE_URL}/webadmin/login.php`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Wait for the login form
  await page.waitForSelector('input[name="admin_name"]', { state: 'visible', timeout: 15000 });

  // Fill login form
  await page.fill('input[name="admin_name"]', ADMIN_NAME);
  await page.fill('input[name="admin_pass"]', ADMIN_PASS);

  // Submit and wait for redirect
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    page.click('input[type="submit"][name="submit"]'),
  ]);

  // Verify login — should no longer be on login.php
  const url = page.url();
  if (url.includes('login.php')) {
    throw new Error(`Zenc login failed — still on login page: ${url}`);
  }

  return { context, page };
}

/**
 * Navigate to zenc orders listing page.
 * Includes session validation (see GitHub issue #222).
 */
export async function navigateToZencOrders(page: Page, params?: Record<string, string>): Promise<void> {
  const url = new URL(`${ZENC_BASE_URL}/webadmin/orders.php`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Check if session expired (redirected to login page)
  const reAuthed = await reAuthenticateZencIfNeeded(page);
  if (reAuthed) {
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
}

/**
 * Navigate to zenc order edit page.
 * Includes session validation and page verification to prevent
 * stale/wrong data extraction (see GitHub issue #222).
 */
export async function navigateToZencOrderEdit(page: Page, orderId: number): Promise<void> {
  const editUrl = `${ZENC_BASE_URL}/webadmin/orders.php?oID=${orderId}&action=edit`;

  await page.goto(editUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Check if session expired (redirected to login page)
  const reAuthed = await reAuthenticateZencIfNeeded(page);
  if (reAuthed) {
    // Re-navigate to the edit page after re-authentication
    await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  }

  // Verify we landed on the edit page, not the listing page.
  // The edit page URL should contain oID and action=edit.
  const currentUrl = page.url();
  if (!currentUrl.includes('action=edit')) {
    throw new Error(
      `Zenc: Expected edit page for order ${orderId} but got: ${currentUrl}`
    );
  }
}

export { ZENC_BASE_URL };
