/**
 * Route-level tests for GET /api/reports/shopify-sync-performance.
 *
 * Harness: buildApp() + app.inject().
 *
 * Auth layer has two checks that must both pass before the handler runs:
 *   1. app.authenticate (global preHandler on reportsRoutes): jwtVerify()
 *      + shared_admin_session cookie + DB validateSession()
 *   2. app.requirePermission (route preHandler): jwtVerify() + JWT permissions
 *
 * For the 400 test we need both checks to pass, so we:
 *   - Mock prisma and SharedSessionService to bypass DB calls
 *   - Provide a shared_admin_session cookie (any string — validateSession is mocked)
 *   - Sign a JWT with reports:view permission embedded
 *
 * 401 case: no Authorization header → jwtVerify() throws immediately → 401.
 * 400 case: valid JWT + cookie + out-of-range windowHours → Zod rejects → 400.
 *
 * Real-DB 200 is NOT asserted: MySQL is not available in this test environment.
 */

// ── Mocks must be hoisted before any imports that pull in the mocked modules ──
import { vi } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
    sharedAdminSession: {
      findUnique: vi.fn().mockResolvedValue({
        id: 1,
        token: 'test-session-token',
        userEmail: 'test@test.com',
        nodeUserId: 1,
        phpUserId: null,
        expiresAt: new Date(Date.now() + 86400000), // 1 day from now
        lastActiveAt: new Date(),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('../../../lib/logger', () => {
  const noop = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };
  return { createLogger: () => noop, logger: noop, default: noop };
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../app';
import type { FastifyInstance } from 'fastify';

const FAKE_SESSION_COOKIE = 'test-session-token';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

/** Sign a JWT with reports:view permission embedded.
 *  requirePermission reads only the JWT payload — no DB call. */
function makeToken(): string {
  return app.jwt.sign({
    id: 1,
    email: 'test@test.com',
    permissions: ['reports:view'],
  });
}

/** Headers that satisfy both auth layers (JWT + shared-session cookie). */
function authHeaders() {
  return {
    authorization: `Bearer ${makeToken()}`,
    cookie: `shared_admin_session=${FAKE_SESSION_COOKIE}`,
  };
}

describe('GET /api/reports/shopify-sync-performance/:storeId/failures', () => {
  it('requires auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/shopify-sync-performance/142/failures',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/reports/shopify-sync-performance', () => {
  it('returns 401 when no auth token is provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/shopify-sync-performance',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for out-of-range windowHours (9999 > max 168)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/shopify-sync-performance?windowHours=9999',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for windowHours=0 (below min of 1)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/shopify-sync-performance?windowHours=0',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });
});
