import type { FastifyPluginAsync } from 'fastify';
import {
  loginSchema,
  googleLoginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateProfileSchema,
  ERROR_CODES,
} from '@admin/shared';
import { config } from '../../config';
import { AuthService } from './auth.service';

// Ticket ID: 164781 - Cookie domain for cross-subdomain SSO
// Set COOKIE_DOMAIN=.uksoccershop.com in production for cross-subdomain access
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

// Ticket ID: 164781 - Shared session cookie options (reusable)
const getSharedCookieOptions = () => ({
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 7, // 7 days
  ...(COOKIE_DOMAIN && { domain: COOKIE_DOMAIN }),
});

// Rate limit configurations for auth endpoints
const authRateLimitConfig = {
  login: { max: 5, timeWindow: '1 minute' },       // 5 login attempts per minute
  twoFactorLogin: { max: 5, timeWindow: '1 minute' }, // 5 2FA attempts per minute
  forgotPassword: { max: 3, timeWindow: '1 minute' }, // 3 password reset requests per minute
  resetPassword: { max: 5, timeWindow: '1 minute' },  // 5 reset attempts per minute
  refresh: { max: 30, timeWindow: '1 minute' },       // 30 refreshes per minute
  googleLogin: { max: 5, timeWindow: '1 minute' },    // 5 Google login attempts per minute
};

