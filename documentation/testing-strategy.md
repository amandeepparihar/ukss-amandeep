# Comprehensive Testing Strategy for js-admin-panel

**Project**: Admin Panel Framework
**Created**: 2025-12-16
**Status**: Research Phase - No Tests Implemented Yet
**Tech Stack**: React 18, TypeScript, Fastify, Prisma, PostgreSQL, Redis

---

## Executive Summary

This document outlines a comprehensive testing strategy for the js-admin-panel project. The strategy covers unit tests, integration tests, and end-to-end (E2E) tests for both the backend API (`apps/api`) and frontend web application (`apps/web`). The project currently has NO test framework configured, so this strategy includes recommendations for test tooling, file organization, and specific test cases to implement.

---

## 1. Current State Analysis

### 1.1 Test Infrastructure Status
- **No test frameworks currently configured** in either `apps/api` or `apps/web`
- Root `package.json` has a `test` script configured in turbo.json but no packages implement it
- No existing test files found in the codebase
- No test configuration files (vitest.config.ts, jest.config.ts, playwright.config.ts)

### 1.2 Project Architecture Overview
```
/js-admin-panel
├── apps/
│   ├── api/                    # Fastify backend
│   │   ├── src/
│   │   │   ├── modules/        # Business logic modules
│   │   │   │   ├── auth/       # Authentication & sessions
│   │   │   │   ├── users/      # User CRUD
│   │   │   │   ├── roles/      # Role & permissions
│   │   │   │   ├── menu/       # Dynamic menu
│   │   │   │   ├── files/      # File upload (S3/MinIO)
│   │   │   │   └── exports/    # Data export (CSV/Excel/PDF)
│   │   │   ├── plugins/        # Fastify plugins
│   │   │   ├── lib/            # Utilities (errors, logger, prisma)
│   │   │   └── workers/        # BullMQ job workers
│   │   └── prisma/             # Database schema & seeds
│   └── web/                    # React frontend
│       ├── src/
│       │   ├── components/     # UI components
│       │   │   ├── data-table/ # Advanced table component
│       │   │   ├── forms/      # Form field components
│       │   │   ├── file-upload/# File upload component
│       │   │   ├── export/     # Export dialog
│       │   │   ├── layout/     # Layout components
│       │   │   └── ui/         # Shadcn UI primitives
│       │   ├── hooks/          # Custom React hooks
│       │   ├── pages/          # Page components
│       │   ├── stores/         # Zustand stores
│       │   └── lib/            # Utilities (API client)
└── packages/
    └── shared/                 # Shared schemas & types
```

---

## 2. Recommended Testing Stack

### 2.1 Backend Testing (`apps/api`)

**Recommended Tools:**
- **Vitest** - Fast, Vite-powered test runner (preferred over Jest for better TypeScript support)
- **Supertest** - HTTP assertions for API endpoint testing
- **@faker-js/faker** - Generate realistic test data
- **@testcontainers/postgresql** - Isolated database for integration tests (optional, can use test DB)
- **Redis Mock** or **ioredis-mock** - Mock Redis for unit tests

**Why Vitest?**
- Native TypeScript support (no ts-jest needed)
- Faster than Jest
- Compatible with Vite ecosystem
- Built-in coverage reporting
- Watch mode with HMR

**Installation:**
```bash
cd apps/api
pnpm add -D vitest supertest @faker-js/faker @types/supertest c8
```

### 2.2 Frontend Testing (`apps/web`)

**Recommended Tools:**
- **Vitest** - Test runner (consistency with backend)
- **React Testing Library** - Component testing (user-centric approach)
- **@testing-library/user-event** - Simulate user interactions
- **@testing-library/jest-dom** - Custom matchers for DOM
- **MSW (Mock Service Worker)** - API mocking
- **Playwright** - E2E testing (modern, reliable, multi-browser)

**Why Playwright over Cypress?**
- Better performance
- Multi-browser support out of the box
- Auto-wait functionality
- Better debugging tools
- More reliable for CI/CD

**Installation:**
```bash
cd apps/web
pnpm add -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom @vitest/ui jsdom msw
pnpm add -D playwright @playwright/test
pnpm exec playwright install
```

### 2.3 Shared Testing Utilities (`packages/shared`)

**Recommended Tools:**
- **Vitest** - Test Zod schemas and utility functions
- **@faker-js/faker** - Test data generation

---

## 3. API Endpoints Requiring Integration Tests

### 3.1 Authentication Module (`/api/auth/`)

**Priority: HIGH** - Critical security functionality

