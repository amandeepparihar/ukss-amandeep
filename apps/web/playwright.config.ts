import { defineConfig, devices } from '@playwright/test';

const STORAGE_STATE = 'e2e/.auth/user.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: 'html',
  timeout: 60000,

  // Global setup runs once before all tests to authenticate
  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3002',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    // Setup project - runs first, no dependencies
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },

    // Unauthenticated tests (login page, forgot password, etc.)
    {
      name: 'unauthenticated',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /auth\.spec\.ts/,
    },

    // Authenticated tests - use saved session state
    {
      name: 'authenticated',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
      },
      testIgnore: /auth\.spec\.ts/,
      dependencies: ['unauthenticated'],
    },
  ],

  // Run local dev server before tests (disabled when BASE_URL is set)
  // Uses --mode test to load .env.test (localhost API) instead of .env (production API)
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'pnpm dev --mode test',
        url: 'http://localhost:3002',
        reuseExistingServer: true,
        timeout: 120000,
      },
});
