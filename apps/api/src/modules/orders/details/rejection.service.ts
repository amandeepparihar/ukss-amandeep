/**
 * Order rejection service — handles all 5 rejection types for SPEC-03 (REQ-03-010).
 *
 * Rejection types:
 *   1 = reject         — Status change only (orders_status=112, refund_status_for_reject_orders=1)
 *   2 = rejectlink     — Insert row into reject_and_link_requests for SMS linking
 *   3 = rejectdelete   — Disable matching size attributes in products_attributes (pa_status=0)
 *   4 = rejectdisable  — Set products.products_status=0 for all products (+ hero shirt family)
 *   5 = rejectDeleteFE — Set products.products_status=4 for all products (+ hero shirt family)
 *
 * CX-001 / REQ-03-010: All DB writes within a single $transaction to guarantee atomicity.
 * Common rejection + type-specific side-effects all run inside one interactive transaction.
 *
 * Ported from: webadmin/includes/functions/extra_functions/reject_order_and_perform_given_action.php
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { REJECTED_ORDER_STATUS } from '../orders.constants';

const logger = createLogger('orders-rejection');

/** Transaction client type for threading through helpers */
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type RejectionActionType = 1 | 2 | 3 | 4 | 5;

export interface RejectionResult {
  result: 'success' | 'error';
  message: string;
}

/**
 * REQ-03-010: Reject an order with optional side-effect.
 * All writes execute inside a single interactive transaction for atomicity.
 *
 * @param orderId    The orders.orders_id to reject
 * @param actionType 1–5 corresponding to the rejection variant
 * @returns          Result indicating success or error with a descriptive message
 */
export async function rejectOrder(
  orderId: number,
  actionType: RejectionActionType,
): Promise<RejectionResult> {
  const actionLabel = ACTION_LABELS[actionType];
  logger.info({ orderId, actionType, actionLabel }, 'Starting order rejection');

  try {
    const sideEffectMsg = await prisma.$transaction(async (tx) => {
      // Phase 1: Common rejection (status + history + box columns)
      const statusUpdated = await executeCommonRejection(tx, orderId);
      if (!statusUpdated) {
        throw new RejectionAbortError(orderId);
      }

      // Phase 2: Type-specific side-effect (within same transaction)
      return executeSideEffect(tx, orderId, actionType);
    }, { timeout: 30_000 }); // 30s timeout for complex side-effects

    const message = `Order ${orderId} has been marked as rejected.`
      + (sideEffectMsg ? ` ${sideEffectMsg}` : '');

    logger.info({ orderId, actionType }, 'Order rejection completed successfully');
    return { result: 'success', message };
  } catch (err) {
    if (err instanceof RejectionAbortError) {
      logger.warn({ orderId }, 'Order status update affected 0 rows — aborting');
      return {
        result: 'error',
        message: `Failed to mark order ${orderId} as rejected. The order may already be rejected or does not exist.`,
      };
    }
    logger.error({ orderId, actionType, err }, 'Order rejection failed');
    return {
      result: 'error',
      message: `An unexpected error occurred while rejecting order ${orderId}. Please try again.`,
    };
  }
}

