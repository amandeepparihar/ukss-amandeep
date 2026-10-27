/**
 * SPEC-13: Shared SQL query builders for order processing.
 * Requirements: REQ-13-001 (simulation), REQ-13-004 (execute), REQ-13-006 (batch)
 *
 * These queries are shared between simulation (read-only) and execution (writes)
 * to guarantee identical logic.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import type {
  TxClient,
  OrderForProcessingRow,
  OrderProductForProcessingRow,
} from './processing.types';

// ---------------------------------------------------------------------------
// Fetch order data for processing
// ---------------------------------------------------------------------------

/**
 * Fetch order with customer fraud info for processing eligibility check.
 * Wraps zero-date columns and casts BigInt columns per CLAUDE.md rules.
 */
export async function fetchOrderForProcessing(
  orderId: number,
  client: TxClient = prisma
): Promise<OrderForProcessingRow | null> {
  const rows = await client.$queryRaw<OrderForProcessingRow[]>(
    Prisma.sql`
      SELECT
        o.orders_id,
        o.orders_status,
        o.locked_order,
        o.order_site,
        o.customers_id,
        o.riskified_status,
        c.approve_customer,
        COALESCE(c.fraud_status, '0') AS fraud_status,
        o.multisite_order_id,
        CAST(o.fruugo_orders_id AS CHAR) AS fruugo_orders_id,
        o.amazon_orders_id AS amazon_order_id,
        o.ebay_orders_id,
        o.order_process_status,
        NULLIF(o.ship_by_date, '0000-00-00 00:00:00') AS ship_by_date,
        COALESCE(o.sift_score_bit, '0') AS sift_score_bit,
        COALESCE(sm.auto_pick, 'no') AS auto_pick
      FROM orders o
      LEFT JOIN customers c ON o.customers_id = c.customers_id
      LEFT JOIN store_management sm ON o.order_site = sm.store_id
      WHERE o.orders_id = ${orderId}
    `
  );

  return rows.length > 0 ? rows[0] : null;
}

// ---------------------------------------------------------------------------
// Fetch order products with product details
// ---------------------------------------------------------------------------

/**
 * Fetch all products for an order with relevant product/manufacturer data.
 */
export async function fetchOrderProducts(
  orderId: number,
  client: TxClient = prisma
): Promise<OrderProductForProcessingRow[]> {
  return client.$queryRaw<OrderProductForProcessingRow[]>(
    Prisma.sql`
      SELECT
        op.orders_products_id,
        op.products_id,
        op.products_name,
        op.products_model,
        op.products_quantity,
        op.box_number,
        op.printing_status,
        op.jit_marked,
        op.backorder,
        op.scanning_status,
        COALESCE(op.arrived_status, '') AS arrived_status,
        COALESCE(op.pick_from_hero_shirt, 'no') AS pick_from_hero_shirt,
        COALESCE(op.scan_checkpoint, '') AS scan_checkpoint,
        p.virtual_product_type_id,
        p.toffs,
        p.copa,
        p.hero_shirt_parent,
        p.hero_shirts,
        p.manufacturers_id
      FROM orders_products op
      LEFT JOIN products p ON op.products_id = p.products_id
      WHERE op.orders_id = ${orderId}
        AND op.refund != '1'
        AND op.backorder = 'No'
    `
  );
}

/**
 * Resolve which order lines are pre-order products.
 *
 * Legacy parity: order_processing_new.php builds `$pre_order_products_array` via
 * zen_get_all_pre_order_products(0) — `SELECT products_id, products_options_values_id
 * FROM products_attributes_infos WHERE pre_order='Yes'` (general.php:6144-6178) — and
 * matches each Size attribute as `products_id . ':' . products_options_values_id`
 * (order_processing_new.php:898-913). We resolve the same membership to the set of
 * orders_products_id values so the caller can skip the pick and force status 12.
 *
 * Columns verified present in zenc_main_db (2026-06-23):
 *   products_attributes_infos(pre_order, products_id, products_options_values_id),
 *   orders_products_attributes(orders_products_id, products_options, products_options_values_id).
 */
export async function fetchPreOrderLineIds(
  orderId: number,
  client: TxClient = prisma
): Promise<Set<number>> {
  const rows = await client.$queryRaw<Array<{ orders_products_id: number }>>(
    Prisma.sql`
      SELECT DISTINCT op.orders_products_id
      FROM orders_products op
      JOIN orders_products_attributes opa
        ON opa.orders_products_id = op.orders_products_id
      JOIN products_attributes_infos pai
        ON pai.products_id = op.products_id
       AND pai.products_options_values_id = opa.products_options_values_id
      WHERE op.orders_id = ${orderId}
        AND pai.pre_order = 'Yes'
        AND opa.products_options LIKE '%Size%'
    `
  );
  return new Set(rows.map((r) => Number(r.orders_products_id)));
}

// ---------------------------------------------------------------------------
// Order eligibility check (pure function)
// ---------------------------------------------------------------------------

/**
 * Check if an order is eligible for processing.
 *
 * Eligibility rules from PHP (order_processing_simulation.php lines 266-294):
 * 1. Status must be in eligible list
 * 2. fraud_status must be '0' OR order is marketplace
 * 3. Lock check:
 *    - locked_order == 0 → eligible
 *    - locked_order == 1 AND approve_customer == 1 AND no size-lock tickets → eligible
 *    - orders_status == 1 (Pending) → eligible regardless of lock
 */
export function checkOrderEligibility(
  order: OrderForProcessingRow,
  eligibleStatuses: number[],
  hasTicketLock = false
): { eligible: boolean; reason?: string } {
  // Check status eligibility
  if (!eligibleStatuses.includes(order.orders_status)) {
    return {
      eligible: false,
      reason: `Order status ${order.orders_status} is not eligible for processing`,
    };
  }

  // PHP line 255: fraud_status check — marketplace orders bypass fraud gating
  const isMarketplace = !!(
    order.amazon_order_id || order.fruugo_orders_id || order.ebay_orders_id ||
    order.multisite_order_id
  );
  if (order.fraud_status !== '0' && !isMarketplace) {
    return {
      eligible: false,
      reason: 'Order is flagged as fraud',
    };
  }

  // PHP line 294: lock check
  // Pending orders (status 1) bypass lock check entirely
  if (order.orders_status === 1) {
    return { eligible: true };
  }

  if (order.locked_order > 0) {
    if (order.approve_customer !== '1') {
      return {
        eligible: false,
        reason: 'Order is locked — approve customer or unlock first',
      };
    }
    // PHP: locked_order == 1 AND approve_customer == 1 BUT has size-lock tickets → ineligible
    if (hasTicketLock) {
      return {
        eligible: false,
        reason: 'Order is locked — has open size-lock customer tickets',
      };
    }
  }

  return { eligible: true };
}

/**
 * Check if an order has size-lock customer tickets.
 * PHP: customers_tickets with extra_option IN ('4','6','7') AND order_status_id = '2'
 */
export async function checkTicketLock(
  orderId: number,
  client: TxClient = prisma
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ extra_option: string }>>(
    Prisma.sql`
      SELECT extra_option
      FROM customers_tickets
      WHERE orders_id = ${orderId}
        AND order_status_id = '2'
        AND extra_option IN ('4','6','7')
      ORDER BY date_added DESC
      LIMIT 1
    `
  );
  return rows.length > 0;
}
