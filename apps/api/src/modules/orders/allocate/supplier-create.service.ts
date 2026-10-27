/**
 * SPEC-12a: Supplier order creation — faithful port of legacy set_supplier
 * (ajaxSupplierManage.php L179-384).
 *
 * One Prisma transaction per call.  Emails fire after commit, fire-and-forget.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { emailService } from '../../../lib/email';
import { STATUS, AIRO_TYPE_MANUFACTURER_ID_LIST, TOFFS_TYPE_MANUFACTURER_ID_LIST } from '../orders.constants';
import { shouldTransitionToInTransit, overflowRowCount } from './supplier-create.logic';
import { deriveLineMetadata, getCoverageCounts, isAiroSize, getAdminName } from './allocate.queries';
import type { CreateSupplierOrderInput } from './allocate.schema';
import type { CreateSupplierOrderResult, SupplierLineMetadata } from './allocate.types';
import type { TxClient } from '../processing/processing.types';

const logger = createLogger('supplier-create');

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function createSupplierOrder(
  orderId: number,
  input: CreateSupplierOrderInput,
  adminId: number,
): Promise<CreateSupplierOrderResult> {
  const adminName = await getAdminName(adminId);
  const supplierRows = await prisma.$queryRaw<Array<{ suppliers_name: string }>>(
    Prisma.sql`SELECT suppliers_name FROM suppliers WHERE suppliers_id = ${input.supplierId} LIMIT 1`,
  );
  const supplierName = supplierRows[0]?.suppliers_name ?? '';

  const sizeEmailQueue: SupplierLineMetadata[] = [];

  const result = await prisma.$transaction(async (tx) => {
    let createdLines = 0;
    let updatedLines = 0;
    let overflowRows = 0;

    for (const opid of input.orderProductIds) {
      const m = await deriveLineMetadata(orderId, opid, tx);
      if (!m) continue;

      // Check whether an sop row already exists for this order_product_id
      const existing = await tx.$queryRaw<Array<{ supplier_id: bigint | null }>>(
        Prisma.sql`SELECT supplier_id FROM suppliers_orders_products WHERE order_product_id = ${opid} LIMIT 1`,
      );

      if (existing.length > 0) {
        // Row exists — update supplier if it changed (L40-43 brief)
        // NULL/0 means no real supplier assigned yet (all supplier IDs are positive integers),
        // so treat it as "no supplier" and allow the update to proceed.
        const oldSupplierId = Number(existing[0].supplier_id ?? 0);
        if (oldSupplierId !== input.supplierId) {
          await tx.$executeRaw(
            Prisma.sql`UPDATE suppliers_orders_products SET supplier_id = ${input.supplierId}, date_modified = NOW() WHERE order_product_id = ${opid}`,
          );
          // Audit: legacy ajaxSupplierManage.php L137-148 writes an "Update Supplier"
          // history row when the supplier changes.
          const oldSupplierRows = await tx.$queryRaw<Array<{ suppliers_name: string }>>(
            Prisma.sql`SELECT suppliers_name FROM suppliers WHERE suppliers_id = ${oldSupplierId} LIMIT 1`,
          );
          const oldSupplierName = oldSupplierRows[0]?.suppliers_name ?? String(oldSupplierId);
          await insertUpdateSupplierActionHistory(tx, m, oldSupplierName, supplierName, adminName);
          updatedLines++;
        }
      } else {
        // No existing row — INSERT the primary open row (legacy L179-221)
        await insertOpenSopRow(tx, m, input.supplierId);
        createdLines++;
      }

      // Insert (quantity - 1) overflow rows (legacy L324-384, airo_other_order=1)
      // Each overflow row also gets its own history entry (legacy L366-377).
      const numOverflow = overflowRowCount(input.quantity);
      for (let i = 0; i < numOverflow; i++) {
        await insertOverflowSopRow(tx, m, input.supplierId);
        await insertOverflowActionHistory(tx, m, supplierName, adminName);
        overflowRows++;
      }

      // Audit history for the primary open row (legacy L302-315)
      await insertActionHistory(tx, m, supplierName, adminName);

      // Queue size-unmapped AIRO email (legacy L272-289) — sent AFTER commit
      if (
        AIRO_TYPE_MANUFACTURER_ID_LIST.includes(m.manufacturersId) &&
        !(await isAiroSize(m.productsOptionsValuesId, tx))
      ) {
        sizeEmailQueue.push(m);
      }
    }

    // Status transition — legacy runs TWO independent coverage checks on every
    // set_supplier call, not an if/else: AIRO coverage (L388-519) → 128 IN_TRANSIT,
    // then Toffs coverage (L521-637) → 22 RETRO_SHIRTS. Both are evaluated even
    // though a real order's lines are normally all-AIRO or all-Toffs (the
    // select_retailer() client guard forbids mixing the two in one submission).
    const airoCounts = await getCoverageCounts(orderId, AIRO_TYPE_MANUFACTURER_ID_LIST, tx);
    const statusChangedTo128 = shouldTransitionToInTransit(airoCounts);
    if (statusChangedTo128) {
      await applyOrderStatusTransition(tx, orderId, STATUS.IN_TRANSIT);
    }

    const toffsCounts = await getCoverageCounts(orderId, TOFFS_TYPE_MANUFACTURER_ID_LIST, tx);
    const statusChangedTo22 = shouldTransitionToInTransit(toffsCounts);
    if (statusChangedTo22) {
      await applyOrderStatusTransition(tx, orderId, STATUS.RETRO_SHIRTS);
    }

    return { createdLines, updatedLines, overflowRows, statusChangedTo128, statusChangedTo22 };
  });

  // Fire-and-forget emails after successful commit
  for (const m of sizeEmailQueue) {
    sendSizeUnmappedEmail(m).catch((err) =>
      logger.warn({ err, orderProductId: m.orderProductId }, 'size-unmapped email failed (non-blocking)'),
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Apply an order status transition + history row.
 * Legacy: ajaxSupplierManage.php L488-518 (AIRO → 128) and L595-635 (Toffs → 22)
 * are two copies of the same UPDATE+INSERT pair against a different status id.
 */
