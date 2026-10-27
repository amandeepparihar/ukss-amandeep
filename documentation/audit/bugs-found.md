# Bugs Found During Feature Audit

## Critical Bugs

### BUG-001: File List API Error
- **Severity**: High
- **Feature**: F046 - List User Files
- **Endpoint**: GET /api/files
- **Error Message**:
```
Invalid `prisma.file.count()` invocation in files.service.ts:168
Invalid value for argument `not`. Expected FileStatus.
```
- **Root Cause**: The `FileStatus` enum value "DELETED" is being used but may not exist in the Prisma schema, or the query syntax is incorrect.
- **File**: `apps/api/src/modules/files/files.service.ts` line 168
- **Impact**: Users cannot view their uploaded files

## Medium Bugs

### BUG-002: Security Pages Not Routed
- **Severity**: Medium
- **Features**: F018, F019, F020, F021
- **Issue**: TrustedDevicesPage.tsx and LoginHistoryPage.tsx exist in `/pages/security/` but are NOT registered in App.tsx routes
- **Impact**: Users cannot access trusted devices or login history pages via UI
- **Files**:
  - `apps/web/src/pages/security/TrustedDevicesPage.tsx` - exists but not routed
  - `apps/web/src/pages/security/LoginHistoryPage.tsx` - exists but not routed
  - `apps/web/src/App.tsx` - missing route registrations

### BUG-003: Login History Returns Empty
- **Severity**: Medium
- **Feature**: F021 - Login History
- **Endpoint**: GET /api/auth/login-history
- **Issue**: Returns `{"data":{"data":[],"total":0,"limit":50,"offset":0}}` even after multiple logins
- **Possible Cause**: Login notification tracking may not be enabled or configured
- **Impact**: Login history feature doesn't show any data

## Low Bugs

### BUG-004: Menu Tree Empty Response
- **Severity**: Low
- **Feature**: F035 - Get Menu Tree
- **Endpoint**: GET /api/menu
- **Issue**: Returns empty response (no menu items)
- **Possible Cause**: Menu items may not be seeded in database
- **Impact**: Dynamic menu based on permissions may not work

### BUG-005: Active Announcements Empty
- **Severity**: Low
- **Feature**: F057 - Get Active Announcements
- **Endpoint**: GET /api/announcements/active
- **Issue**: Returns empty even though there is 1 announcement in the system
- **Possible Cause**: Role-based filtering or active date range filtering
- **Impact**: Users may not see announcements meant for them

## UI Pages Not Tested (Require Manual Testing)

The following features require manual UI testing as they involve user interactions that cannot be tested via API alone:

1. **Authentication Flow** (TC002-TC015)
   - Login page form submission
   - Remember me functionality
   - 2FA UI flow
   - Password reset email flow

2. **Data Tables** (TC033-TC037, TC073-TC076)
   - Search functionality
   - Filter dropdowns
   - Column sorting
   - Row selection
   - Pagination controls

3. **Forms** (TC039-TC044, TC068-TC070)
   - User create/edit dialogs
   - Role create/edit dialogs
   - Announcement forms
   - Settings forms

4. **Notifications** (TC087-TC088)
   - Toast notifications
   - Persistent notifications panel

5. **File Upload** (TC053-TC054, TC091-TC092)
   - Drag and drop
   - File size validation
   - Progress tracking

6. **Layout** (TC094-TC096)
   - Sidebar collapse
   - Mobile responsiveness
   - Breadcrumbs

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 0 |
| Medium | 2 |
| Low | 2 |
| **Total** | **5** |

## Test Execution Summary

| Status | Count |
|--------|-------|
| Pass | 32 |
| Fail | 1 |
| Not Tested | 77 |
| **Total** | **110** |

Note: Many "Not Tested" items require manual UI testing or would modify production data (delete users, change passwords, etc.)
