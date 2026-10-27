/**
 * Inter-admin order query service — query templates, query submission, and history.
 * Requirements: REQ-08-011, REQ-08-013
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { emailService } from '../../../lib/email';
import { createLogger } from '../../../lib/logger';
import { escapeHtml } from '../../../lib/utils/string-utils';
import { isSafeToSend } from './notifications.email';
import type {
  QueryTemplateRow,
  OrderQueryRow,
  CreateQueryParams,
  AdminRow,
} from './notifications.types';

const logger = createLogger('orders-queries');

// ---------------------------------------------------------------------------
// REQ-08-011: Query Template Lookup
// ---------------------------------------------------------------------------

/**
 * REQ-08-011: Fetch all query templates.
 * Templates are stored in order_related_query with template_query=1.
 */
export async function getQueryTemplates(): Promise<QueryTemplateRow[]> {
  return prisma.$queryRaw<QueryTemplateRow[]>(
    Prisma.sql`SELECT query_id, query_content, template_name
               FROM order_related_query
               WHERE template_query = 1
               ORDER BY template_name ASC`
  );
}

// ---------------------------------------------------------------------------
// REQ-08-013: Inter-Admin Order Query
// ---------------------------------------------------------------------------

/**
 * REQ-08-013: List admin users for query recipient dropdown.
 */
export async function getAdminUsers(): Promise<AdminRow[]> {
  return prisma.$queryRaw<AdminRow[]>(
    Prisma.sql`SELECT admin_id, admin_name, admin_email
               FROM admin
               ORDER BY admin_name ASC`
  );
}

/**
 * Resolve a single admin by ID — used to convert admin_id from dropdown to admin_name for storage.
 * PHP: get_all_admin($admins) with WHERE admin_id IN (...)
 */
export async function resolveAdminById(adminId: number): Promise<AdminRow | null> {
  const rows = await prisma.$queryRaw<AdminRow[]>(
    Prisma.sql`SELECT admin_id, admin_name, admin_email
               FROM admin
               WHERE admin_id = ${adminId}
               LIMIT 1`
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * REQ-08-013: Submit an inter-admin query about an order.
 * Inserts into order_related_query and sends email notification.
 *
 * PHP: orders.php lines 2548-2570 — stores resolved admin_name in query_to,
 * sends email to resolved admin_email.
 */
export async function createOrderQuery(
  params: CreateQueryParams
): Promise<{ queryId: number; emailSent: boolean }> {
  const { orderId, queryFrom, queryTo, queryToEmail, queryContent, isTemplate, templateName } = params;

  // INSERT query record (REQ-08-013) — store admin_name, not admin_id
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO order_related_query
               (query_from, query_to, query_content, template_query,
                template_name, order_id, date_added)
               VALUES (${queryFrom}, ${queryTo}, ${queryContent},
                       ${isTemplate ? 1 : 0}, ${templateName},
                       ${orderId}, NOW())`
  );

  // Fetch the inserted ID
  const idRows = await prisma.$queryRaw<{ query_id: number }[]>(
    Prisma.sql`SELECT LAST_INSERT_ID() AS query_id`
  );
  const queryId = idRows.length > 0 ? Number(idRows[0].query_id) : 0;

  // Send email notification to the recipient admin (REQ-08-013)
  let emailSent = false;
  try {
    if (queryToEmail) {
      const targetEmail = queryToEmail.trim();

      // SAFETY: Only send to @velsof.com
      if (isSafeToSend(targetEmail)) {
        const safeFrom = escapeHtml(queryFrom);
        const safeContent = escapeHtml(queryContent).replace(/\n/g, '<br>');
        await emailService.sendEmail({
          to: targetEmail,
          subject: `Order Query - Order #${orderId}`,
          text: `You have a new query from ${queryFrom} regarding Order #${orderId}:\n\n${queryContent}`,
          html: `<p>You have a new query from <strong>${safeFrom}</strong> regarding <strong>Order #${orderId}</strong>:</p><blockquote style="border-left: 3px solid #ccc; padding-left: 10px; margin: 10px 0;">${safeContent}</blockquote>`,
        });
        emailSent = true;
      } else {
        logger.info({ targetEmail }, 'Query email NOT sent — not @velsof.com');
      }
    }
  } catch (error) {
    // REQ-08-013: Email failure doesn't prevent query storage
    logger.error(
      { error: error instanceof Error ? error.message : 'Unknown', orderId, queryTo },
      'Failed to send query notification email'
    );
  }

  logger.info({ queryId, orderId, queryFrom, queryTo, emailSent }, 'Order query created');

  return { queryId, emailSent };
}

/**
 * REQ-08-013: Fetch query history for a specific order.
 */
export async function getOrderQueries(orderId: number): Promise<OrderQueryRow[]> {
  return prisma.$queryRaw<OrderQueryRow[]>(
    Prisma.sql`SELECT query_id, query_from, query_to, query_content,
                      template_query, template_name, order_id,
                      NULLIF(date_added, '0000-00-00 00:00:00') AS date_added
               FROM order_related_query
               WHERE order_id = ${orderId}
                 AND template_query = 0
               ORDER BY date_added DESC`
  );
}
