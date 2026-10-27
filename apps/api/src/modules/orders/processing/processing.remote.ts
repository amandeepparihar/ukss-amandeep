/**
 * SPEC-13: Remote Order Processing & Invoice Log.
 * Requirements: REQ-13-008 (remote processing), REQ-13-005 (invoice log)
 *
 * Ported from PHP: remote_order_processing.php, order_invoice_simulation.php
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { ARCHIVE_ORDERS_COUNT } from '../orders.constants';
import type {
  TxClient,
  RemoteProcessInput,
  InvoiceLogEntry,
  InvoicePrintRow,
} from './processing.types';

const logger = createLogger('orders-processing-remote');

// ---------------------------------------------------------------------------
// REQ-13-008: Remote Order Processing
// ---------------------------------------------------------------------------

/**
 * Process an order remotely from the edit page with a specific invoice type.
 * Inserts/updates remote_order_processing and pre_processed_order_products.
 */
export async function remoteOrderProcessing(
  orderId: number,
  input: RemoteProcessInput,
  adminName: string
): Promise<{ archive: number; message: string }> {
  return prisma.$transaction(async (tx: TxClient) => {
    // 1. Determine archive number
    const archive = await getNextArchive(tx);

    // 2. Fetch order data for sift_score_bit and product IDs
    const orderRow = await tx.$queryRaw<Array<{ sift_score_bit: string }>>(
      Prisma.sql`SELECT COALESCE(sift_score_bit, '0') AS sift_score_bit FROM orders WHERE orders_id = ${orderId}`
    );
    const siftScoreBit = orderRow[0]?.sift_score_bit ?? '0';

    // Look up products_id for each orders_products_id
    const allOpIds = input.products.map((p) => p.ordersProductsId);
    const productIdRows = await tx.$queryRaw<Array<{ orders_products_id: number; products_id: number }>>(
      Prisma.sql`
        SELECT orders_products_id, products_id
        FROM orders_products
        WHERE orders_products_id IN (${Prisma.join(allOpIds)})
      `
    );
    const productsIdMap = new Map(productIdRows.map((r) => [r.orders_products_id, r.products_id]));

    // 3. For each product — check existing, insert if new (PHP: UPDATE is commented out)
    for (const product of input.products) {
      const existing = await tx.$queryRaw<Array<{ id: number; status: number }>>(
        Prisma.sql`
          SELECT id, status
          FROM remote_order_processing
          WHERE orders_id = ${orderId}
            AND orders_products_id = ${product.ordersProductsId}
        `
      );

      // PHP line 3559: UPDATE is commented out — skip update for existing status=0 records
      const hasActive = existing.some((r) => r.status === 0);
      if (!hasActive) {
        // Insert new record (include date_modified per PHP)
        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO remote_order_processing
              (orders_id, orders_products_id, box_number, invoice_type,
               archive, status, date_added, date_modified, modified_by)
            VALUES (
              ${orderId}, ${product.ordersProductsId}, ${product.boxNumber},
              ${input.type}, ${archive}, 0, NOW(), NOW(), ${adminName}
            )
          `
        );
      }
    }

    // 4. pre_processed_order_products — PHP checks existing first, then UPDATE or INSERT ALL
    const existingPpop = await tx.$queryRaw<Array<{ orders_id: number }>>(
      Prisma.sql`SELECT orders_id FROM pre_processed_order_products WHERE orders_id = ${orderId} LIMIT 1`
    );

    if (existingPpop.length > 0) {
      // PHP: UPDATE all products for this order with status=4
      await tx.$executeRaw(
        Prisma.sql`
          UPDATE pre_processed_order_products
          SET status = 4, process_archive = 0, to_be_printed = 0,
              date_modified = NOW(), sift_score_bit = ${siftScoreBit}
          WHERE orders_id = ${orderId}
        `
      );
    } else {
      // PHP: INSERT ALL order products (not just submitted ones)
      const allProducts = await tx.$queryRaw<Array<{ orders_products_id: number; products_id: number }>>(
        Prisma.sql`SELECT orders_products_id, products_id FROM orders_products WHERE orders_id = ${orderId}`
      );
      for (const p of allProducts) {
        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO pre_processed_order_products
              (orders_id, orders_products_id, order_products_id, status,
               process_archive, to_be_printed, sift_score_bit, date_added, date_modified)
            VALUES (${orderId}, ${p.orders_products_id}, ${p.products_id}, 4,
                    0, 0, ${siftScoreBit}, NOW(), NOW())
          `
        );
      }
    }

    // 3. Clean up: remove products for this order NOT in the submitted list (status = 0)
    const submittedIds = input.products.map((p) => p.ordersProductsId);
    if (submittedIds.length > 0) {
      await tx.$executeRaw(
        Prisma.sql`
          DELETE FROM remote_order_processing
          WHERE orders_id = ${orderId}
            AND status = 0
            AND orders_products_id NOT IN (${Prisma.join(submittedIds)})
        `
      );
    }

    logger.info(
      { orderId, type: input.type, archive, productCount: input.products.length },
      'Remote order processing completed'
    );

    return {
      archive,
      message: `Order ${orderId} processed remotely (archive ${archive})`,
    };
  });
}

// ---------------------------------------------------------------------------
// REQ-13-005: Invoice Log Display
// ---------------------------------------------------------------------------

/**
 * Get the invoice log for an order — matches PHP order_invoice_simulation.php.
 *
 * PHP logic:
 * 1. Query orders_products + orders_products_attributes (Size) + remote_order_processing (ROP status)
 * 2. Query printedinvoice_parsing_result for invoice print data
 * 3. Display: Product Name, Size, ROP Status, Invoice Type, Printed By, Print Time
 */
