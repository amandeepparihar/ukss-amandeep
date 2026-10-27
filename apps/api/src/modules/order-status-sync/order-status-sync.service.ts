/**
 * Order Status Sync Service (Stage 4)
 *
 * Synchronizes order statuses from UKSS orders back to marketplace order tables.
 * Reads the current UKSS order status (orders.orders_status), looks up the
 * corresponding marketplace status via the muosm mapping table, and writes
 * it to mo_marketplace_orders and mop_marketplace_order_products.
 *
 * Pipeline: Stage 4 (Status Sync)
 * Cron: `pnpm cli sync-order-status`
 *
 * Flow:
 *   1. Fetch MOP products linked to UKSS order_products (mop_ukss_orders_products_id != '')
 *      that don't yet have a final status (Shipped/Cancelled/Return)
 *   2. For each product, look up the UKSS order's current status and map it
 *      to a marketplace status via muosm_marketplcae_ukss_order_status_mappings
 *   3. Determine the action: Cancel > Return > Ship > Confirm (priority order)
 *   4. Update mo_marketplace_orders, mop_marketplace_order_products, and
 *      create a mosh_marketplace_order_status_history entry
 */

import { prisma } from '../../lib/prisma';
import { createLogger, type Logger } from '../../lib/logger';
import { emailService } from '../../lib/email';
import { config } from '../../config';
import { escapeHtml } from '../../lib/utils/string-utils';
import {
  createExecutionContext,
  serializeError,
  getErrorMessage,
  ApiResponseStatus,
  UkssOrderStatus,
  STATUS_SYNC_AUDIT_USER,
  OrderStatus,
} from '../marketplaces/orders';

const defaultLogger = createLogger('order-status-sync-service');

// Configuration values from environment or defaults
const FRUUGO_STORE_ID = config.FRUUGO_STORE_ID ?? 95;

// UKSS order status IDs that allow confirmation for Fruugo:
// 12=Picking, 128=Picking(FC), 14=Ready to Ship, 16=Awaiting Items,
// 22=JIT Order, 23=JIT Pending, 24=JIT Dispatched, 7=Confirmed
const FRUUGO_ALLOWED_STATUS_FOR_CONFIRMATION = config.FRUUGO_ALLOWED_STATUS_FOR_CONFIRMATION
  ? config.FRUUGO_ALLOWED_STATUS_FOR_CONFIRMATION.split(',').map(Number)
  : [12, 128, 14, 16, 22, 23, 24, 7];

const SPORTDEAL_STORE_ID = config.SPORTDEAL_STORE_ID
  ? Number(config.SPORTDEAL_STORE_ID)
  : 127;

const TOFFS_STORE_ID = config.TOFFS_STORE_ID ?? 143;

const ALLEGRO_STORE_ID = config.ALLEGRO_STORE_ID;

// Same as Fruugo but uses 5 (Shipped) instead of 7 (Confirmed) —
// Sportdeal orders can be confirmed even when UKSS status is Shipped.
const sportdealConfirmConfig = config.SPORTDEAL_ALLOWED_STATUS_FOR_CONFIRMATION || config.SPORTSDEAL_ALLOWED_STATUS_FOR_CONFIRMATION;
const SPORTDEAL_ALLOWED_STATUS_FOR_CONFIRMATION = sportdealConfirmConfig
  ? sportdealConfirmConfig.split(',').map(Number)
  : [12, 128, 14, 16, 22, 23, 24, 5];

/**
 * Fetch order products that need status sync.
 *
 * Returns MOP products joined with UKSS orders_products data (box status,
 * tracking, shipment code) for products that don't yet have a final
 * marketplace status (Shipped/Cancelled/Return).
 */
