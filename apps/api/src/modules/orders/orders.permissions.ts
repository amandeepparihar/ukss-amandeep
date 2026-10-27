/**
 * Orders module permission service — feature-level permission checks.
 * Requirements: REQ-01-003, REQ-01-004
 *
 * Checks permission_to_admin table for refund (id=1) and reject (id=2) permissions.
 * Admin ID 10 has hardcoded full permissions (legacy superuser override).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { PERMISSION_IDS, SUPERUSER_ADMIN_ID } from './orders.constants';

export interface OrderFeaturePermissions {
  refundPermission: boolean;
  rejectPermission: boolean;
}

interface PermissionRow {
  permission_id: number;
}

/**
 * REQ-01-003 + REQ-01-004: Load feature-level permissions for the given admin.
 *
 * - Admin ID 10 gets automatic full permissions (REQ-01-004).
 * - Otherwise query permission_to_admin for refund (1) and reject (2).
 * - On query failure, default both to false (REQ-01-003 error handling).
 */
export async function getOrderFeaturePermissions(
  adminId: number
): Promise<OrderFeaturePermissions> {
  // REQ-01-004: Superuser override — hardcoded grant before any DB query
  // Uses == comparison to match original PHP string comparison against '10'
  const isSuperuser = adminId == SUPERUSER_ADMIN_ID;

  let refundPermission = isSuperuser;
  let rejectPermission = isSuperuser;

  try {
    // REQ-01-003: Query runs even for superuser but cannot revoke already-granted permissions
    const rows = await prisma.$queryRaw<PermissionRow[]>(
      Prisma.sql`SELECT permission_id FROM permission_to_admin WHERE admin_id = ${adminId}`
    );

    for (const row of rows) {
      if (row.permission_id === PERMISSION_IDS.REFUND) {
        refundPermission = true;
      }
      if (row.permission_id === PERMISSION_IDS.REJECT) {
        rejectPermission = true;
      }
    }
  } catch {
    // REQ-01-003: On query failure, default both to false (deny)
    // Superuser override already set above, so only non-superusers lose permission
    if (!isSuperuser) {
      refundPermission = false;
      rejectPermission = false;
    }
  }

  return { refundPermission, rejectPermission };
}