export async function getInvoiceLog(
  orderId: number
): Promise<InvoiceLogEntry[]> {
  // 1. Fetch order products with size and ROP status (PHP lines 36-50)
  const products = await prisma.$queryRaw<Array<{
    orders_products_id: number;
    products_name: string;
    products_options_values: string | null;
    rop_id: number | null;
  }>>(
    Prisma.sql`
      SELECT op.orders_products_id,
             op.products_name,
             opa.products_options_values,
             rop.id AS rop_id
      FROM orders_products op
      LEFT JOIN orders_products_attributes opa
        ON op.orders_products_id = opa.orders_products_id
        AND opa.products_options LIKE '%Size%'
      LEFT JOIN remote_order_processing rop
        ON op.orders_products_id = rop.orders_products_id
      WHERE op.orders_id = ${orderId}
      GROUP BY op.orders_products_id
    `
  );

  // 2. Fetch invoice print log (PHP lines 65-95: printedinvoice_parsing_result)
  const invoiceRows = await prisma.$queryRaw<InvoicePrintRow[]>(
    Prisma.sql`
      SELECT DISTINCT ppr_invoice_barcode,
             ppr_invoice_type,
             ppr_admin_name,
             NULLIF(ppr_datetime, '0000-00-00 00:00:00') AS ppr_datetime
      FROM printedinvoice_parsing_result
      WHERE ppr_orders_id = ${orderId}
      ORDER BY ppr_id DESC
    `
  );

  // 3. Build invoice lookup map (PHP lines 78-95)
  // PHP uses barcode format: 'INV{orderId}INV' for complete, 'M{ordersProductsId}M' for multipart
  let completeInvoice = false;
  let completeInvoiceData: { type: string; admin: string; datetime: string } | null = null;
  const productInvoiceMap = new Map<number, { type: string; admin: string; datetime: string }>();

  for (const row of invoiceRows) {
    const barcode = row.ppr_invoice_barcode;
    if (barcode === `INV${orderId}INV`) {
      // Complete invoice for the entire order
      completeInvoice = true;
      completeInvoiceData = {
        type: row.ppr_invoice_type,
        admin: row.ppr_admin_name,
        datetime: row.ppr_datetime || '',
      };
      break; // PHP breaks on complete invoice
    } else {
      // Multipart invoice — barcode = 'M{ordersProductsId}M'
      const productId = parseInt(barcode.replace(/M/g, ''), 10);
      if (!isNaN(productId)) {
        productInvoiceMap.set(productId, {
          type: row.ppr_invoice_type,
          admin: row.ppr_admin_name,
          datetime: row.ppr_datetime || '',
        });
      }
    }
  }

  // 4. Build results (PHP lines 102-155)
  const entries: InvoiceLogEntry[] = [];

  for (const product of products) {
    let invoiceType = 'No Invoice Printed';
    let invoicePrintedBy = '';
    let invoiceTime = '';

    if (completeInvoice && completeInvoiceData) {
      invoiceType = completeInvoiceData.type;
      invoicePrintedBy = completeInvoiceData.admin;
      invoiceTime = completeInvoiceData.datetime;
    } else {
      const productInvoice = productInvoiceMap.get(product.orders_products_id);
      if (productInvoice) {
        invoiceType = productInvoice.type;
        invoicePrintedBy = productInvoice.admin;
        invoiceTime = productInvoice.datetime;
      }
    }

    entries.push({
      ordersProductsId: product.orders_products_id,
      productName: product.products_name,
      size: product.products_options_values || '',
      remoteProcessingStatus: product.rop_id != null ? 'Added' : 'Not Added',
      invoiceType,
      invoicePrintedBy,
      invoiceTime,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Internal: Archive number management
// ---------------------------------------------------------------------------

/**
 * Get the next archive number for remote processing.
 * PHP (orders.php lines 3531-3547):
 * 1. Get MAX(archive) WHERE status = 1 (completed) → baseline = max + 1
 * 2. Get latest active archive (status = 0)
 * 3. If active archive exists, check total count (ALL records, not just status=0)
 * 4. If count >= 15, increment; otherwise reuse
 */
async function getNextArchive(tx: TxClient): Promise<number> {
  // 1. Get last completed archive — PHP: MAX(archive) WHERE status = 1
  const completedRows = await tx.$queryRaw<Array<{ max_archive: number | null }>>(
    Prisma.sql`
      SELECT MAX(archive) AS max_archive
      FROM remote_order_processing
      WHERE status = 1
    `
  );
  const baseArchive = (completedRows[0]?.max_archive || 0) + 1;

  // 2. Check if there's an active (status=0) archive
  const activeRows = await tx.$queryRaw<Array<{ archive: number }>>(
    Prisma.sql`
      SELECT archive
      FROM remote_order_processing
      WHERE status = 0
      ORDER BY id DESC
      LIMIT 1
    `
  );

  if (activeRows.length === 0) {
    // No active archives — use baseline from completed
    return baseArchive;
  }

  const activeArchive = activeRows[0].archive;

  // 3. Check capacity of active archive — PHP counts ALL records (not just status=0)
  const countRows = await tx.$queryRaw<Array<{ cnt: number }>>(
    Prisma.sql`
      SELECT COUNT(*) AS cnt
      FROM remote_order_processing
      WHERE archive = ${activeArchive}
    `
  );

  const count = Number(countRows[0]?.cnt ?? 0);

  if (count >= ARCHIVE_ORDERS_COUNT) {
    // Active archive is full — increment
    return activeArchive + 1;
  }

  return activeArchive;
}
