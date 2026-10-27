import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { createLogger } from '../../lib/logger';
import { encrypt, decrypt, isEncrypted } from '../../lib/encryption';
import { config } from '../../config';
import {
  InvalidCredentialsError,
  AccountLockedError,
  InvalidTokenError,
  NotFoundError,
  ConflictError,
  TwoFactorRequiredError,
  AuthenticationError,
} from '../../lib/errors';
import type { LoginInput, ChangePasswordInput } from '@admin/shared';
import { MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MINUTES } from '@admin/shared';
import { LoginNotificationService } from './login-notification.service.js';
// Ticket ID: 164781 - Import SharedSessionService for cross-app authentication
import { SharedSessionService } from './shared-session.service.js';

const BACKUP_CODE_COUNT = 10;

// Generate a single backup code in format XXXX-XXXX
function generateBackupCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars (0, O, 1, I)
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
    if (i === 3) code += '-';
  }
  return code;
}

// Generate multiple backup codes
function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    codes.push(generateBackupCode());
  }
  return codes;
}

// Hash a backup code for storage
async function hashBackupCode(code: string): Promise<string> {
  // Remove dashes and uppercase for comparison
  const normalized = code.replace(/-/g, '').toUpperCase();
  return bcrypt.hash(normalized, 10);
}

// Verify a backup code against hashed codes
async function verifyBackupCode(code: string, hashedCodes: string[]): Promise<number> {
  const normalized = code.replace(/-/g, '').toUpperCase();
  for (let i = 0; i < hashedCodes.length; i++) {
    if (hashedCodes[i] && await bcrypt.compare(normalized, hashedCodes[i])) {
      return i;
    }
  }
  return -1;
}

const logger = createLogger('auth');

// Token expiry parsing
function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 15 * 60; // Default 15 minutes

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  switch (unit) {
    case 's':
      return num;
    case 'm':
      return num * 60;
    case 'h':
      return num * 60 * 60;
    case 'd':
      return num * 60 * 60 * 24;
    default:
      return 15 * 60;
  }
}

export class AuthService {
  private loginNotificationService: LoginNotificationService;
  // Ticket ID: 164781 - Shared session service for cross-app authentication
  private sharedSessionService: SharedSessionService;

  constructor(private app: FastifyInstance) {
    this.loginNotificationService = new LoginNotificationService(app);
    // Ticket ID: 164781 - Initialize shared session service
    this.sharedSessionService = new SharedSessionService();
  }

  async login(data: LoginInput, metadata: { ip?: string; userAgent?: string }) {
    const { email, password, rememberMe } = data;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    if (!user) {
      logger.warn({ email }, 'Login attempt for non-existent user');
      throw new InvalidCredentialsError();
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000
      );
      throw new AccountLockedError(minutesLeft);
    }

    // Check if user is active
    if (!user.isActive) {
      logger.warn({ userId: user.id }, 'Login attempt for inactive user');
      throw new InvalidCredentialsError();
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      // Increment failed attempts
      const failedAttempts = user.failedLoginAttempts + 1;
      const updateData: Record<string, unknown> = { failedLoginAttempts: failedAttempts };

      if (failedAttempts >= MAX_LOGIN_ATTEMPTS) {
        updateData.lockedUntil = new Date(
          Date.now() + LOCKOUT_DURATION_MINUTES * 60000
        );
        logger.warn({ userId: user.id }, 'Account locked due to failed attempts');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });

