/**
 * Resolve the legacy `sms_users_id` audit value for deliveries write paths.
 *
 * Authentication and permission checks are owned by the jsa tables
 * (`jsa_users`, `jsa_roles`, `jsa_permissions`) via `app.authenticate` /
 * `ensurePermission`. By the time this helper runs the request is already
 * authorised — we are NOT re-authenticating against `sms_users`.
 *
 * The only reason this helper still exists is that several legacy tables
 * (`product_quantities`, `stock_system_logs2`, `product_lists_to_products_history`,
 * `sms_products_for_review.submitted_by`, ...) carry an integer
 * `sms_users_id` audit column. We populate it from the SSO cookie when the
 * operator's account was previously linked at login; otherwise we fall back to
 * 0 (legacy "system / unknown" sentinel) and continue. We never block the
 * write on a missing legacy mapping.
 */

import type { FastifyRequest } from 'fastify';
import { sharedSessionService } from '../auth/shared-session.instance';

const CACHE_KEY = Symbol.for('deliveries.smsUser');

const LEGACY_SYSTEM_USER_ID = 0;

export async function resolveSmsUserId(request: FastifyRequest): Promise<number> {
  const cached = (request as unknown as Record<symbol, number | undefined>)[CACHE_KEY];
  if (typeof cached === 'number') return cached;

  let smsUsersId = LEGACY_SYSTEM_USER_ID;

  const sharedToken = request.cookies?.shared_admin_session;
  if (sharedToken) {
    const session = await sharedSessionService.validateSession(sharedToken);
    if (session?.phpUserId) smsUsersId = session.phpUserId;
  }

  (request as unknown as Record<symbol, number>)[CACHE_KEY] = smsUsersId;
  return smsUsersId;
}
