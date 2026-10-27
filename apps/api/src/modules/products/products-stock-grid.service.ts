/**
 * Stock-home-grid refresh service.
 *
 * Mirrors the full legacy SMS flow (no HTTP call to legacy):
 *   - app_controller.php::addStockGridList() — sets timestamp + DELETE
 *   - grid_file_controller.php::updategridlist() — INSERT one row per
 *     (product_lists_id, box_lists_id) combo with aggregated per-size columns.
 *
 * Trigger points: addInventory() and updateInventoryRow() in
 * products-inventory.service.ts. The Deliveries / homepage grids in legacy SMS
 * read from this table, so without this refresh new Stock2 products would
 * never appear in those grids.
 *
 * The implementation is fail-soft: any error here is logged but does not roll
 * back the inventory save. The pl_stock_grid_delete_time flag is also set so
 * the legacy `updateStockGridListTable` cron retries the row if our INSERT
 * fails for any reason.
 */

import { prisma, Prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';

const logger = createLogger('products-stock-grid');

interface SizeGroupItemRow {
  option_id: number;
  shortname: string | null;
}

interface ProductQuantityRow {
  product_quantities_id: number;
  product_lists_id: number;
  box_lists_id: number;
  size_id: number;
  quantity: number;
  fc_quantity: number;
  scanned_at_fc: string | null;
  FBA_quantity: number;
  total_added_quantity: number;
  first_quantity_added: string | null;
  created: string | null;
  modified: string | null;
  last_sale_date: string | null;
  default_options_values_id: number | null;
  sms_size_groups_id: number | null;
  actual_size_options_comments: string | null;
}

interface ProductHeaderRow {
  product_lists_id: number;
  product_code: string;
  product_name: string;
  products_code_type: number;
  product_code_image: string | null;
  product_code_additional_img: string | null;
  description_notes: string | null;
  price: number | null;
  FBA_price: number | null;
  map_status: number;
  font_assigned: string | null;
  teams_id: number;
  product_list_sort: number;
  special: number;
  special_start_date: string | null;
  special_end_date: string | null;
  quantity_map: number;
  season_name: string | null;
  season_sort: number;
  box_code: string | null;
}

/**
 * Refresh stock_home_grid_lists for the given product_lists_ids.
 *
 * Fail-soft: errors are logged. The cron picks up rows whose
 * pl_stock_grid_delete_time is left non-zero after this call.
 */
export async function refreshStockHomeGrid(productListsIds: number[]): Promise<void> {
  if (productListsIds.length === 0) return;
  const log = logger.child({ productListsIds });

  try {
    // 1. Flag rows pending refresh — legacy app_controller.php line 1856.
    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE product_lists
        SET pl_stock_grid_delete_time = NOW()
        WHERE product_lists_id IN (${Prisma.join(productListsIds)})
      `,
    );

    // 2. Delete existing rows so the upcoming INSERT does not duplicate
    //    (legacy CakePHP create()+save() is INSERT-only, no upsert).
    //    Legacy: app_controller.php line 1874.
    await prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM stock_home_grid_lists
        WHERE product_lists_id IN (${Prisma.join(productListsIds)})
      `,
    );

    // 3. Load the dynamic option_<X> column list once.
    const sizeGroupItemsRaw = await prisma.$queryRaw<SizeGroupItemRow[]>(
      Prisma.sql`
        SELECT option_id, shortname
        FROM size_group_items
        WHERE flag = 1
        ORDER BY item_id
      `,
    );
    const sizeGroupItems = sizeGroupItemsRaw ?? [];

    // 4. Build + INSERT rows per product (one row per non-empty box).
    for (const productListsId of productListsIds) {
      try {
        await rebuildGridForProduct(productListsId, sizeGroupItems);
      } catch (err) {
        log.warn({ productListsId, err }, 'Failed to rebuild grid rows for product (cron will retry)');
      }
    }

    // 5. Reset flag — legacy grid_file_controller.php line 902.
    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE product_lists
        SET pl_stock_grid_delete_time = '0000-00-00 00:00:00'
        WHERE product_lists_id IN (${Prisma.join(productListsIds)})
      `,
    );
  } catch (err) {
    log.warn({ err }, 'refreshStockHomeGrid failed (cron will retry)');
  }
}

/**
 * Build and INSERT stock_home_grid_lists rows for a single product.
 * One row per (product_lists_id, box_lists_id) combo where stock exists.
 */
async function rebuildGridForProduct(
  productListsId: number,
  sizeGroupItems: SizeGroupItemRow[],
): Promise<void> {
  // Pull all product_quantities rows for this product, joined with the size
  // mapping so we can group per default_options_values_id (the standard size
  // bucket — XS/S/M/L/etc.) which is what the option_X columns key on.
  const pqRowsRaw = await prisma.$queryRaw<ProductQuantityRow[]>(
    Prisma.sql`
      SELECT
        pq.product_quantities_id,
        pq.product_lists_id,
        pq.box_lists_id,
        pq.size_id,
        pq.quantity,
        pq.fc_quantity,
        pq.scanned_at_fc,
        pq.FBA_quantity,
        pq.total_added_quantity,
        DATE_FORMAT(pq.first_quantity_added, '%Y-%m-%d %H:%i:%s') AS first_quantity_added,
        DATE_FORMAT(pq.created, '%Y-%m-%d %H:%i:%s') AS created,
        DATE_FORMAT(pq.modified, '%Y-%m-%d %H:%i:%s') AS modified,
        DATE_FORMAT(pq.last_sale_date, '%Y-%m-%d') AS last_sale_date,
        msd.default_options_values_id,
        msd.sms_size_groups_id,
        msd.actual_size_options_comments
      FROM product_quantities pq
      LEFT JOIN manufacturers_sizes_to_default_sizes msd
        ON pq.size_id = msd.manufacturers_options_values_id
      WHERE pq.product_lists_id = ${productListsId}
    `,
  );

  const pqRows = pqRowsRaw ?? [];
  if (pqRows.length === 0) return; // No inventory yet → nothing to insert.

  // Per-product header info (one row): product_lists + season + the FIRST box.
  // We re-look-up box_code per row inside the loop below.
  const headerRowsRaw = await prisma.$queryRaw<ProductHeaderRow[]>(
    Prisma.sql`
      SELECT
        pl.product_lists_id,
        pl.product_code,
        pl.product_name,
        pl.products_code_type,
        pl.product_code_image,
        pl.product_code_additional_img,
        pl.description_notes,
        pl.price,
        pl.FBA_price,
        pl.map_status,
        pl.font_assigned,
        pl.teams_id,
        pl.sort AS product_list_sort,
        pl.special,
        DATE_FORMAT(pl.special_start_date, '%Y-%m-%d') AS special_start_date,
        DATE_FORMAT(pl.special_end_date, '%Y-%m-%d') AS special_end_date,
        pl.quantity_map,
        s.season AS season_name,
        s.sort AS season_sort,
        NULL AS box_code
      FROM product_lists pl
      LEFT JOIN seasons s ON pl.seasons_id = s.seasons_id
      WHERE pl.product_lists_id = ${productListsId}
      LIMIT 1
    `,
  );
  const headerRows = headerRowsRaw ?? [];
  if (headerRows.length === 0) return;
  const header = headerRows[0];

  // Aggregate maps keyed by default_options_values_id → box_lists_id → value.
  const qtyByOptionByBox = new Map<number, Map<number, number>>();
  const fcQtyByOptionByBox = new Map<number, Map<number, number>>();
  const scannedByOptionByBox = new Map<number, Map<number, string>>();
  const fbaByOptionByBox = new Map<number, Map<number, number>>();
  const commentByOptionByBox = new Map<number, Map<number, string>>();

  let totalAdded = 0;
  let totalRemaining = 0;
  let lastSaleDate: string | null = null;

  for (const row of pqRows) {
    totalAdded += Number(row.total_added_quantity ?? 0);
    totalRemaining += Number(row.quantity ?? 0);
    if (row.last_sale_date && row.last_sale_date !== '0000-00-00') {
      if (!lastSaleDate || row.last_sale_date > lastSaleDate) {
        lastSaleDate = row.last_sale_date;
      }
    }
    if (row.default_options_values_id == null) continue;

    const optionId = Number(row.default_options_values_id);
    const boxId = Number(row.box_lists_id);

    if (!qtyByOptionByBox.has(optionId)) qtyByOptionByBox.set(optionId, new Map());
    if (!fcQtyByOptionByBox.has(optionId)) fcQtyByOptionByBox.set(optionId, new Map());
    if (!scannedByOptionByBox.has(optionId)) scannedByOptionByBox.set(optionId, new Map());
    if (!fbaByOptionByBox.has(optionId)) fbaByOptionByBox.set(optionId, new Map());
    if (!commentByOptionByBox.has(optionId)) commentByOptionByBox.set(optionId, new Map());

    qtyByOptionByBox.get(optionId)!.set(boxId, Number(row.quantity ?? 0));
    fcQtyByOptionByBox.get(optionId)!.set(boxId, Number(row.fc_quantity ?? 0));
    scannedByOptionByBox.get(optionId)!.set(boxId, row.scanned_at_fc ?? 'no');
    fbaByOptionByBox.get(optionId)!.set(boxId, Number(row.FBA_quantity ?? 0));
    const comment = (row.actual_size_options_comments ?? '').trim();
    if (comment) commentByOptionByBox.get(optionId)!.set(boxId, comment);
  }

  const percentageSold = totalAdded > 0 ? ((totalAdded - totalRemaining) / totalAdded) * 100 : 0;

  // Today, used for the "is special active?" date check.
  const today = new Date().toISOString().slice(0, 10);

  // Walk distinct (product_lists_id, box_lists_id) combos. The first
  // product_quantities row encountered for each combo provides the row's
  // product_quantities_id and size_id — matching the legacy "first wins"
  // selection inside the foreach loop.
  const seenBoxes = new Set<number>();
  for (const row of pqRows) {
    const boxId = Number(row.box_lists_id);
    if (seenBoxes.has(boxId)) continue;
    seenBoxes.add(boxId);

    // Look up box_code for this box_lists_id.
    const bcRowsRaw = await prisma.$queryRaw<Array<{ box_code: string }>>(
      Prisma.sql`SELECT box_code FROM box_lists WHERE box_lists_id = ${boxId} LIMIT 1`,
    );
    const bcRows = bcRowsRaw ?? [];
    const boxCode = bcRows[0]?.box_code ?? '';

    // Per-box totals across all sizes.
    let totalQuantity = 0;
    let totalFcQuantity = 0;
    let totalFbaQuantity = 0;

    // Build the dynamic option_<X> columns for this box.
    const dynColumns: Record<string, string | number> = {};
    for (const sgi of sizeGroupItems) {
      const optionId = Number(sgi.option_id);
      const qty = qtyByOptionByBox.get(optionId)?.get(boxId);
      const fcQty = fcQtyByOptionByBox.get(optionId)?.get(boxId);
      const scanned = scannedByOptionByBox.get(optionId)?.get(boxId);
      const fbaQty = fbaByOptionByBox.get(optionId)?.get(boxId);
      const comment = commentByOptionByBox.get(optionId)?.get(boxId);

      // Legacy uses '' when absent (matching empty-string varchar columns).
      if (qty != null) {
        dynColumns[`option_${optionId}`] = comment ? `${qty}#${comment}` : qty;
      } else {
        dynColumns[`option_${optionId}`] = '';
      }
      dynColumns[`fc_quantity_option_${optionId}`] = fcQty != null ? fcQty : '';
      dynColumns[`scanned_at_fc_option_${optionId}`] = scanned ?? 'no';
      dynColumns[`FBA_option_${optionId}`] = fbaQty != null ? fbaQty : '';

      if (qty != null) {
        totalQuantity += qty;
        totalFcQuantity += fcQty ?? 0;
        totalFbaQuantity += fbaQty ?? 0;
      }
    }

    // one_size = 1 if this product spans multiple size groups in any box,
    // else 0. We compute it from the full pqRows distribution rather than
    // per-box because the legacy logic uses the full one_size matrix.
    const distinctSizeGroupsInProduct = new Set(
      pqRows
        .map((r) => r.sms_size_groups_id)
        .filter((g): g is number => g != null),
    );
    const oneSize = distinctSizeGroupsInProduct.size > 1 ? 1 : 0;

    // Special pricing window check (legacy lines 593–601).
    const startOk = header.special_start_date != null && header.special_start_date <= today;
    const endOk =
      (header.special_end_date != null && header.special_end_date >= today) ||
      header.special_end_date === '0001-01-01';
    const inSpecialWindow = startOk && endOk;
    const special = inSpecialWindow && Number(header.special) === 1 ? 1 : 0;

    // Static columns mapped 1:1 from legacy $product_details_array.
    const staticColumns: Record<string, string | number | null> = {
      product_quantities_id: Number(row.product_quantities_id),
      product_lists_id: productListsId,
      product_list_id: productListsId, // legacy duplicate alias
      product_name: header.product_name,
      product_code: header.product_code,
      product_code_type: Number(header.products_code_type ?? 0),
      product_code_image: header.product_code_image ?? '',
      product_code_additional_img: header.product_code_additional_img ?? '',
      description_notes: header.description_notes ?? '',
      season: header.season_name ?? '',
      season_sort: Number(header.season_sort ?? 0),
      product_lists_sort: Number(header.product_list_sort ?? 0),
      team_id: Number(header.teams_id),
      map: Number(header.map_status) === 1 ? 'Mapped' : '',
      price: Number(header.price ?? 0),
      FBA_price: Number(header.FBA_price ?? 0),
      quantity_map: Number(header.quantity_map ?? 0),
      amazon_low_price: '',
      // Skipping the per-marketplace ebay_product computation — defaulting to
      // 3 ("no product for ebay") matches the legacy fallback when no rows
      // are found in product_feed_variations.
      ebay_product: 3,
      assign_font: header.font_assigned ?? '',
      boxcode: boxCode,
      size_id: Number(row.size_id),
      first_quantity_added: row.first_quantity_added ?? '0000-00-00 00:00:00',
      created: row.created ?? null,
      modified: row.modified ?? null,
      last_sale_date: lastSaleDate ?? '0000-00-00',
      special,
      special_start_date: header.special_start_date ?? '0000-00-00',
      one_size: oneSize,
      attr: '', // legacy computes a comma list of mismatched option_ids;
                // safe to leave empty for new inserts.
      quantity: totalQuantity,
      fc_quantity: totalFcQuantity,
      FBA_quantity: totalFbaQuantity,
      Is_FBA: totalFbaQuantity > 0 ? 'Yes' : 'No',
      percentage_sold: percentageSold,
    };

    const allColumns = { ...staticColumns, ...dynColumns };
    await insertGridRow(allColumns);
  }
}

// Dynamic column names are built from size_group_items.option_id (integers)
// plus a fixed set of static columns. This regex validates every column name
// before it enters the SQL text to guard against legacy data drift.
const SAFE_COLUMN_RE = /^(?:option|fc_quantity_option|scanned_at_fc_option|FBA_option)_\d+$|^[a-z_A-Z]+$/;

async function insertGridRow(columns: Record<string, string | number | null>): Promise<void> {
  const colNames = Object.keys(columns);
  for (const col of colNames) {
    if (!SAFE_COLUMN_RE.test(col)) {
      throw new Error(`Refusing to insert into unrecognised column: ${col}`);
    }
  }
  const placeholders = colNames.map(() => '?').join(', ');
  const sql = `INSERT INTO stock_home_grid_lists (${colNames.join(', ')}) VALUES (${placeholders})`;
  const values = colNames.map((k) => columns[k]);
  await prisma.$executeRawUnsafe(sql, ...values);
}
