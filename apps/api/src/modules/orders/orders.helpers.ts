/**
 * Orders module helper functions — ported from orders.php lines 35-53
 * Requirements: REQ-01-020 (URL helper functions)
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { WEBADMIN_BYPASS_TOKEN } from './orders.constants';
import { sharedSessionService } from '../auth/shared-session.instance';

/**
 * REQ-01-020: Pads a number with leading zeros to reach the specified string length.
 */
export function addLeadingZeros(num: number, length: number): string {
  return String(num).padStart(length, '0');
}

/**
 * REQ-01-020: Returns current UTC date/time in dd-mm-YYYY-HH-ii format.
 */
export function getFormattedDate(): string {
  const now = new Date();
  const dd = addLeadingZeros(now.getUTCDate(), 2);
  const mm = addLeadingZeros(now.getUTCMonth() + 1, 2);
  const yyyy = now.getUTCFullYear();
  const hh = addLeadingZeros(now.getUTCHours(), 2);
  const ii = addLeadingZeros(now.getUTCMinutes(), 2);
  return `${dd}-${mm}-${yyyy}-${hh}-${ii}`;
}

/**
 * REQ-01-020: Appends bypass token + formatted date as query parameters
 * for unauthenticated internal access (FC integration).
 * Format: {url}?webadmin_bypass_parameter={token}codeaccess{dd-mm-YYYY-HH-ii}&codeaccess=1
 */
export function createBypassURL(sendToFcUrl: string): string {
  const formattedDate = getFormattedDate();
  const separator = sendToFcUrl.includes('?') ? '&' : '?';
  return `${sendToFcUrl}${separator}webadmin_bypass_parameter=${WEBADMIN_BYPASS_TOKEN}codeaccess${formattedDate}&codeaccess=1`;
}

// ---------------------------------------------------------------------------
// Shared data-processing helpers (used by details, products, and panel services)
// ---------------------------------------------------------------------------

/** Group an array by a numeric key function into a Map. */
export function groupBy<T>(arr: T[], keyFn: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of arr) {
    const key = keyFn(item);
    const existing = map.get(key) ?? [];
    existing.push(item);
    map.set(key, existing);
  }
  return map;
}

/** Convert a Date or string to ISO string, or null if falsy. */
export function toIso(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

/** Extract a value from a PromiseSettledResult with a safe default. */
export function settledVal<T>(r: PromiseSettledResult<T>, def: T, logger?: { warn: (...args: unknown[]) => void }, msg?: string): T {
  if (r.status === 'fulfilled') return r.value;
  if (logger && msg) logger.warn({ err: (r as PromiseRejectedResult).reason }, msg);
  return def;
}

/**
 * REQ-01-001: Validates a webadmin_bypass_parameter token within a 1-minute window.
 * Token format: {static_token}codeaccess{dd-mm-YYYY-HH-ii}
 */
export function validateBypassToken(token: string): boolean {
  if (!token || !token.startsWith(WEBADMIN_BYPASS_TOKEN + 'codeaccess')) {
    return false;
  }

  const datePart = token.substring((WEBADMIN_BYPASS_TOKEN + 'codeaccess').length);
  // datePart should be in dd-mm-YYYY-HH-ii format
  const parts = datePart.split('-');
  if (parts.length !== 5) {
    return false;
  }

  const [dd, mm, yyyy, hh, ii] = parts;
  const tokenDate = new Date(
    Date.UTC(
      parseInt(yyyy, 10),
      parseInt(mm, 10) - 1,
      parseInt(dd, 10),
      parseInt(hh, 10),
      parseInt(ii, 10)
    )
  );

  if (isNaN(tokenDate.getTime())) {
    return false;
  }

  const now = new Date();
  const diffMs = Math.abs(now.getTime() - tokenDate.getTime());
  // Allow 1-minute window (60000ms)
  return diffMs <= 60000;
}

// ---------------------------------------------------------------------------
// SPEC-06: Shared helpers for product-level actions
// ---------------------------------------------------------------------------

/** Format a Date as DD/MM/YYYY (used by ship check and status modules). */
export function formatDdMmYyyy(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

/** Resolve PHP admin ID from shared session cookie. Returns 0 if unavailable. */
export async function resolvePhpAdminId(
  cookies: Record<string, string | undefined>,
): Promise<number> {
  const sharedToken = cookies.shared_admin_session;
  if (!sharedToken) return 0;
  const session = await sharedSessionService.validateSession(sharedToken);
  return session?.phpUserId ?? 0;
}

/** Resolve admin name from shared session or JWT fallback. */
export async function resolveAdminName(
  cookies: Record<string, string | undefined>,
  user: { email?: string } | undefined,
): Promise<string> {
  const sharedToken = cookies?.shared_admin_session;
  if (sharedToken) {
    const session = await sharedSessionService.validateSession(sharedToken);
    if (session?.userEmail) return session.userEmail;
  }
  if (user?.email) return user.email;
  return 'Unknown';
}

interface FcCheckRow { fc_order_id: string | null }

/** Check if any of the given order product IDs belong to an FC order. */
export async function hasFcOrder(orderProductIds: number[]): Promise<boolean> {
  const rows = await prisma.$queryRaw<FcCheckRow[]>(Prisma.sql`
    SELECT o.fc_order_id FROM orders o
    INNER JOIN orders_products op ON o.orders_id = op.orders_id
    WHERE o.fc_order_id IS NOT NULL AND o.fc_order_id != ''
      AND op.orders_products_id IN (${Prisma.join(orderProductIds)})
  `);
  return rows.length > 0;
}
