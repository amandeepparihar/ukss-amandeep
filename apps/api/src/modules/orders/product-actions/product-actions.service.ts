/**
 * Product-level actions service — box number, JIT, ship check, printing/arrived toggles, box fields.
 * Requirements: REQ-06-001 through REQ-06-011, REQ-06-021 through REQ-06-026
 *
 * Ported from orders.php lines 3949-4290 (box number), 1575-1682 (JIT),
 * 4730-4744 (ship check), 2970-3033 (printing/arrived), 4486-4515 (box1/box2).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { FC_BOX_NUMBER, START_FROM_WHICH_ORDER, JIT_BOX_CODE_LIST } from '../orders.constants';
import { formatDdMmYyyy, hasFcOrder } from '../orders.helpers';
import type {
  ProductActionResult, ProductStatusRow, MultipartBatchCheckRow,
  JitBoxDataRow, OrderIdFromProductRow,
} from './product-actions.types';

const logger = createLogger('product-actions');

// ---------------------------------------------------------------------------
// A. Box Number Management (REQ-06-001 through REQ-06-007)
// ---------------------------------------------------------------------------

/**
 * REQ-06-001 through REQ-06-007: Assign box number to order product.
 * Validation order (per spec appendix + orders.php:3949-4270):
 * 1. Check backorder status + read current box (REQ-06-002, REQ-06-006) — combined query
 * 2. Block manual FC2023 entry (REQ-06-003)
 * 3. Handle TSHIRTS auto-JIT (REQ-06-006)
 * 4+5. Check FC multipart batch + FC order exists (REQ-06-004, REQ-06-005) — parallel
 * 6. Perform UPDATE (REQ-06-001)
 * 7. Blank SKU inventory deduction (REQ-06-007)
 */
export async function updateBoxNumber(
  orderId: number,
  orderProductId: number,
  boxNumber: string,
): Promise<ProductActionResult> {
  let toBeRefresh = false;

  // Step 1 — Combined query: backorder status + current box number (saves 1 round trip)
  const statusRows = await prisma.$queryRaw<ProductStatusRow[]>(Prisma.sql`
    SELECT backorder, box_number FROM orders_products WHERE orders_products_id = ${orderProductId}
  `);
  if (statusRows.length > 0 && statusRows[0].backorder === 'Yes') {
    return {
      status: 'error',
      message: "Sorry, you can't pick this product from the box because it is already marked as backorder.",
    };
  }

  // Step 2 — REQ-06-003: Block manual FC2023 entry
  if (boxNumber.toUpperCase() === FC_BOX_NUMBER) {
    return { status: 'error', message: "You can't change/enter the box number to FC2023." };
  }

  // Step 3 — REQ-06-006 / PMS #164876: Auto-JIT for any JIT box code.
  // SET side is generalised to JIT_BOX_CODE_LIST (TSHIRTS, HOLD, DELIVERY) — parity with
  // legacy orders.php:4255-4261 ($jit_clause appended when box_num ∈ JIT_BOX_CODES).
  const currentBox = statusRows.length > 0 ? (statusRows[0].box_number ?? '') : '';
  const newBoxUpper = boxNumber.toUpperCase();

  if (JIT_BOX_CODE_LIST.includes(newBoxUpper)) {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE orders_products SET jit_marked = 'yes'
      WHERE orders_id = ${orderId} AND orders_products_id = ${orderProductId}
    `);
    toBeRefresh = true;
  }

  // UNSET side is intentionally NOT generalised: legacy only clears JIT when moving OFF
  // TSHIRTS (orders.php:4140-4164); #164876 generalised the SET but never the UNSET, so
  // HOLD/DELIVERY -> normal leaves jit_marked unchanged in zenc. Matching that keeps
  // zenc-vs-stock2 parity on the shared DB. (See #1045 — generalising this would need a
  // matching change in zenc first.)
  if (currentBox.toUpperCase() === 'TSHIRTS' && newBoxUpper !== 'TSHIRTS') {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE orders_products SET jit_marked = 'no'
      WHERE orders_id = ${orderId} AND orders_products_id = ${orderProductId}
    `);
    toBeRefresh = true;
  }

  // Steps 4+5 — Parallel: multipart FC batch + FC order check (saves 1 round trip)
  const [multipartRows, fcOrderExists] = await Promise.all([
    prisma.$queryRaw<MultipartBatchCheckRow[]>(Prisma.sql`
      SELECT orders_products_id, multipart_batch_id FROM orders_products
      WHERE orders_products_id = ${orderProductId}
        AND multipart_batch_id IS NOT NULL
        AND box_number = ${FC_BOX_NUMBER}
    `),
    hasFcOrder([orderProductId]),
  ]);

  if (multipartRows.length > 0) {
    return {
      status: 'error',
      message: 'This product is part of a multipart FC batch so you can not change the box number.',
    };
  }
  if (fcOrderExists) {
    return {
      status: 'error',
      message: "Box number can't be changed as order already created on FC",
    };
  }

  // Step 6 — REQ-06-001: Perform the box number UPDATE
  const updateResult: number = await prisma.$executeRaw(Prisma.sql`
    UPDATE orders_products SET box_number = ${boxNumber}
    WHERE orders_id = ${orderId} AND orders_products_id = ${orderProductId}
  `);

  // Step 7 — REQ-06-007: Blank SKU inventory deduction (only if update affected rows)
  if (updateResult > 0) {
    try {
      await deductBlankSkuInventory(orderProductId, orderId);
    } catch (err) {
      // Deduction failure does not block the box number assignment (spec line 89)
      logger.error({ err, orderId, orderProductId }, 'Blank SKU deduction failed');
    }
  }

  logger.info({ orderId, orderProductId, boxNumber }, 'Box number updated');

  // PHP: $to_be_refresh → 'success' (JIT was toggled, client does a full refresh)
  //      !$to_be_refresh → 'refresh' (normal box update, client refreshes inline)
  return {
    status: toBeRefresh ? 'success' : 'refresh',
    message: 'Box number updated',
  };
}

