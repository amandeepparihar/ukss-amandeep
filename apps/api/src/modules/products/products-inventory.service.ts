/**
 * New Product Module — Inventory management service.
 * Requirements: REQ-3 (inventory management), REQ-4 (existing inventory display)
 *
 * Verified against legacy SMS: product_quantities_controller.php lines 735-1149
 * Log table: stock_system_logs2 (legacy model: StockSystemLog, renamed after table crash)
 *
 * All writes wrapped in a single transaction. Column names verified against live zenc_main_db.
 */

import { prisma, Prisma } from '../../lib/prisma';
import { NotFoundError, ConflictError, ApiError } from '../../lib/errors';
import { toBigIntSafe } from '../../lib/utils/bigint';
import type { TxClient, InventoryInput, InventoryEntryResult, InventoryRow } from './products.types';
import { resolveBoxId } from './products-lookup.service';
import { refreshStockHomeGrid } from './products-stock-grid.service';

// ---------------------------------------------------------------------------
// Quantity-map sync
// ---------------------------------------------------------------------------

/**
 * Propagate the current total of `product_quantities.quantity` (summed across
 * every box for this product code) to every ZenCart `products` row that the
 * product is mapped to, plus the `product_lists_to_products` mapping itself.
 *
 * Only invoked when `product_lists.quantity_map = 1` — i.e. the operator has
 * opted this product into automatic stock-level sync with the storefront.
 *
 * Mirrors legacy `product_quantities_controller.php` lines 1018–1078 (used by
 * both the initial inventory add and the inline-edit endpoint). Kept here as a
 * single source of truth so the two callers can't drift.
 */
async function syncQuantityMapForProduct(
  tx: TxClient,
  productListsId: number,
): Promise<void> {
  // Total quantity across all boxes for this product code.
  const totalRows = await tx.$queryRaw<Array<{ total_quantity: number }>>(
    Prisma.sql`
      SELECT COALESCE(SUM(quantity), 0) AS total_quantity
      FROM product_quantities
      WHERE product_lists_id = ${productListsId}
    `,
  );
  const totalQuantity = Number(totalRows[0]?.total_quantity ?? 0);

  const mappedProducts = await tx.$queryRaw<
    Array<{ products_id: number; product_lists_to_products_id: number }>
  >(
    Prisma.sql`
      SELECT products_id, product_lists_to_products_id
      FROM product_lists_to_products
      WHERE product_lists_id = ${productListsId}
    `,
  );

  for (const mp of mappedProducts) {
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE product_lists_to_products
        SET sms_quantity = ${totalQuantity}, status = 1
        WHERE product_lists_to_products_id = ${mp.product_lists_to_products_id}
      `,
    );
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE products
        SET products_quantity = ${totalQuantity}, quantity_map = 1, products_status = 1
        WHERE products_id = ${mp.products_id}
      `,
    );
  }
}

// ---------------------------------------------------------------------------
// Add inventory (REQ-3)
// ---------------------------------------------------------------------------

