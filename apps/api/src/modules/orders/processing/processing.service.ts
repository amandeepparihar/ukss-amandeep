/**
 * SPEC-13: Order Processing Engine — core service.
 * Requirements: REQ-13-001/002 (simulation), REQ-13-003 (disagree),
 *   REQ-13-004 (execute), REQ-13-006 (batch), REQ-13-009 (unallocated),
 *   REQ-13-011 (process status tracking)
 *
 * Ported from PHP: order_processing_simulation.php, process_order.php,
 * auto_process_orders.php
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { STATUS, PROCESS_STATUS, JIT_BOX_CODE_LIST } from '../orders.constants';
import { loadDbConfiguration } from '../orders.service';
import { calculateAndSetShipByDate } from '../status/status.helpers';
import {
  fetchOrderForProcessing,
  fetchOrderProducts,
  fetchPreOrderLineIds,
  checkOrderEligibility,
  checkTicketLock,
} from './processing.queries';
import {
  resolveSmsSize,
  resolveProductCode,
  checkSmsStock,
  pickStock,
  detectProductType,
  detectPrintingOptions,
  checkParentStock,
} from './processing.stock';
import { aggregateProductResults, determineProposedStatus } from './processing.status';
import { prepareOrderQueue } from './processing.batch';
import type {
  TxClient,
  SimulationResult,
  SimulationProductResult,
  BatchProcessResult,
  QueueProcessResult,
  UnallocatedStockItem,
  OrderProductForProcessingRow,
} from './processing.types';

const logger = createLogger('orders-processing');

// ---------------------------------------------------------------------------
// REQ-13-001 / REQ-13-002: Processing Simulation
// ---------------------------------------------------------------------------

/**
 * Run a processing simulation on an order.
 * Returns a detailed preview of what processing would do.
 * Note: updates order_process_status to mark simulation as completed.
 */
export async function simulateOrderProcessing(
  orderId: number
): Promise<SimulationResult> {
  // 1. Fetch order and eligible statuses in parallel (independent queries)
  const [order, eligibleStatuses] = await Promise.all([
    fetchOrderForProcessing(orderId),
    getEligibleStatuses(),
  ]);
  if (!order) {
    return buildIneligibleResult(orderId, 'Order not found');
  }

  // 2. Check eligibility (with ticket lock check for locked+approved orders)
  const hasTicketLock = order.locked_order > 0 && order.approve_customer === '1'
    ? await checkTicketLock(orderId)
    : false;
  const eligibility = checkOrderEligibility(order, eligibleStatuses, hasTicketLock);
  if (!eligibility.eligible) {
    return buildIneligibleResult(orderId, eligibility.reason!);
  }

  // 3. Fetch products
  const products = await fetchOrderProducts(orderId);
  if (products.length === 0) {
    return buildIneligibleResult(orderId, 'Order has no products');
  }

  // 5. Analyze each product (pre-order lines are skipped from the pick — legacy parity)
  const preOrderLineIds = await fetchPreOrderLineIds(orderId);
  const productResults: SimulationProductResult[] = [];
  for (const product of products) {
    productResults.push(
      await resolveProductStock(product, prisma, preOrderLineIds.has(product.orders_products_id))
    );
  }

  // 6. Determine proposed status (preOrder/OOS override precedence — legacy L1539-1550)
  const { hasRetro, hasPrinting, hasPreOrder, hasOutOfStock, stockAvailable } =
    aggregateProductResults(productResults);
  const { status: proposedStatus, name: proposedStatusName } =
    determineProposedStatus(hasRetro, hasPrinting, hasPreOrder, hasOutOfStock, products);

  // 7. Update order_process_status (simulation completed)
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE orders
      SET order_process_status = ${PROCESS_STATUS.SIMULATION_DONE}, order_process_date = NOW()
      WHERE orders_id = ${orderId}
    `
  );

  return {
    orderId,
    eligible: true,
    products: productResults,
    proposedStatus,
    proposedStatusName,
    hasRetroProducts: hasRetro,
    hasPrintingProducts: hasPrinting,
    totalProducts: productResults.length,
    stockAvailableCount: stockAvailable,
  };
}

// ---------------------------------------------------------------------------
// REQ-13-003: Record Disagreement
// ---------------------------------------------------------------------------

/**
 * Record an admin's disagreement with simulation results.
 */
export async function recordDisagreement(
  orderId: number,
  adminName: string,
  comment: string
): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO order_processing_simulation_comments
        (orders_id, comment, date_added, added_by, status)
      VALUES (${orderId}, ${comment}, NOW(), ${adminName}, 1)
    `
  );

  logger.info({ orderId, adminName }, 'Simulation disagreement recorded');
}

