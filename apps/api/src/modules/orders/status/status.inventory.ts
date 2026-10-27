/**
 * Inventory and product operations for status changes — ported from PHP general.php.
 * Restock/deduct inventory, committed quantity, unpick, hero shirt cascade.
 *
 * Requirements: REQ-07-005, REQ-07-007, REQ-07-008, REQ-07-011, REQ-07-016, REQ-07-026
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../../../lib/logger';
import { FC_BOX_NUMBER, FC_BOX_LISTS_ID, HERO_SHIRT_VIRTUAL_TYPE } from '../orders.constants';
import type {
  OrderProductRow,
  HeroShirtProduct,
  HeroShirtParent,
  ProductQuantityRow,
  OrderProductBarcodeRow,
} from './status.types';

const logger = createLogger('orders-status-inventory');

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// ---------------------------------------------------------------------------
// REQ-07-026: Inventory Functions
// ---------------------------------------------------------------------------

/**
 * REQ-07-026: Restock inventory — adds quantity back to products.
 * Ported from zen_restock_inventory() in general.php lines 1546-1559.
 * Called on status 112 (Rejected).
 */
export async function zenRestockInventory(
  tx: TxClient,
  orderId: number
): Promise<void> {
  const products = await tx.$queryRaw<OrderProductRow[]>(
    Prisma.sql`SELECT products_id, products_quantity
               FROM orders_products WHERE orders_id = ${orderId}`
  );

  for (const p of products) {
    await tx.$executeRaw(
      Prisma.sql`UPDATE products
                 SET products_quantity = products_quantity + ${p.products_quantity},
                     products_ordered = products_ordered - ${p.products_quantity}
                 WHERE products_id = ${p.products_id}`
    );
  }

  logger.info({ orderId, productCount: products.length }, 'Restocked inventory');
}

/**
 * REQ-07-026: Process inventory — deducts quantity from products.
 * Ported from zen_process_inventory() in general.php lines 1563-1576.
 * Called when moving FROM status 112 (Rejected) to another status.
 */
export async function zenProcessInventory(
  tx: TxClient,
  orderId: number
): Promise<void> {
  const products = await tx.$queryRaw<OrderProductRow[]>(
    Prisma.sql`SELECT products_id, products_quantity
               FROM orders_products WHERE orders_id = ${orderId}`
  );

  for (const p of products) {
    await tx.$executeRaw(
      Prisma.sql`UPDATE products
                 SET products_quantity = products_quantity - ${p.products_quantity},
                     products_ordered = products_ordered + ${p.products_quantity}
                 WHERE products_id = ${p.products_id}`
    );
  }

  logger.info({ orderId, productCount: products.length }, 'Processed inventory (deducted)');
}

/**
 * REQ-07-026: Decrease committed quantity — releases FC committed stock.
 * Ported from committed_quantity() in general.php lines 10290-11045
 * (case 'order_status_update_to_shipped').
 * Called on status 5 (Shipped) via update_order_status().
 *
 * PHP guard: skips entirely when fc_order_status = 'DESPATCHED' (already handled by FC).
 * PHP reads barcode from orders_products.product_barcode (NOT bundle_product_barcode_mappings).
 * PHP filters product_quantities by barcode AND box_lists_id = FC_BOX_ID (25039).
 */