| Endpoint | Method | Test Cases |
|----------|--------|------------|
| `/api/auth/login` | POST | ✅ Valid credentials → 200 + JWT tokens<br>✅ Invalid email → 401<br>✅ Invalid password → 401<br>✅ Inactive user → 401<br>✅ Rate limiting (5 failed attempts)<br>✅ Cookie sets refreshToken<br>✅ Returns user object |
| `/api/auth/logout` | POST | ✅ Authenticated user → 200<br>✅ Clears refreshToken cookie<br>✅ Revokes session in DB<br>✅ Unauthenticated → 401 |
| `/api/auth/refresh` | POST | ✅ Valid refreshToken (cookie) → 200 + new tokens<br>✅ Invalid/expired token → 401<br>✅ Revoked token → 401<br>✅ Missing token → 401<br>✅ Rotates refresh token |
| `/api/auth/forgot-password` | POST | ✅ Valid email → 200 (always, even if email doesn't exist)<br>✅ Creates reset token in DB<br>✅ Token expires after 1 hour<br>✅ Invalid email format → 400 |
| `/api/auth/reset-password` | POST | ✅ Valid token + new password → 200<br>✅ Invalid token → 401<br>✅ Expired token → 401<br>✅ Weak password → 400<br>✅ Password hashed in DB |
| `/api/auth/me` | GET | ✅ Authenticated → 200 + user profile<br>✅ Unauthenticated → 401<br>✅ Includes role & permissions |
| `/api/auth/me` | PUT | ✅ Update profile (firstName, lastName, avatar) → 200<br>✅ Cannot update email<br>✅ Validation errors → 400<br>✅ Unauthenticated → 401 |
| `/api/auth/me/password` | PUT | ✅ Valid current + new password → 200<br>✅ Incorrect current password → 401<br>✅ Weak new password → 400<br>✅ Same as current → 400 |
| `/api/auth/sessions` | GET | ✅ List all active sessions → 200<br>✅ Shows current session first<br>✅ Includes device info, IP, last activity |
| `/api/auth/sessions/:id` | DELETE | ✅ Revoke specific session → 200<br>✅ Cannot revoke current session → 400<br>✅ Cannot revoke another user's session → 403<br>✅ Session not found → 404 |
| `/api/auth/2fa/setup` | POST | ✅ Generate QR code + secret → 200<br>✅ Returns otpauthUrl<br>✅ Doesn't enable 2FA yet (requires verify) |
| `/api/auth/2fa/verify` | POST | ✅ Valid code → 200 + enables 2FA<br>✅ Invalid code → 401<br>✅ Stores recovery codes<br>✅ 2FA already enabled → 400 |
| `/api/auth/2fa/disable` | DELETE | ✅ Valid password → 200<br>✅ Disables 2FA in DB<br>✅ Incorrect password → 401<br>✅ 2FA not enabled → 400 |

**Key Integration Test Scenarios:**
- Login → Logout → Login (session cleanup)
- Login → Refresh token → Use new access token
- Failed login 5 times → Account locked → Wait → Login again
- 2FA flow: Setup → Verify → Login with 2FA → Disable

---

### 3.2 Users Module (`/api/users/`)

**Priority: HIGH** - Core CRUD functionality

| Endpoint | Method | Test Cases |
|----------|--------|------------|
| `/api/users` | GET | ✅ List users with pagination → 200<br>✅ Filter by status (isActive)<br>✅ Search by name/email<br>✅ Sort by createdAt, email<br>✅ Permission check (users:view)<br>✅ Unauthenticated → 401<br>✅ No permission → 403 |
| `/api/users/:id` | GET | ✅ Get user by ID → 200<br>✅ Includes role & permissions<br>✅ User not found → 404<br>✅ Permission check (users:view) |
| `/api/users` | POST | ✅ Create user with valid data → 201<br>✅ Password hashed in DB<br>✅ Duplicate email → 409<br>✅ Invalid role ID → 400<br>✅ Missing required fields → 400<br>✅ Weak password → 400<br>✅ Audit log created<br>✅ Permission check (users:create) |
| `/api/users/:id` | PUT | ✅ Update user → 200<br>✅ Can change role, status, name<br>✅ Cannot change email (or require email verification)<br>✅ User not found → 404<br>✅ Duplicate email → 409<br>✅ Audit log created<br>✅ Permission check (users:edit) |
| `/api/users/:id` | DELETE | ✅ Soft delete user → 204<br>✅ User marked inactive (or deleted)<br>✅ Cannot delete self → 400<br>✅ Cannot delete system users → 400<br>✅ Audit log created<br>✅ User not found → 404<br>✅ Permission check (users:delete) |

**Key Integration Test Scenarios:**
- Create user → Login as new user → Verify permissions
- Update user role → Verify permissions change
- Delete user → Verify cannot login
- Bulk user operations (if implemented)

---

### 3.3 Roles Module (`/api/roles/`)

**Priority: HIGH** - Critical for authorization

| Endpoint | Method | Test Cases |
|----------|--------|------------|
| `/api/roles` | GET | ✅ List all roles → 200<br>✅ Includes user count, permission count<br>✅ Pagination & sorting<br>✅ Permission check (roles:view) |
| `/api/roles/:id` | GET | ✅ Get role by ID → 200<br>✅ Includes full permission list<br>✅ Role not found → 404<br>✅ Permission check (roles:view) |
| `/api/roles` | POST | ✅ Create role → 201<br>✅ Duplicate name → 409<br>✅ Validation errors → 400<br>✅ Audit log created<br>✅ Permission check (roles:create) |
| `/api/roles/:id` | PUT | ✅ Update role name/description → 200<br>✅ Cannot update system roles → 403<br>✅ Duplicate name → 409<br>✅ Audit log created<br>✅ Permission check (roles:edit) |
| `/api/roles/:id` | DELETE | ✅ Delete role → 204<br>✅ Cannot delete if users assigned → 400<br>✅ Cannot delete system roles → 403<br>✅ Audit log created<br>✅ Permission check (roles:delete) |
| `/api/roles/:id/permissions` | PUT | ✅ Update permissions → 200<br>✅ Add new permissions<br>✅ Remove existing permissions<br>✅ Invalid permission format → 400<br>✅ Audit log created<br>✅ Permission check (roles:edit) |

**Key Integration Test Scenarios:**
- Create role with permissions → Assign to user → Verify access
- Remove permission → Verify user loses access
- Delete role with users → Should fail
- Update system role → Should fail

---

### 3.4 Files Module (`/api/files/`)

**Priority: HIGH** - Security-sensitive (file uploads)

| Endpoint | Method | Test Cases |
|----------|--------|------------|
| `/api/files/upload` | POST | ✅ Upload valid file → 200 + file metadata<br>✅ File saved to S3/MinIO<br>✅ Database record created<br>✅ File too large (>10MB) → 400<br>✅ Invalid file type → 400<br>✅ Missing file → 400<br>✅ Authenticated only → 401<br>✅ Virus scan (if implemented) |
| `/api/files/presigned-upload` | POST | ✅ Get presigned URL → 200<br>✅ Returns uploadUrl, key, fields<br>✅ Invalid file type → 400<br>✅ Authenticated only → 401 |
| `/api/files/confirm-upload` | POST | ✅ Confirm client-side upload → 200<br>✅ Verify file exists in S3<br>✅ Create DB record<br>✅ File not in S3 → 400<br>✅ Authenticated only → 401 |
| `/api/files/:id` | GET | ✅ Get file metadata → 200<br>✅ File not found → 404<br>✅ Authenticated only → 401<br>✅ Cannot access other user's files (if scoped) |
| `/api/files/:id/download` | GET | ✅ Get presigned download URL → 200<br>✅ URL valid for 1 hour<br>✅ File not found → 404<br>✅ Authenticated only → 401 |
| `/api/files` | GET | ✅ List user's files → 200<br>✅ Pagination works<br>✅ Filter by folder<br>✅ Authenticated only → 401 |
| `/api/files/:id` | DELETE | ✅ Delete file → 200<br>✅ File removed from S3<br>✅ DB record deleted<br>✅ Cannot delete other user's files<br>✅ File not found → 404<br>✅ Authenticated only → 401 |

**Key Integration Test Scenarios:**
- Upload file → Download → Verify content matches
- Presigned upload → Confirm → Download
- Upload multiple file types (image, PDF, Excel)
- Upload virus-infected file → Should block (if AV enabled)
- Delete file → Verify S3 cleanup

**Mocking Strategy:**
- Mock S3 client in unit tests
- Use MinIO in integration tests (via Docker)
- Test with real small files (<100KB)

---

### 3.5 Menu Module (`/api/menu/`)

**Priority: MEDIUM** - UI-related, less critical

| Endpoint | Method | Test Cases |
|----------|--------|------------|
| `/api/menu` | GET | ✅ Get user-specific menu tree → 200<br>✅ Filtered by user permissions<br>✅ Hierarchical structure<br>✅ Hidden items excluded<br>✅ Authenticated only → 401 |
| `/api/menu/all` | GET | ✅ Get all menu items (admin) → 200<br>✅ Flat list with parent references<br>✅ Permission check (menu:view) |
| `/api/menu/:id` | GET | ✅ Get menu item by ID → 200<br>✅ Item not found → 404<br>✅ Permission check (menu:view) |
| `/api/menu` | POST | ✅ Create menu item → 201<br>✅ Set parent (nested item)<br>✅ Set permissions<br>✅ Validation errors → 400<br>✅ Audit log created<br>✅ Permission check (menu:create) |
| `/api/menu/:id` | PUT | ✅ Update menu item → 200<br>✅ Change parent (reorder hierarchy)<br>✅ Audit log created<br>✅ Permission check (menu:edit) |
| `/api/menu/:id` | DELETE | ✅ Delete menu item → 204<br>✅ Cascade delete children (optional)<br>✅ Or prevent if has children<br>✅ Audit log created<br>✅ Permission check (menu:delete) |
| `/api/menu/reorder` | POST | ✅ Reorder multiple items → 200<br>✅ Updates sortOrder in DB<br>✅ Invalid item ID → 400<br>✅ Permission check (menu:edit) |

**Key Integration Test Scenarios:**
- Create nested menu structure → Get as user → Verify hierarchy
- User without permission → Menu item hidden
- Reorder menu → Verify order persists

---

### 3.6 Exports Module (`/api/exports/`)

**Priority: MEDIUM** - Feature-complete, needs validation

| Endpoint | Method | Test Cases |
|----------|--------|------------|
| `/api/exports` | POST | ✅ Export as CSV → 200 + file download<br>✅ Export as XLSX → 200<br>✅ Export as PDF → 200<br>✅ Apply filters (e.g., active users only)<br>✅ Custom columns<br>✅ Custom title/subtitle<br>✅ Landscape/portrait orientation<br>✅ Invalid resource → 400<br>✅ Invalid format → 400<br>✅ Large dataset (>1000 rows) → Performance test<br>✅ Authenticated only → 401 |
| `/api/exports/preview` | POST | ✅ Get preview (first 5 rows) → 200<br>✅ Returns columns + sample data<br>✅ Filters applied correctly<br>✅ Invalid resource → 400 |
| `/api/exports/resources` | GET | ✅ List available resources → 200<br>✅ Returns users, roles, audit-logs<br>✅ Includes default columns<br>✅ Authenticated only → 401 |

**Key Integration Test Scenarios:**
- Export users as CSV → Parse CSV → Verify data accuracy
- Export with filters → Verify only filtered data included
- Export as PDF → Verify file is valid PDF
- Export 10,000+ rows → Performance benchmark

**Testing Tools:**
- CSV parsing: `papaparse` or `csv-parse`
- Excel validation: `xlsx` library
- PDF validation: `pdf-parse` or check Content-Type header

---

## 4. React Components Requiring Unit Tests

### 4.1 Data Table Component (`components/data-table/`)

**Priority: HIGH** - Core component, complex logic

**Files to Test:**
- `DataTable.tsx`
- `DataTableToolbar.tsx`
- `DataTablePagination.tsx`
- `DataTableColumnHeader.tsx`
- `DataTableFacetedFilter.tsx`
- `useDataTable.ts` (custom hook)

**Test Cases:**

#### `DataTable.tsx`
```typescript
// Test file: components/data-table/DataTable.test.tsx

describe('DataTable', () => {
  // Rendering
  ✅ Renders with basic columns and data
  ✅ Displays loading state when isLoading=true
  ✅ Shows empty state when data is empty
  ✅ Renders checkbox column when enableRowSelection=true

  // Row Selection
  ✅ Selects single row on checkbox click
  ✅ Selects all rows on header checkbox click
  ✅ Deselects row when clicking selected checkbox
  ✅ Calls onRowSelectionChange with correct state
  ✅ Disables multi-select when enableMultiRowSelection=false

  // Pagination
  ✅ Shows pagination controls
  ✅ Calls onPaginationChange when page changes
  ✅ Displays correct page info (e.g., "1-10 of 100")
  ✅ Disables next button on last page
  ✅ Server-side pagination works (manualPagination=true)

  // Sorting
  ✅ Sorts column on header click
  ✅ Toggles asc/desc on repeated clicks
  ✅ Calls onSortingChange for server-side sorting
  ✅ Shows sort indicator icon

  // Filtering
  ✅ Filters data by column
  ✅ Shows active filter badges
  ✅ Clears filters on reset button
  ✅ Multiple filters work together (AND logic)

  // Global Search
  ✅ Filters all columns by search term
  ✅ Clears search on X button
  ✅ Debounces search input (if implemented)

  // Column Visibility
  ✅ Hides/shows columns via visibility menu
  ✅ Persists visibility state

  // Bulk Actions
  ✅ Shows bulk actions when rows selected
  ✅ Executes bulk action on selected rows
  ✅ Confirms destructive actions (if implemented)

  // Accessibility
  ✅ Keyboard navigation works (Tab, Enter, Space)
  ✅ Screen reader labels present
  ✅ ARIA attributes correct
});
```

#### `useDataTable.ts` Hook
```typescript
// Test file: components/data-table/useDataTable.test.ts

describe('useDataTable', () => {
  ✅ Initializes with default pagination state
  ✅ Updates pagination state correctly
  ✅ Updates sorting state correctly
  ✅ Updates filter state correctly
  ✅ Resets pagination when filters change
  ✅ Builds correct API query params
  ✅ Handles server-side mode correctly
});
```

**Mocking Strategy:**
- Mock TanStack Table with `vi.mock('@tanstack/react-table')`
- Use `@testing-library/react` for rendering
- Mock API calls with MSW

---

### 4.2 File Upload Component (`components/file-upload/`)

**Priority: HIGH** - Security-sensitive

**Files to Test:**
- `FileUpload.tsx`

**Test Cases:**
```typescript
// Test file: components/file-upload/FileUpload.test.tsx

describe('FileUpload', () => {
  // Rendering
  ✅ Renders drop zone with label
  ✅ Shows max size and file type info
  ✅ Displays file preview after selection

  // File Selection
  ✅ Opens file picker on click
  ✅ Accepts files via drag & drop
  ✅ Handles multiple files when multiple=true
  ✅ Restricts to single file when multiple=false

  // Validation
  ✅ Rejects file exceeding maxSize
  ✅ Rejects file with invalid type
  ✅ Shows error message for invalid file
  ✅ Prevents upload if validation fails

  // File Preview
  ✅ Shows image preview for image files
  ✅ Shows file icon for non-image files
  ✅ Displays file name and size
  ✅ Shows remove button for each file

  // Upload Process
  ✅ Calls onUpload with valid files
  ✅ Shows loading state during upload
  ✅ Clears files after successful upload
  ✅ Handles upload errors gracefully

  // UI States
  ✅ Disables drop zone when disabled=true
  ✅ Highlights drop zone on drag over
  ✅ Removes highlight on drag leave

  // Cleanup
  ✅ Revokes object URLs on unmount
});
```

**Mocking Strategy:**
- Mock `File` objects with `new File(['content'], 'test.txt', { type: 'text/plain' })`
- Mock `URL.createObjectURL` and `URL.revokeObjectURL`
- Fire drag & drop events with `@testing-library/user-event`

---

### 4.3 Form Components (`components/forms/`)

**Priority: MEDIUM** - Common components

**Files to Test:**
- `TextField.tsx`
- `SelectField.tsx`
- `CheckboxField.tsx`
- `SwitchField.tsx`
- `TextareaField.tsx`
- `RadioGroupField.tsx`

**Test Cases (Example: TextField):**
```typescript
// Test file: components/forms/TextField.test.tsx

describe('TextField', () => {
  ✅ Renders with label
  ✅ Renders with placeholder
  ✅ Shows required indicator (*)
  ✅ Displays validation error message
  ✅ Calls onChange handler on input
  ✅ Supports controlled value
  ✅ Shows error state styling
  ✅ Integrates with React Hook Form (FormField)
  ✅ Disables input when disabled=true
  ✅ Supports different input types (text, email, password)
});
```

**Mocking Strategy:**
- Wrap in `<FormProvider>` from React Hook Form
- Use `useForm()` hook in test setup
- Validate integration with Zod schemas

---

### 4.4 Export Components (`components/export/`)

**Priority: MEDIUM**

**Files to Test:**
- `ExportDialog.tsx`
- `ExportButton.tsx`

**Test Cases:**
```typescript
// Test file: components/export/ExportDialog.test.tsx

describe('ExportDialog', () => {
  ✅ Opens dialog on trigger
  ✅ Closes dialog on cancel
  ✅ Loads available resources on mount
  ✅ Shows format options (CSV, Excel, PDF)
  ✅ Shows column selection
  ✅ Shows orientation options (for PDF)
  ✅ Calls export API on submit
  ✅ Shows loading state during export
  ✅ Shows success toast on completion
  ✅ Shows error toast on failure
  ✅ Downloads file automatically
});
```

---

### 4.5 Layout Components (`components/layout/`)

**Priority: LOW** - Mostly presentational

**Files to Test:**
- `AppShell.tsx`
- `Header.tsx`
- `Sidebar.tsx`
- `PageHeader.tsx`

**Test Cases:**
```typescript
// Test file: components/layout/Sidebar.test.tsx

describe('Sidebar', () => {
  ✅ Renders menu items from data
  ✅ Highlights active route
  ✅ Toggles collapse/expand
  ✅ Shows nested menu items
  ✅ Filters items by user permissions
  ✅ Shows badge counts (if implemented)
});
```

---

### 4.6 UI Primitives (`components/ui/`)

**Priority: LOW** - Shadcn components (mostly tested upstream)

Only test if custom logic added:
- `Button.tsx` - Only if custom variants added
- `Input.tsx` - Only if custom validation
- `Dialog.tsx` - Only if custom behavior

**Recommendation:** Focus on integration tests instead of unit testing Shadcn primitives.

---

## 5. Custom Hooks Requiring Tests

### 5.1 `useAuth.ts`

**Priority: HIGH** - Critical authentication logic

**Test Cases:**
```typescript
// Test file: hooks/useAuth.test.ts

describe('useAuth', () => {
  // Initial State
  ✅ Returns isLoading=true initially
  ✅ Checks for existing token on mount
  ✅ Loads user data if token exists
  ✅ Sets isLoading=false after check

  // Login
  ✅ Calls /auth/login API on login()
  ✅ Stores user and token on success
  ✅ Navigates to home page on success
  ✅ Shows error toast on failure
  ✅ Sets isLoggingIn state correctly

  // Logout
  ✅ Calls /auth/logout API on logout()
  ✅ Clears user and token
  ✅ Clears React Query cache
  ✅ Navigates to login page
  ✅ Logs out even if API fails

  // Token Refresh
  ✅ Refreshes token on 401 response (via interceptor)
  ✅ Retries original request after refresh
  ✅ Logs out if refresh fails

  // useCurrentUser Hook
  ✅ Fetches current user data
  ✅ Caches for 5 minutes
  ✅ Refetches on refetch() call
  ✅ Returns cached user immediately

  // usePermission Hook
  ✅ Returns can() function to check permission
  ✅ Returns canAny() for multiple permissions
  ✅ Checks against user's role permissions
});
```

**Mocking Strategy:**
- Mock `axios` API calls with MSW
- Mock `useNavigate` from react-router-dom
- Mock `zustand` store for auth state
- Mock `@tanstack/react-query` client

---

### 5.2 `useExport.ts`

**Priority: MEDIUM**

**Test Cases:**
```typescript
// Test file: hooks/useExport.test.ts

describe('useExport', () => {
  ✅ Calls /exports API with correct params
  ✅ Sets isExporting=true during export
  ✅ Creates download link on success
  ✅ Triggers file download automatically
  ✅ Shows success toast with filename
  ✅ Shows error toast on failure
  ✅ Cleans up blob URL after download

  // getPreview()
  ✅ Calls /exports/preview API
  ✅ Returns sample data and columns
  ✅ Shows error toast on failure

  // getAvailableResources()
  ✅ Calls /exports/resources API
  ✅ Returns list of exportable resources
  ✅ Shows error toast on failure
});
```

---

### 5.3 `useNotifications.ts`

**Priority: LOW** - Simple wrapper

**Test Cases:**
```typescript
// Test file: hooks/useNotifications.test.ts

describe('useNotifications', () => {
  ✅ Returns success() function
  ✅ Returns error() function
  ✅ Returns info() function
  ✅ Returns warning() function
  ✅ Calls toast library with correct params
  ✅ Supports custom duration
  ✅ Supports persistent notifications
});
```

---

### 5.4 `useDataTable.ts` (Data Table Hook)

**Priority: HIGH** - Complex state management

See [Section 4.1](#41-data-table-component-componentsdata-table) for test cases.

---

## 6. Critical User Flows for E2E Tests (Playwright)

### 6.1 Authentication Flow

**Priority: HIGHEST**

**Test Scenarios:**
```typescript
// Test file: e2e/auth.spec.ts

test.describe('Authentication', () => {
  test('User can login with valid credentials', async ({ page }) => {
    // 1. Navigate to login page
    // 2. Enter valid email and password
    // 3. Click login button
    // 4. Verify redirected to dashboard
    // 5. Verify user menu shows name
    // 6. Verify access token stored
  });

  test('User cannot login with invalid credentials', async ({ page }) => {
    // 1. Navigate to login page
    // 2. Enter invalid credentials
    // 3. Click login button
    // 4. Verify error message shown
    // 5. Verify stays on login page
  });

  test('User can logout', async ({ page }) => {
    // 1. Login as user
    // 2. Click user menu
    // 3. Click logout
    // 4. Verify redirected to login page
    // 5. Verify cannot access protected routes
  });

  test('Session persists on page refresh', async ({ page }) => {
    // 1. Login as user
    // 2. Reload page
    // 3. Verify still logged in
    // 4. Verify can access protected routes
  });

  test('Forgot password flow', async ({ page }) => {
    // 1. Click "Forgot password"
    // 2. Enter email
    // 3. Verify success message
    // 4. Check email for reset link (mock email service)
    // 5. Click reset link
    // 6. Enter new password
    // 7. Login with new password
  });

  test('2FA setup and login flow', async ({ page }) => {
    // 1. Login as user
    // 2. Navigate to security settings
    // 3. Enable 2FA
    // 4. Scan QR code (save secret)
    // 5. Enter TOTP code
    // 6. Verify 2FA enabled
    // 7. Logout and login again
    // 8. Enter TOTP code
    // 9. Verify successful login
  });
});
```

---

### 6.2 User Management Flow

**Priority: HIGH**

**Test Scenarios:**
```typescript
// Test file: e2e/users.spec.ts

test.describe('User Management', () => {
  test('Admin can create new user', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page
    // 3. Click "Add User"
    // 4. Fill form (email, name, role)
    // 5. Submit form
    // 6. Verify user appears in list
    // 7. Verify success toast shown
  });

  test('Admin can edit user', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page
    // 3. Click edit button for user
    // 4. Change name and role
    // 5. Save changes
    // 6. Verify changes reflected in list
  });

  test('Admin can delete user', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page
    // 3. Click delete button for user
    // 4. Confirm deletion
    // 5. Verify user removed from list
  });

  test('Admin can search and filter users', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page
    // 3. Enter search term
    // 4. Verify filtered results
    // 5. Apply status filter (Active/Inactive)
    // 6. Verify filtered results
  });

  test('User without permission cannot access users page', async ({ page }) => {
    // 1. Login as user without users:view permission
    // 2. Navigate to /users
    // 3. Verify 403 error or redirected
  });
});
```

---

### 6.3 Role & Permission Management Flow

**Priority: HIGH**

**Test Scenarios:**
```typescript
// Test file: e2e/roles.spec.ts

test.describe('Role Management', () => {
  test('Admin can create role with permissions', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Roles page
    // 3. Click "Add Role"
    // 4. Enter role name and description
    // 5. Select permissions (users:view, users:create)
    // 6. Save role
    // 7. Verify role appears in list
  });

  test('Admin can edit role permissions', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Roles page
    // 3. Click edit for role
    // 4. Add new permission (users:delete)
    // 5. Save changes
    // 6. Verify permission added
  });

  test('Permission changes reflect immediately', async ({ page, context }) => {
    // 1. Login as admin
    // 2. Create user with role (users:view only)
    // 3. Login as new user in new tab
    // 4. Verify can view users but not create
    // 5. As admin, add users:create permission
    // 6. As user, verify "Add User" button now visible
  });

  test('Cannot delete role with assigned users', async ({ page }) => {
    // 1. Login as admin
    // 2. Create role and assign to user
    // 3. Try to delete role
    // 4. Verify error message shown
  });
});
```

---

### 6.4 File Upload Flow

**Priority: HIGH** - Security-critical

**Test Scenarios:**
```typescript
// Test file: e2e/file-upload.spec.ts

test.describe('File Upload', () => {
  test('User can upload single file', async ({ page }) => {
    // 1. Login as user
    // 2. Navigate to file upload demo page
    // 3. Select file via file picker
    // 4. Verify preview shown
    // 5. Click upload
    // 6. Verify success message
    // 7. Verify file appears in files list
  });

  test('User can upload via drag & drop', async ({ page }) => {
    // 1. Login as user
    // 2. Navigate to file upload page
    // 3. Drag file to drop zone
    // 4. Drop file
    // 5. Verify preview shown
    // 6. Click upload
    // 7. Verify success message
  });

  test('User can upload multiple files', async ({ page }) => {
    // 1. Login as user
    // 2. Navigate to file upload page
    // 3. Select 3 files
    // 4. Verify all 3 previews shown
    // 5. Click upload
    // 6. Verify all 3 uploaded
  });

  test('Upload rejects oversized file', async ({ page }) => {
    // 1. Login as user
    // 2. Select file > 10MB
    // 3. Verify error message shown
    // 4. Verify upload button disabled
  });

  test('Upload rejects invalid file type', async ({ page }) => {
    // 1. Login as user
    // 2. Select .exe file
    // 3. Verify error message shown
    // 4. Verify upload button disabled
  });

  test('User can download uploaded file', async ({ page }) => {
    // 1. Login as user
    // 2. Navigate to files list
    // 3. Click download button
    // 4. Verify file downloads
    // 5. Verify file content matches
  });

  test('User can delete uploaded file', async ({ page }) => {
    // 1. Login as user
    // 2. Navigate to files list
    // 3. Click delete button
    // 4. Confirm deletion
    // 5. Verify file removed from list
  });
});
```

---

### 6.5 Data Export Flow

**Priority: MEDIUM**

**Test Scenarios:**
```typescript
// Test file: e2e/export.spec.ts

test.describe('Data Export', () => {
  test('User can export users as CSV', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page
    // 3. Click "Export" button
    // 4. Select CSV format
    // 5. Click export
    // 6. Verify file downloads
    // 7. Parse CSV and verify data accuracy
  });

  test('User can export with filters applied', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page
    // 3. Apply filter (active users only)
    // 4. Click export
    // 5. Verify only active users in export
  });

  test('User can customize export columns', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page
    // 3. Click export
    // 4. Deselect some columns
    // 5. Export
    // 6. Verify only selected columns in file
  });

  test('Export works for all formats (CSV, Excel, PDF)', async ({ page }) => {
    // 1. Login as admin
    // 2. Export as CSV → Verify
    // 3. Export as Excel → Verify
    // 4. Export as PDF → Verify
  });
});
```

---

### 6.6 Data Table Interactions

**Priority: MEDIUM**

**Test Scenarios:**
```typescript
// Test file: e2e/data-table.spec.ts

test.describe('Data Table', () => {
  test('Pagination works correctly', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page (with >20 users)
    // 3. Verify first page shows 1-20
    // 4. Click next page
    // 5. Verify page 2 shows 21-40
    // 6. Change page size to 50
    // 7. Verify shows 1-50
  });

  test('Sorting works correctly', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page
    // 3. Click "Email" column header
    // 4. Verify sorted ascending
    // 5. Click again
    // 6. Verify sorted descending
  });

  test('Search filters results', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page
    // 3. Enter search term in search box
    // 4. Verify only matching users shown
    // 5. Clear search
    // 6. Verify all users shown
  });

  test('Column filters work', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page
    // 3. Open status filter
    // 4. Select "Active" only
    // 5. Verify only active users shown
    // 6. Apply role filter
    // 7. Verify filters stack (AND logic)
  });

  test('Bulk actions work', async ({ page }) => {
    // 1. Login as admin
    // 2. Navigate to Users page
    // 3. Select 3 users via checkbox
    // 4. Click "Deactivate" bulk action
    // 5. Confirm action
    // 6. Verify all 3 users deactivated
  });
});
```

---

## 7. Service Layer Unit Tests

### 7.1 `auth.service.ts`

**Priority: HIGH** - Complex business logic

**Test Cases:**
```typescript
// Test file: modules/auth/auth.service.test.ts

describe('AuthService', () => {
  // login()
  ✅ Hashes password correctly
  ✅ Compares password with bcrypt
  ✅ Returns user and tokens on success
  ✅ Throws InvalidCredentialsError on wrong password
  ✅ Throws InvalidCredentialsError on non-existent email
  ✅ Throws error if user inactive
  ✅ Increments failed login attempts
  ✅ Locks account after 5 failed attempts
  ✅ Creates session record in DB
  ✅ Logs audit event

  // refreshTokens()
  ✅ Validates refresh token signature
  ✅ Returns new access and refresh tokens
  ✅ Rotates refresh token (invalidates old one)
  ✅ Throws InvalidTokenError if token revoked
  ✅ Throws InvalidTokenError if token expired
  ✅ Updates session lastActivity timestamp

  // logout()
  ✅ Revokes refresh token
  ✅ Deletes session from DB
  ✅ Logs audit event

  // forgotPassword()
  ✅ Creates password reset token
  ✅ Sets expiration (1 hour)
  ✅ Saves token to DB
  ✅ Returns success even for non-existent email (security)

  // resetPassword()
  ✅ Validates reset token
  ✅ Hashes new password
  ✅ Updates password in DB
  ✅ Invalidates reset token
  ✅ Throws InvalidTokenError if expired

  // changePassword()
  ✅ Verifies current password
  ✅ Throws error if current password wrong
  ✅ Hashes and saves new password
  ✅ Logs audit event

  // setup2FA()
  ✅ Generates TOTP secret
  ✅ Returns QR code URL
  ✅ Does not enable 2FA yet

  // verify2FA()
  ✅ Validates TOTP code
  ✅ Enables 2FA in DB
  ✅ Generates recovery codes
  ✅ Throws error if code invalid

  // disable2FA()
  ✅ Verifies password
  ✅ Disables 2FA in DB
  ✅ Removes TOTP secret
});
```

**Mocking Strategy:**
- Mock `prisma` client
- Mock `bcrypt` for password hashing
- Mock `@fastify/jwt` for token generation
- Mock `otplib` for TOTP

---

### 7.2 `users.service.ts`

**Priority: HIGH**

**Test Cases:**
```typescript
// Test file: modules/users/users.service.test.ts

describe('UsersService', () => {
  // create()
  ✅ Hashes password before saving
  ✅ Creates user in DB
  ✅ Throws ConflictError if email exists
  ✅ Throws NotFoundError if role invalid
  ✅ Logs audit event

  // update()
  ✅ Updates user fields
  ✅ Throws ConflictError if email taken
  ✅ Throws NotFoundError if user not found
  ✅ Does not update password (separate method)
  ✅ Logs audit event

  // delete()
  ✅ Soft deletes user (marks inactive)
  ✅ Or hard deletes (based on config)
  ✅ Throws error if deleting self
  ✅ Throws NotFoundError if user not found
  ✅ Logs audit event

  // findAll()
  ✅ Returns paginated users
  ✅ Filters by search term
  ✅ Filters by isActive
  ✅ Sorts by specified field
  ✅ Includes role relation

  // findById()
  ✅ Returns user with relations
  ✅ Throws NotFoundError if not found
});
```

---

### 7.3 `files.service.ts`

**Priority: HIGH** - External service interaction

**Test Cases:**
```typescript
// Test file: modules/files/files.service.test.ts

describe('FilesService', () => {
  // upload()
  ✅ Uploads file to S3
  ✅ Creates DB record
  ✅ Generates unique key (nanoid + original name)
  ✅ Validates file type
  ✅ Throws error if S3 upload fails

  // getPresignedUploadUrl()
  ✅ Returns presigned POST URL
  ✅ Sets max file size policy
  ✅ Sets expiration (15 minutes)

  // confirmUpload()
  ✅ Verifies file exists in S3 (headObject)
  ✅ Creates DB record
  ✅ Throws error if file not found in S3

  // getDownloadUrl()
  ✅ Returns presigned GET URL
  ✅ URL expires after 1 hour
  ✅ Throws NotFoundError if file not in DB

  // delete()
  ✅ Deletes from S3
  ✅ Deletes from DB
  ✅ Throws NotFoundError if not found
  ✅ Handles S3 errors gracefully
});
```

**Mocking Strategy:**
- Mock `@aws-sdk/client-s3` (S3Client, PutObjectCommand, etc.)
- Mock `prisma` client
- Use `aws-sdk-client-mock` for easier S3 mocking

---

### 7.4 `export.service.ts`

**Priority: MEDIUM**

**Test Cases:**
```typescript
// Test file: modules/exports/export.service.test.ts

describe('ExportService', () => {
  // export() - CSV
  ✅ Generates CSV with correct headers
  ✅ Formats data rows correctly
  ✅ Handles empty data
  ✅ Escapes special characters (commas, quotes)

  // export() - Excel
  ✅ Generates XLSX file
  ✅ Sets column widths
  ✅ Formats headers (bold)
  ✅ Handles large datasets (>10k rows)

  // export() - PDF
  ✅ Generates PDF with title and subtitle
  ✅ Renders table with columns
  ✅ Supports landscape/portrait
  ✅ Handles multi-page content
  ✅ Formats dates correctly

  // Performance
  ✅ Exports 10,000 rows in <5 seconds
  ✅ Memory usage stays reasonable
});
```

**Mocking Strategy:**
- Mock `papaparse` for CSV
- Mock `xlsx` library
- Mock `pdfkit` for PDF generation

---

## 8. Test File Organization Structure

### 8.1 Backend Test Structure

```
apps/api/
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.service.test.ts          # Unit tests
│   │   │   ├── auth.routes.ts
│   │   │   └── auth.routes.test.ts           # Integration tests
│   │   ├── users/
│   │   │   ├── users.service.ts
│   │   │   ├── users.service.test.ts
│   │   │   ├── users.routes.ts
│   │   │   └── users.routes.test.ts
│   │   └── ... (same pattern for other modules)
│   ├── lib/
│   │   ├── errors.ts
│   │   ├── errors.test.ts
│   │   ├── prisma.ts
│   │   └── prisma.test.ts
│   └── plugins/
│       ├── auth.ts
│       └── auth.test.ts
├── tests/
│   ├── setup.ts                              # Global test setup
│   ├── helpers/
│   │   ├── db.ts                             # Test DB utilities
│   │   ├── fixtures.ts                       # Test data factories
│   │   └── factories.ts                      # Factory functions
│   └── integration/
│       ├── auth-flow.test.ts                 # Multi-endpoint flows
│       └── permissions.test.ts               # RBAC scenarios
├── vitest.config.ts
└── package.json
```

### 8.2 Frontend Test Structure

```
apps/web/
├── src/
│   ├── components/
│   │   ├── data-table/
│   │   │   ├── DataTable.tsx
│   │   │   ├── DataTable.test.tsx
│   │   │   ├── useDataTable.ts
│   │   │   └── useDataTable.test.ts
│   │   ├── file-upload/
│   │   │   ├── FileUpload.tsx
│   │   │   └── FileUpload.test.tsx
│   │   └── forms/
│   │       ├── TextField.tsx
│   │       ├── TextField.test.tsx
│   │       └── ... (other form fields)
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useAuth.test.ts
│   │   └── ... (other hooks)
│   ├── pages/
│   │   ├── users/
│   │   │   ├── UsersPage.tsx
│   │   │   └── UsersPage.test.tsx
│   │   └── ... (other pages)
│   └── stores/
│       ├── authStore.ts
│       └── authStore.test.ts
├── tests/
│   ├── setup.ts                              # Global test setup
│   ├── mocks/
│   │   ├── handlers.ts                       # MSW handlers
│   │   └── server.ts                         # MSW server setup
│   └── utils/
│       ├── render.tsx                        # Custom render with providers
│       └── factories.ts                      # Test data factories
├── e2e/
│   ├── auth.spec.ts
│   ├── users.spec.ts
│   ├── roles.spec.ts
│   ├── file-upload.spec.ts
│   ├── export.spec.ts
│   └── data-table.spec.ts
├── vitest.config.ts
├── playwright.config.ts
└── package.json
```

### 8.3 Shared Package Test Structure

```
packages/shared/
├── src/
│   ├── schemas/
│   │   ├── index.ts
│   │   └── index.test.ts                     # Schema validation tests
│   ├── types/
│   │   └── index.ts
│   └── utils/
│       ├── index.ts
│       └── index.test.ts
├── vitest.config.ts
└── package.json
```

---

## 9. Configuration Files to Create

### 9.1 Backend Vitest Config

**File:** `apps/api/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'c8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts',
        '**/*.spec.ts',
        'prisma/seeds/**',
      ],
      all: true,
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### 9.2 Frontend Vitest Config

**File:** `apps/web/vitest.config.ts`

```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'c8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        'e2e/',
        '**/*.test.tsx',
        '**/*.test.ts',
        '**/*.spec.tsx',
        '**/*.spec.ts',
        'src/components/ui/**', // Shadcn components
      ],
      all: true,
      lines: 70,
      functions: 70,
      branches: 65,
      statements: 70,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### 9.3 Playwright Config

**File:** `apps/web/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### 9.4 Backend Test Setup

**File:** `apps/api/tests/setup.ts`

```typescript
import { beforeAll, afterAll, afterEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';

// Clean up database before all tests
beforeAll(async () => {
  // Reset test database
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS test CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA test');

  // Run migrations
  // execSync('pnpm prisma migrate deploy', { env: { ...process.env, DATABASE_URL: TEST_DB_URL } });
});

// Clean up after each test
afterEach(async () => {
  // Clear all tables
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='test'
  `;

  for (const { tablename } of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE`);
  }

  // Clear Redis
  await redis.flushdb();
});