async function fetchOrderProductsForStatusSync(logger?: Logger, limit?: number) {
  const log = logger || defaultLogger;
  try {
    const limitClause = limit ? `LIMIT ?` : '';
    const query = `
      SELECT
        mop.mop_id,
        mop.mop_store_name,
        mop.mop_order_id,
        mop.mop_mo_id,
        mop.mop_product_id,
        mop.mop_product_sku,
        mop.mop_product_quantity,
        mop.mop_order_status_to_update,
        mop.mop_ukss_orders_products_id,
        op.orders_id,
        op.box_number,
        op.box1,
        op.box2,
        op.box3,
        op.return_chk,
        op.tracking_no,
        op.shipment_code,
        op.backorder,
        op.jit_marked
      FROM mop_marketplace_order_products AS mop
      LEFT JOIN orders_products AS op
        ON op.orders_products_id = mop.mop_ukss_orders_products_id
      WHERE mop.mop_ukss_orders_products_id != ''
        AND mop.mop_ukss_orders_products_id IS NOT NULL
        -- SAFE: OrderStatus values are compile-time string constants, not user input
        -- NOTE: MySQL treats NULL NOT IN (...) as NULL (falsy), so NULL rows are
        -- excluded automatically — matching the legacy PHP behaviour.
        AND mop.mop_order_status_of_order NOT IN ('${OrderStatus.SHIPPED}', '${OrderStatus.CANCELLED}', '${OrderStatus.RETURN}')
      ${limitClause}
    `;

    const params = limit ? [limit] : [];
    const results = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    log.info({ count: results.length }, 'Fetched order products for status sync');
    return results;
  } catch (error) {
    log.error({ error: serializeError(error) }, 'Failed to fetch order products for status sync');
    throw error;
  }
}

/**
 * Fetch order status mapping for a given UKSS order.
 *
 * Joins orders with muosm_marketplcae_ukss_order_status_mappings to translate
 * the current UKSS orders_status into a marketplace-readable status string.
 */
async function fetchOrderStatusMapping(ordersId: number, logger?: Logger) {
  const log = logger || defaultLogger;
  try {
    const query = `
      SELECT
        muosm.muosm_store_id,
        muosm.muosm_mo_status,
        muosm.muosm_id,
        o.orders_status,
        o.order_site
      FROM orders AS o
      INNER JOIN muosm_marketplcae_ukss_order_status_mappings AS muosm
        ON o.order_site = muosm.muosm_store_id
      WHERE muosm.muosm_orders_status = o.orders_status
        AND o.orders_id = ?
      LIMIT 1
    `;

    const results = await prisma.$queryRawUnsafe<any[]>(query, ordersId);

    if (results.length === 0) {
      log.warn({ ordersId }, 'No status mapping found for order');
      return null;
    }

    return results[0];
  } catch (error) {
    log.error({ error: serializeError(error), ordersId }, 'Failed to fetch order status mapping');
    return null;
  }
}

/**
 * Insert a status history record in mosh_marketplace_order_status_history.
 */
async function insertStatusHistory(historyData: {
  moshMoId: bigint;
  moshMopId?: bigint;
  moshMoOrderId: string;
  moshMuosmId: number;
  moshMoOrderStatus: string;
}, logger?: Logger) {
  const log = logger || defaultLogger;
  try {
    await prisma.moshMarketplaceOrderStatusHistory.create({
      data: {
        moshMoId: historyData.moshMoId,
        moshMopId: historyData.moshMopId ?? BigInt(0),
        moshMoOrderId: historyData.moshMoOrderId,
        moshMuosmId: BigInt(historyData.moshMuosmId),
        moshMoOrderStatus: historyData.moshMoOrderStatus,
        moshCreatedBy: STATUS_SYNC_AUDIT_USER,
        moshModifiedBy: STATUS_SYNC_AUDIT_USER,
      },
    });

    log.info({ moshMoId: historyData.moshMoId.toString() }, 'Status history inserted');
    return true;
  } catch (error) {
    log.error({ error: serializeError(error), historyData }, 'Failed to insert status history');
    throw error;
  }
}

/**
 * Update marketplace order header status.
 */
async function updateMarketplaceOrderStatus(moId: bigint, status: string, muosmId: number, logger?: Logger) {
  const log = logger || defaultLogger;
  try {
    await prisma.moMarketplaceOrder.update({
      where: { moId },
      data: {
        moOrderStatus: status,
        moMuosmId: muosmId,
      },
    });

    log.info({ moId: moId.toString(), status }, 'Updated marketplace order status');
    return true;
  } catch (error) {
    log.error({ error: serializeError(error), moId: moId.toString() }, 'Failed to update marketplace order status');
    throw error;
  }
}

/**
 * Update marketplace order product status and set API response to Waiting
 * so Stage 5 picks it up for push to marketplace API.
 */
