# Authentication Module

## Overview

The Authentication module provides a complete, production-ready authentication system including:
- JWT-based authentication with refresh tokens
- Two-Factor Authentication (2FA) with TOTP
- Session management with device tracking
- Password reset flow
- Account lockout protection
- Trusted device management

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Login Request                                                   │
│       │                                                         │
│       ▼                                                         │
│  [Verify Credentials] ──► Invalid ──► Return Error              │
│       │                                                         │
│       ▼ Valid                                                   │
│  [Check 2FA Enabled?] ──► Yes ──► Return 2FA Required           │
│       │                           User verifies TOTP            │
│       ▼ No                              │                       │
│  [Create Session]  <────────────────────┘                       │
│       │                                                         │
│       ▼                                                         │
│  [Return Tokens]                                                │
│   - Access Token (15min, in memory)                             │
│   - Refresh Token (7d, HTTP-only cookie)                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Database Models

```prisma
model User {
  id                   String    @id @default(cuid())
  email                String    @unique
  password             String
  firstName            String
  lastName             String
  avatar               String?
  isActive             Boolean   @default(true)
  emailVerified        Boolean   @default(false)

  // 2FA
  twoFactorEnabled     Boolean   @default(false)
  twoFactorSecret      String?
  twoFactorBackupCodes String[]  // Hashed backup codes

  // Security
  failedLoginAttempts  Int       @default(0)
  lockedUntil          DateTime?

  // Relations
  roleId               String
  role                 Role      @relation(...)
  sessions             Session[]
  loginHistory         LoginHistory[]

  // Timestamps
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  deletedAt            DateTime? // Soft delete
}

model Session {
  id            String   @id @default(cuid())
  userId        String
  refreshToken  String   @unique
  userAgent     String?
  ipAddress     String?
  deviceInfo    Json?    // Browser, OS, device type
  expiresAt     DateTime
  createdAt     DateTime @default(now())
  lastActiveAt  DateTime @default(now())
  user          User     @relation(...)
}

model TrustedDevice {
  id          String   @id @default(cuid())
  userId      String
  fingerprint String   @unique
  name        String?
  browser     String?
  os          String?
  deviceType  String?
  createdAt   DateTime @default(now())
  lastUsedAt  DateTime @default(now())
  user        User     @relation(...)
}
```

## API Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/login` | Login with email/password | No |
| POST | `/api/auth/2fa/login` | Verify 2FA during login | No |
| POST | `/api/auth/logout` | Logout (revoke session) | Yes |
| POST | `/api/auth/refresh` | Refresh access token | Cookie |
| POST | `/api/auth/forgot-password` | Request password reset | No |
| POST | `/api/auth/reset-password` | Reset password with token | No |
| GET | `/api/auth/me` | Get current user | Yes |
| PUT | `/api/auth/me` | Update profile | Yes |
| PUT | `/api/auth/me/password` | Change password | Yes |
| GET | `/api/auth/sessions` | List active sessions | Yes |
| DELETE | `/api/auth/sessions/:id` | Revoke session | Yes |
| POST | `/api/auth/2fa/setup` | Setup 2FA | Yes |
| POST | `/api/auth/2fa/verify` | Verify 2FA setup | Yes |
| DELETE | `/api/auth/2fa/disable` | Disable 2FA | Yes |

---

## Frontend Usage

### useAuth Hook

The main hook for authentication operations:

```tsx
import { useAuth } from '@/hooks/useAuth';

function MyComponent() {
  const {
    // State
    user,           // Current user object
    isAuthenticated,
    isLoading,
    isLoggingIn,

    // Actions
    login,          // Login with credentials
    logout,         // Logout
    verify2FA,      // Verify 2FA code

    // 2FA
    setup2FA,       // Initialize 2FA setup
    enable2FA,      // Enable 2FA with code
    disable2FA,     // Disable 2FA

    // Password
    changePassword,
    requestPasswordReset,
    resetPassword,
  } = useAuth();

  // Example: Login
  const handleLogin = async () => {
    try {
      await login({ email, password });
      // Redirects to dashboard on success
    } catch (error) {
      // Handle error (shown as toast automatically)
    }
  };
}
```

### useCurrentUser Hook

