import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  // Test directory
  testDir: './e2e',

  // Run tests in files in parallel - set to false for more stable tests against remote
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry failed tests - set to 2 for remote testing stability
  retries: 2,

  // Limit workers to avoid overwhelming the remote server
  workers: 2,

  // Reporter to use
  reporter: process.env.CI
    ? [['html'], ['github']]
    : [['html'], ['list']],

  // Shared settings for all the projects below
  use: {
    // Base URL for remote testing
    baseURL: 'https://js-admin.veldev.com',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Maximum time each action such as `click()` can take
    actionTimeout: 15000,

    // Navigation timeout
    navigationTimeout: 60000,
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No webServer needed - testing against remote
  // webServer: undefined,

  // Global timeout for each test - increased for remote testing
  timeout: 60000,

  // Expect options
  expect: {
    // Maximum time expect() should wait for the condition to be met
    timeout: 15000,
  },
});
