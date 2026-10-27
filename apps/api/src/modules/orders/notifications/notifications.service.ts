/**
 * Notifications service — store brand resolution, status update email dispatch,
 * Amazon redirect, Fruugo confirmation tracking.
 *
 * Ports PHP zen_mail() and related email logic from orders.php.
 * Requirements: REQ-08-001 through REQ-08-005, REQ-08-009, REQ-08-012
 *
 * Lower-level email utilities (queue, HTML builder, direct send) are in
 * notifications.email.ts to keep this file under 500 lines.
 *
 * SAFETY: Only sends emails to @velsof.com addresses. All other addresses are
 * logged but NOT sent — they may belong to real customers.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { config } from '../../../config';
import { createLogger } from '../../../lib/logger';
import type {
  StoreBrand,
  StatusEmailParams,
} from './notifications.types';
import {
  isSafeToSend,
  hasHeaderInjection,
  isAmazonEmail,
  sendEmailDirect,
  queueEmailToOrdersTable,
} from './notifications.email';

// Re-export processEmailQueue so routes can import from either file
export { processEmailQueue } from './notifications.email';

const logger = createLogger('orders-notifications');

// Default UKSS store config used when store_id not found (REQ-08-001 error handling)
const DEFAULT_STORE: StoreBrand = {
  storeId: 0,
  storeName: 'UKSoccershop',
  storeEmail: 'auto-confirm@uksoccershop.com',
  storeUrl: 'https://www.uksoccershop.com/',
  storeLogo: null,
};

// Email address for Amazon redirect (REQ-08-003)
const DEVELOPMENT_TEAM_EMAIL = config.DEVELOPMENT_TEAM_EMAIL || 'ukss-team@velsof.com';

// Customer-facing status name overrides (REQ-08-012, PHP lines 7375-7383)
const STATUS_NAME_OVERRIDES: Record<string, string> = {
  'Awaiting Printing': 'Printing',
  'At Printers': 'Printed',
  'Awaiting Delivery': 'Stock Transfer',
  'Pre-Ordered': 'Awaiting Dispatch',
};

// ---------------------------------------------------------------------------
// REQ-08-001: Store Brand Resolution
// ---------------------------------------------------------------------------

/**
 * REQ-08-001: Resolve store brand config from order_site value.
 * Fetches store_name, store_email from store_management,
 * store_logo from store_customization.
 */
export async function resolveStoreBrand(orderSite: number): Promise<StoreBrand> {
  if (orderSite === 0 || orderSite === 89) {
    return DEFAULT_STORE;
  }

  const rows = await prisma.$queryRaw<{
    store_id: number;
    store_name: string;
    store_email: string;
    store_url: string;
    store_logo: string | null;
  }[]>(
    Prisma.sql`SELECT sm.store_id, sm.store_name, sm.store_email, sm.store_url,
                      sc.store_logo
               FROM store_management sm
               LEFT JOIN store_customization sc ON sc.store_id = sm.store_id
               WHERE sm.store_id = ${orderSite}
               LIMIT 1`
  );

  if (rows.length === 0) {
    logger.warn({ orderSite }, 'Store not found, falling back to UKSS defaults');
    return DEFAULT_STORE;
  }

  const store = rows[0];
  return {
    storeId: store.store_id,
    storeName: store.store_name?.replace(/[\r\n]/g, '') || DEFAULT_STORE.storeName,
    storeEmail: store.store_email?.replace(/[\r\n]/g, '') || DEFAULT_STORE.storeEmail,
    storeUrl: store.store_url || DEFAULT_STORE.storeUrl,
    storeLogo: store.store_logo,
  };
}

// ---------------------------------------------------------------------------
// REQ-08-005: Email From Address Resolution
// ---------------------------------------------------------------------------

/**
 * REQ-08-005: Determine the from-address for status update emails.
 * PHP uses the global EMAIL_FROM constant for all paths (#300, #310).
 * Amazon orders use a separate auto-confirm address (PHP lines 7441-7449).
 */
function resolveFromAddress(
  useOriginalEmail: boolean,
  isAmazonOrder: boolean = false
): string {
  if (useOriginalEmail) {
    return config.EMAIL_FROM;
  }
  // For Amazon orders, use auto-confirm address (PHP lines 7441-7449)
  if (isAmazonOrder) {
    return 'auto-confirm@uksoccershop.com';
  }
  // PHP uses EMAIL_FROM for all store emails (not per-store email)
  return config.EMAIL_FROM;
}

// ---------------------------------------------------------------------------
// Email module resolution per store (PHP lines 7462-7525)
// ---------------------------------------------------------------------------

/**
 * Resolve the email template module name based on order_site.
 * PHP uses store-specific modules for Teamzo (99) and Airosportswear (111).
 */
