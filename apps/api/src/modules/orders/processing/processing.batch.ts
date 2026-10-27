/**
 * SPEC-13 / #1061 P2: Batch engine — eligible-queue selection + archive numbering.
 *
 * Faithful port of the legacy queue-preparation phase in
 * webadmin/includes/modules/order_processing_new.php (lines 1-348):
 *
 *   L10  set sift_score_bit=1 for marketplace (customers_id=0) un-archived rows
 *   L16  archive_number = MAX(process_archive) + 1
 *   L40  assign archive_number to eligible rows (status 0/4, not printed,
 *        not archived, sift_score_bit=1)
 *   L75  15-minute same-customer rule → UPDATE those rows to status 3
 *   L129 pre-orders (orders_status 12) selected FIRST
 *   L360 remaining orders (status 0/4) by date_added ASC, excluding pre-orders
 *
 * The newfile.txt flat file the legacy engine writes (L28-32) is NOT reproduced:
 * it only held the current archive number for the legacy print-queue pages to
 * fread. Stock2 derives the archive number from the DB instead.
 *
 * ⚠️ Single-engine constraint: archive numbering is MAX+1, exactly as legacy —
 * it is NOT atomic across connections. Do not run this engine concurrently with
 * the legacy ZenCart order_processing_new.php cron against the same database, or
 * the two will allocate colliding archive numbers. During the migration only one
 * batch engine may own the queue at a time.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { STATUS } from '../orders.constants';
import type { TxClient } from './processing.types';

/**
 * Pure ordering rule: pre-orders first (legacy L129), then the remaining queue
 * by date_added (legacy L360/374), de-duplicated and preserving first position.
 * Extracted so the ordering is unit-testable without a database.
 */