async function updateMarketplaceOrderProductStatus(
  mopId: bigint,
  status: string,
  trackingNo?: string,
  shippingCarrier?: string,
  logger?: Logger
) {
  const log = logger || defaultLogger;
  try {
    const updateData: any = {
      mopOrderStatusToUpdate: status,
      mopApiResponse: ApiResponseStatus.WAITING,
    };

    if (trackingNo) {
      updateData.mopUkssTrackingCode = trackingNo;
    }

    if (shippingCarrier) {
      updateData.mopUkssShippingCarrier = shippingCarrier;
    }

    await prisma.mopMarketplaceOrderProduct.update({
      where: { mopId },
      data: updateData,
    });

    log.info({ mopId: mopId.toString(), status }, 'Updated marketplace order product status');
    return true;
  } catch (error) {
    log.error({ error: serializeError(error), mopId: mopId.toString() }, 'Failed to update marketplace order product status');
    throw error;
  }
}

/**
 * Check if order should be confirmed.
 *
 * Confirmation happens when the warehouse has assigned a box or marked as backorder,
 * but the order hasn't shipped yet (no tracking number).
 * Fruugo and Sportdeal have additional store-specific allowed UKSS status codes.
 */
function shouldConfirmOrder(
  orderProduct: any,
  orderStatusMapping: any,
  allowedStatusForFruugo: number[],
  allowedStatusForSportsDeal: number[]
): boolean {
  // Toffs exclusion: don't confirm if order_status=5 (Shipped) and return_chk='yes'
  // Legacy PHP: PMS 164772 — prevents confirming Toffs orders that are actually returns
  if (
    orderStatusMapping?.order_site == TOFFS_STORE_ID &&
    orderStatusMapping?.orders_status == UkssOrderStatus.SHIPPED &&
    orderProduct.return_chk?.toLowerCase() === 'yes'
  ) {
    return false;
  }

  const hasBoxNumber = orderProduct.box_number && orderProduct.box_number !== '';
  const hasBackorder = orderProduct.backorder && orderProduct.backorder.toLowerCase() === 'yes';
  const isNotConfirmed = orderProduct.mop_order_status_to_update?.toLowerCase() !== 'confirmed';
  const hasNoTracking = !orderProduct.tracking_no || orderProduct.tracking_no === '';
  // When UKSS order is already Shipped (status=5), backorder products must NOT be confirmed.
  const isUkssShipped = orderStatusMapping?.orders_status == UkssOrderStatus.SHIPPED;

  // Standard confirmation: box_number OR backorder (backorder only when not yet UKSS-shipped).
  if ((hasBoxNumber || (hasBackorder && !isUkssShipped)) && isNotConfirmed && hasNoTracking) {
    return true;
  }

  // Fruugo special case
  if (
    orderStatusMapping?.order_site == FRUUGO_STORE_ID &&
    allowedStatusForFruugo.includes(Number(orderStatusMapping?.orders_status)) &&
    isNotConfirmed &&
    hasNoTracking
  ) {
    return true;
  }

  // Sportdeal special case
  if (
    SPORTDEAL_STORE_ID &&
    orderStatusMapping?.order_site == SPORTDEAL_STORE_ID &&
    allowedStatusForSportsDeal.includes(Number(orderStatusMapping?.orders_status)) &&
    isNotConfirmed &&
    hasNoTracking
  ) {
    return true;
  }

  return false;
}

/**
 * Check if order should be shipped.
 *
 * Standard shipping requires tracking number + shipment code + UKSS status = Shipped.
 * Fruugo has additional validation: boxes must not be cancelled/rejected, and
 * return_chk must not be 'yes'.
 */
function shouldShipOrder(orderProduct: any, orderStatusMapping: any): boolean {
  const hasTracking = orderProduct.tracking_no && orderProduct.tracking_no !== '';
  const hasShipmentCode = orderProduct.shipment_code && orderProduct.shipment_code !== '';
  const isShipped = orderStatusMapping?.orders_status == UkssOrderStatus.SHIPPED;

  // Standard shipping
  if (hasTracking && hasShipmentCode && isShipped) {
    return true;
  }

  // Fruugo special case
  if (orderStatusMapping?.order_site == FRUUGO_STORE_ID && isShipped) {
    const returnChk = orderProduct.return_chk?.toLowerCase();
    if (returnChk === 'yes') {
      return false;
    }

    // Box validation
    const box1Valid =
      !orderProduct.box1 ||
      (orderProduct.box1.toLowerCase() !== 'cancelled' &&
        orderProduct.box1.toLowerCase() !== 'rejected');
    const box2Valid =
      !orderProduct.box2 ||
      (orderProduct.box2.toLowerCase() !== 'cancelled' &&
        orderProduct.box2.toLowerCase() !== 'rejected');
    const box3Valid =
      !orderProduct.box3 ||
      (orderProduct.box3.toLowerCase() !== 'cancelled' &&
        orderProduct.box3.toLowerCase() !== 'rejected');

    // Box number validation
    const hasBoxNumber = orderProduct.box_number && orderProduct.box_number !== '';
    const hasBackorder = orderProduct.backorder?.toLowerCase() === 'yes';
    const hasJitMarked = orderProduct.jit_marked?.toLowerCase() === 'yes';
    const boxNumberValid = hasBoxNumber || hasBackorder || hasJitMarked;

    if (box1Valid && box2Valid && box3Valid && boxNumberValid) {
      return true;
    }
  }

  return false;
}