export const authRoutes: FastifyPluginAsync = async (app) => {
  const authService = new AuthService(app);

  // POST /api/auth/login
  app.post('/login', {
    config: {
      rateLimit: authRateLimitConfig.login,
    },
  }, async (request, reply) => {
    const data = loginSchema.parse(request.body);
    const result = await authService.login(data, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    // Set refresh token as HTTP-only cookie
    reply.setCookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    // Ticket ID: 164781 - Set shared session cookie for cross-app authentication
    reply.setCookie('shared_admin_session', result.sharedToken, getSharedCookieOptions());

    return { data: { user: result.user, accessToken: result.tokens.accessToken } };
  });

  // GET /api/auth/google-config - Public endpoint to expose Google Client ID
  app.get('/google-config', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    return { data: { clientId: config.GOOGLE_CLIENT_ID || null } };
  });

  // POST /api/auth/google-login - Login with Google credential (ID token)
  app.post('/google-login', {
    config: {
      rateLimit: authRateLimitConfig.googleLogin,
    },
  }, async (request, reply) => {
    const data = googleLoginSchema.parse(request.body);
    const result = await authService.googleLogin(data.credential, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    // Set refresh token as HTTP-only cookie (same as password login)
    reply.setCookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    // Set shared session cookie for cross-app authentication
    reply.setCookie('shared_admin_session', result.sharedToken, getSharedCookieOptions());

    return { data: { user: result.user, accessToken: result.tokens.accessToken } };
  });

  // POST /api/auth/2fa/login - Verify 2FA code during login
  app.post('/2fa/login', {
    config: {
      rateLimit: authRateLimitConfig.twoFactorLogin,
    },
  }, async (request, reply) => {
    const { twoFactorToken, code } = request.body as { twoFactorToken: string; code: string };

    if (!twoFactorToken || !code) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.TWO_FACTOR_TOKEN_REQUIRED, message: 'Two-factor token and code are required' },
      });
    }

    const result = await authService.verifyTwoFactorLogin(twoFactorToken, code, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    // Set refresh token as HTTP-only cookie
    reply.setCookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    // Ticket ID: 164781 - Set shared session cookie for cross-app authentication (2FA login)
    reply.setCookie('shared_admin_session', result.sharedToken, getSharedCookieOptions());

    return { data: { user: result.user, accessToken: result.tokens.accessToken } };
  });

  // GET /api/auth/shared-session-login - Ticket ID: 164781
  // Auto-login using shared session cookie (for CakePHP → Node.js SSO)
  // NOTE: Must be GET because SameSite=Lax cookies are not sent with cross-origin POST requests
  app.get('/shared-session-login', async (request, reply) => {
    const sharedToken = request.cookies.shared_admin_session;

    if (!sharedToken) {
      return reply.status(401).send({
        error: { code: 'NO_SHARED_SESSION', message: 'No shared session found' },
      });
    }

    try {
      const result = await authService.loginWithSharedSession(sharedToken, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });

      // Set refresh token as HTTP-only cookie
      reply.setCookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });

      return { data: { user: result.user, accessToken: result.tokens.accessToken } };
    } catch {
      return reply.status(401).send({
        error: { code: 'INVALID_SHARED_SESSION', message: 'Invalid or expired shared session' },
      });
    }
  });

  // POST /api/auth/logout
  app.post('/logout', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const refreshToken = request.cookies.refreshToken;
    // Ticket ID: 164781 - Get shared session token for cross-app logout
    const sharedToken = request.cookies.shared_admin_session;

    await authService.logout(request.user.sub, refreshToken, sharedToken);

    reply.clearCookie('refreshToken', { path: '/api/auth' });
    // Ticket ID: 164781 - Clear shared session cookie (must use same domain)
    reply.clearCookie('shared_admin_session', {
      path: '/',
      ...(COOKIE_DOMAIN && { domain: COOKIE_DOMAIN }),
    });
    return { data: { success: true } };
  });

  // POST /api/auth/refresh
  app.post('/refresh', {
    config: {
      rateLimit: authRateLimitConfig.refresh,
    },
  }, async (request, reply) => {
    const refreshToken = request.cookies.refreshToken || (request.body as { refreshToken?: string })?.refreshToken;

    if (!refreshToken) {
      return reply.status(401).send({
        error: { code: 'INVALID_TOKEN', message: 'Refresh token required' },
      });
    }

    const result = await authService.refreshTokens(refreshToken);

    reply.setCookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 60 * 60 * 24 * 7,
    });

    return { data: { user: result.user, accessToken: result.tokens.accessToken } };
  });

  // POST /api/auth/forgot-password
  app.post('/forgot-password', {
    config: {
      rateLimit: authRateLimitConfig.forgotPassword,
    },
  }, async (request) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    await authService.forgotPassword(email);
    return { data: { success: true, message: 'If the email exists, a reset link will be sent.' } };
  });

  // POST /api/auth/reset-password
  app.post('/reset-password', {
    config: {
      rateLimit: authRateLimitConfig.resetPassword,
    },
  }, async (request) => {
    const { token, password } = resetPasswordSchema.parse(request.body);
    await authService.resetPassword(token, password);
    return { data: { success: true } };
  });

  // GET /api/auth/me
  app.get('/me', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const user = await authService.getMe(request.user.sub);
    return { data: user };
  });

  // PUT /api/auth/me
  app.put('/me', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const data = updateProfileSchema.parse(request.body);
    const user = await authService.updateProfile(request.user.sub, data);
    return { data: user };
  });

  // PUT /api/auth/me/password
  app.put('/me/password', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const data = changePasswordSchema.parse(request.body);
    await authService.changePassword(request.user.sub, data);
    return { data: { success: true } };
  });

  // GET /api/auth/sessions
  app.get('/sessions', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const sessions = await authService.getSessions(request.user.sub);
    return { data: sessions };
  });

  // DELETE /api/auth/sessions/:id
  app.delete('/sessions/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    await authService.revokeSession(request.user.sub, id);
    return { data: { success: true } };
  });

  // POST /api/auth/2fa/setup
  app.post('/2fa/setup', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const result = await authService.setup2FA(request.user.sub);
    return { data: result };
  });

  // POST /api/auth/2fa/verify
  app.post('/2fa/verify', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { code } = request.body as { code: string };
    const result = await authService.verify2FA(request.user.sub, code);
    return { data: result };
  });

  // DELETE /api/auth/2fa/disable
  app.delete('/2fa/disable', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { password } = request.body as { password: string };
    const result = await authService.disable2FA(request.user.sub, password);
    return { data: result };
  });

  // GET /api/auth/2fa/backup-codes/status - Get backup codes status
  app.get('/2fa/backup-codes/status', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const result = await authService.getBackupCodesStatus(request.user.sub);
    return { data: result };
  });

  // POST /api/auth/2fa/backup-codes/regenerate - Regenerate backup codes
  app.post('/2fa/backup-codes/regenerate', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { password } = request.body as { password: string };
    const result = await authService.regenerateBackupCodes(request.user.sub, password);
    return { data: result };
  });
};

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: { sub: string };
  }
}

import type { FastifyRequest, FastifyReply } from 'fastify';