export function mergeQueueOrder(preorderIds: number[], remainingIds: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of [...preorderIds, ...remainingIds]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * L10: marketplace orders (customers_id=0) always join the batch — force their
 * sift_score_bit so the L40 archive assignment picks them up. PMS 140450.
 */
export async function setSiftBitForMarketplaceQueue(client: TxClient = prisma): Promise<void> {
  await client.$executeRaw(
    Prisma.sql`
      UPDATE pre_processed_order_products po
      INNER JOIN orders o ON o.orders_id = po.orders_id
      SET po.sift_score_bit = '1'
      WHERE o.customers_id = 0
        AND po.process_archive = 0
    `
  );
}

/**
 * L16-19: next archive number = current MAX(process_archive) + 1.
 */
export async function pickNextArchiveNumber(client: TxClient = prisma): Promise<number> {
  const rows = await client.$queryRaw<Array<{ max_archive: number | null }>>(
    Prisma.sql`SELECT MAX(process_archive) AS max_archive FROM pre_processed_order_products`
  );
  return Number(rows[0]?.max_archive ?? 0) + 1;
}

/**
 * L40: stamp the archive number onto every eligible queue row.
 * Eligible = status 0 (new) or 4 (remote), not yet printed, not yet archived,
 * sift_score_bit set. Returns the number of rows stamped.
 */
export async function assignArchiveToEligible(
  archiveNumber: number,
  client: TxClient = prisma
): Promise<number> {
  const affected = await client.$executeRaw(
    Prisma.sql`
      UPDATE pre_processed_order_products
      SET process_archive = ${archiveNumber}, date_modified = NOW()
      WHERE (status = 0 OR status = 4)
        AND to_be_printed = 0
        AND process_archive = 0
        AND sift_score_bit = '1'
    `
  );
  return Number(affected);
}

/**
 * L75-104: 15-minute same-customer rule for the queue. Among the status-0 rows
 * just stamped with this archive, find consecutive orders from the same
 * (non-marketplace) customer placed within 15 minutes and flip them to status 3
 * (manual). Because the eligibility SELECTs below filter on status 0/4, flipping
 * to 3 removes the order from the batch — exactly as legacy L100 does it with an
 * UPDATE (NOT an insert). Returns the flagged order IDs.
 */
export async function flag15MinuteOrdersInArchive(
  archiveNumber: number,
  client: TxClient = prisma
): Promise<number[]> {
  const rows = await client.$queryRaw<Array<{
    orders_id: number;
    customers_id: number;
    date_added: string | null;
  }>>(
    Prisma.sql`
      SELECT ppop.orders_id, o.customers_id,
             NULLIF(ppop.date_added, '0000-00-00 00:00:00') AS date_added
      FROM pre_processed_order_products ppop
      LEFT JOIN orders o ON ppop.orders_id = o.orders_id
      WHERE ppop.status = 0 AND ppop.process_archive = ${archiveNumber}
      GROUP BY ppop.orders_id
      ORDER BY date_added ASC
    `
  );

  const toFlag: number[] = [];
  // Per customer: the previous order's id + timestamp (legacy $all_orders_array).
  const lastByCustomer = new Map<number, { orderId: number; at: number }>();

  for (const row of rows) {
    if (!row.customers_id || row.customers_id === 0 || !row.date_added) continue;
    const at = new Date(row.date_added).getTime();
    const prev = lastByCustomer.get(row.customers_id);
    if (prev && prev.at + 15 * 60 * 1000 >= at) {
      // Legacy only adds the *current* order to $orders_to_remove (L88); the
      // previous one is reached when it is itself the current row in its turn.
      toFlag.push(row.orders_id);
    }
    lastByCustomer.set(row.customers_id, { orderId: row.orders_id, at });
  }

  if (toFlag.length > 0) {
    await client.$executeRaw(
      Prisma.sql`
        UPDATE pre_processed_order_products
        SET status = 3, date_modified = NOW()
        WHERE orders_id IN (${Prisma.join(toFlag)})
      `
    );
  }
  return toFlag;
}

/**
 * L129 + L360/374: build the ordered list of order IDs to process for an
 * archive — pre-orders (orders_status 12) first, then remaining eligible orders
 * (status 0/4) oldest-first. Status-3 (15-min flagged) rows are excluded
 * naturally because both SELECTs filter on status 0/4.
 */
export async function selectQueueOrderIds(
  archiveNumber: number,
  client: TxClient = prisma
): Promise<number[]> {
  const preorderRows = await client.$queryRaw<Array<{ orders_id: number }>>(
    Prisma.sql`
      SELECT o.orders_id
      FROM orders o
      LEFT JOIN pre_processed_order_products poo ON poo.orders_id = o.orders_id
      WHERE poo.status = 0
        AND poo.process_archive = ${archiveNumber}
        AND o.orders_status = ${STATUS.PRE_ORDERED}
      GROUP BY o.orders_id
      ORDER BY o.orders_id ASC
    `
  );
  const preorderIds = preorderRows.map((r) => Number(r.orders_id));

  const remainingRows = await client.$queryRaw<Array<{ orders_id: number }>>(
    Prisma.sql`
      SELECT DISTINCT po.orders_id
      FROM pre_processed_order_products po
      WHERE po.process_archive = ${archiveNumber}
        AND po.status IN (0, 4)
      ORDER BY po.date_added ASC
    `
  );
  const remainingIds = remainingRows.map((r) => Number(r.orders_id));

  return mergeQueueOrder(preorderIds, remainingIds);
}

export interface PreparedQueue {
  archiveNumber: number;
  orderIds: number[];
  flaggedOrderIds: number[];
  eligibleRowCount: number;
}

/**
 * Run the full legacy queue-preparation phase and return the ordered order IDs
 * ready for the per-order processing loop. Mirrors order_processing_new.php
 * L1-348 in sequence.
 */
export async function prepareOrderQueue(client: TxClient = prisma): Promise<PreparedQueue> {
  await setSiftBitForMarketplaceQueue(client);
  const archiveNumber = await pickNextArchiveNumber(client);
  const eligibleRowCount = await assignArchiveToEligible(archiveNumber, client);
  const flaggedOrderIds = await flag15MinuteOrdersInArchive(archiveNumber, client);
  const orderIds = await selectQueueOrderIds(archiveNumber, client);
  return { archiveNumber, orderIds, flaggedOrderIds, eligibleRowCount };
}