/**
 * Check if order should be returned (Fruugo-only).
 */
function shouldReturnOrder(orderProduct: any): boolean {
  const returnChk = orderProduct.return_chk?.toLowerCase();
  const storeName = orderProduct.mop_store_name?.toLowerCase();

  return returnChk === 'yes' && storeName === 'fruugo';
}

/**
 * Check if order should be cancelled/rejected.
 * Any box (box1/box2/box3) set to 'Cancelled' or 'Rejected' triggers this.
 */
function shouldCancelOrder(orderProduct: any): boolean {
  const box1 = orderProduct.box1?.toString();
  const box2 = orderProduct.box2?.toString();
  const box3 = orderProduct.box3?.toString();

  return (
    box1 === 'Cancelled' ||
    box2 === 'Cancelled' ||
    box3 === 'Cancelled' ||
    box1 === 'Rejected' ||
    box2 === 'Rejected' ||
    box3 === 'Rejected'
  );
}

/**
 * Sync marketplace order statuses from UKSS to MOP tables.
 *
 * Pipeline: Stage 4 (Status Sync)
 * Cron: `pnpm cli sync-order-status`
 *
 * WHY priority is Cancel > Return > Ship > Confirm:
 * A product can match multiple conditions (e.g., cancelled AND has tracking).
 * Cancel is highest priority because it's irreversible. Using else-if ensures
 * only ONE status update per product per sync cycle.
 */