export async function committedQuantityDecrease(
  tx: TxClient,
  orderId: number,
  fcOrderStatus: string | null
): Promise<void> {
  // PHP: if fc_order_status == 'DESPATCHED', skip committed quantity reduction
  if (fcOrderStatus && fcOrderStatus.toUpperCase() === 'DESPATCHED') {
    logger.info({ orderId }, 'Skipping committed qty decrease — FC already despatched');
    return;
  }

  // PHP reads orders_products.product_barcode directly (no bundle mapping join)
  const fcProducts = await tx.$queryRaw<OrderProductBarcodeRow[]>(
    Prisma.sql`SELECT orders_products_id, product_barcode
               FROM orders_products
               WHERE orders_id = ${orderId}
                 AND box_number = ${FC_BOX_NUMBER}
                 AND product_barcode IS NOT NULL
                 AND product_barcode != ''`
  );

  for (const fp of fcProducts) {
    // PHP: WHERE barcode = X AND box_lists_id = FC_BOX_ID (25039)
    const pqRows = await tx.$queryRaw<ProductQuantityRow[]>(
      Prisma.sql`SELECT committed_quantity, quantity, barcode
                 FROM product_quantities
                 WHERE barcode = ${fp.product_barcode}
                   AND box_lists_id = ${FC_BOX_LISTS_ID}
                 LIMIT 1`
    );

    if (pqRows.length > 0 && pqRows[0].committed_quantity > 0) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE product_quantities
                   SET committed_quantity = committed_quantity - 1
                   WHERE barcode = ${fp.product_barcode}
                     AND box_lists_id = ${FC_BOX_LISTS_ID}
                     AND committed_quantity > 0`
      );
    }
  }

  logger.info({ orderId, fcProductCount: fcProducts.length }, 'Decreased committed quantity');
}

/**
 * REQ-07-026: Unpick order products — clears pick allocations.
 * Ported from unpick_order_product() in general.php lines 11071-11300.
 * Called on status 18 (Cancelled) and 112 (Rejected) via update_order_status().
 *
 * PHP reads barcode from orders_products.product_barcode (NOT bundle_product_barcode_mappings).
 * PHP SELECT on product_quantities: WHERE barcode = X (no box_lists_id filter).
 * PHP UPDATE on product_quantities: WHERE barcode = X AND box_lists_id = FC_BOX_ID (25039).
 * PHP sets box_number = NULL (not empty string).
 */
export async function unpickOrderProduct(
  tx: TxClient,
  orderId: number
): Promise<void> {
  // PHP reads orders_products.product_barcode directly
  const fcProducts = await tx.$queryRaw<OrderProductBarcodeRow[]>(
    Prisma.sql`SELECT orders_products_id, product_barcode
               FROM orders_products
               WHERE orders_id = ${orderId}
                 AND box_number = ${FC_BOX_NUMBER}
                 AND product_barcode IS NOT NULL
                 AND product_barcode != ''`
  );

  for (const fp of fcProducts) {
    // PHP SELECT: WHERE barcode = X (no box_lists_id filter)
    const pqRows = await tx.$queryRaw<ProductQuantityRow[]>(
      Prisma.sql`SELECT committed_quantity, quantity, barcode
                 FROM product_quantities
                 WHERE barcode = ${fp.product_barcode}
                 LIMIT 1`
    );

    if (pqRows.length > 0) {
      const newCommitted = Math.max(0, pqRows[0].committed_quantity - 1);
      // PHP UPDATE: WHERE barcode = X AND box_lists_id = FC_BOX_ID (25039)
      await tx.$executeRaw(
        Prisma.sql`UPDATE product_quantities
                   SET committed_quantity = ${newCommitted},
                       quantity = quantity + 1
                   WHERE barcode = ${fp.product_barcode}
                     AND box_lists_id = ${FC_BOX_LISTS_ID}`
      );
    }

    // PHP: SET box_number = NULL (not empty string)
    await tx.$executeRaw(
      Prisma.sql`UPDATE orders_products
                 SET box_number = NULL
                 WHERE orders_products_id = ${fp.orders_products_id}
                   AND box_number = ${FC_BOX_NUMBER}`
    );
  }

  logger.info({ orderId, fcProductCount: fcProducts.length }, 'Unpicked order products');
}

// ---------------------------------------------------------------------------
// REQ-07-007 + REQ-07-016: Hero Shirt Product Disabling
// ---------------------------------------------------------------------------

/**
 * REQ-07-016: Disable hero shirt (pre-own) products on Being Picked (status 16).
 * Ported from orders.php lines 6931-7038.
 * Uses products.virtual_product_type_id = 5 (matching PHP, not pick_from_hero_shirt).
 */
export async function disableHeroShirtProducts(
  tx: TxClient,
  orderId: number
): Promise<void> {
  // Step 1: Find pre-own products in this order
  const preOwnProducts = await tx.$queryRaw<HeroShirtProduct[]>(
    Prisma.sql`SELECT p.products_id
               FROM orders_products op
               INNER JOIN products p ON p.products_id = op.products_id
               WHERE op.orders_id = ${orderId}
                 AND p.virtual_product_type_id = ${HERO_SHIRT_VIRTUAL_TYPE}`
  );

  if (preOwnProducts.length === 0) return;

  const disableIds = new Set<number>();

  for (const preOwn of preOwnProducts) {
    disableIds.add(preOwn.products_id);

    // Step 2: Check if this product has a hero_shirt_parent
    const parentRows = await tx.$queryRaw<HeroShirtParent[]>(
      Prisma.sql`SELECT hero_shirt_parent FROM products
                 WHERE products_id = ${preOwn.products_id}
                   AND hero_shirt_parent != 0`
    );

    if (parentRows.length > 0) {
      // Has a parent — add parent and find all siblings
      const parentId = parentRows[0].hero_shirt_parent;
      disableIds.add(parentId);

      const children = await tx.$queryRaw<HeroShirtProduct[]>(
        Prisma.sql`SELECT products_id FROM products
                   WHERE hero_shirt_parent = ${parentId}`
      );
      for (const child of children) {
        disableIds.add(child.products_id);
      }
    } else {
      // This product IS the parent — find all children
      const children = await tx.$queryRaw<HeroShirtProduct[]>(
        Prisma.sql`SELECT products_id FROM products
                   WHERE hero_shirt_parent = ${preOwn.products_id}`
      );
      for (const child of children) {
        disableIds.add(child.products_id);
      }
    }
  }

  if (disableIds.size === 0) return;

  const idArray = Array.from(disableIds);
  const idList = Prisma.join(idArray);

  // Disable in products table
  await tx.$executeRaw(
    Prisma.sql`UPDATE products SET products_status = 0
               WHERE products_id IN (${idList})`
  );

  // Disable in new_products table (mirror table)
  await tx.$executeRaw(
    Prisma.sql`UPDATE new_products SET products_status = 0
               WHERE products_id IN (${idList})`
  );

  logger.info({ orderId, disabledCount: idArray.length }, 'Disabled hero shirt products');
}
