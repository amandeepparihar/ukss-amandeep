/**
 * Order deletion service — REQ-03-006 (delete confirmation + execution).
 *
 * Ported from: webadmin/includes/functions/general.php:zen_remove_order() (lines 1516-1543)
 *
 * Deletes an order and all related rows from:
 *   orders, orders_products, orders_products_attributes, orders_status_history, orders_total
 *
 * Optionally restocks products if restock=true:
 *   products.products_quantity += orders_products.products_quantity
 *   products.products_ordered  -= orders_products.products_quantity
 *
 * All writes execute inside a single interactive transaction (CX-001).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('orders-deletion');

/** Transaction client type */
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Sentinel error to distinguish "not found" from unexpected failures */
class OrderNotFoundError extends Error {
  constructor(orderId: number) {
    super(`Order ${orderId} not found`);
    this.name = 'OrderNotFoundError';
  }
}

interface OrderProductRestockRow {
  products_id: number;
  products_quantity: number;
}

/**
 * REQ-03-006: Delete an order with optional restock.
 *
 * @param orderId  The order to delete
 * @param restock  If true, restore product quantities before deleting
 * @returns        Success/error result with message
 */
export async function deleteOrder(
  orderId: number,
  restock: boolean,
): Promise<{ result: 'success' | 'error'; message: string }> {
  logger.info({ orderId, restock }, 'Starting order deletion');

  try {
    await prisma.$transaction(async (tx) => {
      // Verify order exists before proceeding
      const [{ cnt }] = await tx.$queryRaw<[{ cnt: bigint }]>(
        Prisma.sql`SELECT COUNT(*) AS cnt FROM orders WHERE orders_id = ${orderId}`
      );
      if (Number(cnt) === 0) {
        throw new OrderNotFoundError(orderId);
      }

      // Phase 1: Restock if requested
      if (restock) {
        await restockProducts(tx, orderId);
      }

      // Phase 2: Delete from all related tables (order of deletion matters for FK safety)
      await tx.$executeRaw(
        Prisma.sql`DELETE FROM orders_products_attributes WHERE orders_id = ${orderId}`
      );
      await tx.$executeRaw(
        Prisma.sql`DELETE FROM orders_status_history WHERE orders_id = ${orderId}`
      );
      await tx.$executeRaw(
        Prisma.sql`DELETE FROM orders_total WHERE orders_id = ${orderId}`
      );
      await tx.$executeRaw(
        Prisma.sql`DELETE FROM orders_products WHERE orders_id = ${orderId}`
      );
      await tx.$executeRaw(
        Prisma.sql`DELETE FROM orders WHERE orders_id = ${orderId}`
      );
    }, { timeout: 30_000 });

    logger.info({ orderId, restock }, 'Order deletion completed');
    return { result: 'success', message: `Order ${orderId} has been deleted.` };
  } catch (err) {
    if (err instanceof OrderNotFoundError) {
      return { result: 'error', message: `Order ${orderId} does not exist.` };
    }
    logger.error({ orderId, err }, 'Order deletion failed');
    return {
      result: 'error',
      message: `Failed to delete order ${orderId}. Please try again.`,
    };
  }
}

/**
 * Restore product quantities from order products before deletion.
 * Ported from: zen_remove_order() restock logic.
 */
async function restockProducts(tx: TxClient, orderId: number): Promise<void> {
  const products = await tx.$queryRaw<OrderProductRestockRow[]>(
    Prisma.sql`SELECT products_id, products_quantity
               FROM orders_products
               WHERE orders_id = ${orderId}`
  );

  for (const product of products) {
    await tx.$executeRaw(
      Prisma.sql`UPDATE products
                 SET products_quantity = products_quantity + ${product.products_quantity},
                     products_ordered = products_ordered - ${product.products_quantity}
                 WHERE products_id = ${product.products_id}`
    );
  }

  logger.info({ orderId, productCount: products.length }, 'Restocked products');
}