      throw new InvalidCredentialsError();
    }

    // Check 2FA
    if (user.twoFactorEnabled) {
      // Return a temporary token for 2FA verification
      const twoFactorToken = nanoid(32);
      await redis.setex(`2fa:${twoFactorToken}`, 300, user.id); // 5 minutes
      throw new TwoFactorRequiredError(twoFactorToken);
    }

    // Reset failed attempts
    if (user.failedLoginAttempts > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
    }

    return this.loginByUser(user, metadata, { loginMethod: 'password', rememberMe });
  }

  /**
   * Shared post-authentication logic. Called after identity is verified
   * (by password, 2FA, or Google OAuth). Generates tokens, creates session,
   * audit log, login notification, and cross-app shared session.
   */
  private async loginByUser(
    user: { id: string; email: string; firstName: string; lastName: string; avatar: string | null; isActive: boolean; emailVerified: boolean; twoFactorEnabled: boolean; roleId: string; role: { id: string; name: string; description: string | null; isSystem: boolean; permissions: { resource: string; action: string }[] }; createdAt: Date; updatedAt: Date },
    metadata: { ip?: string; userAgent?: string },
    options: { loginMethod: 'password' | 'google'; rememberMe?: boolean; googleSub?: string; auditMetadata?: Record<string, unknown> }
  ) {
    // Build permissions array (needed for JWT)
    const permissions = user.role.permissions.map(
      (p) => `${p.resource}:${p.action}`
    );

    // Generate tokens with permissions embedded
    const tokens = await this.generateTokens(user.id, permissions, options.rememberMe);

    // Create session
    const refreshTokenExpiry = options.rememberMe
      ? parseExpiry('30d')
      : parseExpiry(config.JWT_REFRESH_EXPIRY);

    await prisma.session.create({
      data: {
        userId: user.id,
        refreshToken: tokens.refreshToken,
        ipAddress: metadata.ip,
        userAgent: metadata.userAgent,
        expiresAt: new Date(Date.now() + refreshTokenExpiry * 1000),
      },
    });

    // Create audit log with login method metadata
    const auditMetadata = {
      ...metadata,
      loginMethod: options.loginMethod,
      ...(options.googleSub && { googleSub: options.googleSub }),
      ...(options.auditMetadata || {}),
    };
    await this.createAuditLog(user.id, 'login', 'session', null, auditMetadata);

    logger.info({ userId: user.id, loginMethod: options.loginMethod }, 'User logged in successfully');

    // Record login (async, don't block)
    this.loginNotificationService
      .recordLogin(user.id, { ip: metadata.ip, userAgent: metadata.userAgent })
      .catch((error) => logger.error({ error }, 'Failed to record login'));

    // Ticket ID: 164781 - Create shared session for cross-app authentication
    const phpUserId = await this.sharedSessionService.findPhpUserIdByEmail(user.email);
    const sharedToken = await this.sharedSessionService.createSession(
      {
        email: user.email,
        nodeUserId: user.id,
        phpUserId: phpUserId ?? undefined,
      },
      metadata
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        roleId: user.roleId,
        role: {
          id: user.role.id,
          name: user.role.name,
          description: user.role.description,
          isSystem: user.role.isSystem,
        },
        permissions,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      tokens,
      // Ticket ID: 164781 - Include shared token for cross-app cookie
      sharedToken,
    };
  }

  async verifyTwoFactorLogin(
    twoFactorToken: string,
    code: string,
    metadata: { ip?: string; userAgent?: string }
  ) {
    // Get user ID from Redis
    const userId = await redis.get(`2fa:${twoFactorToken}`);
    if (!userId) {
      throw new InvalidTokenError('2FA session expired or invalid');
    }

    // Get user with 2FA secret
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: { permissions: true },
        },
      },
    });

    if (!user || !user.twoFactorSecret) {
      throw new InvalidTokenError('2FA not configured');
    }

    // Decrypt the stored secret
    let secret: string;
    try {
      // Check if secret is encrypted (for backwards compatibility with existing plain text secrets)
      if (isEncrypted(user.twoFactorSecret)) {
        secret = decrypt(user.twoFactorSecret);
      } else {
        // Legacy plain text secret - encrypt it now for future use
        secret = user.twoFactorSecret;
        const encryptedSecret = encrypt(secret);
        await prisma.user.update({
          where: { id: user.id },
          data: { twoFactorSecret: encryptedSecret },
        });
        logger.info({ userId: user.id }, 'Migrated 2FA secret to encrypted format');
      }
    } catch (error) {
      logger.error({ userId: user.id, error }, 'Failed to decrypt 2FA secret');
      throw new InvalidTokenError('Failed to verify 2FA code');
    }

    // Verify the code - try TOTP first
    let isValid = authenticator.verify({ token: code, secret });
    let usedBackupCode = false;

    // If TOTP fails, try backup codes
    if (!isValid && user.twoFactorBackupCodes) {
      const hashedCodes: string[] = JSON.parse(user.twoFactorBackupCodes);
      const usedCodeIndex = await verifyBackupCode(code, hashedCodes);

      if (usedCodeIndex >= 0) {
        isValid = true;
        usedBackupCode = true;

        // Mark the backup code as used by setting it to empty string
        hashedCodes[usedCodeIndex] = '';
        await prisma.user.update({
          where: { id: user.id },
          data: { twoFactorBackupCodes: JSON.stringify(hashedCodes) },
        });

        logger.info({ userId: user.id }, 'User logged in with backup code');
      }
    }

    if (!isValid) {
      throw new InvalidCredentialsError();
    }

    // Delete the 2FA token from Redis
    await redis.del(`2fa:${twoFactorToken}`);

    // Reset failed attempts
    if (user.failedLoginAttempts > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
    }

    return this.loginByUser(user, metadata, {
      loginMethod: 'password',
      auditMetadata: { method: usedBackupCode ? '2fa_backup_code' : '2fa' },
    });
  }

  async googleLogin(credential: string, metadata: { ip?: string; userAgent?: string }) {
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(config.GOOGLE_CLIENT_ID);

    // Verify Google ID token
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: config.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (error) {
      logger.warn({ error }, 'Google ID token verification failed');
      throw new AuthenticationError('Google authentication failed. Please try again.');
    }

    if (!payload?.email) {
      throw new AuthenticationError('Google authentication failed. No email in token.');
    }

    // Find user by email (case-insensitive)
    const user = await prisma.user.findUnique({
      where: { email: payload.email.toLowerCase() },
      include: {
        role: {
          include: { permissions: true },
        },
      },
    });

    if (!user) {
      logger.warn({ email: payload.email }, 'Google login attempt for non-existent user');
      throw new AuthenticationError('No account found for this email. Contact your administrator.');
    }

    if (!user.isActive) {
      logger.warn({ userId: user.id }, 'Google login attempt for inactive user');
      throw new AuthenticationError('Your account has been deactivated. Contact your administrator.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000
      );
      throw new AccountLockedError(minutesLeft);
    }

    // Google login bypasses 2FA (Google's own MFA is trusted)
    // Google login does NOT touch failedLoginAttempts

    return this.loginByUser(user, metadata, {
      loginMethod: 'google',
      googleSub: payload.sub,
    });
  }

  // Ticket ID: 164781 - Updated logout to delete shared sessions by user email
  async logout(userId: string, refreshToken?: string, sharedToken?: string) {
    logger.info({ userId, hasRefreshToken: !!refreshToken, hasSharedToken: !!sharedToken }, 'Logout called - Ticket ID: 164781');

    // Get user email for shared session deletion
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (refreshToken) {
      await prisma.session.deleteMany({
        where: {
          userId,
          refreshToken,
        },
      });
    } else {
      // Logout from all sessions
      await prisma.session.deleteMany({
        where: { userId },
      });
    }

    // Ticket ID: 164781 - Delete shared session by user email (more reliable than token)
    // This ensures cross-app logout works even if cookie isn't sent
    if (user?.email) {
      logger.info({ email: user.email }, 'Deleting shared sessions by email - Ticket ID: 164781');
      await this.sharedSessionService.deleteUserSessions(user.email);
      logger.info('Shared sessions deleted - Ticket ID: 164781');
    } else if (sharedToken) {
      // Fallback to token-based deletion
      logger.info({ sharedToken: sharedToken.substring(0, 15) }, 'Deleting shared session by token - Ticket ID: 164781');
      await this.sharedSessionService.deleteSession(sharedToken);
      logger.info('Shared session deleted - Ticket ID: 164781');
    }

    await this.createAuditLog(userId, 'logout', 'session', null, {});
    logger.info({ userId }, 'User logged out');
  }

  /**
   * Login using shared session token
   * Ticket ID: 164781 - CakePHP → Node.js SSO
   *
   * Validates the shared session and creates a Node.js session for the user.
   */
  async loginWithSharedSession(
    sharedToken: string,
    metadata: { ip?: string; userAgent?: string }
  ) {
    // Validate shared session
    const sharedSession = await this.sharedSessionService.validateSession(sharedToken);
    if (!sharedSession) {
      throw new AuthenticationError('Invalid or expired shared session');
    }

    // Find Node.js user by email
    const user = await prisma.user.findUnique({
      where: { email: sharedSession.email.toLowerCase() },
      include: {
        role: {
          include: { permissions: true },
        },
      },
    });

    if (!user) {
      throw new AuthenticationError('User not found in Node.js application');
    }

    if (!user.isActive) {
      throw new AuthenticationError('Account is disabled');
    }

    // Build permissions array (needed for JWT)
    const permissions = user.role?.permissions?.map(
      (p) => `${p.resource}:${p.action}`
    ) || [];

    // Generate tokens — must pass user.id (string), not the full user object.
    // Passing the object embeds it as JWT sub, causing getMe to fail with
    // "Expected String, provided Object" and leaking password hash in the token.
    const tokens = await this.generateTokens(user.id, permissions);

    // Create session
    await prisma.session.create({
      data: {
        userId: user.id,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        ipAddress: metadata.ip,
        userAgent: metadata.userAgent,
      },
    });

    await this.createAuditLog(user.id, 'login', 'session', null, {
      method: 'shared_session',
      ip: metadata.ip,
    });

    logger.info({ userId: user.id, email: user.email }, 'User logged in via shared session - Ticket ID: 164781');

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        roleId: user.roleId,
        role: {
          id: user.role!.id,
          name: user.role!.name,
          description: user.role!.description,
          isSystem: user.role!.isSystem,
        },
        permissions,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      tokens,
    };
  }

  async refreshTokens(refreshToken: string) {
    const session = await prisma.session.findUnique({
      where: { refreshToken },
      include: {
        user: {
          include: {
            role: {
              include: { permissions: true },
            },
          },
        },
      },
    });

    if (!session) {
      throw new InvalidTokenError('Invalid refresh token');
    }

    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: session.id } });
      throw new InvalidTokenError('Refresh token has expired');
    }

    if (!session.user.isActive) {
      await prisma.session.delete({ where: { id: session.id } });
      throw new InvalidTokenError('User account is inactive');
    }

    // Build permissions array (needed for JWT)
    const permissions = session.user.role.permissions.map(
      (p) => `${p.resource}:${p.action}`
    );

    // Generate new tokens with permissions embedded
    const tokens = await this.generateTokens(session.userId, permissions, false);

    // Update session with new refresh token
    await prisma.session.update({
      where: { id: session.id },
      data: {
        refreshToken: tokens.refreshToken,
        lastActiveAt: new Date(),
        expiresAt: new Date(
          Date.now() + parseExpiry(config.JWT_REFRESH_EXPIRY) * 1000
        ),
      },
    });

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        avatar: session.user.avatar,
        isActive: session.user.isActive,
        emailVerified: session.user.emailVerified,
        twoFactorEnabled: session.user.twoFactorEnabled,
        roleId: session.user.roleId,
        role: {
          id: session.user.role.id,
          name: session.user.role.name,
          description: session.user.role.description,
          isSystem: session.user.role.isSystem,
        },
        permissions,
        createdAt: session.user.createdAt.toISOString(),
        updatedAt: session.user.updatedAt.toISOString(),
      },
      tokens,
    };
  }

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      logger.warn({ email }, 'Password reset requested for non-existent email');
      return;
    }

    // Generate reset token
    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordReset.create({
      data: {
        email: user.email,
        token,
        expiresAt,
      },
    });

    // TODO: Send email with reset link
    logger.info({ userId: user.id }, 'Password reset token generated');

    // In development, log the token
    if (config.NODE_ENV === 'development') {
      logger.debug({ token, email }, 'Password reset token (DEV ONLY)');
    }
  }

  async resetPassword(token: string, newPassword: string) {
    const resetRequest = await prisma.passwordReset.findUnique({
      where: { token },
    });

    if (!resetRequest || resetRequest.expiresAt < new Date() || resetRequest.usedAt) {
      throw new InvalidTokenError('Invalid or expired reset token');
    }

    const user = await prisma.user.findUnique({
      where: { email: resetRequest.email },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password and mark token as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      prisma.passwordReset.update({
        where: { id: resetRequest.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate all sessions
      prisma.session.deleteMany({
        where: { userId: user.id },
      }),
    ]);

    await this.createAuditLog(user.id, 'password_reset', 'user', user.id, {});
    logger.info({ userId: user.id }, 'Password reset successfully');
  }

  async changePassword(userId: string, data: ChangePasswordInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    // Verify current password
    const validPassword = await bcrypt.compare(data.currentPassword, user.password);
    if (!validPassword) {
      throw new InvalidCredentialsError();
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(data.newPassword, 12);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    await this.createAuditLog(userId, 'password_change', 'user', userId, {});
    logger.info({ userId }, 'Password changed successfully');
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: { permissions: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    const permissions = user.role.permissions.map(
      (p) => `${p.resource}:${p.action}`
    );

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      roleId: user.roleId,
      role: {
        id: user.role.id,
        name: user.role.name,
        description: user.role.description,
        isSystem: user.role.isSystem,
      },
      permissions,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async updateProfile(
    userId: string,
    data: { firstName?: string; lastName?: string; avatar?: string | null }
  ) {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      include: {
        role: {
          include: { permissions: true },
        },
      },
    });

    await this.createAuditLog(userId, 'update', 'user', userId, { newValues: data });

    const permissions = user.role.permissions.map(
      (p) => `${p.resource}:${p.action}`
    );

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      roleId: user.roleId,
      role: {
        id: user.role.id,
        name: user.role.name,
        description: user.role.description,
        isSystem: user.role.isSystem,
      },
      permissions,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async getSessions(userId: string) {
    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { lastActiveAt: 'desc' },
    });

    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      deviceInfo: s.deviceInfo,
      createdAt: s.createdAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
      },
    });

    if (!session) {
      throw new NotFoundError('Session');
    }

    await prisma.session.delete({ where: { id: sessionId } });
    await this.createAuditLog(userId, 'revoke_session', 'session', sessionId, {});
    logger.info({ userId, sessionId }, 'Session revoked');
  }

  async setup2FA(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, 'Admin Panel', secret);

    // Store secret temporarily in Redis
    await redis.setex(`2fa-setup:${userId}`, 600, secret); // 10 minutes

    return { secret, otpauth };
  }

  async verify2FA(userId: string, code: string) {
    const secret = await redis.get(`2fa-setup:${userId}`);
    if (!secret) {
      throw new InvalidTokenError('2FA setup session expired');
    }

    const isValid = authenticator.verify({ token: code, secret });
    if (!isValid) {
      throw new InvalidTokenError('Invalid 2FA code');
    }

    // Encrypt the secret before storing in database
    const encryptedSecret = encrypt(secret);

    // Generate backup codes
    const backupCodes = generateBackupCodes();
    const hashedBackupCodes = await Promise.all(backupCodes.map(hashBackupCode));

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: encryptedSecret,
        twoFactorBackupCodes: JSON.stringify(hashedBackupCodes),
      },
    });

    await redis.del(`2fa-setup:${userId}`);
    await this.createAuditLog(userId, '2fa_enabled', 'user', userId, {});

    // Return backup codes to show to user (one-time view)
    return { success: true, backupCodes };
  }

  async disable2FA(userId: string, password: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      throw new InvalidCredentialsError();
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
      },
    });

    await this.createAuditLog(userId, '2fa_disabled', 'user', userId, {});
    return { success: true };
  }

  async regenerateBackupCodes(userId: string, password: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    if (!user.twoFactorEnabled) {
      throw new InvalidTokenError('2FA is not enabled');
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      throw new InvalidCredentialsError();
    }

    // Generate new backup codes
    const backupCodes = generateBackupCodes();
    const hashedBackupCodes = await Promise.all(backupCodes.map(hashBackupCode));

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorBackupCodes: JSON.stringify(hashedBackupCodes),
      },
    });

    await this.createAuditLog(userId, '2fa_backup_codes_regenerated', 'user', userId, {});
    logger.info({ userId }, 'Backup codes regenerated');

    return { backupCodes };
  }

  async getBackupCodesStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, twoFactorBackupCodes: true },
    });

    if (!user) throw new NotFoundError('User');

    if (!user.twoFactorEnabled || !user.twoFactorBackupCodes) {
      return { enabled: false, remaining: 0, total: BACKUP_CODE_COUNT };
    }

    const hashedCodes: string[] = JSON.parse(user.twoFactorBackupCodes);
    const remaining = hashedCodes.filter((code) => code !== null && code !== '').length;

    return { enabled: true, remaining, total: BACKUP_CODE_COUNT };
  }

  private async generateTokens(userId: string, permissions: string[], rememberMe?: boolean) {
    const accessToken = this.app.jwt.sign(
      { sub: userId, permissions },
      { expiresIn: config.JWT_ACCESS_EXPIRY }
    );

    const refreshToken = nanoid(64);

    return {
      accessToken,
      refreshToken,
      expiresIn: parseExpiry(config.JWT_ACCESS_EXPIRY),
    };
  }

  private async createAuditLog(
    userId: string,
    action: string,
    resource: string,
    resourceId: string | null,
    metadata: Record<string, unknown>
  ) {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        resource,
        resourceId,
        metadata,
      },
    });
  }
}