function resolveEmailModule(orderSite: number): string {
  if (orderSite === 0 || orderSite === 89) return 'order_status';
  if (orderSite === 99) return 'order_status_teamzo';
  if (orderSite === 111) return 'order_status_airo';
  return 'order_status_store';
}

// ---------------------------------------------------------------------------
// REQ-08-012: Admin-Triggered Status Update Email
// ---------------------------------------------------------------------------

/**
 * REQ-08-012: Send status update email to customer after admin changes status.
 * This is the main notification entry point called from the status module.
 *
 * Returns true if email was sent/queued successfully.
 */
export async function sendStatusUpdateEmail(
  params: StatusEmailParams
): Promise<boolean> {
  const {
    orderId, newStatus, customerName, customerEmail, orderSite,
    statusName, datePurchased, comments, notifyComments,
    useOriginalEmail, sendMessageAutomatically, fruugoOrdersId,
    amazonOrdersId,
  } = params;

  // Apply customer-facing status name overrides (PHP lines 7375-7383)
  const displayStatusName = STATUS_NAME_OVERRIDES[statusName] || statusName;

  // Resolve store brand (REQ-08-001)
  const storeBrand = await resolveStoreBrand(orderSite);
  const isAmazonOrder = isAmazonEmail(customerEmail);
  const fromAddress = resolveFromAddress(useOriginalEmail, isAmazonOrder);
  const fromName = storeBrand.storeName;

  // Build email subject (REQ-08-012)
  const subject = `Order Update - #${orderId}`;

  // Build notification comment text (REQ-08-012: notifyComments flag)
  const commentText = notifyComments && comments.trim()
    ? `Comments: ${comments}\n\n`
    : '';

  // Build plain text body (PHP lines 7387-7395)
  const textBody = [
    storeBrand.storeName,
    '------------------------------------------------------',
    `Order Number: #${orderId}`,
    '',
    datePurchased ? `Date Ordered: ${datePurchased}` : '',
    '',
    commentText,
    `Your order has been updated to the following status: ${displayStatusName}`,
    '',
    'Please reply to this email if you have any questions.',
  ].filter(Boolean).join('\n');

  // Build HTML template variables (PHP lines 7397-7406)
  const htmlVariables: Record<string, string> = {
    EMAIL_CUSTOMERS_NAME: customerName,
    EMAIL_TEXT_ORDER_NUMBER: `Order Number: #${orderId}`,
    EMAIL_TEXT_DATE_ORDERED: datePurchased ? `Date Ordered: ${datePurchased}` : '',
    EMAIL_TEXT_STATUS_COMMENTS: commentText ? commentText.replace(/\n/g, '<br>') : '',
    EMAIL_TEXT_STATUS_UPDATED: 'Your order has been updated to the following status:',
    EMAIL_TEXT_STATUS_LABEL: displayStatusName,
    EMAIL_TEXT_STATUS_PLEASE_REPLY: 'Please reply to this email if you have any questions.',
    STORE_EMAIL: storeBrand.storeEmail,
    STORE_NAME: storeBrand.storeName,
    STORE_URL: storeBrand.storeUrl.replace('http://', ''),
  };

  if (storeBrand.storeLogo) {
    htmlVariables.STORE_LOGO = storeBrand.storeLogo;
  }

  // Store-specific disclaimer (PHP lines 7426)
  htmlVariables.EMAIL_DISCLAIMER = `This email address was given to us by you or by one of our customers. If you feel that you have received this email in error, please send an email to ${storeBrand.storeEmail}`;

  // Determine email module based on store (PHP lines 7462-7525)
  const module = resolveEmailModule(orderSite);

  // Resolve target email address
  let targetEmail = customerEmail.trim();
  let targetSubject = subject;

  // REQ-08-003: Amazon redirect
  if (isAmazonEmail(targetEmail)) {
    logger.info({ orderId, originalEmail: targetEmail }, 'Amazon email redirected to dev team');
    targetEmail = DEVELOPMENT_TEAM_EMAIL;
    targetSubject = `AMAZON ${subject}`;
  }

  // REQ-08-009: Header injection check
  if (hasHeaderInjection(targetEmail, fromAddress, fromName, customerName, targetSubject)) {
    logger.error({ orderId }, 'Email header injection detected, email NOT sent');
    return false;
  }

  // SAFETY: Only send to @velsof.com addresses
  if (!isSafeToSend(targetEmail)) {
    logger.info(
      { orderId, targetEmail, module },
      'Email NOT sent — recipient is not @velsof.com (safety filter)'
    );
    return false;
  }

  // REQ-08-012: sendMessageAutomatically -> set pending_order_cron flag for cron
  // PHP: send_message_automatically only sets pending_order_cron = 1 when status is Pending (1).
  // For any other status, pending_order_cron is reset to 0.
  // The actual email is sent later by a separate pending-order cron -- NOT queued directly.
  if (sendMessageAutomatically) {
    const pendingCronVal = (newStatus === 1) ? '1' : '0';
    await prisma.$executeRaw(
      Prisma.sql`UPDATE orders SET pending_order_cron = ${pendingCronVal} WHERE orders_id = ${orderId}`
    );
    logger.info({ orderId, pendingCronVal }, 'Updated pending_order_cron flag');
  } else {
    // Send immediately via nodemailer
    await sendEmailDirect({
      toAddress: targetEmail,
      subject: targetSubject,
      textBody,
      fromAddress,
      module,
      htmlVariables,
    });
  }

  // REQ-08-004: Fruugo confirmation tracking
  if (fruugoOrdersId) {
    await updateFruugoConfirmation(fruugoOrdersId);
  }

  // Admin CC email (PHP lines 7531-7537, module: order_status_extra)
  // Sends a copy of the status update email to a configured admin address.
  // Skipped for Amazon orders (amazon_orders_id is non-empty).
  await sendAdminCcEmail({
    orderId,
    amazonOrdersId,
    subject,
    textBody,
    fromName,
    htmlVariables,
  });

  return true;
}