export async function addInventory(
  data: InventoryInput,
  userId: number,
  userIp: string,
): Promise<{ entries: InventoryEntryResult[] }> {
  const result = await prisma.$transaction(async (tx: TxClient) => {
    // 0. Cascade consistency: the submitted (sizeOptionId, sizeGroupId, sizeId)
    // triple must form a real path through the size-mapping tables. Without
    // this, a stale/tampered client could store a size_id from a completely
    // different group/option pair — exactly the gap the legacy SMS UI
    // prevented by always re-deriving these from cascading dropdowns.
    const sizePathRows = await tx.$queryRaw<Array<{ ok: number }>>(
      Prisma.sql`
        SELECT 1 AS ok
        FROM manufacturers_sizes_to_default_sizes msd
        JOIN sms_size_groups ssg ON msd.sms_size_groups_id = ssg.sms_size_groups_id
        WHERE msd.manufacturers_options_values_id = ${data.sizeId}
          AND msd.sms_size_groups_id = ${data.sizeGroupId}
          AND ssg.products_options_id = ${data.sizeOptionId}
        LIMIT 1
      `
    );
    if (sizePathRows.length === 0) {
      throw new ApiError(
        400,
        'INVALID_SIZE_PATH',
        'Selected size does not belong to the chosen size group/option',
      );
    }

    // 1. Validate product_lists_id exists and get product code for side effects
    const plRows = await tx.$queryRaw<Array<{ product_lists_id: number; product_code: string; quantity_map: number }>>(
      Prisma.sql`SELECT product_lists_id, product_code, quantity_map FROM product_lists WHERE product_lists_id = ${data.productListsId} LIMIT 1`
    );
    if (plRows.length === 0) {
      throw new NotFoundError('Product code not found');
    }
    const productCode = plRows[0].product_code;
    const quantityMap = Number(plRows[0].quantity_map);

    // 1a. Refuse mixing size groups within a single product. Mirrors legacy
    // product_quantities_controller.php::get_mapped_sizes_to_size_groups
    // (lines 3290–3380). The frontend pre-checks this when the user picks a
    // group; this is the server-side gate for tampered or stale requests.
    const existingGroupRows = await tx.$queryRaw<Array<{
      existing_group_id: number;
      existing_group_name: string;
    }>>(
      Prisma.sql`
        SELECT
          msd.sms_size_groups_id AS existing_group_id,
          ssg.sms_size_groups_name AS existing_group_name
        FROM product_quantities pq
        INNER JOIN manufacturers_sizes_to_default_sizes msd
          ON pq.size_id = msd.manufacturers_options_values_id
        INNER JOIN sms_size_groups ssg
          ON msd.sms_size_groups_id = ssg.sms_size_groups_id
        WHERE pq.product_lists_id = ${data.productListsId}
        LIMIT 1
      `
    );
    if (existingGroupRows.length > 0) {
      const existingGroupId = Number(existingGroupRows[0].existing_group_id);
      if (existingGroupId !== data.sizeGroupId) {
        throw new ApiError(
          400,
          'SIZE_GROUP_CONFLICT',
          `Sorry! You can not assign another size group to the same product. ` +
            `${existingGroupRows[0].existing_group_name} is already assigned to this product code!`,
        );
      }
    }

    // 2. Check barcode ownership — must belong to this product or be new (REQ-3.4)
    // Note: BigInt from $queryRaw must be converted to Number for comparison with request data
    const barcodeRows = await tx.$queryRaw<Array<{ product_lists_id: number; product_code: string }>>(
      Prisma.sql`
        SELECT pq.product_lists_id, pl.product_code
        FROM product_quantities pq
        JOIN product_lists pl ON pq.product_lists_id = pl.product_lists_id
        WHERE pq.barcode = ${data.barcode}
        LIMIT 1
      `
    );
    if (barcodeRows.length > 0 && Number(barcodeRows[0].product_lists_id) !== data.productListsId) {
      throw new ConflictError(`Barcode belongs to another product: ${barcodeRows[0].product_code}`);
    }

    const entries: InventoryEntryResult[] = [];

    // 3. Process each box entry
    for (const entry of data.entries) {
      const boxListsId = await resolveBoxId(tx, entry.boxCode);

      // Check if barcode+box combination already exists.
      // IMPORTANT: Do NOT select first_quantity_added (DATETIME) — legacy rows have
      // '0000-00-00 00:00:00' which mysql2 binary protocol cannot deserialize,
      // producing Prisma P2010 Code: N/A, Message: N/A. Select only what we actually use.
      const existing = await tx.$queryRaw<Array<{
        product_quantities_id: number;
        quantity: number;
      }>>(
        Prisma.sql`
          SELECT product_quantities_id, quantity
          FROM product_quantities
          WHERE barcode = ${data.barcode} AND box_lists_id = ${boxListsId}
          LIMIT 1
        `
      );

      let previousQuantity: number;
      let newQuantity: number;
      let productQuantitiesId: number;
      let isNewRow: boolean;

      if (existing.length > 0) {
        // UPDATE existing row (REQ-3.6)
        // Note: BigInt conversion needed for MySQL INT columns from $queryRaw
        previousQuantity = Number(existing[0].quantity);
        const delta = entry.action === 'add' ? entry.quantity : -entry.quantity;
        newQuantity = previousQuantity + delta;
        // Stock can never go negative. Block a subtract that would take the
        // box below zero (REQ: old quantity − subtracted amount must be ≥ 0).
        if (newQuantity < 0) {
          throw new ApiError(
            400,
            'INSUFFICIENT_STOCK',
            `Cannot subtract ${entry.quantity} from box ${entry.boxCode}: ` +
              `only ${previousQuantity} in stock.`,
          );
        }
        productQuantitiesId = Number(existing[0].product_quantities_id);
        isNewRow = false;

        await tx.$executeRaw(
          Prisma.sql`
            UPDATE product_quantities SET
              quantity = ${newQuantity},
              size_weight = ${data.weight},
              modified = NOW()
            WHERE product_quantities_id = ${productQuantitiesId}
          `
        );
      } else {
        // INSERT new row (REQ-3.7)

        // Guard: same product + same size + same box must be unique (mirrors the
        // DB-level UNIQUE KEY product_quantities_UN on production). Checked here
        // so staging (which lacks that key) and the user both get a clear message.
        const sizeBoxConflict = await tx.$queryRaw<Array<{ barcode: string }>>(
          Prisma.sql`
            SELECT pq.barcode
            FROM product_quantities pq
            WHERE pq.product_lists_id = ${data.productListsId}
              AND pq.size_id = ${data.sizeId}
              AND pq.box_lists_id = ${boxListsId}
              AND pq.barcode != ${data.barcode}
            LIMIT 1
          `
        );
        if (sizeBoxConflict.length > 0) {
          throw new ConflictError(
            `Size already exists in box ${entry.boxCode} with barcode ${sizeBoxConflict[0].barcode}. ` +
            `The combination of product + size + box must be unique.`,
          );
        }

        previousQuantity = 0;
        newQuantity = entry.action === 'add' ? entry.quantity : -entry.quantity;
        // New box starts at 0 — subtracting any amount would go negative.
        if (newQuantity < 0) {
          throw new ApiError(
            400,
            'INSUFFICIENT_STOCK',
            `Cannot subtract ${entry.quantity} from box ${entry.boxCode}: ` +
              `box has no stock yet.`,
          );
        }
        isNewRow = true;

        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO product_quantities (
              sms_users_id, product_lists_id, size_id, sms_size_groups_id, quantity,
              box_lists_id, barcode, size_weight,
              total_added_quantity, first_quantity_added, first_quantity_flag,
              featured, comment, locked_admin, total_quantity,
              last_sale_date, FBA_quantity, COPA_quantity,
              created, modified
            ) VALUES (
              ${userId}, ${data.productListsId}, ${data.sizeId}, ${data.sizeGroupId}, ${newQuantity},
              ${boxListsId}, ${data.barcode}, ${data.weight},
              ${newQuantity}, NOW(), 'no',
              0, '', '', 0,
              '0000-00-00', 0, 0,
              NOW(), NOW()
            )
          `
        );

        const idRows = await tx.$queryRaw<Array<{ id: number }>>(
          Prisma.sql`SELECT LAST_INSERT_ID() AS id`
        );
        productQuantitiesId = Number(idRows[0].id);
      }

      // 4. Log to stock_system_logs2 (REQ-3.9).
      // New rows: always log (mirrors scan_barcode_controller.php:1418 — no qty guard).
      // Updates: only log if quantity actually changed (mirrors product_quantities_controller.php:1123).
      if (isNewRow || previousQuantity !== newQuantity) {
        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO stock_system_logs2 (
              sms_users_id, product_quantities_id, previous_qty, current_qty,
              ip_address, modified
            ) VALUES (
              ${userId}, ${productQuantitiesId}, ${previousQuantity}, ${newQuantity},
              ${userIp}, NOW()
            )
          `
        );
      }

      // 5. Update weight for all rows with same barcode+size (REQ-3.8)
      if (data.weight > 0) {
        await tx.$executeRaw(
          Prisma.sql`
            UPDATE product_quantities
            SET size_weight = ${data.weight}
            WHERE barcode = ${data.barcode} AND size_id = ${data.sizeId}
          `
        );
      }

      entries.push({
        boxCode: entry.boxCode,
        previousQuantity,
        newQuantity,
        action: entry.action,
        isNewRow,
      });
    }

    // =====================================================================
    // Side effects (REQ-5) — run within the same transaction
    // =====================================================================

    // 6. Pre-order email notification (REQ-5.1)
    // Legacy: product_quantities_controller.php lines 942-1011
    // Find orders with status 12 (Picking) or 23 (JIT Pending) that match this product code
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE pre_orderded_orders poo
        JOIN orders_products op ON op.orders_id = poo.orders_id
        JOIN orders o ON o.orders_id = poo.orders_id
        SET poo.email_status = 1, poo.email_date = CURDATE()
        WHERE op.products_model LIKE CONCAT('%', ${productCode}, '%')
          AND o.orders_status IN (12, 23)
          AND poo.email_status = 0
      `
    );

    // 7. Quantity map sync (REQ-5.2)
    // Legacy: product_quantities_controller.php lines 1018-1078
    if (quantityMap === 1) {
      await syncQuantityMapForProduct(tx, data.productListsId);
    }

    return { entries };
  }, { timeout: 30_000 });

  // Rebuild stock_home_grid_lists rows so the legacy SMS Deliveries / homepage
  // grids see the new product. Done OUTSIDE the transaction — failure here
  // must not roll back the inventory save (legacy parity: addStockGridList is
  // also called after the save in product_quantities_controller.php).
  await refreshStockHomeGrid([data.productListsId]);

  return result;
}

// ---------------------------------------------------------------------------
// Update existing inventory row (inline edit)
// ---------------------------------------------------------------------------

export async function updateInventoryRow(
  productQuantitiesId: number,
  quantity: number,
  weight: number,
  userId: number,
  userIp: string,
): Promise<void> {
  const productListsId = await prisma.$transaction(async (tx: TxClient): Promise<number> => {
    // Fetch current row — only INT/VARCHAR columns to avoid zero-date DATETIME issue
    const rows = await tx.$queryRaw<Array<{
      product_quantities_id: number;
      quantity: number;
      product_lists_id: number;
      quantity_map: number;
    }>>(
      Prisma.sql`
        SELECT pq.product_quantities_id, pq.quantity,
               pq.product_lists_id, pl.quantity_map
        FROM product_quantities pq
        JOIN product_lists pl ON pq.product_lists_id = pl.product_lists_id
        WHERE pq.product_quantities_id = ${productQuantitiesId}
        LIMIT 1
      `
    );
    if (rows.length === 0) {
      throw new NotFoundError('Inventory row not found');
    }
    const previousQuantity = Number(rows[0].quantity);
    const productListsId = Number(rows[0].product_lists_id);
    const quantityMap = Number(rows[0].quantity_map);

    await tx.$executeRaw(
      Prisma.sql`
        UPDATE product_quantities
        SET quantity = ${quantity}, size_weight = ${weight}, modified = NOW()
        WHERE product_quantities_id = ${productQuantitiesId}
      `
    );

    // Log change to stock_system_logs2
    if (previousQuantity !== quantity) {
      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO stock_system_logs2 (
            sms_users_id, product_quantities_id, previous_qty, current_qty,
            ip_address, modified
          ) VALUES (
            ${userId}, ${productQuantitiesId}, ${previousQuantity}, ${quantity},
            ${userIp}, NOW()
          )
        `
      );
    }

    // Quantity map sync — keep ZenCart in step if this product is mapped
    if (quantityMap === 1) {
      await syncQuantityMapForProduct(tx, productListsId);
    }

    return productListsId;
  }, { timeout: 15_000 });

  // Rebuild stock_home_grid_lists rows so the legacy SMS Deliveries grid
  // reflects the updated quantity. Done outside the tx (legacy parity).
  await refreshStockHomeGrid([productListsId]);
}

