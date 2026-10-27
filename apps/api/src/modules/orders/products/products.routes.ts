/**
 * Order products routes — product table data for the order edit page.
 * Requirements: REQ-05-001 through REQ-05-019
 */

import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { OrderIdParamSchema } from '../orders.schema';
import { getOrderProducts } from './products.service';
import { NotFoundError } from '../../../lib/errors';
import type { OrderContextRow } from './products.types';

export const productsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /:id/products — All products for an order with batched lookup data.
   * Returns structured data for the products table component.
   */
  app.get('/:id/products', {
    preHandler: [app.requirePermission('orders:view')],
  }, async (request) => {
    const { id } = OrderIdParamSchema.parse(request.params);

    // Fetch order-level context needed by the products service
    const orderRows = await prisma.$queryRaw<OrderContextRow[]>(Prisma.sql`
      SELECT orders_id, orders_status, order_site, rtrn_chk, currency, currency_value, id_of_original_order
      FROM orders WHERE orders_id = ${id}
    `);

    if (orderRows.length === 0) {
      throw new NotFoundError('Order');
    }

    const order = orderRows[0];
    const result = await getOrderProducts(
      id,
      order.orders_status,
      order.order_site,
      order.rtrn_chk ?? 'no',
      order.currency ?? 'GBP',
      Number(order.currency_value ?? 1),
      !!(order.id_of_original_order && order.id_of_original_order > 0),
    );

    return { data: result };
  });
};