export async function syncMarketplaceOrderStatus(limit?: number) {
  const startTime = Date.now();
  let processedCount = 0;
  let confirmedCount = 0;
  let shippedCount = 0;
  let returnedCount = 0;
  let cancelledCount = 0;
  let statusUpdatedCount = 0;
  let errorCount = 0;

  const { executionId, logger } = createExecutionContext('order-status-sync-service');

  logger.info({ limit, executionId }, 'Starting marketplace order status sync');

  try {
    // 1. Fetch order products that need status sync (with limit in SQL)
    const orderProducts = await fetchOrderProductsForStatusSync(logger, limit);

    if (orderProducts.length === 0) {
      logger.info('No order products found for status sync');
      return {
        success: true,
        processed: 0,
        confirmed: 0,
        shipped: 0,
        returned: 0,
        cancelled: 0,
        statusUpdated: 0,
        errors: 0,
        message: 'No order products to process',
      };
    }

    logger.info({ count: orderProducts.length }, 'Processing order products for status sync');

    // 2. Process each order product
    for (const orderProduct of orderProducts) {
      try {
        const ordersId = orderProduct.orders_id;
        const mopId = BigInt(orderProduct.mop_id);
        const moId = BigInt(orderProduct.mop_mo_id);

        if (!ordersId) {
          logger.warn({ mopId: mopId.toString() }, 'Order product missing orders_id, skipping');
          continue;
        }

        // 3. Fetch order status mapping (UKSS status → marketplace status)
        const orderStatusMapping = await fetchOrderStatusMapping(ordersId, logger);

        if (!orderStatusMapping) {
          logger.warn({ ordersId, mopId: mopId.toString() }, 'No status mapping found, skipping');
          errorCount++;
          continue;
        }

        const status = orderStatusMapping.muosm_mo_status;
        const muosmId = Number(orderStatusMapping.muosm_id);

        // 4. Determine which status action to apply
        // WHY: else-if chain ensures only ONE status update per product.
        // Priority: Cancel > Return > Ship > Confirm
        type StatusAction = { statusValue: string; label: string; trackingNo?: string; shippingCarrier?: string };
        let action: StatusAction | null = null;

        // Allegro: status is determined by UKSS order-level status (muosm mapping),
        // not by individual product box statuses. Skip box-level cancel check for Allegro.
        const isAllegroOrder = ALLEGRO_STORE_ID != null && Number(orderStatusMapping?.muosm_store_id) === ALLEGRO_STORE_ID;
        if (shouldCancelOrder(orderProduct) && !isAllegroOrder) {
          action = { statusValue: status, label: 'cancelled' };
        } else if (shouldReturnOrder(orderProduct)) {
          action = { statusValue: OrderStatus.RETURN, label: 'returned' };
        } else if (shouldShipOrder(orderProduct, orderStatusMapping)) {
          action = {
            statusValue: status,
            label: 'shipped',
            trackingNo: orderProduct.tracking_no || '',
            shippingCarrier: orderProduct.shipment_code || '',
          };
        } else if (shouldConfirmOrder(orderProduct, orderStatusMapping, FRUUGO_ALLOWED_STATUS_FOR_CONFIRMATION, SPORTDEAL_ALLOWED_STATUS_FOR_CONFIRMATION)) {
          action = { statusValue: status, label: 'confirmed' };
        } else if (
          status
          && status !== orderProduct.mop_order_status_to_update
          && isAllegroOrder
        ) {
          // Generic passthrough (Allegro only): muosm mapped to a status different from
          // current — update it. This allows intermediate statuses (e.g. PROCESSING,
          // READY_FOR_PICKUP) to flow through to the Allegro API via Stage 5.
          action = { statusValue: status, label: 'status-updated' };
        }

        if (action) {
          await updateMarketplaceOrderStatus(moId, action.statusValue, muosmId, logger);
          await updateMarketplaceOrderProductStatus(mopId, action.statusValue, action.trackingNo, action.shippingCarrier, logger);
          await insertStatusHistory({
            moshMoId: moId,
            moshMopId: mopId,
            moshMoOrderId: orderProduct.mop_order_id || '',
            moshMuosmId: muosmId,
            moshMoOrderStatus: action.statusValue,
          }, logger);

          if (action.label === 'cancelled') cancelledCount++;
          else if (action.label === 'returned') returnedCount++;
          else if (action.label === 'shipped') shippedCount++;
          else if (action.label === 'confirmed') confirmedCount++;
          else if (action.label === 'status-updated') statusUpdatedCount++;

          processedCount++;
          logger.info({ mopId: mopId.toString(), status: action.statusValue, action: action.label }, 'Order status updated');
        }
      } catch (error) {
        errorCount++;
        const errorMsg = getErrorMessage(error);
        await emailService.sendErrorNotification({
          subject: `Error: Marketplace Order Status Sync Failed`,
          errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Order Status Sync <br><b>File:</b> apps/api/src/modules/order-status-sync/order-status-sync.service.ts <br><b>Error:</b> Failed to process order product. <br><b>Order Product ID:</b> ${escapeHtml(String(orderProduct.orders_id || ''))}`,
          module: 'order-status-sync',
          context: {
            error: errorMsg,
          },
        });
        logger.error({ error: serializeError(error), orderProduct }, 'Error processing order product');
      }
    }

    const duration = Date.now() - startTime;

    logger.info(
      {
        processed: processedCount,
        confirmed: confirmedCount,
        shipped: shippedCount,
        returned: returnedCount,
        cancelled: cancelledCount,
        statusUpdated: statusUpdatedCount,
        errors: errorCount,
        duration,
      },
      'Marketplace order status sync completed'
    );

    return {
      success: true,
      processed: processedCount,
      confirmed: confirmedCount,
      shipped: shippedCount,
      returned: returnedCount,
      cancelled: cancelledCount,
      statusUpdated: statusUpdatedCount,
      errors: errorCount,
      duration,
    };
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    logger.error({ error: serializeError(error) }, 'Failed to sync marketplace order statuses');
    await emailService.sendErrorNotification({
      subject: `Error: Marketplace Order Status Sync Failed`,
      errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Order Status Sync <br><b>File:</b> apps/api/src/modules/order-status-sync/order-status-sync.service.ts <br><b>Error:</b> Failed to sync marketplace order statuses.`,
      module: 'order-status-sync',
      context: {
        error: errorMsg,
      },
    });
    return {
      success: false,
      processed: processedCount,
      confirmed: confirmedCount,
      shipped: shippedCount,
      returned: returnedCount,
      cancelled: cancelledCount,
      statusUpdated: statusUpdatedCount,
      errors: errorCount,
      error: errorMsg,
    };
  }
}