// ---------------------------------------------------------------------------
// Get existing inventory (REQ-4)
// ---------------------------------------------------------------------------

export async function getInventory(productListsId: number): Promise<InventoryRow[]> {
  return toBigIntSafe(await prisma.$queryRaw<InventoryRow[]>(
    Prisma.sql`
      SELECT
        pq.product_quantities_id,
        pq.barcode,
        COALESCE(pov.products_options_values_name, '') AS manufacturer_size_shortname,
        pq.size_weight AS weight,
        bl.box_code,
        pq.quantity,
        COALESCE(su.admin_name, 'Unknown') AS added_by,
        DATE_FORMAT(pq.created, '%Y-%m-%d %H:%i') AS date_added,
        ssg.products_options_id AS products_options_id,
        pq.sms_size_groups_id AS sms_size_groups_id
      FROM product_quantities pq
      LEFT JOIN products_options_values_to_products_options povtpo
        ON pq.size_id = povtpo.products_options_values_to_products_options_id
      LEFT JOIN products_options_values pov
        ON povtpo.products_options_values_id = pov.products_options_values_id
      -- Size group is now read from the column stored on the row itself
      -- (populated at creation). We join sms_size_groups on its PRIMARY KEY
      -- only to resolve products_options_id. We must NOT join
      -- manufacturers_sizes_to_default_sizes on size_id here: its
      -- manufacturers_options_values_id is NOT unique (11 Macron sizes map to
      -- both a Shirts and a Shorts group), so that join fanned each barcode
      -- out into duplicate rows. Bug-166405.
      LEFT JOIN sms_size_groups ssg
        ON ssg.sms_size_groups_id = pq.sms_size_groups_id
      LEFT JOIN box_lists bl ON pq.box_lists_id = bl.box_lists_id
      LEFT JOIN sms_users su ON pq.sms_users_id = su.sms_users_id
      WHERE pq.product_lists_id = ${productListsId}
      ORDER BY pq.barcode ASC, bl.box_code ASC
    `
  ));
}