// ---------------------------------------------------------------------------
// REQ-13-004: Execute Processing (after simulation approval)
// ---------------------------------------------------------------------------

/**
 * Execute processing on a single order — performs actual stock picks and status changes.
 * Fresh execution (not cached) for data consistency.
 */
export async function executeProcessing(
  orderId: number,
  adminId: number
): Promise<SimulationResult> {
  const eligibleStatuses = await getEligibleStatuses();

  return prisma.$transaction(async (tx: TxClient) => {
    // 1. Fetch order (within transaction for consistency)
    const order = await fetchOrderForProcessing(orderId, tx);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // 2. Check eligibility (with ticket lock check for locked+approved orders)
    const hasTicketLock = order.locked_order > 0 && order.approve_customer === '1'
      ? await checkTicketLock(orderId, tx)
      : false;
    const eligibility = checkOrderEligibility(order, eligibleStatuses, hasTicketLock);
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason || 'Order not eligible');
    }

    // 3. Set process status (processing in progress)
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE orders
        SET order_process_status = ${PROCESS_STATUS.ACTIVE}, order_process_date = NOW()
        WHERE orders_id = ${orderId}
      `
    );

    // 4. Fetch products
    const products = await fetchOrderProducts(orderId, tx);
    if (products.length === 0) {
      throw new Error('Order has no products');
    }

    // 5. Process each product — pick stock and assign box numbers.
    //    PHP: auto-pick stores (Amazon etc.) skip stock deduction; pre-order lines skip the pick.
    const isAutoPick = order.auto_pick === 'yes';
    const preOrderLineIds = await fetchPreOrderLineIds(orderId, tx);
    const productResults: SimulationProductResult[] = [];
    for (const product of products) {
      productResults.push(
        await processProduct(product, tx, isAutoPick, preOrderLineIds.has(product.orders_products_id))
      );
    }

    // 6. Determine final status (preOrder/OOS override precedence — legacy L1539-1550)
    const { hasRetro, hasPrinting, hasPreOrder, hasOutOfStock, stockAvailable } =
      aggregateProductResults(productResults);
    const { status: finalStatus, name: finalStatusName } =
      determineProposedStatus(hasRetro, hasPrinting, hasPreOrder, hasOutOfStock, products);

    // 7. Update order status. Legacy order_processing_new.php:1623-1624 writes the
    //    computed status UNCONDITIONALLY — including 2 (Processing) when out of stock
    //    (L1065-1072) and 12 (Pre Order). The prior port wrongly suppressed the write
    //    on OOS, leaving such orders stuck on their previous status.
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE orders
        SET orders_status = ${finalStatus},
            order_process_status = ${PROCESS_STATUS.COMPLETED},
            order_process_date = NOW()
        WHERE orders_id = ${orderId}
      `
    );

    // 8. Insert status history. Legacy L1690-1696 inserts unconditionally for every
    //    non-zero status (incl. 12 and 2). customer_notified = 0 for Pre Order (12),
    //    else 1 (L1685-1688). comment_by keeps the Stock2 convention (real admin name,
    //    not legacy's literal 'a'); status_change_from matches legacy 'OrderProcessingPage'.
    const adminName = await resolveAdminNameById(tx, adminId);
    const customerNotified = finalStatus === STATUS.PRE_ORDERED ? 0 : 1;
    await tx.$executeRaw(
      Prisma.sql`
        INSERT INTO orders_status_history
          (orders_id, orders_status_id, date_added, customer_notified,
           comments, comment_by, comment_private, status_change_from)
        VALUES (
          ${orderId}, ${finalStatus}, NOW(), ${customerNotified},
          ${''},
          ${adminName}, ${'Yes'}, ${'OrderProcessingPage'}
        )
      `
    );

    // 8b. Fruugo confirmation. Legacy order_processing_new.php:1701-1707 marks the
    //     Fruugo order confirmed once UKSS processes it; the Fruugo status gate
    //     (Topic 4) reads this flag. Fires only when the order carries a real
    //     fruugo_orders_id (legacy: != '' && != '0'). The eBay ack write at
    //     L1709-1713 is intentionally NOT ported (dead per the inventory-sync audit).
    if (order.fruugo_orders_id && order.fruugo_orders_id !== '0') {
      await tx.$executeRaw(
        Prisma.sql`
          UPDATE fruugo_orders
          SET ukss_confirmation_status = 1
          WHERE fruugo_order_id = ${order.fruugo_orders_id}
        `
      );
    }

    // 9. Unlock if locked — PHP only unlocks Pending orders
    if (order.locked_order > 0 && order.orders_status === STATUS.PENDING) {
      await tx.$executeRaw(
        Prisma.sql`
          UPDATE orders SET locked_order = 0
          WHERE orders_id = ${orderId}
        `
      );
    }

    // 10. Calculate ship-by-date. Legacy order_processing_new.php:1627 sets it
    //     unconditionally once the status block runs.
    await calculateAndSetShipByDate(tx, orderId, finalStatus, order.ship_by_date);

    // 11. Clean up remote_order_processing records — PHP DELETEs (not soft-update)
    await tx.$executeRaw(
      Prisma.sql`
        DELETE FROM remote_order_processing
        WHERE orders_id = ${orderId} AND status = 0
      `
    );

    // 12. Insert into pre_processed_order_products
    // PHP: orders.php line 3609 — all columns verified against DB DESCRIBE
    const siftScoreBit = order.sift_score_bit ?? '0';
    for (const result of productResults) {
      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO pre_processed_order_products
            (orders_id, orders_products_id, order_products_id, status,
             process_archive, to_be_printed, sift_score_bit, date_added, date_modified)
          VALUES (${orderId}, ${result.ordersProductsId}, ${result.productsId}, 0,
                  0, 0, ${siftScoreBit}, NOW(), NOW())
        `
      );
    }

    // 13. Retro cleanup. Legacy order_processing_new.php:1719-1722 — once an order
    //     resolves to Retro Shirts(22), its remaining order-processing work is manual,
    //     so its pre_processed_order_products rows are set to status='3' to stop them
    //     re-queueing on the next cron pass. (Stock2 per-order processing uses
    //     process_archive=0 uniformly, so we scope by orders_id.)
    if (finalStatus === STATUS.RETRO_SHIRTS) {
      await tx.$executeRaw(
        Prisma.sql`
          UPDATE pre_processed_order_products
          SET status = '3', date_modified = NOW()
          WHERE orders_id = ${orderId}
        `
      );
    }

    logger.info(
      { orderId, finalStatus, processed: productResults.length },
      'Order processed successfully'
    );

    return {
      orderId,
      eligible: true,
      products: productResults,
      proposedStatus: finalStatus,
      proposedStatusName: finalStatusName,
      hasRetroProducts: hasRetro,
      hasPrintingProducts: hasPrinting,
      totalProducts: productResults.length,
      stockAvailableCount: stockAvailable,
    };
  });
}

// ---------------------------------------------------------------------------
// REQ-13-006: Batch Processing
// ---------------------------------------------------------------------------

/**
 * Process a batch of orders. Each order in its own transaction —
 * if one fails, others continue.
 *
 * Applies the 15-minute same-customer rule (PHP: order_processing_new.php lines 60-107):
 * If two orders from the same non-marketplace customer were placed within 15 minutes,
 * both are flagged for manual processing (status=3 in pre_processed_order_products).
 */
export async function batchProcessOrders(
  orderIds: number[],
  adminId: number
): Promise<BatchProcessResult> {
  let processed = 0;
  let failed = 0;
  const errors: Array<{ orderId: number; error: string }> = [];

  // 15-minute same-customer rule: identify orders to flag
  const flaggedOrderIds = await apply15MinuteRule(orderIds);

  for (const orderId of orderIds) {
    if (flaggedOrderIds.has(orderId)) {
      // Insert into pre_processed_order_products with status=3 (manual processing)
      try {
        await flagOrderForManualProcessing(orderId);
        logger.info({ orderId }, '15-minute rule: order flagged for manual processing');
        errors.push({ orderId, error: '15-minute rule: flagged for manual processing' });
        failed++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ orderId, error: message });
      }
      continue;
    }

    try {
      await executeProcessing(orderId, adminId);
      processed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push({ orderId, error: message });
      logger.warn({ orderId, error: message }, 'Batch processing: order failed');
    }
  }

  logger.info(
    { total: orderIds.length, processed, failed, flagged: flaggedOrderIds.size },
    'Batch processing complete'
  );

  return { processed, failed, errors };
}

/**
 * #1061 P2: process the full eligible queue.
 *
 * Reproduces the legacy order_processing_new.php run: prepare the queue
 * (sift bit → archive number → assign → 15-min flag → ordered SELECT) and then
 * process each order oldest-first with pre-orders prioritised. The 15-minute
 * rule is applied during preparation (orders flipped to status 3 are excluded
 * from the returned list), so we do NOT re-flag here.
 */
export async function processOrderQueue(adminId: number): Promise<QueueProcessResult> {
  const queue = await prepareOrderQueue();
  logger.info(
    {
      archiveNumber: queue.archiveNumber,
      eligibleRows: queue.eligibleRowCount,
      orders: queue.orderIds.length,
      flagged: queue.flaggedOrderIds.length,
    },
    'Order queue prepared'
  );

  let processed = 0;
  let failed = 0;
  const errors: Array<{ orderId: number; error: string }> = [];

  for (const orderId of queue.orderIds) {
    try {
      await executeProcessing(orderId, adminId);
      processed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push({ orderId, error: message });
      logger.warn({ orderId, error: message }, 'Queue processing: order failed');
    }
  }

  logger.info(
    { archiveNumber: queue.archiveNumber, total: queue.orderIds.length, processed, failed },
    'Order queue processing complete'
  );

  return {
    archiveNumber: queue.archiveNumber,
    total: queue.orderIds.length,
    processed,
    failed,
    errors,
    flaggedForManual: queue.flaggedOrderIds,
  };
}

// ---------------------------------------------------------------------------
// REQ-13-009: Unallocated Stock Detection
// ---------------------------------------------------------------------------

/**
 * Find pre-ordered products that now have stock available.
 * Checks orders with status 12, 22, 23, 128 for products with empty box_number.
 */
export async function getUnallocatedStock(): Promise<UnallocatedStockItem[]> {
  // Fetch orders with eligible statuses and products with no box assignment.
  // Include the ordered size from orders_products_attributes directly.
  const rows = await prisma.$queryRaw<Array<{
    orders_id: number;
    orders_products_id: number;
    products_name: string;
    products_model: string;
    products_quantity: number;
    date_purchased: string | null;
    customers_name: string;
    size: string;
  }>>(
    Prisma.sql`
      SELECT
        o.orders_id,
        op.orders_products_id,
        op.products_name,
        op.products_model,
        op.products_quantity,
        NULLIF(o.date_purchased, '0000-00-00 00:00:00') AS date_purchased,
        o.customers_name,
        COALESCE(opa.products_options_values, '') AS size
      FROM orders o
      INNER JOIN orders_products op ON o.orders_id = op.orders_id
      LEFT JOIN orders_products_attributes opa
        ON op.orders_products_id = opa.orders_products_id
        AND opa.products_options LIKE '%Size%'
      WHERE o.orders_status IN (${Prisma.join(
        [STATUS.PRE_ORDERED, STATUS.RETRO_SHIRTS, STATUS.AWAITING_DELIVERY, STATUS.IN_TRANSIT]
      )})
        AND (op.box_number = '' OR op.box_number IS NULL)
        AND op.backorder = 'No'
      ORDER BY o.orders_id ASC
      LIMIT 500
    `
  );

  const results: UnallocatedStockItem[] = [];

  for (const row of rows) {
    // Resolve product code
    const codeRes = await resolveProductCode(row.products_model);
    if (!codeRes) continue;

    // Check total stock across all sizes for this product code
    const stockRows = await prisma.$queryRaw<Array<{ total: number }>>(
      Prisma.sql`
        SELECT COALESCE(SUM(quantity), 0) AS total
        FROM product_quantities
        WHERE product_lists_id = ${codeRes.productListsId}
      `
    );

    const totalStock = Number(stockRows[0]?.total ?? 0);
    if (totalStock > 0) {
      results.push({
        orderId: row.orders_id,
        ordersProductsId: row.orders_products_id,
        productName: row.products_name,
        productsModel: row.products_model,
        size: row.size,
        smsStock: totalStock,
        orderDate: row.date_purchased || '',
        customerName: row.customers_name || '',
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the result for a pre-order line. Legacy order_processing_new.php:908-920
 * skips the stock pick for pre-order products entirely; they force order status 12
 * via the aggregate. Shared by the read (resolveProductStock) and write
 * (processProduct) paths so both stay in lock-step.
 */
function buildPreOrderResult(
  product: OrderProductForProcessingRow,
  productType: ReturnType<typeof detectProductType>
): SimulationProductResult {
  return {
    ordersProductsId: product.orders_products_id,
    productsId: product.products_id,
    productName: product.products_name,
    productsModel: product.products_model,
    size: 'N/A',
    quantity: product.products_quantity,
    smsStock: 0,
    boxNumber: '',
    productType,
    hasPrinting: false,
    isOutOfStock: false,
    isPreOrder: true,
    warnings: ['Pre-order product — skipped (no stock pick); forces order status 12'],
  };
}

/**
 * Shared product analysis core — resolves stock info for a single product.
 * Used by both simulation (read-only) and execution (write) paths.
 */
async function resolveProductStock(
  product: OrderProductForProcessingRow,
  client: TxClient = prisma,
  isPreOrder = false
): Promise<SimulationProductResult> {
  const warnings: string[] = [];
  const productType = detectProductType(product);

  // Legacy order_processing_new.php:908-920 — pre-order lines skip the pick and
  // force status 12. Checked first so we never report them as out-of-stock.
  if (isPreOrder) {
    return buildPreOrderResult(product, productType);
  }

  // PHP: skip products that already have a box_number assigned
  if (product.box_number && product.box_number !== '') {
    const hasPrintingAlready = await detectPrintingOptions(product.orders_products_id, client);
    warnings.push('Already processed (box assigned)');
    return {
      ordersProductsId: product.orders_products_id,
      productsId: product.products_id,
      productName: product.products_name,
      productsModel: product.products_model,
      size: 'N/A',
      quantity: product.products_quantity,
      smsStock: 0,
      boxNumber: product.box_number,
      productType,
      hasPrinting: hasPrintingAlready,
      isOutOfStock: false,
      warnings,
    };
  }

  // PHP: arrived_status == 'Arrived' → skip stock picking, doesn't block processing
  if (product.arrived_status === 'Arrived') {
    const hasPrintingAlready = await detectPrintingOptions(product.orders_products_id, client);
    warnings.push('Product marked as arrived — skipping stock picking');
    return {
      ordersProductsId: product.orders_products_id,
      productsId: product.products_id,
      productName: product.products_name,
      productsModel: product.products_model,
      size: 'N/A',
      quantity: product.products_quantity,
      smsStock: 0,
      boxNumber: '',
      productType,
      hasPrinting: hasPrintingAlready,
      isOutOfStock: false,
      warnings,
    };
  }

  const hasPrintingResult = await detectPrintingOptions(product.orders_products_id, client);

  // Resolve size
  const sizeRes = await resolveSmsSize(
    product.orders_products_id,
    product.manufacturers_id,
    client
  );

  // Resolve product code — pass sizeId for comma-separated model validation
  const codeRes = await resolveProductCode(product.products_model, sizeRes?.sizeId || 0, client);

  let smsStock = 0;
  let boxNumber = '';
  let isOutOfStock = false;

  if (codeRes) {
    const sizeId = sizeRes?.sizeId || 0;
    const stockResult = await checkSmsStock(
      codeRes.productListsId,
      sizeId,
      product.products_quantity,
      client
    );

    smsStock = stockResult.quantity;

    if (stockResult.available) {
      boxNumber = stockResult.boxCode;
    } else if (productType === 'hero_shirt' && codeRes.parentProductListsId) {
      // Try parent hero shirt
      const parentStock = await checkParentStock(
        codeRes.parentProductListsId,
        sizeId,
        product.products_quantity,
        product.manufacturers_id,
        client
      );
      if (parentStock?.available) {
        boxNumber = parentStock.boxCode;
        smsStock = parentStock.quantity;
        warnings.push('Stock picked from parent hero shirt product');
      } else {
        isOutOfStock = true;
        warnings.push('No stock available (hero shirt or parent)');
      }
    } else if (productType === 'tshirt') {
      boxNumber = 'TSHIRTS';
      warnings.push('T-shirt — will be JIT marked');
    } else {
      isOutOfStock = true;
      warnings.push('Insufficient stock in SMS');
    }
  } else {
    isOutOfStock = true;
    warnings.push('Product code not found in SMS product_lists');
  }

  // Type-specific warnings
  if (productType === 'toffs') {
    warnings.push('Toffs product — requires retro shirt processing');
  }
  if (productType === 'copa') {
    warnings.push('Copa product — requires retro shirt processing');
  }
  if (hasPrintingResult) {
    warnings.push('Product has printing/personalization options');
  }

  return {
    ordersProductsId: product.orders_products_id,
    productsId: product.products_id,
    productName: product.products_name,
    productsModel: product.products_model,
    size: sizeRes?.sizeName || 'N/A',
    quantity: product.products_quantity,
    smsStock,
    boxNumber,
    productType,
    hasPrinting: hasPrintingResult,
    isOutOfStock,
    warnings,
  };
}

// analyzeProduct was a pass-through to resolveProductStock — callers now use resolveProductStock directly

/**
 * Process a single product — pick stock and update box number (WRITE operation).
 * Single-pass: resolve stock, pick, and assign box in one go (matches PHP flow).
 *
 * @param isAutoPick - true for auto-pick stores (Amazon etc.) — skip stock deduction
 */
async function processProduct(
  product: OrderProductForProcessingRow,
  tx: TxClient,
  isAutoPick = false,
  isPreOrder = false
): Promise<SimulationProductResult> {
  const warnings: string[] = [];
  const productType = detectProductType(product);

  // Legacy order_processing_new.php:908-920 — pre-order lines skip the pick (no
  // committed/quantity decrement) and force status 12. Checked first.
  if (isPreOrder) {
    return buildPreOrderResult(product, productType);
  }

  // PHP: skip products that already have a box_number assigned
  if (product.box_number && product.box_number !== '') {
    const hasPrintingAlready = await detectPrintingOptions(product.orders_products_id, tx);
    warnings.push('Already processed (box assigned)');
    return {
      ordersProductsId: product.orders_products_id,
      productsId: product.products_id,
      productName: product.products_name,
      productsModel: product.products_model,
      size: 'N/A',
      quantity: product.products_quantity,
      smsStock: 0,
      boxNumber: product.box_number,
      productType,
      hasPrinting: hasPrintingAlready,
      isOutOfStock: false,
      warnings,
    };
  }

  // PHP: arrived_status == 'Arrived' means product arrived externally — skip stock picking
  // Does NOT count as out-of-stock (doesn't block order processing)
  if (product.arrived_status === 'Arrived') {
    const hasPrintingAlready = await detectPrintingOptions(product.orders_products_id, tx);
    warnings.push('Product marked as arrived — skipping stock picking');
    return {
      ordersProductsId: product.orders_products_id,
      productsId: product.products_id,
      productName: product.products_name,
      productsModel: product.products_model,
      size: 'N/A',
      quantity: product.products_quantity,
      smsStock: 0,
      boxNumber: '',
      productType,
      hasPrinting: hasPrintingAlready,
      isOutOfStock: false,
      warnings,
    };
  }

  const hasPrintingResult = await detectPrintingOptions(product.orders_products_id, tx);
  const sizeRes = await resolveSmsSize(product.orders_products_id, product.manufacturers_id, tx);
  const codeRes = await resolveProductCode(product.products_model, sizeRes?.sizeId || 0, tx);

  let smsStock = 0;
  let assignedBox = '';
  // Barcode of the picked product_quantities row — written to orders_products.product_barcode
  // so it stays in sync with the pick source (hero child vs parent). Legacy PM #165583.
  let pickedBarcode = '';
  let isOutOfStock = false;
  // PHP: track if hero shirt is picked from pre-printed stock
  let isPrePrintedHeroShirt = product.pick_from_hero_shirt === 'yes';

  // PHP: auto-pick stores skip the entire stock picking block
  if (isAutoPick) {
    warnings.push('Auto-pick store — stock already deducted at order creation');
  } else if (codeRes) {
    const sizeId = sizeRes?.sizeId || 0;
    const stockResult = await checkSmsStock(codeRes.productListsId, sizeId, product.products_quantity, tx);
    smsStock = stockResult.quantity;

    if (stockResult.available) {
      await pickStock(codeRes.productListsId, sizeId, product.products_quantity, stockResult.boxListsId, tx);
      assignedBox = stockResult.boxCode;
      pickedBarcode = stockResult.barcode;
      // PHP line 725: hero shirt with direct stock and parent → pre-printed hero shirt
      if (productType === 'hero_shirt' && codeRes.parentProductListsId) {
        isPrePrintedHeroShirt = true;
      }
    } else if (productType === 'hero_shirt' && codeRes.parentProductListsId) {
      const parentStock = await checkParentStock(
        codeRes.parentProductListsId, sizeId, product.products_quantity,
        product.manufacturers_id, tx
      );
      if (parentStock?.available) {
        await pickStock(parentStock.productListsId, sizeId, product.products_quantity, parentStock.boxListsId, tx);
        assignedBox = parentStock.boxCode;
        pickedBarcode = parentStock.barcode;
        smsStock = parentStock.quantity;
        warnings.push('Stock picked from parent hero shirt product');
      } else {
        isOutOfStock = true;
        warnings.push('No stock available (hero shirt or parent)');
      }
    } else if (productType === 'tshirt') {
      assignedBox = 'TSHIRTS';
      warnings.push('T-shirt — JIT marked');
    } else {
      isOutOfStock = true;
      warnings.push('Insufficient stock in SMS');
    }
  } else if (!isAutoPick) {
    isOutOfStock = true;
    warnings.push('Product code not found in SMS product_lists');
  }

  // Update box_number (+ jit_marked / product_barcode / printing_status) on orders_products.
  // Mirrors legacy build_box_number_update_sql (general.php:13011, PM #164876 + #165583):
  //   - jit_marked='yes' when the assigned box is ANY JIT box (TSHIRTS/HOLD/DELIVERY) — the
  //     prior port only marked TSHIRTS, so HOLD/DELIVERY-routed lines were left un-JIT'd.
  //   - product_barcode set to the picked product_quantities.barcode when non-empty (skip empty
  //     to avoid wiping an existing value).
  //   - printing_status='Printed' for pre-printed hero shirts (legacy $additional_set).
  if (assignedBox) {
    const setClauses = [Prisma.sql`box_number = ${assignedBox}`];
    if (JIT_BOX_CODE_LIST.includes(assignedBox.trim().toUpperCase())) {
      setClauses.push(Prisma.sql`jit_marked = 'yes'`);
    }
    if (pickedBarcode) {
      setClauses.push(Prisma.sql`product_barcode = ${pickedBarcode}`);
    }
    if (isPrePrintedHeroShirt) {
      setClauses.push(Prisma.sql`printing_status = 'Printed'`);
    }
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE orders_products SET ${Prisma.join(setClauses, ', ')}
        WHERE orders_products_id = ${product.orders_products_id}
      `
    );
  } else if (isPrePrintedHeroShirt && isAutoPick) {
    // PHP lines 851-873: auto-pick store with hero_product_quantity == '1'
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE orders_products SET printing_status = 'Printed'
        WHERE orders_products_id = ${product.orders_products_id}
      `
    );
  }

  // Type-specific warnings
  if (productType === 'toffs') warnings.push('Toffs product — requires retro shirt processing');
  if (productType === 'copa') warnings.push('Copa product — requires retro shirt processing');
  if (hasPrintingResult) warnings.push('Product has printing/personalization options');

  return {
    ordersProductsId: product.orders_products_id,
    productsId: product.products_id,
    productName: product.products_name,
    productsModel: product.products_model,
    size: sizeRes?.sizeName || 'N/A',
    quantity: product.products_quantity,
    smsStock,
    boxNumber: assignedBox,
    productType,
    hasPrinting: hasPrintingResult,
    isOutOfStock,
    warnings,
  };
}

// aggregateProductResults + determineProposedStatus relocated to processing.status.ts
// (pure, unit-tested). They now apply the legacy pre-order(12) / OOS(2) override
// precedence — see that module.

/**
 * Get eligible statuses from DB configuration.
 */
async function getEligibleStatuses(): Promise<number[]> {
  const config = await loadDbConfiguration();
  // PHP: zencconfigure.php defines this as '1,12,22,23,128' — it's NOT in the DB configuration table
  const raw = config.get('ORDER_PROCESSING_SIMULATION_ELIGIBLE_STATUSES') || '1,12,22,23,128';
  return raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
}

/**
 * Apply the 15-minute same-customer rule (PHP: order_processing_new.php lines 60-107).
 * If consecutive orders from the same non-marketplace customer are within 15 minutes,
 * both orders are flagged for manual processing.
 *
 * @returns Set of order IDs that should be flagged (not auto-processed)
 */
async function apply15MinuteRule(orderIds: number[]): Promise<Set<number>> {
  if (orderIds.length <= 1) return new Set();

  // Fetch customer IDs and order dates for all orders
  const rows = await prisma.$queryRaw<Array<{
    orders_id: number;
    customers_id: number;
    date_purchased: string | null;
  }>>(
    Prisma.sql`
      SELECT orders_id, customers_id,
        NULLIF(date_purchased, '0000-00-00 00:00:00') AS date_purchased
      FROM orders
      WHERE orders_id IN (${Prisma.join(orderIds)})
      ORDER BY date_purchased ASC
    `
  );

  const flagged = new Set<number>();
  // Track last seen order per customer: { orderId, dateAdded }
  const customerTracker = new Map<number, { orderId: number; dateAdded: Date }>();

  for (const row of rows) {
    // Skip marketplace orders (customers_id = 0)
    if (row.customers_id === 0 || !row.date_purchased) continue;

    const currentDate = new Date(row.date_purchased);

    if (customerTracker.has(row.customers_id)) {
      const prev = customerTracker.get(row.customers_id)!;
      const prevPlus15 = new Date(prev.dateAdded.getTime() + 15 * 60 * 1000);

      if (prevPlus15 >= currentDate) {
        // Within 15 minutes — flag both orders
        flagged.add(prev.orderId);
        flagged.add(row.orders_id);
      }
    }

    // Always update tracker to current order (PHP does this regardless of flagging)
    customerTracker.set(row.customers_id, {
      orderId: row.orders_id,
      dateAdded: currentDate,
    });
  }

  return flagged;
}

/**
 * Insert pre_processed_order_products rows with status=3 for a flagged order
 * (15-minute rule). These orders need manual processing.
 */
async function flagOrderForManualProcessing(orderId: number): Promise<void> {
  // Legacy order_processing_new.php:100 (PMS 115091) flips the order's EXISTING
  // queue rows to status 3 — it does NOT insert new rows. The producer already
  // queued the order (status 0) at creation, so we UPDATE those rows in place.
  //
  // Inserting status-3 rows alongside the live status-0 rows (the previous
  // implementation) failed to remove the order from the batch: the eligibility
  // SELECT filters status IN (0,4), so the original status-0 rows still matched
  // and the order was processed anyway. The UPDATE is what actually pulls it out.
  //
  // The table has no unique key on (orders_id, orders_products_id) and already
  // holds duplicate groups, so ON DUPLICATE KEY UPDATE / a real upsert is not an
  // option — the keyed-by-orders_id UPDATE is both faithful and correct.
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE pre_processed_order_products
      SET status = 3, date_modified = NOW()
      WHERE orders_id = ${orderId}
    `
  );
}

/**
 * Resolve admin name from admin ID for status history comment_by.
 * PHP uses $_SESSION['adminn_name'] — we look it up from sms_users.
 */
async function resolveAdminNameById(client: TxClient, adminId: number): Promise<string> {
  const rows = await client.$queryRaw<Array<{ name: string }>>(
    Prisma.sql`SELECT name FROM sms_users WHERE id = ${adminId} LIMIT 1`
  );
  return rows[0]?.name || String(adminId);
}

/**
 * Build an ineligible simulation result.
 */
function buildIneligibleResult(orderId: number, reason: string): SimulationResult {
  return {
    orderId,
    eligible: false,
    reason,
    products: [],
    proposedStatus: 0,
    proposedStatusName: '',
    hasRetroProducts: false,
    hasPrintingProducts: false,
    totalProducts: 0,
    stockAvailableCount: 0,
  };
}