/**
 * REQ-06-007: Deduct blank SKU inventory for printed t-shirts.
 * Idempotent via is_quantity_deducted flag.
 * Wrapped in transaction: deduction + flag must be atomic to avoid stock discrepancy.
 */
async function deductBlankSkuInventory(orderProductId: number, orderId: number): Promise<void> {
  if (orderId <= START_FROM_WHICH_ORDER) return;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE orders_products op
      INNER JOIN orders_products_attributes opa
        ON op.orders_products_id = opa.orders_products_id
      INNER JOIN products_to_blankskus ptb
        ON ptb.ordered_product = op.products_id
      INNER JOIN blank_skus_inventory bsi
        ON bsi.blank_products_id = ptb.blank_product
        AND bsi.product_option_id = opa.products_options_id
        AND bsi.product_option_value_id = opa.products_options_values_id
      SET bsi.quantity = bsi.quantity - 1
      WHERE op.is_quantity_deducted = 0
        AND op.orders_id > ${START_FROM_WHICH_ORDER}
        AND op.orders_products_id = ${orderProductId}
    `);

    await tx.$executeRaw(Prisma.sql`
      UPDATE orders_products SET is_quantity_deducted = '1'
      WHERE orders_products_id = ${orderProductId}
    `);
  });
}

// ---------------------------------------------------------------------------
// B. JIT Toggle (REQ-06-008 through REQ-06-011)
// ---------------------------------------------------------------------------

/**
 * REQ-06-008 through REQ-06-011: Toggle JIT status with FC validation.
 */
export async function toggleJit(
  orderProductId: number,
  checkBit: 'yes' | 'no',
): Promise<ProductActionResult> {
  // REQ-06-009: Check FC order exists
  if (await hasFcOrder([orderProductId])) {
    return {
      status: 'error',
      message: 'Order Already created on FC. Cannot mark/unmark as JIT.',
    };
  }

  // REQ-06-010 + REQ-06-011: Check multipart batch and FC2023 box
  const boxDataRows = await prisma.$queryRaw<JitBoxDataRow[]>(Prisma.sql`
    SELECT box_number, multipart_batch_id FROM orders_products
    WHERE orders_products_id = ${orderProductId}
  `);

  if (boxDataRows.length > 0) {
    const { box_number, multipart_batch_id } = boxDataRows[0];

    if (multipart_batch_id != null) {
      return {
        status: 'error',
        message: 'Already added to Multipart FC Batch. Cannot unmark as JIT.',
      };
    }

    if (checkBit === 'yes' && box_number?.toUpperCase() === FC_BOX_NUMBER) {
      return {
        status: 'error',
        message: 'System can not mark the product as JIT because it has been picked from FC2023',
      };
    }
  }

  // REQ-06-008: Perform the JIT update
  await prisma.$executeRaw(Prisma.sql`
    UPDATE orders_products SET jit_marked = ${checkBit}
    WHERE orders_products_id = ${orderProductId}
  `);

  logger.info({ orderProductId, checkBit }, 'JIT toggled');

  return { status: 'success', message: 'JIT Marked Successfully' };
}

/**
 * Guarded JIT-clear used by callers that opportunistically unmark JIT
 * (backorder, box1 cancel/reject). Mirrors legacy `invoke_jit_unmark_via_action`
 * (orders.php:1735, PMS #165637): pre-check jit_marked='yes' to skip no-ops, then
 * route through toggleJit so the FC-order / multipart / FC2023 guards apply identically.
 * Never throws — a guard rejection must not abort the calling action.
 */
export async function invokeJitUnmark(orderProductId: number): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ jit_marked: string | null }>>(Prisma.sql`
    SELECT jit_marked FROM orders_products WHERE orders_products_id = ${orderProductId}
  `);
  if (rows.length === 0 || (rows[0].jit_marked ?? '').toLowerCase() !== 'yes') {
    return;
  }
  try {
    const result = await toggleJit(orderProductId, 'no');
    logger.info({ orderProductId, result }, 'JIT cleared via invokeJitUnmark');
  } catch (err) {
    logger.error({ err, orderProductId }, 'invokeJitUnmark failed');
  }
}

// ---------------------------------------------------------------------------
// D. Ship Check Toggle (REQ-06-021)
// ---------------------------------------------------------------------------

/**
 * REQ-06-021: Toggle ship check. When checked, auto-populate box1/box2/box3 with date.
 */
export async function updateShipCheck(
  orderId: number,
  orderProductId: number,
  shipChk: 'yes' | 'no',
): Promise<ProductActionResult> {
  // Combined UPDATE: ship_chk + ship_date + (optionally) box dates in one query
  if (shipChk === 'yes') {
    const dateStr = formatDdMmYyyy(new Date());
    await prisma.$executeRaw(Prisma.sql`
      UPDATE orders_products
      SET box1 = ${dateStr}, box2 = ${dateStr}, box3 = ${dateStr},
          ship_chk = 'yes', ship_date = NOW()
      WHERE orders_id = ${orderId} AND orders_products_id = ${orderProductId}
    `);
  } else {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE orders_products SET ship_chk = 'no', ship_date = NOW()
      WHERE orders_id = ${orderId} AND orders_products_id = ${orderProductId}
    `);
  }

  logger.info({ orderId, orderProductId, shipChk }, 'Ship check updated');

  return { status: 'success', message: `Ship check set to ${shipChk}` };
}

