/**
 * Status management service — main status update handler with business rules,
 * status history, predefined templates, and touchpoint management.
 *
 * Requirements: REQ-07-001 through REQ-07-025, REQ-08-012
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { STATUS } from '../orders.constants';
import {
  zenRestockInventory,
  zenProcessInventory,
  committedQuantityDecrease,
  unpickOrderProduct,
  disableHeroShirtProducts,
} from './status.inventory';
import {
  insertPreOrderedOrders,
  calculateAndSetShipByDate,
  updateOrderProcessStatus,
  updateBoxFields,
} from './status.helpers';
import {
  propagateMarketplaceStatus,
  isFruugoConfirmationBlocked,
  isPreOrderStatus,
} from './status.marketplace';
import { sendStatusUpdateEmail } from '../notifications/notifications.service';
import { getOrderStatuses } from '../orders.service';
import { toIso } from '../orders.helpers';
import type {
  OrderCurrentState,
  StatusUpdateParams,
  StatusUpdateResult,
  StatusHistoryRow,
  PredefinedTemplateRow,
} from './status.types';

const logger = createLogger('orders-status');

// ---------------------------------------------------------------------------
// REQ-07-001: Main Status Update Handler
// ---------------------------------------------------------------------------

/**
 * REQ-07-001: Process order status change with all business rules.
 * Executes within a single database transaction (CX-001).
 * Marketplace propagation runs after commit (REQ-07-013).
 */