For accessing the current user:

```tsx
import { useCurrentUser } from '@/hooks/useAuth';

function Profile() {
  const { data: user, isLoading, refetch } = useCurrentUser();

  if (isLoading) return <Loading />;
  if (!user) return <NotLoggedIn />;

  return (
    <div>
      <h1>Welcome, {user.firstName}</h1>
      <p>Email: {user.email}</p>
      <p>Role: {user.role.name}</p>
    </div>
  );
}
```

### usePermission Hook

For checking permissions:

```tsx
import { usePermission } from '@/hooks/useAuth';

function Dashboard() {
  const canViewReports = usePermission('reports:view');
  const canManageUsers = usePermission('users:edit');

  return (
    <div>
      {canViewReports && <ReportsWidget />}
      {canManageUsers && <UserManagementLink />}
    </div>
  );
}
```

---

## Protecting Routes

### Backend Route Protection

```typescript
// apps/api/src/modules/reports/reports.routes.ts
export async function reportsRoutes(app: FastifyInstance) {
  // Public route (no auth)
  app.get('/public-stats', async () => {
    return { stats: await getPublicStats() };
  });

  // Protected route (requires login)
  app.get('/my-reports', {
    preHandler: [app.authenticate]
  }, async (request) => {
    const userId = request.user.id;
    return { reports: await getUserReports(userId) };
  });

  // Protected route with permission
  app.get('/all-reports', {
    preHandler: [app.authenticate, app.requirePermission('reports:view')]
  }, async () => {
    return { reports: await getAllReports() };
  });

  // Multiple permissions (AND)
  app.delete('/reports/:id', {
    preHandler: [
      app.authenticate,
      app.requirePermission('reports:view'),
      app.requirePermission('reports:delete')
    ]
  }, async (request) => {
    await deleteReport(request.params.id);
    return { success: true };
  });
}
```

### Frontend Route Protection

```tsx
// apps/web/src/routes/ProtectedRoute.tsx
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, usePermission } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  permission?: string;
  permissions?: string[];
  requireAll?: boolean; // For multiple permissions
}

export function ProtectedRoute({
  children,
  permission,
  permissions,
  requireAll = true,
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // Show loading while checking auth
  if (isLoading) {
    return <LoadingScreen />;
  }

  // Not logged in - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check single permission
  if (permission) {
    const hasPermission = usePermission(permission);
    if (!hasPermission) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  // Check multiple permissions
  if (permissions) {
    const hasPermissions = permissions.map(p => usePermission(p));
    const hasAccess = requireAll
      ? hasPermissions.every(Boolean)
      : hasPermissions.some(Boolean);

    if (!hasAccess) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return <>{children}</>;
}
```

### Using ProtectedRoute

```tsx
// apps/web/src/routes/index.tsx
const routes = [
  // Public routes
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },

  // Protected routes
  {
    path: '/',
    element: <ProtectedRoute><DashboardPage /></ProtectedRoute>,
  },
  {
    path: '/users',
    element: (
      <ProtectedRoute permission="users:view">
        <UsersPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/admin',
    element: (
      <ProtectedRoute permissions={['admin:view', 'settings:edit']} requireAll>
        <AdminPage />
      </ProtectedRoute>
    ),
  },
];
```

---

## Two-Factor Authentication (2FA)

### Setup Flow

