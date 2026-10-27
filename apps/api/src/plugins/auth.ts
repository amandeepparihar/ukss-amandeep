import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { AuthenticationError, AuthorizationError } from '../lib/errors';
import { SharedSessionService } from '../modules/auth/shared-session.service';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (...permissions: string[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: {
      sub: string;
      permissions: string[];
    };
  }
}

import type { FastifyRequest, FastifyReply } from 'fastify';

// Ticket ID: 164781 - Shared session service for cross-app logout validation
const sharedSessionService = new SharedSessionService();

const authPlugin: FastifyPluginAsync = async (app) => {
  // Authentication decorator - verifies JWT and extracts user info including permissions
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      // Ensure permissions array exists (for backwards compatibility with old tokens)
      if (!request.user.permissions) {
        request.user.permissions = [];
      }

      // Ticket ID: 164781 - Check if shared session is still valid for cross-app logout
      const sharedToken = request.cookies.shared_admin_session;
      if (!sharedToken) {
        // Shared session cookie missing - user logged out from PHP app
        reply.clearCookie('refreshToken', { path: '/api/auth' });
        reply.clearCookie('shared_admin_session', { path: '/' });
        throw new AuthenticationError('Session expired');
      }

      // Validate shared session exists in database
      const sharedSession = await sharedSessionService.validateSession(sharedToken);
      if (!sharedSession) {
        // Shared session invalid - user logged out from PHP app
        reply.clearCookie('refreshToken', { path: '/api/auth' });
        reply.clearCookie('shared_admin_session', { path: '/' });
        throw new AuthenticationError('Session expired');
      }
    } catch (err) {
      if (err instanceof AuthenticationError) {
        throw err;
      }
      throw new AuthenticationError('Authentication required');
    }
  });

  // Optional authentication (doesn't throw if no token)
  app.decorate('optionalAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      if (!request.user.permissions) {
        request.user.permissions = [];
      }
    } catch {
      // Ignore errors for optional auth
    }
  });

  // Permission check decorator - uses permissions from JWT (no database query!)
  // Usage: app.requirePermission('resource', 'action') or app.requirePermission('resource:action')
  app.decorate('requirePermission', (...requiredPermissions: string[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      // First authenticate
      try {
        await request.jwtVerify();
        if (!request.user.permissions) {
          request.user.permissions = [];
        }
      } catch {
        throw new AuthenticationError('Authentication required');
      }

      // Permissions are embedded in JWT - no database query needed!
      const userPermissions = request.user.permissions;

      // Handle both formats:
      // - requirePermission('resource', 'action') -> checks for 'resource:action'
      // - requirePermission('resource:action') -> checks for 'resource:action'
      let permissionsToCheck: string[];

      if (requiredPermissions.length === 2 && !requiredPermissions[0].includes(':')) {
        // Format: requirePermission('settings', 'edit') -> 'settings:edit'
        permissionsToCheck = [`${requiredPermissions[0]}:${requiredPermissions[1]}`];
      } else {
        // Format: requirePermission('settings:edit') or multiple permissions
        permissionsToCheck = requiredPermissions;
      }

      // Check if user has all required permissions
      const hasAllPermissions = permissionsToCheck.every((p) =>
        userPermissions.includes(p)
      );

      if (!hasAllPermissions) {
        throw new AuthorizationError('Insufficient permissions');
      }
    };
  });
};

export default fp(authPlugin, {
  name: 'auth-plugin',
});