// ---------------------------------------------------------------------------
// Admin CC Email (PHP lines 7531-7537)
// ---------------------------------------------------------------------------

/**
 * Admin CC email -- PHP lines 7531-7537.
 * Sends an admin copy of the status update email using module order_status_extra.
 * Conditions:
 *   1. ADMIN_STATUS_CC_ENABLED is true (env var)
 *   2. ADMIN_STATUS_CC_EMAIL is configured (env var)
 *   3. Order is NOT an Amazon order (amazon_orders_id must be empty/null)
 *
 * The email is queued to orders_email for the existing PHP cron to pick up,
 * matching the PHP zen_mail() behavior.
 */
async function sendAdminCcEmail(params: {
  orderId: number;
  amazonOrdersId: string | null;
  subject: string;
  textBody: string;
  fromName: string;
  htmlVariables: Record<string, string>;
}): Promise<void> {
  const { orderId, amazonOrdersId, subject, textBody, fromName, htmlVariables } = params;

  // Check config: admin CC must be enabled and address must be set
  if (!config.ADMIN_STATUS_CC_ENABLED || !config.ADMIN_STATUS_CC_EMAIL) {
    return;
  }

  // Skip Amazon orders (PHP: amazon_orders_id must be NULL)
  if (amazonOrdersId) {
    logger.debug({ orderId }, 'Admin CC skipped -- Amazon order');
    return;
  }

  const adminCcAddress = config.ADMIN_STATUS_CC_EMAIL;
  const subjectPrefix = config.ADMIN_STATUS_CC_SUBJECT_PREFIX;
  const adminCcSubject = subjectPrefix + ' Order Update #' + String(orderId);

  // SAFETY: Only send to @velsof.com addresses
  if (!isSafeToSend(adminCcAddress)) {
    logger.info(
      { orderId, adminCcAddress },
      'Admin CC email NOT sent -- recipient is not @velsof.com (safety filter)',
    );
    return;
  }

  try {
    await queueEmailToOrdersTable({
      orderId,
      toName: '',
      toAddress: adminCcAddress,
      subject: adminCcSubject,
      textBody,
      fromName,
      fromAddress: config.EMAIL_FROM,
      module: 'order_status_extra',
      data: JSON.stringify(htmlVariables),
      attach: '',
    });
    logger.info({ orderId, adminCcAddress }, 'Admin CC email queued (order_status_extra)');
  } catch (error) {
    // Admin CC failure must not block the status update
    logger.warn(
      { orderId, error: error instanceof Error ? error.message : 'Unknown' },
      'Failed to queue admin CC email',
    );
  }
}

// ---------------------------------------------------------------------------
// REQ-08-004: Fruugo Email Event Logging
// ---------------------------------------------------------------------------

/**
 * REQ-08-004: Update ukss_confirmation_status in fruugo_orders
 * when a Fruugo order receives a customer notification.
 */
async function updateFruugoConfirmation(fruugoOrdersId: string): Promise<void> {
  try {
    await prisma.$executeRaw(
      Prisma.sql`UPDATE fruugo_orders
                 SET ukss_confirmation_status = 1
                 WHERE fruugo_order_id = ${fruugoOrdersId}`
    );
    logger.info({ fruugoOrdersId }, 'Fruugo confirmation status updated');
  } catch (error) {
    // REQ-08-004: Log warning but don't block the status update
    logger.warn(
      { fruugoOrdersId, error: error instanceof Error ? error.message : 'Unknown' },
      'Failed to update Fruugo confirmation status'
    );
  }
}