```tsx
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';
import QRCode from 'qrcode.react';

function Setup2FA() {
  const { setup2FA, enable2FA } = useAuth();
  const [qrData, setQrData] = useState(null);
  const [code, setCode] = useState('');

  // Step 1: Initialize 2FA setup
  const handleSetup = async () => {
    const { secret, qrCode, backupCodes } = await setup2FA();
    setQrData({ secret, qrCode, backupCodes });
  };

  // Step 2: Verify code and enable
  const handleVerify = async () => {
    await enable2FA(code);
    // Show backup codes to user
    alert('2FA enabled! Save your backup codes.');
  };

  return (
    <div>
      {!qrData ? (
        <Button onClick={handleSetup}>Enable 2FA</Button>
      ) : (
        <div>
          <h3>Scan with Authenticator App</h3>
          <QRCode value={qrData.qrCode} />

          <p>Or enter manually: {qrData.secret}</p>

          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter 6-digit code"
          />

          <Button onClick={handleVerify}>Verify & Enable</Button>

          <div>
            <h4>Backup Codes (save these!)</h4>
            <ul>
              {qrData.backupCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Login with 2FA

```tsx
function LoginPage() {
  const { login, verify2FA, isLoggingIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show2FA, setShow2FA] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [tempToken, setTempToken] = useState('');

  const handleLogin = async () => {
    try {
      const result = await login({ email, password });

      if (result.requires2FA) {
        // User has 2FA enabled, show code input
        setTempToken(result.tempToken);
        setShow2FA(true);
      }
      // Success - hook handles redirect
    } catch (error) {
      // Error shown as toast
    }
  };

  const handleVerify2FA = async () => {
    try {
      await verify2FA({ code: totpCode, tempToken });
      // Success - hook handles redirect
    } catch (error) {
      // Error shown as toast
    }
  };

  if (show2FA) {
    return (
      <div>
        <h2>Two-Factor Authentication</h2>
        <p>Enter the code from your authenticator app</p>
        <Input
          value={totpCode}
          onChange={(e) => setTotpCode(e.target.value)}
          placeholder="000000"
          maxLength={6}
        />
        <Button onClick={handleVerify2FA} disabled={isLoggingIn}>
          Verify
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleLogin}>
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      <Button type="submit" disabled={isLoggingIn}>
        Sign In
      </Button>
    </form>
  );
}
```

---

## Session Management

### Viewing Active Sessions

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

function SessionsPage() {
  const queryClient = useQueryClient();

  // Fetch sessions
  const { data: sessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get('/auth/sessions').then(r => r.data),
  });

  // Revoke session mutation
  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => api.delete(`/auth/sessions/${sessionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries(['sessions']);
    },
  });

  return (
    <div>
      <h2>Active Sessions</h2>
      <ul>
        {sessions?.map((session) => (
          <li key={session.id}>
            <div>
              <strong>{session.deviceInfo?.browser}</strong> on {session.deviceInfo?.os}
              <br />
              <small>{session.ipAddress}</small>
              <br />
              <small>Last active: {formatDate(session.lastActiveAt)}</small>
            </div>
            {session.isCurrent ? (
              <Badge>Current</Badge>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => revokeMutation.mutate(session.id)}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Password Reset Flow

### Request Password Reset

```tsx
function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    await requestPasswordReset(email);
    setSent(true);
  };

  if (sent) {
    return (
      <div>
        <h2>Check Your Email</h2>
        <p>We sent a password reset link to {email}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Forgot Password</h2>
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter your email"
      />
      <Button type="submit">Send Reset Link</Button>
    </form>
  );
}
```

### Reset Password with Token

```tsx
function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const [token] = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSubmit = async () => {
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    await resetPassword({ token, password });
    // Redirects to login on success
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Reset Password</h2>
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="New password"
      />
      <Input
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="Confirm password"
      />
      <Button type="submit">Reset Password</Button>
    </form>
  );
}
```

---

## Real-World Example: Adding Social Login (OAuth)

### Step 1: Add OAuth Provider to Backend

```typescript
// apps/api/src/modules/auth/oauth.routes.ts
import { FastifyInstance } from 'fastify';
import { OAuth2Client } from 'google-auth-library';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export async function oauthRoutes(app: FastifyInstance) {
  // Initiate Google login
  app.get('/google', async (request, reply) => {
    const url = googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: ['email', 'profile'],
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    });
    return reply.redirect(url);
  });

  // Google callback
  app.get('/google/callback', async (request, reply) => {
    const { code } = request.query as { code: string };

    // Exchange code for tokens
    const { tokens } = await googleClient.getToken(code);
    googleClient.setCredentials(tokens);

    // Get user info
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload()!;

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: payload.email },
    });

    if (!user) {
      // Create new user from OAuth
      user = await prisma.user.create({
        data: {
          email: payload.email!,
          firstName: payload.given_name || '',
          lastName: payload.family_name || '',
          avatar: payload.picture,
          emailVerified: true,
          password: '', // No password for OAuth users
          roleId: defaultRoleId,
        },
      });
    }

    // Create session and return tokens
    const session = await authService.createSession(user);

    // Set refresh token cookie
    reply.setCookie('refreshToken', session.refreshToken, {
      httpOnly: true,
      secure: true,
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    // Redirect to frontend with access token
    return reply.redirect(
      `${process.env.FRONTEND_URL}/oauth/callback?token=${session.accessToken}`
    );
  });
}
```

### Step 2: Register OAuth Routes

```typescript
// apps/api/src/app.ts
import { oauthRoutes } from './modules/auth/oauth.routes';

app.register(oauthRoutes, { prefix: '/api/auth/oauth' });
```

### Step 3: Frontend OAuth Handler

```tsx
// apps/web/src/pages/auth/OAuthCallback.tsx
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export function OAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setAccessToken = useAuthStore((s) => s.setAccessToken);

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setAccessToken(token);
      navigate('/');
    } else {
      navigate('/login?error=oauth_failed');
    }
  }, []);

  return <div>Completing login...</div>;
}
```

### Step 4: Add OAuth Button to Login

```tsx
function LoginPage() {
  return (
    <div>
      {/* Email/password form */}
      <form>...</form>

      <div className="divider">or continue with</div>

      <Button
        variant="outline"
        onClick={() => window.location.href = '/api/auth/oauth/google'}
      >
        <GoogleIcon className="mr-2 h-4 w-4" />
        Continue with Google
      </Button>
    </div>
  );
}
```

---

## Security Configuration

### Environment Variables

```env
# JWT
JWT_SECRET=your-super-secret-key-at-least-32-chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Account Security
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=30

# 2FA
TOTP_ISSUER=YourAppName

# OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/oauth/google/callback
```

### Rate Limiting

```typescript
// apps/api/src/plugins/rateLimit.ts
app.register(fastifyRateLimit, {
  global: true,
  max: 100,
  timeWindow: '1 minute',
});

// Per-route limits
app.post('/api/auth/login', {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: '1 minute',
    },
  },
}, loginHandler);

app.post('/api/auth/2fa/login', {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: '1 minute',
    },
  },
}, verify2FAHandler);
```

---

## Best Practices

### 1. Never Store Access Tokens in localStorage
```typescript
// Good: In-memory storage
const authStore = create((set) => ({
  accessToken: null, // Memory only
  setAccessToken: (token) => set({ accessToken: token }),
}));

// Bad: localStorage
localStorage.setItem('accessToken', token); // Don't do this!
```

### 2. Use HTTP-Only Cookies for Refresh Tokens
```typescript
// Backend: Set cookie properly
reply.setCookie('refreshToken', token, {
  httpOnly: true,    // Can't be accessed by JavaScript
  secure: true,      // HTTPS only
  sameSite: 'strict', // CSRF protection
  path: '/api/auth', // Only sent to auth endpoints
});
```

### 3. Always Validate on Backend
```typescript
// Even if frontend checks permission, always verify on backend
app.delete('/users/:id', {
  preHandler: [app.authenticate, app.requirePermission('users:delete')]
}, handler);
```

### 4. Handle Token Refresh Gracefully
```typescript
// API client with automatic refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      try {
        await refreshToken();
        return api.request(error.config);
      } catch {
        logout();
      }
    }
    throw error;
  }
);
```

---

## Troubleshooting

### "Unauthorized" After Login
1. Check if access token is being set correctly
2. Verify the token is being sent in Authorization header
3. Check token expiration

### 2FA Not Working
1. Ensure device time is synchronized
2. Check TOTP secret is stored correctly
3. Try backup codes

### Session Not Persisting
1. Check refresh token cookie is being set
2. Verify cookie domain and path settings
3. Check CORS configuration

---

## Related Files

| File | Description |
|------|-------------|
| `apps/api/src/modules/auth/` | Backend auth module |
| `apps/api/src/plugins/auth.ts` | Auth middleware |
| `apps/web/src/hooks/useAuth.ts` | Frontend auth hook |
| `apps/web/src/stores/authStore.ts` | Auth state store |
| `apps/web/src/pages/auth/` | Auth pages |

---

## GitHub Issue
This documentation addresses: https://github.com/velsof/js-admin-panel/issues/26