async function applyOrderStatusTransition(
  tx: TxClient,
  orderId: number,
  statusId: number,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`UPDATE orders SET orders_status = ${statusId} WHERE orders_id = ${orderId}`,
  );
  await tx.$executeRaw(
    Prisma.sql`INSERT INTO orders_status_history SET orders_id = ${orderId}, orders_status_id = ${statusId}, date_added = NOW()`,
  );
}

/**
 * INSERT the primary open sop row for an order line.
 * Columns: legacy ajaxSupplierManage.php L179-221.
 * supplier_order_id is intentionally left unset (NULL) — this marks the row
 * as "open" (not yet assigned to a supplier order).
 *
 * Verified columns (2026-06-24): product_name, product_id, product_model,
 * order_id, order_product_id, supplier_id, size_name, order_date, customer_id,
 * customer_name, date_added, manufacturers_id, default_option_value_id,
 * products_options_values_id, pvt_id, shortname, master_product_id.
 */
async function insertOpenSopRow(
  tx: TxClient,
  m: SupplierLineMetadata,
  supplierId: number,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO suppliers_orders_products
        (product_name, product_id, product_model,
         order_id, order_product_id, supplier_id,
         size_name, order_date, customer_id, customer_name,
         date_added, manufacturers_id, default_option_value_id,
         products_options_values_id, pvt_id, shortname, master_product_id)
      VALUES
        (${m.productName}, ${m.productId}, ${m.productModel},
         ${m.orderId}, ${m.orderProductId}, ${supplierId},
         ${m.sizeName}, ${m.orderDate}, ${m.customerId}, ${m.customerName},
         NOW(), ${m.manufacturersId}, ${m.defaultOptionValueId},
         ${m.productsOptionsValuesId}, ${m.pvtId}, ${m.shortname}, ${m.masterProductId})
    `,
  );
}

/**
 * INSERT an overflow sop row for quantity > 1.
 * Columns: legacy ajaxSupplierManage.php L338-364.
 * Key differences from the open row:
 *   - airo_other_order = 1
 *   - NO order_id / order_product_id / customer_id / customer_name / order_date
 *     (no order linkage — these are uncommitted Airo overflow units)
 *
 * Verified columns (2026-06-24): product_name, product_id, product_model,
 * supplier_id, size_name, date_added, airo_other_order, manufacturers_id,
 * default_option_value_id, products_options_values_id, pvt_id, shortname,
 * master_product_id.
 */
async function insertOverflowSopRow(
  tx: TxClient,
  m: SupplierLineMetadata,
  supplierId: number,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO suppliers_orders_products
        (product_name, product_id, product_model,
         supplier_id, size_name, date_added, airo_other_order,
         manufacturers_id, default_option_value_id,
         products_options_values_id, pvt_id, shortname, master_product_id)
      VALUES
        (${m.productName}, ${m.productId}, ${m.productModel},
         ${supplierId}, ${m.sizeName}, NOW(), 1,
         ${m.manufacturersId}, ${m.defaultOptionValueId},
         ${m.productsOptionsValuesId}, ${m.pvtId}, ${m.shortname}, ${m.masterProductId})
    `,
  );
}

