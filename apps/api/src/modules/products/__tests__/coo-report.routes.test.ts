/**
 * Route-level tests for GET /api/products/coo-report.
 *
 * Harness copied from `reports/__tests__/shopify-sync.routes.test.ts`:
 *   - Mock prisma + logger so buildApp() never touches a real DB/log dir.
 *   - Mock coo-report.service so the handler's business logic (Task 2) is
 *     out of scope here — only routing/auth/validation/response-shape.
 *   - Sign a real JWT via app.jwt.sign(...) with coo-report:view permission,
 *     plus a shared_admin_session cookie (validateSession is DB-backed and
 *     mocked via the prisma.sharedAdminSession.findUnique mock below).
 *
 * 401 case: no Authorization header → jwtVerify() throws immediately.
 * 400 case: valid auth + cooStatus=bogus → Zod rejects (not in the enum).
 * 200 case: valid auth + cooStatus=missing → paginated response shape.
 */

// ── Mocks must be hoisted before any imports that pull in the mocked modules ──
import { vi } from 'vitest';

// buildApp() → app.ts pulls in the full config module (Zod-validated env),
// which process.exit(1)s in this test environment because the 3 fields with
// no schema default (DATABASE_URL, JWT_SECRET, EBAY_STORE_ID) aren't set.
// Rather than hand-stubbing the whole config object (products.routes.ts's
// full dependency graph — queue/index.ts, email.ts, etc. — reads many other
// config fields at module-load time, e.g. REDIS_URL), backfill just those 3
// required env vars and let the real config module compute everything else
// from its own schema defaults. importOriginal() re-runs the real loadConfig()
// against process.env, which now validates successfully.
vi.mock('../../../config', async (importOriginal) => {
  process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/test';
  process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long-000';
  process.env.EBAY_STORE_ID ??= '1';
  return importOriginal<typeof import('../../../config')>();
});

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

// Route depends on the coo-report service (Task 2) — stub it so this file
// only exercises routing/auth/validation, not the SQL/business logic.
vi.mock('../coo-report.service', () => ({
  fetchCooReportPage: vi.fn(async () => ({
    rows: [{
      productListsId: 1,
      productCode: 'AAA',
      productName: 'Test',
      brand: 'Nike',
      countryOfOrigin: null,
      thumbnailUrl: null,
    }],
    total: 1,
  })),
}));

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

/** Sign a JWT with coo-report:view permission embedded.
 *  requirePermission reads only the JWT payload — no DB call. */
function makeToken(): string {
  return app.jwt.sign({
    id: 1,
    email: 'test@test.com',
    permissions: ['coo-report:view'],
  });
}

/** Headers that satisfy both auth layers (JWT + shared-session cookie). */
function authHeaders() {
  return {
    authorization: `Bearer ${makeToken()}`,
    cookie: `shared_admin_session=${FAKE_SESSION_COOKIE}`,
  };
}

describe('GET /api/products/coo-report', () => {
  it('returns 401 when no auth token is provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/products/coo-report',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns a paginated response for a valid query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/products/coo-report?cooStatus=missing&pageSize=10',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ total: 1, page: 1, pageSize: 10, totalPages: 1 });
  });

  it('rejects an invalid cooStatus with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/products/coo-report?cooStatus=bogus',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });
});