// ---------------------------------------------------------------------------
// E. Printing Status Toggle (REQ-06-022)
// ---------------------------------------------------------------------------

/**
 * REQ-06-022: Toggle printing status between 'Printed' and 'Not Printed'.
 */
export async function updatePrintingStatus(
  orderId: number,
  orderProductId: number,
  printed: 'Printed' | 'Not Printed',
): Promise<ProductActionResult> {
  const affected = await prisma.$executeRaw(Prisma.sql`
    UPDATE orders_products SET printing_status = ${printed}
    WHERE orders_id = ${orderId} AND orders_products_id = ${orderProductId}
  `);

  if (affected === 0) {
    return { status: 'error', message: 'Product not found or not updated' };
  }

  logger.info({ orderId, orderProductId, printed }, 'Printing status updated');
  return {
    status: 'success',
    message: printed === 'Printed' ? 'success_printed' : 'success_not_printed',
  };
}

// ---------------------------------------------------------------------------
// E. Arrived Status Toggle (REQ-06-023)
// ---------------------------------------------------------------------------

/**
 * REQ-06-023: Toggle arrived status.
 * PHP source (orders.php:2990-3031): Simple UPDATE + affected rows check.
 */
export async function updateArrivedStatus(
  orderId: number,
  orderProductId: number,
  arrived: 'Arrived' | 'Not Arrived',
): Promise<ProductActionResult> {
  const affected = await prisma.$executeRaw(Prisma.sql`
    UPDATE orders_products SET arrived_status = ${arrived}
    WHERE orders_id = ${orderId} AND orders_products_id = ${orderProductId}
  `);

  if (affected === 0) {
    return { status: 'error', message: 'Product not found or not updated' };
  }

  logger.info({ orderId, orderProductId, arrived }, 'Arrived status updated');
  return {
    status: 'success',
    message: arrived === 'Arrived' ? 'success_arrived' : 'success_not_arrived',
  };
}