// Clean up after all tests
afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});
```

### 9.5 Frontend Test Setup

**File:** `apps/web/tests/setup.ts`

```typescript
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { server } from './mocks/server';

// Start MSW server
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// Clean up after each test
afterEach(() => {
  cleanup();
  server.resetHandlers();
});

// Stop MSW server
afterAll(() => server.close());

// Mock window.matchMedia (for Radix UI components)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver (for virtualized lists)
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;
```

### 9.6 MSW Handlers

**File:** `apps/web/tests/mocks/handlers.ts`

```typescript
import { http, HttpResponse } from 'msw';

const API_URL = 'http://localhost:4000/api';

export const handlers = [
  // Auth endpoints
  http.post(`${API_URL}/auth/login`, async ({ request }) => {
    const body = await request.json();

    if (body.email === 'admin@example.com' && body.password === 'Admin@123') {
      return HttpResponse.json({
        data: {
          user: { id: '1', email: 'admin@example.com', firstName: 'Admin', lastName: 'User' },
          accessToken: 'mock-access-token',
        },
      });
    }

    return HttpResponse.json(
      { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
      { status: 401 }
    );
  }),

  http.get(`${API_URL}/auth/me`, () => {
    return HttpResponse.json({
      data: {
        id: '1',
        email: 'admin@example.com',
        firstName: 'Admin',
        lastName: 'User',
        role: { name: 'Administrator', permissions: [] },
      },
    });
  }),

  // Add more handlers as needed
];
```

### 9.7 Update Package.json Scripts

**Backend (`apps/api/package.json`):**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Frontend (`apps/web/package.json`):**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed"
  }
}
```

---

## 10. Test Execution Strategy

### 10.1 Test Pyramid Distribution

```
        /\
       /  \        E2E Tests (Playwright)
      /    \       ~20 tests (~10% of total)
     /------\      Critical user flows
    /        \
   /          \    Integration Tests
  /            \   ~60 tests (~30% of total)
 /--------------\  API endpoints, DB interactions
/                \
|   Unit Tests   | ~120 tests (~60% of total)
|________________| Components, hooks, services, utilities
```

### 10.2 Test Execution Environments

**Local Development:**
- Run unit tests in watch mode during development: `pnpm test:watch`
- Run integration tests before committing: `pnpm test`
- Run E2E tests manually before PR: `pnpm test:e2e`

**CI/CD Pipeline (GitHub Actions example):**

```yaml
# .github/workflows/test.yml
name: Test

on:
  pull_request:
  push:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test --filter=@admin/api
      - run: pnpm test --filter=@admin/web
      - run: pnpm test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
      redis:
        image: redis:7
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:push
      - run: pnpm test --filter=@admin/api -- tests/integration

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps
      - run: pnpm test:e2e --filter=@admin/web
      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: playwright-report
          path: apps/web/playwright-report/
```

### 10.3 Test Data Strategy

**Approach:**
1. **Factories:** Use `@faker-js/faker` to generate realistic test data
2. **Fixtures:** Store reusable test data in JSON files for complex scenarios
3. **Seeders:** Use Prisma seeders to populate test DB with baseline data
4. **Isolation:** Each test should create and clean up its own data

**Example Factory:**

```typescript
// apps/api/tests/helpers/factories.ts
import { faker } from '@faker-js/faker';
import { prisma } from '../../src/lib/prisma';
import bcrypt from 'bcrypt';

export const userFactory = {
  async create(overrides = {}) {
    return prisma.user.create({
      data: {
        email: faker.internet.email(),
        password: await bcrypt.hash('Test@123', 10),
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        isActive: true,
        roleId: (await roleFactory.create()).id,
        ...overrides,
      },
    });
  },
};

export const roleFactory = {
  async create(overrides = {}) {
    return prisma.role.create({
      data: {
        name: faker.company.buzzNoun(),
        description: faker.lorem.sentence(),
        ...overrides,
      },
    });
  },
};
```

---

## 11. Priority Test Cases Summary

### 11.1 Critical (Must Implement First)

**Backend:**
1. Auth service: login, logout, refresh tokens (15 tests)
2. Auth routes: all endpoints (25 tests)
3. Users CRUD: create, read, update, delete (15 tests)
4. Roles & permissions: CRUD + assignment (20 tests)
5. File upload: server-side + presigned (20 tests)

**Frontend:**
1. useAuth hook: login, logout, token refresh (10 tests)
2. DataTable component: rendering, pagination, sorting (20 tests)
3. FileUpload component: validation, upload, preview (15 tests)
4. Form components: TextField, SelectField (10 tests)

**E2E:**
1. Authentication flow: login, logout, 2FA (6 tests)
2. User management: CRUD operations (5 tests)
3. File upload flow: upload, download, delete (7 tests)

**Total Critical Tests:** ~168 tests

### 11.2 High Priority (Implement Second)

**Backend:**
1. Menu service & routes (15 tests)
2. Export service: CSV, Excel, PDF (20 tests)
3. Auth middleware: permission checks (10 tests)

**Frontend:**
1. ExportDialog component (10 tests)
2. useExport hook (8 tests)
3. DataTable filters & search (15 tests)

**E2E:**
1. Role management flow (4 tests)
2. Data export flow (4 tests)
3. Data table interactions (5 tests)

**Total High Priority Tests:** ~91 tests

### 11.3 Medium Priority (Implement Third)

**Backend:**
1. Error handlers (8 tests)
2. Audit logging (10 tests)
3. Session management (12 tests)

**Frontend:**
1. Layout components (8 tests)
2. useNotifications hook (7 tests)
3. Store tests (10 tests)

**Total Medium Priority Tests:** ~55 tests

### 11.4 Low Priority (Nice to Have)

**Frontend:**
1. UI primitive components (if custom logic added)
2. Page components (mostly integration covered by E2E)

**Total Low Priority Tests:** ~20 tests

---

## 12. Coverage Goals

### 12.1 Coverage Targets

| Layer | Lines | Functions | Branches | Statements |
|-------|-------|-----------|----------|------------|
| Backend | 80% | 80% | 75% | 80% |
| Frontend | 70% | 70% | 65% | 70% |
| E2E | N/A (flow coverage) | N/A | N/A | N/A |

**Why lower coverage for frontend?**
- UI components have more edge cases (browser quirks, accessibility)
- Shadcn components are pre-tested
- E2E tests provide additional coverage for critical paths

### 12.2 Coverage Exclusions

**Backend:**
- `prisma/seeds/**` - Seed data, not production code
- `dist/**` - Compiled output
- `*.test.ts` - Test files themselves
- Type definitions (`.d.ts`)

**Frontend:**
- `src/components/ui/**` - Shadcn primitives (tested upstream)
- `e2e/**` - E2E tests
- `*.test.tsx` - Test files
- `vite.config.ts`, `tailwind.config.ts` - Config files

---

## 13. Estimated Implementation Timeline

Assuming 1 developer working ~6-8 hours/day:

| Phase | Tasks | Time Estimate |
|-------|-------|---------------|
| **Phase 1: Setup** | Install dependencies, configure Vitest/Playwright, setup test infrastructure | 2 days |
| **Phase 2: Critical Backend** | Auth service + routes, Users CRUD, Roles CRUD, Files module | 5 days |
| **Phase 3: Critical Frontend** | useAuth, DataTable, FileUpload, Form components | 4 days |
| **Phase 4: Critical E2E** | Auth flow, User management, File upload | 3 days |
| **Phase 5: High Priority** | Menu, Exports, Auth middleware, Export components | 4 days |
| **Phase 6: Medium Priority** | Error handlers, Session mgmt, Layout components, Stores | 3 days |
| **Phase 7: Low Priority** | UI primitives, Page components | 2 days |
| **Phase 8: CI/CD & Polish** | GitHub Actions, coverage reports, documentation | 2 days |

**Total Estimated Time:** ~25 days (5 weeks)

**Note:** This is for a comprehensive test suite. You can start with Phase 1-4 (Critical tests) for ~14 days to get 80% of the value.

---

## 14. Testing Best Practices

### 14.1 General Principles

1. **Arrange-Act-Assert (AAA)** pattern for all tests
2. **Test behavior, not implementation** - Focus on what the code does, not how
3. **Isolation** - Each test should be independent and idempotent
4. **Descriptive names** - Test names should clearly describe what's being tested
5. **Single responsibility** - One test should verify one behavior
6. **Fast feedback** - Unit tests should run in <5s, integration <30s

### 14.2 Backend-Specific

1. **Use transactions** - Wrap tests in DB transactions and rollback after each
2. **Mock external services** - S3, email, SMS, payment gateways
3. **Test error paths** - Don't just test happy paths
4. **Validate DB state** - Verify records created/updated/deleted
5. **Test permissions** - Verify authorization logic works correctly

### 14.3 Frontend-Specific

1. **User-centric tests** - Test from user's perspective (click, type, see)
2. **Avoid implementation details** - Don't test state directly, test UI changes
3. **Mock API calls** - Use MSW for consistent, reliable API mocking
4. **Accessibility** - Use accessible queries (getByRole, getByLabelText)
5. **Wait for async** - Use waitFor, findBy queries for async operations

### 14.4 E2E-Specific

1. **Test critical paths only** - E2E tests are slow, focus on high-value flows
2. **Use test IDs sparingly** - Prefer user-visible selectors (text, labels)
3. **Isolate test data** - Create fresh data for each test, clean up after
4. **Handle flakiness** - Use auto-wait, avoid fixed timeouts
5. **Take screenshots on failure** - Helps debugging CI failures

---

## 15. Tools and Libraries Reference

### 15.1 Backend Testing Stack

| Tool | Purpose | Installation |
|------|---------|--------------|
| **Vitest** | Test runner | `pnpm add -D vitest` |
| **Supertest** | HTTP assertions | `pnpm add -D supertest @types/supertest` |
| **@faker-js/faker** | Test data generation | `pnpm add -D @faker-js/faker` |
| **c8** | Coverage reporting | Built into Vitest |
| **@testcontainers/postgresql** | Isolated test DB | `pnpm add -D @testcontainers/postgresql` |
| **ioredis-mock** | Mock Redis | `pnpm add -D ioredis-mock` |
| **aws-sdk-client-mock** | Mock AWS SDK | `pnpm add -D aws-sdk-client-mock` |

### 15.2 Frontend Testing Stack

| Tool | Purpose | Installation |
|------|---------|--------------|
| **Vitest** | Test runner | `pnpm add -D vitest` |
| **@testing-library/react** | Component testing | `pnpm add -D @testing-library/react` |
| **@testing-library/user-event** | User interactions | `pnpm add -D @testing-library/user-event` |
| **@testing-library/jest-dom** | DOM matchers | `pnpm add -D @testing-library/jest-dom` |
| **jsdom** | DOM environment | `pnpm add -D jsdom` |
| **MSW** | API mocking | `pnpm add -D msw` |
| **@vitest/ui** | Test UI | `pnpm add -D @vitest/ui` |
| **Playwright** | E2E testing | `pnpm add -D @playwright/test` |

### 15.3 Shared Testing Utilities

| Tool | Purpose | Both Frontend & Backend |
|------|---------|------------------------|
| **@faker-js/faker** | Test data | Yes |
| **Vitest** | Test runner | Yes |

---

## 16. Next Steps

### 16.1 Immediate Actions (This Week)

1. **Install test dependencies** in both `apps/api` and `apps/web`
2. **Create configuration files** (vitest.config.ts, playwright.config.ts)
3. **Set up test infrastructure** (setup files, MSW handlers, test DB)
4. **Write first test** - Start with a simple auth.service.test.ts to validate setup

### 16.2 Sprint 1 (Week 1-2): Critical Backend Tests

1. Auth service + routes (25 tests)
2. Users CRUD (15 tests)
3. Roles CRUD (15 tests)
4. Files module (15 tests)

**Deliverable:** Backend API has 70+ tests, 70%+ coverage

### 16.3 Sprint 2 (Week 3): Critical Frontend Tests

1. useAuth hook (10 tests)
2. DataTable component (20 tests)
3. FileUpload component (15 tests)
4. Form components (10 tests)

**Deliverable:** Frontend has 55+ tests, 60%+ coverage

### 16.4 Sprint 3 (Week 4): E2E Tests

1. Authentication flow (6 tests)
2. User management (5 tests)
3. File upload flow (7 tests)
4. Role management (4 tests)

**Deliverable:** E2E test suite covers critical user journeys

### 16.5 Sprint 4 (Week 5): CI/CD & Polish

1. Set up GitHub Actions workflow
2. Add coverage reporting (Codecov)
3. Write testing documentation
4. Address any flaky tests
5. Optimize test performance

**Deliverable:** Fully automated test suite in CI/CD pipeline

---

## 17. Success Metrics

### 17.1 Quantitative Metrics

- **Test Count:** 250+ total tests (200 unit/integration + 50 E2E)
- **Coverage:** 75%+ backend, 65%+ frontend
- **Test Speed:** Unit tests <10s, integration <60s, E2E <5min
- **CI/CD Time:** Total pipeline <15 minutes
- **Flakiness:** <5% test failure rate in CI

### 17.2 Qualitative Metrics

- **Confidence:** Developers feel confident refactoring with test coverage
- **Bug Prevention:** Tests catch regressions before production
- **Documentation:** Tests serve as living documentation of system behavior
- **Maintainability:** Tests are easy to read and update

---

## 18. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Tests are slow** | Developers skip running tests locally | - Use Vitest (faster than Jest)<br>- Optimize DB cleanup<br>- Run unit tests in watch mode |
| **Flaky E2E tests** | CI/CD pipeline unreliable | - Use Playwright's auto-wait<br>- Avoid fixed timeouts<br>- Isolate test data<br>- Retry failed tests |
| **Low test coverage** | False sense of security | - Enforce minimum coverage thresholds<br>- Review coverage reports in PRs<br>- Focus on critical paths first |
| **Tests become outdated** | Tests don't match actual behavior | - Treat tests as first-class code<br>- Update tests alongside features<br>- Delete obsolete tests |
| **Testing takes too long** | Project timeline at risk | - Start with critical tests only<br>- Parallelize test execution<br>- Use test pyramid approach |

---

## 19. Resources and References

### 19.1 Documentation

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [Playwright Documentation](https://playwright.dev/)
- [MSW Documentation](https://mswjs.io/)
- [Testing Best Practices](https://testingjavascript.com/)

### 19.2 Example Projects

- [Vitest Examples](https://github.com/vitest-dev/vitest/tree/main/examples)
- [Playwright Examples](https://github.com/microsoft/playwright/tree/main/examples)
- [Kent C. Dodds' Testing Workshops](https://github.com/kentcdodds/testing-react-apps)

### 19.3 Articles

- [Write Tests. Not Too Many. Mostly Integration.](https://kentcdodds.com/blog/write-tests)
- [The Testing Trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)
- [Common Testing Mistakes](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

---

## 20. Conclusion

This comprehensive testing strategy provides a roadmap for implementing a robust test suite for the js-admin-panel project. By following this plan, you'll achieve:

✅ **80%+ backend code coverage** with unit and integration tests
✅ **70%+ frontend code coverage** with component and hook tests
✅ **End-to-end coverage** of critical user journeys
✅ **CI/CD automation** with fast feedback loops
✅ **Confidence to refactor** with test safety net

**Remember:** Start small (critical tests first), iterate quickly, and prioritize tests that provide the most value. Testing is an investment that pays dividends in reduced bugs, faster development, and happier users.

---

**Document Status:** Ready for Review
**Next Action:** Present to team, get approval, begin Phase 1 implementation
**Contact:** Create GitHub issues for each test suite and track progress in project board
