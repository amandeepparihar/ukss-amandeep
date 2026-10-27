/**
 * Shared Session Service
 * Ticket ID: 164781 - Single Sign-On between Node.js and PHP applications
 *
 * This service manages cross-application shared sessions that allow
 * users to be authenticated in both Node.js and PHP admin panels
 * when logged into either one.
 *
 * The shared session is stored in the database and validated via a
 * cookie that both applications can access.
 */

import { nanoid } from 'nanoid';
import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';

const logger = createLogger('shared-session');

// Ticket ID: 164781 - Configuration constants
const SHARED_SESSION_DURATION_DAYS = 7;
const TOKEN_LENGTH = 64;

export interface SharedSessionMetadata {
  ip?: string;
  userAgent?: string;
}

export interface SharedSessionUser {
  email: string;
  nodeUserId?: string;
  phpUserId?: number;
}

export interface ValidatedSharedSession {
  email: string;
  nodeUserId?: string;
  phpUserId?: number;
}

/**
 * SharedSessionService - Ticket ID: 164781
 *
 * Manages shared admin sessions between Node.js and PHP applications.
 * Follows patterns established in AuthService for consistency.
 */
export class SharedSessionService {
  /**
   * Create a shared session
   * Ticket ID: 164781
   *
   * Creates a new shared session record and returns the token.
   * This token should be set as a cookie accessible by both applications.
   *
   * @param user - User information (email and optional app-specific IDs)
   * @param metadata - Request metadata (IP, user agent)
   * @returns The session token
   */
  async createSession(
    user: SharedSessionUser,
    metadata: SharedSessionMetadata
  ): Promise<string> {
    const token = nanoid(TOKEN_LENGTH);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SHARED_SESSION_DURATION_DAYS);

    try {
      // Ticket ID: 164781 - Create shared session record
      await prisma.sharedAdminSession.create({
        data: {
          token,
          userEmail: user.email.toLowerCase(),
          nodeUserId: user.nodeUserId,
          phpUserId: user.phpUserId,
          ipAddress: metadata.ip,
          userAgent: metadata.userAgent,
          expiresAt,
        },
      });

      logger.info({ email: user.email }, 'Shared session created - Ticket ID: 164781');
      return token;
    } catch (error) {
      // Ticket ID: 164781 - Log error but don't fail the login
      logger.error({ error, email: user.email }, 'Failed to create shared session - Ticket ID: 164781');
      return token; // Return token anyway so login doesn't fail
    }
  }

  /**
   * Validate a shared session
   * Ticket ID: 164781
   *
   * Validates the session token and returns user information if valid.
   * Updates the lastActiveAt timestamp on successful validation.
   *
   * @param token - The session token from cookie
   * @returns User information if valid, null otherwise
   */
  async validateSession(token: string): Promise<ValidatedSharedSession | null> {
    // Ticket ID: 164781 - Debug logging
    console.log('[SharedSession] validateSession called with token:', token.substring(0, 20) + '...');
    console.log('[SharedSession] Token length:', token.length);

    // Ticket ID: 164781 - Find session by token
    const session = await prisma.sharedAdminSession.findUnique({
      where: { token },
    });

    console.log('[SharedSession] Session found:', session ? 'YES' : 'NO');

    if (!session) {
      // Ticket ID: 164781 - Debug: Check if there are any sessions in the table
      const allSessions = await prisma.sharedAdminSession.findMany({ take: 5 });
      console.log('[SharedSession] Total sessions in DB:', allSessions.length);
      if (allSessions.length > 0) {
        console.log('[SharedSession] First session token starts with:', allSessions[0].token.substring(0, 20));
      }
      return null;
    }

    console.log('[SharedSession] Session expiresAt:', session.expiresAt);
    console.log('[SharedSession] Current time:', new Date());
    console.log('[SharedSession] Is expired:', session.expiresAt < new Date());

    // Ticket ID: 164781 - Check expiration (same pattern as Session validation)
    if (session.expiresAt < new Date()) {
      await prisma.sharedAdminSession.delete({ where: { id: session.id } });
      logger.info({ token: token.substring(0, 8) }, 'Shared session expired - Ticket ID: 164781');
      console.log('[SharedSession] Session DELETED due to expiration');
      return null;
    }

    // Ticket ID: 164781 - Update last active time (same pattern as Session)
    await prisma.sharedAdminSession.update({
      where: { id: session.id },
      data: { lastActiveAt: new Date() },
    });

    console.log('[SharedSession] Session validated successfully for:', session.userEmail);

    return {
      email: session.userEmail,
      nodeUserId: session.nodeUserId ?? undefined,
      phpUserId: session.phpUserId ?? undefined,
    };
  }

  /**
   * Delete shared session by token
   * Ticket ID: 164781
   *
   * Removes the shared session when user logs out.
   *
   * @param token - The session token to delete
   */
  async deleteSession(token: string): Promise<void> {
    // Ticket ID: 164781 - Delete shared session
    await prisma.sharedAdminSession.deleteMany({
      where: { token },
    });
    logger.info('Shared session deleted - Ticket ID: 164781');
  }

  /**
   * Delete all shared sessions for a user by email
   * Ticket ID: 164781
   *
   * Used when user changes password or needs to be logged out everywhere.
   *
   * @param email - User email address
   */
  async deleteUserSessions(email: string): Promise<void> {
    // Ticket ID: 164781 - Delete all shared sessions for user
    await prisma.sharedAdminSession.deleteMany({
      where: { userEmail: email.toLowerCase() },
    });
    logger.info({ email }, 'All shared sessions deleted for user - Ticket ID: 164781');
  }

  /**
   * Find PHP user ID by email
   * Ticket ID: 164781
   *
   * Looks up the PHP user ID (sms_users_id) from the sms_users table
   * using the email address as the common identifier.
   *
   * @param email - User email address
   * @returns PHP user ID or null if not found
   */
  async findPhpUserIdByEmail(email: string): Promise<number | null> {
    try {
      // Ticket ID: 164781 - Query sms_users table by admin_name (stores full email)
      const adminName = email.toLowerCase();

      logger.info({ adminName }, 'Looking up PHP user by admin_name - Ticket ID: 164781');

      const result = await prisma.$queryRaw<{ sms_users_id: number }[]>`
        SELECT sms_users_id FROM sms_users
        WHERE admin_name = ${adminName}
        LIMIT 1
      `;

      logger.info({ adminName, found: result.length > 0, result }, 'PHP user lookup result - Ticket ID: 164781');

      return result.length > 0 ? result[0].sms_users_id : null;
    } catch (error) {
      // Table may not exist in dev environment or different database
      logger.error({ email, error }, 'Error finding PHP user - Ticket ID: 164781');
      return null;
    }
  }

  /**
   * Cleanup expired sessions
   * Ticket ID: 164781
   *
   * Removes all expired shared sessions from the database.
   * This should be called periodically via a scheduled job.
   *
   * @returns Number of sessions deleted
   */
  async cleanupExpiredSessions(): Promise<number> {
    // Ticket ID: 164781 - Delete expired sessions
    const result = await prisma.sharedAdminSession.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    logger.info({ count: result.count }, 'Cleaned up expired shared sessions - Ticket ID: 164781');
    return result.count;
  }
}
