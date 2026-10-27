# E2E Testing with Playwright

This document provides comprehensive information about the End-to-End (E2E) testing setup for the Admin Panel application using Playwright.

## Table of Contents

- [Overview](#overview)
- [Setup](#setup)
- [Running Tests](#running-tests)
- [Project Structure](#project-structure)
- [Writing Tests](#writing-tests)
- [Best Practices](#best-practices)
- [CI/CD Integration](#cicd-integration)
- [Debugging](#debugging)
- [Troubleshooting](#troubleshooting)

## Overview

Our E2E testing suite uses Playwright, a modern end-to-end testing framework that supports multiple browsers (Chromium, Firefox, and WebKit). The tests are designed to:

- Validate critical user flows
- Ensure cross-browser compatibility
- Prevent regressions
- Provide confidence in deployments

### Test Coverage

The test suite covers the following areas:

1. **Authentication** - Login, logout, password reset, session management
2. **User Management** - CRUD operations, search, pagination, bulk actions
3. **Role Management** - CRUD operations, permissions assignment
4. **Permissions** - Access control, UI visibility based on roles
5. **Form Validation** - Required fields, formats, constraints
6. **DataTable** - Sorting, filtering, pagination, export

## Setup

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Running instances of:
  - API server (port 4000)
  - Web application (port 3002)
  - PostgreSQL database
  - Redis server

### Installation

1. Install Playwright and dependencies:

```bash
pnpm add -D @playwright/test
```

2. Install browser binaries:

```bash
npx playwright install
```

3. Install system dependencies (Linux):

```bash
npx playwright install-deps
```

## Running Tests

### Basic Commands

```bash
# Run all tests
pnpm test:e2e

# Run tests with UI mode (interactive)
pnpm test:e2e:ui

# Run tests in headed mode (see browser)
pnpm test:e2e:headed

# Debug tests
pnpm test:e2e:debug

# View test report
pnpm test:e2e:report
```

### Browser-Specific Tests

```bash
# Run tests in Chromium only
pnpm test:e2e:chromium

# Run tests in Firefox only
pnpm test:e2e:firefox

# Run tests in WebKit only
pnpm test:e2e:webkit
```

### Running Specific Tests

```bash
# Run a specific test file
npx playwright test e2e/tests/auth.spec.ts

# Run tests matching a pattern
npx playwright test e2e/tests/users

# Run a specific test by name
npx playwright test -g "should login with valid credentials"
```

## Project Structure

```
e2e/
├── fixtures/          # Test fixtures and utilities
│   ├── auth.fixture.ts    # Authentication fixtures
│   ├── db.fixture.ts      # Database fixtures
│   └── api.fixture.ts     # API fixtures
├── pages/             # Page Object Models
│   ├── login.page.ts      # Login page POM
│   ├── dashboard.page.ts  # Dashboard page POM
│   ├── users.page.ts      # Users page POM
│   └── roles.page.ts      # Roles page POM
├── helpers/           # Helper functions
│   ├── auth.ts            # Authentication helpers
│   ├── testData.ts        # Test data generators
│   └── assertions.ts      # Custom assertions
└── tests/             # Test suites
    ├── auth.spec.ts       # Authentication tests
    ├── users.spec.ts      # User management tests
    ├── roles.spec.ts      # Role management tests
    ├── permissions.spec.ts # Permission tests
    ├── forms.spec.ts      # Form validation tests
    └── datatable.spec.ts  # DataTable tests
```

## Writing Tests

### Page Object Model (POM)

We use the Page Object Model pattern to encapsulate page interactions:

```typescript
// e2e/pages/example.page.ts
import { Page, Locator } from '@playwright/test';

export class ExamplePage {
  readonly page: Page;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.submitButton = page.locator('[data-testid="submit-button"]');
  }

  async goto() {
    await this.page.goto('/example');
  }

  async submit() {
    await this.submitButton.click();
  }
}
```

### Test Structure

Follow the AAA pattern (Arrange, Act, Assert):

```typescript
import { test, expect } from '@playwright/test';
import { ExamplePage } from '../pages/example.page';
import { loginAsAdmin } from '../helpers/auth';

test.describe('Example Feature', () => {
  test('should perform action', async ({ page }) => {
    // Arrange
    const examplePage = new ExamplePage(page);
    await loginAsAdmin(page);
    await examplePage.goto();

    // Act
    await examplePage.submit();

    // Assert
    await expect(page).toHaveURL('/success');
  });
});
```

### Using Fixtures

Fixtures provide reusable setup/teardown logic:

```typescript
import { test, expect } from '../fixtures/auth.fixture';

test.use({ authenticatedPage: true });

test('should access protected route', async ({ authenticatedPage }) => {
  // Already logged in via fixture
  await authenticatedPage.goto('/protected');
  // Test logic here
});
```

### Custom Assertions

Use custom assertion helpers for common checks:

```typescript
import { expectToast, expectModalOpen } from '../helpers/assertions';

test('should show success message', async ({ page }) => {
  // Perform action
  await page.click('[data-testid="save-button"]');

  // Check toast
  await expectToast(page, 'Saved successfully', 'success');
});
```

### Test Data Generation

Use test data generators to create unique test data:

```typescript
import { generateTestUser, generateTestRole } from '../helpers/testData';

test('should create user', async ({ page }) => {
  const testUser = generateTestUser({
    email: 'custom@example.com',
    role: 'admin',
  });

  // Use testUser in test
});
```

## Best Practices

### 1. Use Data Test IDs

Always use `data-testid` attributes for reliable selectors:

```html
<!-- Good -->
<button data-testid="submit-button">Submit</button>

<!-- Avoid -->
<button class="btn btn-primary">Submit</button>
```

```typescript
// Test
await page.click('[data-testid="submit-button"]');
```

### 2. Keep Tests Independent

Each test should be independent and not rely on other tests:

```typescript
// Good
test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/users');
});

test('should create user', async ({ page }) => {
  // Test logic
});

test('should delete user', async ({ page }) => {
  // Test logic - doesn't depend on previous test
});
```

### 3. Use Page Object Models

Encapsulate page interactions in POMs for maintainability:

```typescript
// Instead of
await page.fill('input#email', 'test@example.com');
await page.fill('input#password', 'password');
await page.click('button[type="submit"]');

// Use
await loginPage.login('test@example.com', 'password');
```

### 4. Avoid Hard-Coded Waits

Use Playwright's auto-waiting instead of `setTimeout`:

```typescript
// Bad
await page.click('[data-testid="button"]');
await page.waitForTimeout(2000);

// Good
await page.click('[data-testid="button"]');
await page.waitForSelector('[data-testid="result"]');
```

### 5. Handle Flaky Tests

Identify and fix flaky tests immediately:

- Use proper waiting strategies
- Avoid race conditions
- Ensure test data isolation
- Use retry mechanisms sparingly

### 6. Test Critical User Flows

Focus on testing critical user flows end-to-end:

```typescript
test('complete user registration flow', async ({ page }) => {
  await page.goto('/register');
  await fillRegistrationForm(page);
  await submitForm(page);
  await verifyEmailConfirmation(page);
  await loginWithNewCredentials(page);
  await verifyDashboardAccess(page);
});
```

### 7. Clean Up Test Data

Always clean up test data to prevent pollution:

```typescript
test.afterEach(async ({ page, createTestUser }) => {
  // Cleanup is handled by fixture
});
```

## CI/CD Integration

### GitHub Actions

Tests run automatically on:

- Push to main, develop, or feature branches
- Pull requests to main or develop

### Environment Variables

Required environment variables for CI:

```bash
DATABASE_URL=postgresql://admin:admin123@localhost:5432/admin_panel_test
REDIS_URL=redis://localhost:6379
JWT_SECRET=test-jwt-secret-key-for-ci
API_URL=http://localhost:4000/api
NODE_ENV=test
CI=true
```

### Test Artifacts

Failed test artifacts are automatically uploaded:

- Playwright HTML report
- Screenshots on failure
- Videos on failure
- Trace files on first retry

## Debugging

### Debug Mode

Run tests in debug mode with Playwright Inspector:

```bash
pnpm test:e2e:debug
```

### UI Mode

Interactive test runner with time-travel debugging:

```bash
pnpm test:e2e:ui
```

### Screenshots

Take screenshots during test execution:

```typescript
test('example', async ({ page }) => {
  await page.screenshot({ path: 'screenshot.png' });
});
```

### Video Recording

Videos are automatically recorded on failure (configured in `playwright.config.ts`).

### Console Logs

Capture console output:

```typescript
page.on('console', (msg) => console.log(msg.text()));
```

### Network Requests

Monitor network requests:

```typescript
page.on('request', (request) => {
  console.log('>>', request.method(), request.url());
});

page.on('response', (response) => {
  console.log('<<', response.status(), response.url());
});
```

## Troubleshooting

### Common Issues

#### 1. Tests Timing Out

**Problem**: Tests timeout waiting for elements

**Solution**:
- Increase timeout in config
- Check if element selector is correct
- Ensure application is running
- Check network conditions

```typescript
// Increase timeout for specific test
test.setTimeout(60000);

// Increase timeout for specific action
await page.waitForSelector('[data-testid="element"]', {
  timeout: 30000,
});
```

#### 2. Flaky Tests

**Problem**: Tests pass/fail inconsistently

**Solution**:
- Use proper wait strategies
- Avoid hard-coded timeouts
- Ensure test data isolation
- Check for race conditions

#### 3. Browser Not Found

**Problem**: Playwright can't find browser

**Solution**:
```bash
npx playwright install chromium
npx playwright install-deps
```

#### 4. Port Already in Use

**Problem**: Dev server port is already in use

**Solution**:
- Stop existing process
- Or configure different port in `playwright.config.ts`

#### 5. Authentication Issues

**Problem**: Tests fail at login

**Solution**:
- Verify test credentials
- Check API is running
- Verify database has seeded data
- Check token expiration

### Getting Help

1. Check Playwright documentation: https://playwright.dev
2. Review test logs and artifacts
3. Use debug mode to step through tests
4. Check GitHub Actions logs for CI failures

## Useful Commands

```bash
# Install specific browser
npx playwright install chromium

# Update Playwright
pnpm update @playwright/test

# Generate tests with Playwright codegen
npx playwright codegen http://localhost:3002

# Show test report
npx playwright show-report

# Run tests with specific tag
npx playwright test --grep @smoke

# Run tests in parallel
npx playwright test --workers=4

# Run tests with trace
npx playwright test --trace on
```

## Test Metrics

Target metrics for test suite:

- **Test Execution Time**: < 5 minutes (full suite)
- **Test Coverage**: > 80% of critical user flows
- **Flakiness**: < 1% flaky tests
- **Reliability**: > 99% pass rate

## Contributing

When adding new tests:

1. Follow existing test patterns
2. Use Page Object Models
3. Add proper documentation
4. Ensure tests are independent
5. Clean up test data
6. Verify tests pass locally and on CI

## License

This E2E testing setup is part of the Admin Panel Framework project.