export async function updateOrderStatus(
  params: StatusUpdateParams
): Promise<StatusUpdateResult> {
  const {
    orderId, newStatus, previousOrderStatus, comments,
    notify, notifyComments, privateComment, useOriginalEmail,
    sendMessageAutomatically, pageForLog, adminName,
  } = params;

  // --- Fetch current order state ---
  const stateRows = await prisma.$queryRaw<OrderCurrentState[]>(
    Prisma.sql`SELECT orders_id, orders_status, customers_id,
                      customers_name, customers_email_address, order_site,
                      NULLIF(date_purchased, '0000-00-00 00:00:00') AS date_purchased,
                      NULLIF(ship_by_date, '0000-00-00 00:00:00') AS ship_by_date,
                      CAST(COALESCE(fruugo_orders_id, '') AS CHAR) AS fruugo_orders_id,
                      COALESCE(gosport_order_id, '') AS gosport_order_id,
                      COALESCE(catch_order_id, '') AS catch_order_id,
                      COALESCE(decathlon_order_id, '') AS decathlon_order_id,
                      COALESCE(ebay_orders_id, '') AS ebay_orders_id,
                      COALESCE(tesco_customer_order_id, '') AS tesco_customer_order_id,
                      COALESCE(fc_order_status, '') AS fc_order_status,
                      CAST(COALESCE(amazon_orders_id, '') AS CHAR) AS amazon_orders_id
               FROM orders WHERE orders_id = ${orderId}`
  );

  if (stateRows.length === 0) {
    return { success: false, message: 'Order not found', statusChanged: false, historyInserted: false, marketplaceErrors: [] };
  }

  const state = stateRows[0];

  // --- Optimistic concurrency check (REQ-07-002) ---
  if (state.orders_status !== previousOrderStatus) {
    return {
      success: false,
      message: 'Status has been changed by another admin. Please refresh and try again.',
      statusChanged: false, historyInserted: false, marketplaceErrors: [],
    };
  }

  // --- No-op check (REQ-07-001) ---
  const statusChanged = newStatus !== state.orders_status;
  const hasComments = comments.trim().length > 0;

  if (!statusChanged && !hasComments) {
    return { success: true, message: 'No changes to apply', statusChanged: false, historyInserted: false, marketplaceErrors: [] };
  }

  // --- Fruugo confirmation check (PHP lines 6732-6760) ---
  if (statusChanged && state.fruugo_orders_id) {
    const blocked = await isFruugoConfirmationBlocked(prisma, state.fruugo_orders_id);
    if (blocked) {
      return {
        success: false,
        message: 'Please confirm the Fruugo order first before changing status.',
        statusChanged: false, historyInserted: false, marketplaceErrors: [],
      };
    }
  }

  // --- Execute transactional operations (CX-001) ---
  await prisma.$transaction(async (tx) => {
    if (statusChanged) {
      // 1. Ship-by-date calculation (REQ-07-015) — before status update
      await calculateAndSetShipByDate(tx, orderId, newStatus, state.ship_by_date);

      // 2. Update order status + last_modified (REQ-07-001)
      //    This mirrors PHP's update_order_status() function which also handles:
      //    - committed_quantity decrease on shipped (status 5)
      //    - unpick on cancel/reject (status 18, 112)
      await tx.$executeRaw(
        Prisma.sql`UPDATE orders SET orders_status = ${newStatus}, last_modified = NOW()
                   WHERE orders_id = ${orderId}`
      );

      // 3. Shipped (status 5): Committed quantity release (REQ-07-005)
      // PHP: committed_quantity() skips when fc_order_status = 'DESPATCHED'
      if (newStatus === STATUS.SHIPPED) {
        await committedQuantityDecrease(tx, orderId, state.fc_order_status);
      }

      // 4. Cancel/Reject: Unpick (REQ-07-008, REQ-07-011)
      if (newStatus === STATUS.CANCELLED || newStatus === STATUS.REJECTED) {
        await unpickOrderProduct(tx, orderId);
      }

      // 5. Box field updates (PHP lines 7274-7329)
      await updateBoxFields(tx, orderId, newStatus, previousOrderStatus);

      // 6. Status 112 (Rejected): Restock inventory (REQ-07-011)
      // NOTE: Spec REQ-07-008 says cancel (18) also restocks, but PHP orders.php:7291
      // only calls zen_restock_inventory for status 112. This port matches PHP behavior.
      if (newStatus === STATUS.REJECTED) {
        await zenRestockInventory(tx, orderId);
      }

      // 7. Moving FROM status 112 to another: Re-deduct inventory (REQ-07-004)
      // NOTE: Spec REQ-07-004 incorrectly said zen_process_inventory('restock') fires on status 2.
      // PHP orders.php:7302 calls it when previousStatus == 112 with arg 'off' (deduct). Matches PHP.
      if (previousOrderStatus === STATUS.REJECTED && newStatus !== STATUS.REJECTED) {
        await zenProcessInventory(tx, orderId);
      }

      // 8. Status 16 (Being Picked): Hero shirt disabling (REQ-07-007)
      if (newStatus === STATUS.BEING_PICKED) {
        await disableHeroShirtProducts(tx, orderId);
      }

      // 9. Pre-ordered orders pipeline (REQ-07-006, PHP lines 7236-7272)
      if (isPreOrderStatus(newStatus)) {
        await insertPreOrderedOrders(tx, orderId);
      }

      // 10. Order process status update (REQ-07-020)
      await updateOrderProcessStatus(tx, orderId, newStatus);
    }

    // 11. REQ-07-019: Update pending_order_cron (PHP orders.php lines 6888-6913)
    // This runs on every status form submission (not only when status changes), matching PHP.
    // pending_order_cron = 1 ONLY when sendMessageAutomatically is true AND new status is 1
    // (Pending). PHP hard-blocks it for all other statuses: if ($status != 1) { $val = 0; }
    const pendingOrderCronVal = (sendMessageAutomatically && newStatus === STATUS.PENDING) ? 1 : 0;
    await tx.$executeRaw(
      Prisma.sql`UPDATE orders SET pending_order_cron = ${pendingOrderCronVal}, last_modified = NOW()
                 WHERE orders_id = ${orderId}`
    );

    // 12. Status history insert (REQ-07-017) — always if status changed or comment provided
    const customerNotified = privateComment ? 0 : (notify ? 1 : 0);
    const privateFlag = privateComment ? 'Yes' : 'No';

    await tx.$executeRaw(
      Prisma.sql`INSERT INTO orders_status_history
                 (orders_id, orders_status_id, date_added, customer_notified,
                  comments, comment_by, comment_private, status_change_from)
                 VALUES (${orderId}, ${statusChanged ? newStatus : state.orders_status},
                         NOW(), ${customerNotified}, ${comments},
                         ${adminName}, ${privateFlag}, ${pageForLog})`
    );

    // 13. Status 112: Update pre_processed_order_products (PHP lines 6997-7003)
    if (newStatus === STATUS.REJECTED) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE pre_processed_order_products
                   SET status = 3, date_modified = NOW()
                   WHERE orders_id = ${orderId}`
      );
    }
  });

  // --- After-commit: Marketplace propagation (REQ-07-013) ---
  let marketplaceErrors: string[] = [];
  if (statusChanged) {
    marketplaceErrors = await propagateMarketplaceStatus(
      prisma, orderId, newStatus,
      {
        fruugoOrdersId: state.fruugo_orders_id || null,
        gosportOrderId: state.gosport_order_id || null,
        catchOrderId: state.catch_order_id || null,
        decathlonOrderId: state.decathlon_order_id || null,
        ebayOrdersId: state.ebay_orders_id || null,
        tescoCustomerOrderId: state.tesco_customer_order_id || null,
      }
    );
  }

  // --- After-commit: Customer notification email (REQ-08-012) ---
  let emailSent = false;
  if (notify && !privateComment) {
    try {
      // Resolve status name for the email
      const statuses = await getOrderStatuses(1);
      const statusEntry = statuses.find((s) => s.id === newStatus);
      const statusName = statusEntry?.name || `Status ${newStatus}`;

      const datePurchasedStr = toIso(state.date_purchased);

      emailSent = await sendStatusUpdateEmail({
        orderId,
        newStatus,
        customerName: state.customers_name,
        customerEmail: state.customers_email_address,
        orderSite: state.order_site,
        statusName,
        datePurchased: datePurchasedStr,
        comments,
        notifyComments,
        useOriginalEmail,
        sendMessageAutomatically,
        fruugoOrdersId: state.fruugo_orders_id || null,
        amazonOrdersId: state.amazon_orders_id || null,
      });
    } catch (error) {
      // REQ-08-012: Email failure must not block status change
      logger.error(
        { orderId, error: error instanceof Error ? error.message : 'Unknown' },
        'Failed to send status notification email'
      );
    }
  }

  const action = statusChanged ? 'Status updated' : 'Comment added';
  logger.info({ orderId, newStatus, statusChanged, adminName, emailSent }, action);

  return {
    success: true,
    message: action + ' successfully',
    statusChanged,
    historyInserted: true,
    marketplaceErrors,
  };
}

// ---------------------------------------------------------------------------
// REQ-07-017 + REQ-07-018: Status History
// ---------------------------------------------------------------------------

/**
 * REQ-07-018: Fetch status history for an order.
 * Joins with orders_status for human-readable status names.
 */
export async function getStatusHistory(orderId: number): Promise<StatusHistoryRow[]> {
  return prisma.$queryRaw<StatusHistoryRow[]>(
    Prisma.sql`SELECT osh.orders_status_history_id,
                      osh.orders_id,
                      osh.orders_status_id,
                      os.orders_status_name,
                      osh.date_added,
                      osh.customer_notified,
                      osh.comments,
                      osh.comment_by,
                      osh.comment_private,
                      osh.status_change_from
               FROM orders_status_history osh
               LEFT JOIN orders_status os
                 ON os.orders_status_id = osh.orders_status_id
                 AND os.language_id = 1
               WHERE osh.orders_id = ${orderId}
               ORDER BY osh.date_added DESC, osh.orders_status_history_id DESC`
  );
}

// ---------------------------------------------------------------------------
// REQ-07-023: Predefined Comment Templates
// ---------------------------------------------------------------------------

/**
 * REQ-07-023: Fetch predefined templates by type.
 * PHP has two dropdowns: outgoing (type '0') and reply (type '1').
 * PHP table: order_status_predefined_template (singular, despite plural constant).
 */
export async function getStatusTemplates(
  templateType: '0' | '1' = '0'
): Promise<PredefinedTemplateRow[]> {
  return prisma.$queryRaw<PredefinedTemplateRow[]>(
    Prisma.sql`SELECT id, title, content, template_type
               FROM order_status_predefined_template
               WHERE template_type = ${templateType}
               ORDER BY id ASC`
  );
}

/**
 * REQ-07-023: Fetch a single template by ID.
 */
export async function getTemplateById(
  templateId: number
): Promise<PredefinedTemplateRow | null> {
  const rows = await prisma.$queryRaw<PredefinedTemplateRow[]>(
    Prisma.sql`SELECT id, title, content, template_type
               FROM order_status_predefined_template
               WHERE id = ${templateId}`
  );
  return rows.length > 0 ? rows[0] : null;
}

// ---------------------------------------------------------------------------
// REQ-07-025: Touchpoint Counter
// ---------------------------------------------------------------------------

/**
 * REQ-07-025: Set touchpoint counter for an order.
 * PHP orders.php sets touchpoints to the absolute value received from the
 * client (POST 'touchpoints'), never increments server-side.
 * SQL: UPDATE orders SET touchpoints = :touchpoint, last_added_touchpoint_date = now()
 *      WHERE orders_id = '$order_id'
 */
export async function setTouchpoint(
  orderId: number,
  touchpoints: number
): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`UPDATE orders
               SET touchpoints = ${touchpoints},
                   last_added_touchpoint_date = NOW()
               WHERE orders_id = ${orderId}`
  );
}

/** @deprecated Use setTouchpoint instead — kept for backward compatibility until frontend is updated. */
export const incrementTouchpoint = (orderId: number) => setTouchpoint(orderId, 1);
