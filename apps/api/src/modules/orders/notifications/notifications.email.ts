/**
 * Email dispatch utilities — HTML builder, queue operations, direct sending,
 * safety checks, and email queue processor.
 * Split from notifications.service.ts to respect 500-line limit.
 *
 * Requirements: REQ-08-006, REQ-08-008, REQ-08-009
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { emailService } from '../../../lib/email';
import { config } from '../../../config';
import { createLogger } from '../../../lib/logger';
import type { EmailQueueInsert, OrdersEmailRow } from './notifications.types';

const logger = createLogger('orders-email');

// ---------------------------------------------------------------------------
// SAFETY: Email address filter
// ---------------------------------------------------------------------------

/**
 * SAFETY FILTER: Only allow sending to @velsof.com email addresses.
 * All other addresses may belong to real customers and must not receive
 * test/development emails.
 */
export function isSafeToSend(email: string): boolean {
  return email.toLowerCase().trim().endsWith('@velsof.com');
}

// ---------------------------------------------------------------------------
// REQ-08-009: Email Header Injection Check
// ---------------------------------------------------------------------------

/**
 * REQ-08-009: Check for header injection characters.
 * Returns true if injection detected (email should NOT be sent).
 */
export function hasHeaderInjection(...fields: string[]): boolean {
  return fields.some((f) => f.includes('\r') || f.includes('\n'));
}

// ---------------------------------------------------------------------------
// REQ-08-003: Amazon Email Redirect
// ---------------------------------------------------------------------------

/**
 * REQ-08-003: Check if email address belongs to Amazon marketplace.
 * Amazon prohibits merchants from emailing customers directly.
 */
export function isAmazonEmail(email: string): boolean {
  return email.toLowerCase().includes('marketplace.amazon');
}

// ---------------------------------------------------------------------------
// Direct email sending (REQ-08-009)
// ---------------------------------------------------------------------------

/**
 * REQ-08-009: Send email directly via nodemailer (synchronous send).
 * Ported from PHP zen_mail() for admin-triggered status updates.
 */
