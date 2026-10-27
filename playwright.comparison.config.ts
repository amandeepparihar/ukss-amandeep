import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for zenc vs Stock2 comparison tests.
 *
 * Usage:
 *   pnpm playwright test --config playwright.comparison.config.ts
 *   pnpm playwright test --config playwright.comparison.config.ts --headed
 *   pnpm playwright test --config playwright.comparison.config.ts e2e/comparison/01-listing-counts.spec.ts
 */
export default defineConfig({
  testDir: './e2e/comparison',

  // Sequential — each test depends on shared browser contexts
  fullyParallel: false,

  forbidOnly: !!process.env.CI,

  // Comparison tests shouldn't retry — we want raw results
  retries: 0,

  // Single worker — tests share authenticated browser contexts
  workers: 1,

  reporter: [['html', { outputFolder: 'playwright-report-comparison' }], ['list']],

  use: {
    // No baseURL — comparison tests navigate to both zenc and stock2 explicitly
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 60000,
  },

  projects: [
    {
      name: 'comparison',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Longer timeout — each test navigates to two different systems
  timeout: 120000,

  expect: {
    timeout: 15000,
  },

  // Output directory for test artifacts
  outputDir: './e2e/comparison/test-results',
});