/**
 * INSERT an audit row in delivery_management_action_history.
 * Columns: legacy ajaxSupplierManage.php L302-315.
 *
 * Verified columns (2026-06-24): user, order_product_name, order_product_size,
 * supplier_name, order_id, order_product_id, pvt_id, products_options_values_id,
 * action, date_added, master_product_id.
 * Note: supplier_order_number and supplier_order_date are omitted here —
 * the legacy set_supplier path does not populate them (they belong to the
 * "place supplier order" flow, not the initial assignment).
 */
async function insertActionHistory(
  tx: TxClient,
  m: SupplierLineMetadata,
  supplierName: string,
  adminName: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO delivery_management_action_history
        (user, order_product_name, order_product_size,
         supplier_name, order_id, order_product_id,
         pvt_id, products_options_values_id,
         action, date_added, master_product_id)
      VALUES
        (${adminName}, ${m.productName}, ${m.sizeName},
         ${supplierName}, ${m.orderId}, ${m.orderProductId},
         ${m.pvtId}, ${m.productsOptionsValuesId},
         ${'Set Supplier'}, NOW(), ${m.masterProductId})
    `,
  );
}

/**
 * INSERT an audit row in delivery_management_action_history for an overflow sop row.
 * Columns: legacy ajaxSupplierManage.php L366-377.
 *
 * Deliberately omits order_id and order_product_id — the overflow sop rows have
 * no order linkage (airo_other_order=1), so neither does their history entry.
 * This mirrors legacy exactly; use insertActionHistory for the primary row.
 *
 * Verified columns: user, order_product_name, order_product_size, supplier_name,
 * pvt_id, products_options_values_id, action, date_added, master_product_id.
 */
async function insertOverflowActionHistory(
  tx: TxClient,
  m: SupplierLineMetadata,
  supplierName: string,
  adminName: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO delivery_management_action_history
        (user, order_product_name, order_product_size,
         supplier_name, pvt_id, products_options_values_id,
         action, date_added, master_product_id)
      VALUES
        (${adminName}, ${m.productName}, ${m.sizeName},
         ${supplierName}, ${m.pvtId}, ${m.productsOptionsValuesId},
         ${'Set Supplier'}, NOW(), ${m.masterProductId})
    `,
  );
}

/**
 * INSERT an "Update Supplier" audit row when the supplier on an existing sop
 * row is changed.
 * Legacy: ajaxSupplierManage.php L137-148.
 *
 * Uses the same delivery_management_action_history columns as insertActionHistory,
 * plus action='Update Supplier' and comment='From <oldName> to <newName>'.
 * The comment column was confirmed present in INFORMATION_SCHEMA (2026-06-24).
 */
async function insertUpdateSupplierActionHistory(
  tx: TxClient,
  m: SupplierLineMetadata,
  oldSupplierName: string,
  newSupplierName: string,
  adminName: string,
): Promise<void> {
  const comment = `From ${oldSupplierName} to ${newSupplierName}`;
  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO delivery_management_action_history
        (user, order_product_name, order_product_size,
         supplier_name, order_id, order_product_id,
         pvt_id, products_options_values_id,
         action, comment, date_added, master_product_id)
      VALUES
        (${adminName}, ${m.productName}, ${m.sizeName},
         ${newSupplierName}, ${m.orderId}, ${m.orderProductId},
         ${m.pvtId}, ${m.productsOptionsValuesId},
         ${'Update Supplier'}, ${comment}, NOW(), ${m.masterProductId})
    `,
  );
}

/**
 * Send a notification email when an AIRO-manufacturer product line does not
 * have a recognised Airo size option value (legacy L276-289).
 *
 * Recipients: process.env.DEVELOPMENT_TEAM_EMAILS (comma-separated).
 * If the env var is absent or empty, the email is silently skipped — this
 * path must never fail the create transaction.
 */
async function sendSizeUnmappedEmail(m: SupplierLineMetadata): Promise<void> {
  const recipients = (process.env.DEVELOPMENT_TEAM_EMAILS ?? '').trim();
  if (!recipients) {
    logger.warn(
      { orderProductId: m.orderProductId, orderId: m.orderId },
      'DEVELOPMENT_TEAM_EMAILS not set — skipping size-unmapped notification email',
    );
    return;
  }

  const subject = `Error in Airo Open Order (SDM) module Order ID: ${m.orderId}`;
  const html = [
    'Hi,',
    '',
    'Below product is entered in the Airo Open Order tab with other than airo size',
    `Product ID: ${m.productId}`,
    `Order ID: ${m.orderId}`,
    `Pvt ID: ${m.pvtId}`,
    `Manufacturer: ${m.manufacturersId}`,
  ].join('<br>');

  await emailService.sendEmail({ to: recipients, subject, html });
}