export async function sendEmailDirect(params: {
  toAddress: string;
  subject: string;
  textBody: string;
  fromAddress: string;
  module: string;
  htmlVariables: Record<string, string>;
}): Promise<void> {
  const { toAddress, subject, textBody, fromAddress, module, htmlVariables } = params;

  const htmlBody = buildStatusEmailHtml(htmlVariables);

  try {
    await emailService.sendEmail({
      to: toAddress,
      subject,
      text: textBody,
      html: htmlBody,
      replyTo: fromAddress,
    });
    logger.info({ to: toAddress, subject, module }, 'Status email sent successfully');
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : 'Unknown', to: toAddress, module },
      'Failed to send status email'
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// REQ-08-006: Email Queue Insert
// ---------------------------------------------------------------------------

/**
 * REQ-08-006: Insert email into orders_email table for async processing.
 * The existing PHP cron (header_php.php) will pick it up.
 */
export async function queueEmailToOrdersTable(params: EmailQueueInsert): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO orders_email
               (order_id, to_name, to_address, email_subject, email_text,
                from_email_name, from_email_address, module, data, attach,
                email_sent_status, date_created)
               VALUES (${params.orderId}, ${params.toName}, ${params.toAddress},
                       ${params.subject}, ${params.textBody},
                       ${params.fromName}, ${params.fromAddress},
                       ${params.module}, ${params.data}, ${params.attach},
                       '0', NOW())`
  );
}

// ---------------------------------------------------------------------------
// REQ-08-008: Email Queue Processor
// ---------------------------------------------------------------------------

/**
 * REQ-08-008: Process pending emails from orders_email table.
 * Fetches all unsent emails, sends each via nodemailer, updates status.
 */
export async function processEmailQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ oeId: number; error: string }>;
}> {
  const pendingEmails = await prisma.$queryRaw<OrdersEmailRow[]>(
    Prisma.sql`SELECT oe_id, order_id, to_name, to_address,
                      email_subject, email_text, from_email_name,
                      from_email_address, module, data, attach
               FROM orders_email
               WHERE email_sent_status = '0'
                 AND (error_message IS NULL OR error_message = '')
               ORDER BY oe_id ASC
               LIMIT 100`
  );

  if (pendingEmails.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, errors: [] };
  }

  let succeeded = 0;
  const errors: Array<{ oeId: number; error: string }> = [];

  for (const email of pendingEmails) {
    try {
      if (!isSafeToSend(email.to_address)) {
        logger.info(
          { oeId: email.oe_id, toAddress: email.to_address },
          'Queue email skipped — not @velsof.com (safety filter)'
        );
        await prisma.$executeRaw(
          Prisma.sql`UPDATE orders_email SET email_sent_status = '1'
                     WHERE oe_id = ${email.oe_id}`
        );
        succeeded++;
        continue;
      }

      let htmlVariables: Record<string, string> = {};
      if (email.data) {
        try {
          htmlVariables = JSON.parse(email.data);
        } catch {
          const errMsg = 'JSON decode error for data column';
          logger.error({ oeId: email.oe_id }, errMsg);
          errors.push({ oeId: email.oe_id, error: errMsg });
          continue;
        }
      }

      const htmlBody = buildStatusEmailHtml(htmlVariables);

      await emailService.sendEmail({
        to: email.to_address.trim(),
        subject: email.email_subject,
        text: email.email_text,
        html: htmlBody,
        replyTo: email.from_email_address,
      });

      await prisma.$executeRaw(
        Prisma.sql`UPDATE orders_email SET email_sent_status = '1'
                   WHERE oe_id = ${email.oe_id}`
      );
      succeeded++;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ oeId: email.oe_id, error: errMsg });
      logger.error({ oeId: email.oe_id, error: errMsg }, 'Failed to send queued email');
    }
  }

  if (errors.length > 0) {
    await Promise.all(errors.map((err) =>
      prisma.$executeRaw(
        Prisma.sql`UPDATE orders_email SET error_message = ${err.error}
                   WHERE oe_id = ${err.oeId}`
      )
    ));

    // Notify dev team using no_order_mail module (matches PHP zen_mail() behaviour:
    // module = 'no_order_mail', from = PROMOTION_EMAIL_ID, to = TEAM_LEAD_EMAIL_ADDRESS)
    try {
      const devTeamEmail = config.DEVELOPMENT_TEAM_EMAIL || 'ukss-team@velsof.com';
      const errorSummary = errors.map((e) => `oe_id=${e.oeId}: ${e.error}`).join('\n');
      await queueEmailToOrdersTable({
        orderId: null,
        toName: 'Development Team',
        toAddress: devTeamEmail,
        subject: 'Email Queue Processing Errors',
        textBody: `${errors.length} email(s) failed to send:\n\n${errorSummary}`,
        fromName: 'UKSoccershop',
        fromAddress: config.EMAIL_FROM,
        module: 'no_order_mail',
        data: '',
        attach: '',
      });
    } catch (notifyError) {
      logger.error({ error: notifyError }, 'Failed to send error notification');
    }
  }

  return { processed: pendingEmails.length, succeeded, failed: errors.length, errors };
}

// ---------------------------------------------------------------------------
// HTML Email Builder
// ---------------------------------------------------------------------------

/**
 * Build a simple HTML email from template variables.
 * Matches the structure produced by PHP zen_build_html_email_from_template().
 */
export function buildStatusEmailHtml(vars: Record<string, string>): string {
  const storeName = vars.STORE_NAME || 'UKSoccershop';
  const storeEmail = vars.STORE_EMAIL || 'auto-confirm@uksoccershop.com';
  const customerName = vars.EMAIL_CUSTOMERS_NAME || 'Customer';
  const orderNumber = vars.EMAIL_TEXT_ORDER_NUMBER || '';
  const dateOrdered = vars.EMAIL_TEXT_DATE_ORDERED || '';
  const statusComments = vars.EMAIL_TEXT_STATUS_COMMENTS || '';
  const statusUpdated = vars.EMAIL_TEXT_STATUS_UPDATED || '';
  const statusLabel = vars.EMAIL_TEXT_STATUS_LABEL || '';
  const statusReply = vars.EMAIL_TEXT_STATUS_PLEASE_REPLY || '';
  const disclaimer = vars.EMAIL_DISCLAIMER || '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #2c3e50; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 20px;">${storeName}</h1>
  </div>
  <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
    <p>Dear ${customerName},</p>
    <p><strong>${orderNumber}</strong></p>
    ${dateOrdered ? `<p>${dateOrdered}</p>` : ''}
    ${statusComments ? `<div style="background: #fff; padding: 10px; border-left: 3px solid #3498db; margin: 15px 0;">${statusComments}</div>` : ''}
    <p>${statusUpdated} <strong>${statusLabel}</strong></p>
    <p>${statusReply}</p>
    <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
    <p style="font-size: 11px; color: #999;">${disclaimer}</p>
    <p style="font-size: 11px; color: #999;">Copyright &copy; ${new Date().getFullYear()} ${storeName}. Contact: ${storeEmail}</p>
  </div>
</body>
</html>`;
}