/** Sentinel error to abort the transaction without logging as unexpected */
class RejectionAbortError extends Error {
  constructor(orderId: number) {
    super(`Rejection aborted for order ${orderId}`);
    this.name = 'RejectionAbortError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<RejectionActionType, string> = {
  1: 'reject',
  2: 'rejectlink',
  3: 'rejectdelete',
  4: 'rejectdisable',
  5: 'rejectDeleteFromFrontEnd',
};

// ---------------------------------------------------------------------------
// Phase 1: Common rejection — status update + history + box columns
// ---------------------------------------------------------------------------

/**
 * 1. SET orders.orders_status = 112, refund_status_for_reject_orders = 1
 * 2. INSERT into orders_status_history
 * 3. SET box1/box2/box3 = 'Rejected' for unshipped products
 *
 * Returns true if the status update affected exactly 1 row.
 */
async function executeCommonRejection(tx: TxClient, orderId: number): Promise<boolean> {
  const affectedRows: number = await tx.$executeRaw(
    Prisma.sql`UPDATE orders
               SET orders_status = ${REJECTED_ORDER_STATUS},
                   refund_status_for_reject_orders = 1
               WHERE orders_id = ${orderId}`,
  );

  if (affectedRows !== 1) return false;

  await tx.$executeRaw(
    Prisma.sql`INSERT INTO orders_status_history
                 (orders_id, orders_status_id, date_added, customer_notified, comments)
               VALUES
                 (${orderId}, ${REJECTED_ORDER_STATUS}, NOW(), 0, '')`,
  );

  await tx.$executeRaw(
    Prisma.sql`UPDATE orders_products
               SET box1 = 'Rejected', box2 = 'Rejected', box3 = 'Rejected'
               WHERE orders_id = ${orderId} AND ship_chk = 'no'`,
  );

  return true;
}

// ---------------------------------------------------------------------------
// Phase 2: Side-effect dispatcher
// ---------------------------------------------------------------------------

async function executeSideEffect(
  tx: TxClient,
  orderId: number,
  actionType: RejectionActionType,
): Promise<string> {
  switch (actionType) {
    case 1: return '';
    case 2: return executeRejectLink(tx, orderId);
    case 3: return executeRejectDelete(tx, orderId);
    case 4: return setProductStatus(tx, orderId, 0, 'disabled');
    case 5: return setProductStatus(tx, orderId, 4, 'marked as deleted from front end');
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Type 2: Reject & Link — insert into reject_and_link_requests
// ---------------------------------------------------------------------------

interface OrderProductModelRow {
  products_id: number;
  products_model: string | null;
}

interface ProductListIdRow {
  product_lists_id: number;
}

/**
 * For each product in the order, find its product_lists_id by matching
 * products_model to product_lists.product_code. Then insert a row into
 * reject_and_link_requests(products_id, order_product_lists_id) so the
 * legacy link_rejected_order_products.php cron can process it.
 */
async function executeRejectLink(tx: TxClient, orderId: number): Promise<string> {
  const products = await tx.$queryRaw<OrderProductModelRow[]>(
    Prisma.sql`SELECT DISTINCT op.products_id, p.products_model
               FROM orders_products op
               JOIN products p ON op.products_id = p.products_id
               WHERE op.orders_id = ${orderId}
                 AND p.products_model IS NOT NULL
                 AND p.products_model != ''`,
  );

  if (products.length === 0) return 'No products found to link.';

  let linkedCount = 0;
  let notFoundCount = 0;

  for (const product of products) {
    if (!product.products_model) {
      notFoundCount++;
      continue;
    }

    const plRows = await tx.$queryRaw<ProductListIdRow[]>(
      Prisma.sql`SELECT product_lists_id
                 FROM product_lists
                 WHERE product_code = ${product.products_model}
                 LIMIT 1`,
    );

    if (plRows.length === 0) {
      notFoundCount++;
      logger.warn({ productsId: product.products_id, model: product.products_model },
        'Product model not found in product_lists — skipping link');
      continue;
    }

    // Hero shirt: if product has a hero_shirt_parent, use that as the products_id
    const parentRows = await tx.$queryRaw<Array<{ hero_shirt_parent: number | null }>>(
      Prisma.sql`SELECT hero_shirt_parent FROM products WHERE products_id = ${product.products_id}`,
    );
    const heroParent = parentRows[0]?.hero_shirt_parent;
    const effectiveProductId = (heroParent && heroParent > 0) ? heroParent : product.products_id;

    await tx.$executeRaw(
      Prisma.sql`INSERT INTO reject_and_link_requests (products_id, order_product_lists_id)
                 VALUES (${effectiveProductId}, ${plRows[0].product_lists_id})`,
    );
    linkedCount++;
  }

  const parts: string[] = [];
  if (linkedCount > 0) parts.push(`Linked ${linkedCount} product(s) with SMS.`);
  if (notFoundCount > 0) parts.push(`${notFoundCount} product(s) could not be linked (not found in SMS).`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Type 3: Reject & Remove Size — disable size attributes in products_attributes
// ---------------------------------------------------------------------------

interface OrderProductAttributeRow {
  products_id: number;
  products_options_id: number;
  products_options_values_id: number;
}

/**
 * For each product in the order that has a size attribute, disable the matching
 * row in products_attributes (set pa_status = 0) and product_feed_variations
 * (set pfv_variation_status = 0).
 *
 * Hero shirt handling: if the product has a hero_shirt_parent, operate on the
 * parent product and all its children.
 */
async function executeRejectDelete(tx: TxClient, orderId: number): Promise<string> {
  const attrs = await tx.$queryRaw<OrderProductAttributeRow[]>(
    Prisma.sql`SELECT DISTINCT op.products_id, opa.products_options_id, opa.products_options_values_id
               FROM orders_products op
               JOIN orders_products_attributes opa ON op.orders_products_id = opa.orders_products_id
               WHERE op.orders_id = ${orderId}
                 AND opa.products_options LIKE '%ize%'
                 AND opa.products_options_values_id != 0`,
  );

  if (attrs.length === 0) return 'No size attributes found to remove.';

  let disabledCount = 0;

  for (const attr of attrs) {
    const familyIds = await resolveProductFamily(tx, attr.products_id);

    for (const productId of familyIds) {
      const affected = await tx.$executeRaw(
        Prisma.sql`UPDATE products_attributes
                   SET pa_status = 0
                   WHERE products_id = ${productId}
                     AND options_id = ${attr.products_options_id}
                     AND options_values_id = ${attr.products_options_values_id}`,
      );

      await tx.$executeRaw(
        Prisma.sql`UPDATE product_feed_variations
                   SET pfv_variation_status = 0
                   WHERE pfv_product_id = ${productId}
                     AND pfv_product_option_values_id = ${attr.products_options_values_id}`,
      );

      if (affected > 0) disabledCount++;
    }
  }

  if (disabledCount > 0) return `Disabled ${disabledCount} size attribute(s) across product families.`;
  return 'No matching size attributes found in products_attributes.';
}

// ---------------------------------------------------------------------------
// Types 4 & 5: Set products_status for all products in an order
// ---------------------------------------------------------------------------

interface OrderProductIdRow {
  products_id: number;
}

/**
 * Shared between type 4 (disable → status=0) and type 5 (delete from FE → status=4).
 * Fetches all products_id from orders_products, resolves hero shirt families,
 * and sets products.products_status to the given value.
 */
async function setProductStatus(
  tx: TxClient,
  orderId: number,
  statusValue: number,
  actionDescription: string,
): Promise<string> {
  const productRows = await tx.$queryRaw<OrderProductIdRow[]>(
    Prisma.sql`SELECT DISTINCT products_id FROM orders_products WHERE orders_id = ${orderId}`,
  );

  if (productRows.length === 0) return 'No products found in order.';

  const allProductIds = new Set<number>();
  for (const row of productRows) {
    const familyIds = await resolveProductFamily(tx, row.products_id);
    for (const id of familyIds) allProductIds.add(id);
  }

  if (allProductIds.size === 0) return 'No products found to update.';

  const idsJoin = Prisma.join(Array.from(allProductIds));
  const affected = await tx.$executeRaw(
    Prisma.sql`UPDATE products
               SET products_status = ${statusValue},
                   products_last_modified = NOW()
               WHERE products_id IN (${idsJoin})`,
  );

  logger.info({ orderId, statusValue, productCount: affected }, `Products ${actionDescription}`);
  if (affected > 0) return `${affected} product(s) ${actionDescription}.`;
  return `No products were ${actionDescription}.`;
}

// ---------------------------------------------------------------------------
// Helper: Resolve hero shirt product family
// ---------------------------------------------------------------------------

interface HeroShirtRow {
  products_id: number;
  hero_shirt_parent: number | null;
}

/**
 * Given a products_id, check if it has a hero_shirt_parent (is a child).
 * If it does, find the parent + all siblings. If not, check if it IS a parent.
 * Returns all products_id values in the family, or just [productsId] if standalone.
 */
async function resolveProductFamily(tx: TxClient, productsId: number): Promise<number[]> {
  const rows = await tx.$queryRaw<HeroShirtRow[]>(
    Prisma.sql`SELECT products_id, hero_shirt_parent
               FROM products
               WHERE products_id = ${productsId}`,
  );

  if (rows.length === 0) return [productsId];

  const heroParent = rows[0].hero_shirt_parent;
  const parentId = (heroParent && heroParent > 0) ? heroParent : productsId;

  const familyRows = await tx.$queryRaw<Array<{ products_id: number }>>(
    Prisma.sql`SELECT products_id FROM products
               WHERE products_id = ${parentId} OR hero_shirt_parent = ${parentId}`,
  );

  if (familyRows.length === 0) return [productsId];
  return familyRows.map(r => r.products_id);
}
