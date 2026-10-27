import { prisma, Prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type {
  OrderLookupRow,
  OrderProductRow,
  BatchLookupRow,
  BatchProductRow,
  OrderToteAssignmentResponse,
  BatchToteAssignmentResponse,
  ToteProductDto,
} from './tote-assignment.types';
import type {
  AssignOrderToteInput,
  AssignBatchToteInput,
} from './tote-assignment.schema';

const logger = createLogger('tote-assignment');

function mapProduct(row: OrderProductRow): ToteProductDto {
  return {
    ordersProductsId: row.orders_products_id,
    ordersId: row.orders_id,
    productsId: row.products_id,
    name: row.products_name ?? '',
    model: row.products_model,
    barcode: row.product_barcode,
    quantity: row.products_quantity,
    fcOrderId: row.fc_order_id,
    fcBatchId: row.fc_batch_id,
    fcToteId: row.fc_tote_id,
    multipartBatchId: row.multipart_batch_id,
    multipartToteId: row.multipart_tote_id,
  };
}

export async function getOrderForToteAssignment(
  orderId: number,
): Promise<OrderToteAssignmentResponse> {
  const orderRows = await prisma.$queryRaw<OrderLookupRow[]>(Prisma.sql`
    SELECT orders_id, orders_status, fc_order_id
    FROM orders
    WHERE orders_id = ${orderId}
  `);

  if (orderRows.length === 0) {
    throw new NotFoundError('Order');
  }

  const order = orderRows[0];

  const productRows = await prisma.$queryRaw<OrderProductRow[]>(Prisma.sql`
    SELECT
      op.orders_products_id, op.orders_id, op.products_id,
      op.products_name, op.products_model, op.product_barcode, op.products_quantity,
      op.fc_order_id, op.fc_batch_id, op.fc_tote_id,
      op.multipart_batch_id, op.multipart_tote_id
    FROM orders_products op
    WHERE op.orders_id = ${orderId}
    ORDER BY op.orders_products_id ASC
  `);

  // refs: #165290 (Abhinav Gautam) - coerce fc_order_id to string because
  // Prisma returns numeric columns as JS numbers; the frontend calls .trim() on it.
  return {
    ordersId: order.orders_id,
    ordersStatus: order.orders_status,
    fcOrderId: order.fc_order_id != null ? String(order.fc_order_id) : null,
    products: productRows.map(mapProduct),
  };
}

export async function getBatchForToteAssignment(
  batchName: string,
): Promise<BatchToteAssignmentResponse> {
  const batchRows = await prisma.$queryRaw<BatchLookupRow[]>(Prisma.sql`
    SELECT mfo_id, fc_batch_name
    FROM multipart_fc_orders
    WHERE fc_batch_name = ${batchName}
    LIMIT 1
  `);

  if (batchRows.length === 0) {
    throw new NotFoundError('Batch');
  }

  const batch = batchRows[0];

  const productRows = await prisma.$queryRaw<OrderProductRow[]>(Prisma.sql`
    SELECT
      op.orders_products_id, op.orders_id, op.products_id,
      op.products_name, op.products_model, op.product_barcode, op.products_quantity,
      op.fc_order_id, op.fc_batch_id, op.fc_tote_id,
      op.multipart_batch_id, op.multipart_tote_id
    FROM orders_products op
    WHERE op.multipart_batch_id = ${batch.mfo_id}
    ORDER BY op.orders_id ASC, op.orders_products_id ASC
  `);

  if (productRows.length === 0) {
    throw new NotFoundError('Products for batch');
  }

  return {
    mfoId: batch.mfo_id,
    fcBatchName: batch.fc_batch_name,
    products: productRows.map(mapProduct),
  };
}

function buildOrderAuditComment(
  input: AssignOrderToteInput,
  previous: OrderProductRow[],
  fcOrderId: string,
): string {
  const header = `TOTE Assignment: FC Order ID ${fcOrderId}, FC Batch ID ${input.fcBatchId}, FC Tote ID ${input.fcToteId}`;
  const ids = input.ordersProductsIds.join(', ');
  const overwrites = previous
    .filter(r => r.fc_tote_id || r.fc_batch_id || r.fc_order_id)
    .map(r => `[opid ${r.orders_products_id}: fc_tote_id '${r.fc_tote_id ?? ''}'→'${input.fcToteId}', fc_batch_id '${r.fc_batch_id ?? ''}'→'${input.fcBatchId}', fc_order_id '${r.fc_order_id ?? ''}'→'${fcOrderId}']`);
  const overwriteLine = overwrites.length > 0 ? `\nOverwrites: ${overwrites.join('; ')}` : '';
  return `${header}\nassigned to orders_products_id(s): ${ids}${overwriteLine}`;
}

export async function assignToteToOrder(
  input: AssignOrderToteInput,
  adminName: string,
): Promise<{ updatedCount: number }> {
  return prisma.$transaction(async (tx) => {
    const orderRows = await tx.$queryRaw<OrderLookupRow[]>(Prisma.sql`
      SELECT orders_id, orders_status, fc_order_id
      FROM orders
      WHERE orders_id = ${input.ordersId}
    `);
    if (orderRows.length === 0) {
      throw new NotFoundError('Order');
    }
    const currentOrdersStatus = orderRows[0].orders_status;

    // refs: #165290 - fc_order_id is server-authoritative. The client sends it
    // (frontend shows it read-only) but an authenticated user could tamper with
    // the request body, so reject mismatches and write the DB value.
    // Compare trimmed, since the schema trims the input.
    const fcOrderIdFromDb =
      orderRows[0].fc_order_id != null ? String(orderRows[0].fc_order_id).trim() : '';
    if (!fcOrderIdFromDb) {
      throw new ValidationError([
        { field: 'fcOrderId', message: 'Order has no FC Order ID assigned' },
      ]);
    }
    if (fcOrderIdFromDb !== input.fcOrderId) {
      throw new ValidationError([
        { field: 'fcOrderId', message: 'FC Order ID does not match the order record' },
      ]);
    }

    const previousRows = await tx.$queryRaw<OrderProductRow[]>(Prisma.sql`
      SELECT
        op.orders_products_id, op.orders_id, op.products_id,
        op.products_name, op.products_model, op.product_barcode, op.products_quantity,
        op.fc_order_id, op.fc_batch_id, op.fc_tote_id,
        op.multipart_batch_id, op.multipart_tote_id
      FROM orders_products op
      WHERE op.orders_id = ${input.ordersId}
        AND op.orders_products_id IN (${Prisma.join(input.ordersProductsIds)})
    `);

    if (previousRows.length === 0) {
      throw new NotFoundError('Order products');
    }

    await tx.$executeRaw(Prisma.sql`
      UPDATE orders_products
      SET fc_order_id = ${fcOrderIdFromDb},
          fc_batch_id = ${input.fcBatchId},
          fc_tote_id = ${input.fcToteId}
      WHERE orders_id = ${input.ordersId}
        AND orders_products_id IN (${Prisma.join(input.ordersProductsIds)})
    `);

    const comments = buildOrderAuditComment(input, previousRows, fcOrderIdFromDb);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO orders_status_history
        (orders_id, orders_status_id, date_added, customer_notified,
         comments, comment_by, comment_private, status_change_from)
      VALUES
        (${input.ordersId}, ${currentOrdersStatus}, NOW(), 0,
         ${comments}, ${adminName}, 'Yes', 'TOTE Assignment')
    `);

    logger.info({
      ordersId: input.ordersId,
      ordersProductsIds: input.ordersProductsIds,
      adminName,
    }, 'Order tote assignment saved');

    return { updatedCount: previousRows.length };
  });
}

export async function assignToteToBatch(
  input: AssignBatchToteInput,
  adminName: string,
): Promise<{ updatedCount: number }> {
  return prisma.$transaction(async (tx) => {
    const productsToUpdate = await tx.$queryRaw<BatchProductRow[]>(Prisma.sql`
      SELECT
        op.orders_products_id, op.orders_id, op.products_id,
        op.products_name, op.products_model, op.product_barcode, op.products_quantity,
        op.fc_order_id, op.fc_batch_id, op.fc_tote_id,
        op.multipart_batch_id, op.multipart_tote_id,
        o.orders_status
      FROM orders_products op
      JOIN orders o ON o.orders_id = op.orders_id
      WHERE op.multipart_batch_id = ${input.mfoId}
    `);

    if (productsToUpdate.length === 0) {
      throw new NotFoundError('Products for batch');
    }

    await tx.$executeRaw(Prisma.sql`
      UPDATE orders_products
      SET multipart_tote_id = ${input.multipartToteId}
      WHERE multipart_batch_id = ${input.mfoId}
    `);

    const batchNameRows = await tx.$queryRaw<BatchLookupRow[]>(Prisma.sql`
      SELECT mfo_id, fc_batch_name
      FROM multipart_fc_orders
      WHERE mfo_id = ${input.mfoId}
      LIMIT 1
    `);
    const fcBatchName = batchNameRows[0]?.fc_batch_name ?? `mfo_id ${input.mfoId}`;

    const byOrder = new Map<number, { orders_status: number; opIds: number[]; previous: BatchProductRow[] }>();
    for (const row of productsToUpdate) {
      let entry = byOrder.get(row.orders_id);
      if (!entry) {
        entry = { orders_status: row.orders_status, opIds: [], previous: [] };
        byOrder.set(row.orders_id, entry);
      }
      entry.opIds.push(row.orders_products_id);
      entry.previous.push(row);
    }

    for (const [ordersId, entry] of byOrder.entries()) {
      const overwrites = entry.previous
        .filter(r => r.multipart_tote_id)
        .map(r => `[opid ${r.orders_products_id}: multipart_tote_id '${r.multipart_tote_id ?? ''}'→'${input.multipartToteId}']`);
      const overwriteLine = overwrites.length > 0 ? `\nOverwrites: ${overwrites.join('; ')}` : '';
      const comments = `TOTE Assignment: Multipart Tote ID ${input.multipartToteId} assigned to batch "${fcBatchName}" (mfo_id ${input.mfoId}).\norders_products_id(s) in this order: ${entry.opIds.join(', ')}${overwriteLine}`;

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO orders_status_history
          (orders_id, orders_status_id, date_added, customer_notified,
           comments, comment_by, comment_private, status_change_from)
        VALUES
          (${ordersId}, ${entry.orders_status}, NOW(), 0,
           ${comments}, ${adminName}, 'Yes', 'TOTE Assignment')
      `);
    }

    logger.info({
      mfoId: input.mfoId,
      fcBatchName,
      multipartToteId: input.multipartToteId,
      affectedOrders: byOrder.size,
      updatedCount: productsToUpdate.length,
      adminName,
    }, 'Batch tote assignment saved');

    return { updatedCount: productsToUpdate.length };
  });
}