// ---------------------------------------------------------------------------
// E. Box1 / Box2 Free Text (REQ-06-025, REQ-06-026)
// ---------------------------------------------------------------------------

/**
 * REQ-06-025: Update box1 field and order_updates_track.
 */
export async function updateBox1(
  orderProductId: number,
  value: string,
): Promise<ProductActionResult> {
  return updateBoxField('box1', orderProductId, value);
}

/**
 * REQ-06-026: Update box2 field and order_updates_track.
 */
export async function updateBox2(
  orderProductId: number,
  value: string,
): Promise<ProductActionResult> {
  return updateBoxField('box2', orderProductId, value);
}

/**
 * Shared implementation for box1/box2 field updates with order_updates_track.
 */
async function updateBoxField(
  field: 'box1' | 'box2',
  orderProductId: number,
  value: string,
): Promise<ProductActionResult> {
  // Update the field value (Prisma.raw safe: field is constrained to 'box1'|'box2')
  await prisma.$executeRaw(Prisma.sql`
    UPDATE orders_products SET ${Prisma.raw(field)} = ${value}
    WHERE orders_products_id = ${orderProductId}
  `);

  // box1 Cancelled/Rejected side-effects — box1 only (box2 is dead UI in legacy).
  // This is the NON-modal path, parity with legacy orders.php:4622-4651. The cancel-restock
  // decision modal + atomic inventory restock (legacy 4568-4619 + cancel_restock_preview)
  // is tracked as #1044 slice B and is intentionally NOT implemented here.
  const norm = value.trim().toLowerCase();

  // Unpick (PMS #165732): clear box_number when box1 = Cancelled so the Pick checkbox
  // unchecks on next render (legacy orders.php:4624-4632).
  if (field === 'box1' && norm === 'cancelled') {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE orders_products SET box_number = NULL WHERE orders_products_id = ${orderProductId}
    `);
  }

  // Look up the order_id from the product
  const orderRows = await prisma.$queryRaw<OrderIdFromProductRow[]>(Prisma.sql`
    SELECT orders_id FROM orders_products WHERE orders_products_id = ${orderProductId}
  `);

  if (orderRows.length > 0) {
    // Upsert order_updates_track (eliminates TOCTOU race + saves 1 round trip)
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO order_updates_track (order_id, update_time, users_id)
      VALUES (${orderRows[0].orders_id}, NOW(), '')
      ON DUPLICATE KEY UPDATE update_time = NOW(), users_id = ''
    `);
  }

  // JIT-unmark on Cancelled/Rejected (PMS #165637, legacy orders.php:4646-4651). Guarded +
  // non-throwing inside invokeJitUnmark; prevents cancelled/rejected JIT lines leaking into
  // the JIT FC bucket.
  if (field === 'box1' && (norm === 'cancelled' || norm === 'rejected')) {
    await invokeJitUnmark(orderProductId);
  }

  logger.info({ orderProductId, field, value }, 'Box field updated');

  return { status: 'success', message: `${field} updated` };
}
