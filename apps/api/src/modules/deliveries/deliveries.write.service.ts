/**
 * Deliveries write-path services.
 *
 * Migration source:
 *  - Inline cell edit  → `product_quantities_controller.php::save_product`
 *    (lines 2355-2915) + model `product_quantity.php::save_product_data`
 *    (lines 76-359). See audit in
 *    documentation/deliveries-write-path-plan.md §4.1.
 *  - Image-added toggle → `index_controller.php::added_product_code_image`
 *    (lines 4119-4137). See plan §4.2.
 *  - Link/unlink quantity → `product_quantities_controller.php::link_quantities`
 *    (lines 4337-4764). See plan §4.4.
 *
 * Parity requirements (do not weaken):
 *  - Reproduce every column UPDATE the legacy path performs (audit "WB" tables).
 *  - Add a transaction wrapper around related writes — the legacy app has none,
 *    so adding one is a free reliability win with zero parity cost.
 *  - Re-enforce per-column permission on the server (legacy is wide open under
 *    `Auth->allow()`; we deliberately tighten this — see audit §2).
 *  - Honour the cache contract via `stock-grid-cache` helpers (no direct
 *    StockHomeGridList writes outside the shared module).
 */

import { Prisma, prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { config } from '../../config';
import { directUpdateGridRow } from './stock-grid-cache';
import type {
  DeliveryInlineEditBody,
  ImageAddedBody,
  LinkQuantityBody,
} from './deliveries.write.schema';

const logger = createLogger('deliveries.write');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const mysqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

class DeliveryWriteError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
    this.name = 'DeliveryWriteError';
  }
}
export { DeliveryWriteError };

interface ProductQuantityRow {
  product_quantities_id: number;
  product_lists_id: number;
  box_lists_id: number;
  size_id: number;
  quantity: number;
  total_added_quantity: number | null;
  barcode: string | null;
}

interface ProductListRow {
  product_lists_id: number;
  product_code: string;
  quantity_map: number;
  special: number;
}

/**
 * Coerce all integer columns returned by `$queryRawUnsafe` from `bigint` to
 * `number`. MySQL BIGINT (and any `CAST(... AS SIGNED)` expression) round-trips
 * through Prisma as JS `BigInt`, which then throws `TypeError: Cannot mix
 * BigInt and other types` the first time we do arithmetic against a plain
 * number (e.g. `total_added_quantity + delta` in `applySizeQuantityEdit`).
 * Quantities here are inventory counts that comfortably fit in 53 bits.
 */
function toNum(v: unknown): number {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  return Number(v ?? 0);
}

async function fetchProductQuantity(
  tx: Prisma.TransactionClient,
  id: number
): Promise<ProductQuantityRow | null> {
  const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT product_quantities_id, product_lists_id, box_lists_id, size_id,
            CAST(quantity AS SIGNED) AS quantity,
            CAST(total_added_quantity AS SIGNED) AS total_added_quantity,
            barcode
       FROM product_quantities
      WHERE product_quantities_id = ?
      LIMIT 1`,
    id
  );
  const r = rows[0];
  if (!r) return null;
  return {
    product_quantities_id: toNum(r.product_quantities_id),
    product_lists_id: toNum(r.product_lists_id),
    box_lists_id: toNum(r.box_lists_id),
    size_id: toNum(r.size_id),
    quantity: toNum(r.quantity),
    total_added_quantity:
      r.total_added_quantity == null ? null : toNum(r.total_added_quantity),
    barcode: (r.barcode as string | null) ?? null,
  };
}

async function fetchProductList(
  tx: Prisma.TransactionClient,
  id: number
): Promise<ProductListRow | null> {
  const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT product_lists_id, product_code,
            CAST(quantity_map AS SIGNED) AS quantity_map,
            CAST(special AS SIGNED) AS special
       FROM product_lists
      WHERE product_lists_id = ?
      LIMIT 1`,
    id
  );
  const r = rows[0];
  if (!r) return null;
  return {
    product_lists_id: toNum(r.product_lists_id),
    product_code: String(r.product_code ?? ''),
    quantity_map: toNum(r.quantity_map),
    special: toNum(r.special),
  };
}

async function fetchBoxCode(
  tx: Prisma.TransactionClient,
  boxListsId: number
): Promise<string | null> {
  const rows = await tx.$queryRawUnsafe<{ box_code: string }[]>(
    `SELECT box_code FROM box_lists WHERE box_lists_id = ? LIMIT 1`,
    boxListsId
  );
  return rows[0]?.box_code ?? null;
}

async function sumProductListsQuantity(
  tx: Prisma.TransactionClient,
  productListsId: number,
  boxListsId: number
): Promise<number> {
  // Per-row "quantity" on stock_home_grid_lists is the sum across sizes for a
  // given (product_lists_id, box_lists_id). Matches the legacy model's:
  //   SELECT SUM(quantity) FROM product_quantities WHERE product_lists_id=? AND box_lists_id=?
  // at product_quantity.php:148-152.
  const rows = await tx.$queryRawUnsafe<{ total: number | bigint }[]>(
    `SELECT COALESCE(SUM(CAST(quantity AS SIGNED)),0) AS total
       FROM product_quantities
      WHERE product_lists_id = ? AND box_lists_id = ?`,
    productListsId,
    boxListsId
  );
  return Number(rows[0]?.total ?? 0);
}

async function sumProductListsTotal(
  tx: Prisma.TransactionClient,
  productListsId: number
): Promise<number> {
  // Used when cascading to product_lists_to_products + products on
  // quantity_map=1 — legacy product_quantity.php:184-198. The legacy query
  // groups across all box codes for the same product_lists_id.
  const rows = await tx.$queryRawUnsafe<{ total: number | bigint }[]>(
    `SELECT COALESCE(SUM(CAST(quantity AS SIGNED)),0) AS total
       FROM product_quantities
      WHERE product_lists_id = ?`,
    productListsId
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Reproduce legacy `AppController::Add_Special_price` (app_controller.php:2399-2478).
 *
 * Cheap when the product is not on special — returns immediately. When special
 * is active, walks `new_products` → `specials` and patches
 * `stock_home_grid_lists` via `setGridSpecial` semantics.
 *
 * For phase 2 we implement the no-op short-circuit fully and log when we
 * detect an active special so we can decide later whether to port the full
 * setGridSpecial body. The deliveries inline-edit endpoint should NOT be the
 * first place that mutates specials — the Special column has its own
 * controller; we just need this helper to not break parity for products that
 * happen to be on special when their season/price/quantity is edited.
 */
async function addSpecialPriceIfActive(
  tx: Prisma.TransactionClient,
  productList: ProductListRow,
  callerTag: string
): Promise<void> {
  if (productList.special !== 1) return;
  logger.info(
    {
      productCode: productList.product_code,
      productListsId: productList.product_lists_id,
      callerTag,
    },
    'Product on special during inline edit — full setGridSpecial parity TBD (phase 2 placeholder)'
  );
  // No-op for phase 2. The Special column UI still goes through legacy, which
  // is the authoritative writer of `stock_home_grid_lists.special*` columns.
}

// ---------------------------------------------------------------------------
// Inline cell-edit service
// ---------------------------------------------------------------------------

export interface DeliveryInlineEditResult {
  productQuantitiesId: number;
  column: string;
  value: string;
  previousQuantity?: number;
  newRowQuantity?: number;
}

export async function applyInlineCellEdit(
  body: DeliveryInlineEditBody,
  smsUserId: number,
  ipAddress?: string
): Promise<DeliveryInlineEditResult> {
  if (body.column === 'season') {
    return applySeasonEdit(body, smsUserId);
  }
  if (body.column === 'price') {
    return applyPriceEdit(body, smsUserId);
  }
  if (body.column === 'special_price') {
    return applySpecialPriceEdit(body, smsUserId);
  }
  // option_<N>
  const sizeId = Number(body.column.slice('option_'.length));
  if (!Number.isFinite(sizeId) || sizeId <= 0) {
    throw new DeliveryWriteError(`Unsupported column: ${body.column}`, 'INVALID_COLUMN');
  }
  return applySizeQuantityEdit(body, sizeId, smsUserId, ipAddress);
}

// --- season ---------------------------------------------------------------

async function applySeasonEdit(
  body: DeliveryInlineEditBody,
  smsUserId: number
): Promise<DeliveryInlineEditResult> {
  return prisma.$transaction(async (tx) => {
    const pq = await fetchProductQuantity(tx, body.productQuantitiesId);
    if (!pq) throw new DeliveryWriteError('product_quantity not found', 'PQ_NOT_FOUND', 404);
    const pl = await fetchProductList(tx, pq.product_lists_id);
    if (!pl) throw new DeliveryWriteError('product_list not found', 'PL_NOT_FOUND', 404);

    const seasonsId = await upsertSeasonId(tx, body.value);

    // 1. product_lists.seasons_id (FK)
    await tx.$executeRawUnsafe(
      `UPDATE product_lists SET seasons_id = ? WHERE product_lists_id = ?`,
      seasonsId,
      pq.product_lists_id
    );

    // 2. stock_home_grid_lists.season (string label — legacy parity quirk:
    //    cache stores the label, source-of-truth stores the id).
    //
    //    Legacy (product_quantities_controller.php L2536-2538) patches a
    //    single cache row keyed by (product_quantities_id, product_lists_id).
    //    For a product with multiple boxes that leaves the other box rows
    //    with the old season label — visible as inconsistent rows in the
    //    grid until the next cache rebuild. Since `seasons_id` lives on
    //    product_lists (one season per product), we patch every cache row
    //    for the product instead. Strictly an improvement on legacy: the
    //    same value is written, just to more rows.
    await directUpdateGridRow({
      set: { season: body.value },
      where: { byProductListsId: pq.product_lists_id },
      callerTag: 'deliveries/inline-edit/season',
    }, tx);

    // 3. addSpecialPriceIfActive — no-op unless this product is on special.
    await addSpecialPriceIfActive(tx, pl, 'inline-edit/season');

    logger.info(
      { productQuantitiesId: pq.product_quantities_id, smsUserId, value: body.value },
      'inline season edit applied'
    );
    return { productQuantitiesId: pq.product_quantities_id, column: 'season', value: body.value };
  });
}

async function upsertSeasonId(tx: Prisma.TransactionClient, seasonLabel: string): Promise<number> {
  // Legacy `Season::getSeasonId` (season.php:27-39): SELECT seasons_id by
  // exact match on `season`; if missing, INSERT { season, rueducommerce_season }.
  const existing = await tx.$queryRawUnsafe<{ seasons_id: number }[]>(
    `SELECT seasons_id FROM seasons WHERE season = ? LIMIT 1`,
    seasonLabel
  );
  if (existing[0]) return existing[0].seasons_id;
  // INSERT and return LAST_INSERT_ID. We use raw SQL because `seasons` is
  // outside our Prisma schema (legacy table).
  await tx.$executeRawUnsafe(
    `INSERT INTO seasons (season, rueducommerce_season) VALUES (?, ?)`,
    seasonLabel,
    seasonLabel
  );
  const lastIdRow = await tx.$queryRawUnsafe<{ id: number | bigint }[]>(`SELECT LAST_INSERT_ID() AS id`);
  return Number(lastIdRow[0]?.id ?? 0);
}

// --- price ----------------------------------------------------------------

async function applyPriceEdit(
  body: DeliveryInlineEditBody,
  smsUserId: number
): Promise<DeliveryInlineEditResult> {
  // Tolerant parse — the grid now uses a text editor, so operators may type
  // a leading currency symbol or extra whitespace ("£12.50", "12.50 ").
  // Strip anything that isn't a digit, '.', or '-' before parsing.
  const cleaned = String(body.value).replace(/[^\d.\-]/g, '').trim();
  const priceNum = Number(cleaned);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    throw new DeliveryWriteError('price must be a non-negative number', 'INVALID_PRICE');
  }
  return prisma.$transaction(async (tx) => {
    const pq = await fetchProductQuantity(tx, body.productQuantitiesId);
    if (!pq) throw new DeliveryWriteError('product_quantity not found', 'PQ_NOT_FOUND', 404);
    const pl = await fetchProductList(tx, pq.product_lists_id);
    if (!pl) throw new DeliveryWriteError('product_list not found', 'PL_NOT_FOUND', 404);

    // 1. product_lists.price (NOT FBA — Phase 2 doesn't expose FBA grid).
    await tx.$executeRawUnsafe(
      `UPDATE product_lists SET price = ? WHERE product_lists_id = ?`,
      priceNum,
      pq.product_lists_id
    );

    // 2. Direct cache patch — the only cache write we do for price edits.
    //    Cache stores price as a string; format with 2 decimals to match what
    //    the legacy ZenCart writer produces.
    //
    //    Legacy parity note: legacy calls `addStockGridList` after a price
    //    edit (product_quantities_controller.php L2561), which is a full
    //    DELETE+rebuild via the in-process PHP path. We INTENTIONALLY do
    //    not mirror that here — see the equivalent note in
    //    applySizeQuantityEdit for the full rationale. tl;dr the rebuild
    //    runs as a cross-host POST, the DELETE happens regardless of POST
    //    success, and a failed POST wipes every cache row for the product
    //    until the legacy cron heals (caused a production incident with
    //    JZ5773 losing 4 cache rows on edit). The direct patch above is
    //    enough to show the new price; derived columns will reconcile on
    //    the next legacy cron pass.
    await directUpdateGridRow({
      set: { price: priceNum.toFixed(2) },
      where: { byProductListsId: pq.product_lists_id },
      callerTag: 'deliveries/inline-edit/price/direct-patch',
    }, tx);

    // 3. addSpecialPriceIfActive (no-op for non-special products — see helper).
    await addSpecialPriceIfActive(tx, pl, 'inline-edit/price');

    logger.info(
      { productQuantitiesId: pq.product_quantities_id, smsUserId, price: priceNum },
      'inline price edit applied'
    );

    return { productQuantitiesId: pq.product_quantities_id, column: 'price', value: body.value };
  });
}

// --- special_price ----------------------------------------------------------

/**
 * Mirrors `product_quantities_controller.php::save_product`,
 * `case "special_price":` (lines 2590-2919). Skips the `Is_FBA_grid == 'Yes'`
 * branch entirely, same as the rest of this file.
 */
async function applySpecialPriceEdit(
  body: DeliveryInlineEditBody,
  smsUserId: number
): Promise<DeliveryInlineEditResult> {
  const isClear = body.value === '';
  // Legacy writes the raw string into products_price_sorter / specials_price
  // without validating it. We instead match applyPriceEdit's tolerant-parse
  // gate (strip currency symbols/whitespace, require a non-negative number) —
  // operators type into the same kind of text-editor cell, so the same input
  // hygiene applies here.
  let priceNum = 0;
  if (!isClear) {
    const cleaned = String(body.value).replace(/[^\d.\-]/g, '').trim();
    priceNum = Number(cleaned);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      throw new DeliveryWriteError('special price must be a non-negative number', 'INVALID_SPECIAL_PRICE');
    }
  }

  return prisma.$transaction(async (tx) => {
    const pq = await fetchProductQuantity(tx, body.productQuantitiesId);
    if (!pq) throw new DeliveryWriteError('product_quantity not found', 'PQ_NOT_FOUND', 404);
    const pl = await fetchProductList(tx, pq.product_lists_id);
    if (!pl) {
      throw new DeliveryWriteError('Product code is not found', 'PRODUCT_CODE_NOT_FOUND', 404);
    }

    const codeTypeRows = await tx.$queryRawUnsafe<Array<{ products_code_type: number | bigint | null }>>(
      `SELECT products_code_type FROM product_lists WHERE product_lists_id = ? LIMIT 1`,
      pq.product_lists_id
    );
    const productsCodeType =
      codeTypeRows[0]?.products_code_type == null ? null : toNum(codeTypeRows[0].products_code_type);
    const skipQuantityMap = productsCodeType === 4;

    // Step 2: candidate products_id set — new_products rows whose products_model
    // contains this product_code as a substring.
    const candidates = await tx.$queryRawUnsafe<
      Array<{
        products_id: number | bigint;
        products_model: string | null;
        virtual_product_type_id: number | bigint | null;
      }>
    >(
      `SELECT products_id, products_model, virtual_product_type_id
         FROM new_products
        WHERE products_model LIKE ?`,
      `%${pl.product_code}%`
    );

    // T-shirt guard runs over every LIKE candidate BEFORE the matched set is
    // finalized — bail with no writes at all if any candidate is a t-shirt.
    for (const c of candidates) {
      if (c.virtual_product_type_id != null && toNum(c.virtual_product_type_id) === 4) {
        throw new DeliveryWriteError(
          'You cannot set the special price for Tshirt Virtual type product.',
          'TSHIRT_VIRTUAL_TYPE'
        );
      }
    }

    // CSV-token equality against new_products.products_model — mirrors the
    // pattern in applyLinkQuantity, just matched against a different table.
    const matchedProductsIds = new Set<number>();
    for (const c of candidates) {
      const tokens = String(c.products_model ?? '').split(',').map((s) => s.trim());
      if (tokens.includes(pl.product_code)) {
        matchedProductsIds.add(toNum(c.products_id));
      }
    }

    if (matchedProductsIds.size === 0) {
      throw new DeliveryWriteError(
        'You cannot set the special price to this product code as it is not mapped with any product.',
        'NOT_MAPPED'
      );
    }

    const currentDateTime = mysqlNow();
    const currentDate = currentDateTime.slice(0, 10);

    if (!isClear) {
      // SET branch --------------------------------------------------------

      // Same target row + same values on every loop iteration in legacy — a
      // safe simplification to run this once rather than once per matched id.
      const productListSql = skipQuantityMap
        ? `UPDATE product_lists SET special = '1', special_end_date = '0001-01-01', special_start_date = ? WHERE product_lists_id = ?`
        : `UPDATE product_lists SET special = '1', special_end_date = '0001-01-01', special_start_date = ?, quantity_map = '1' WHERE product_lists_id = ?`;
      await tx.$executeRawUnsafe(productListSql, currentDate, pq.product_lists_id);

      await directUpdateGridRow({
        set: {
          special: 1,
          special_price: priceNum.toFixed(2),
          special_start_date: currentDate,
          special_expiry_date: '0001-01-01',
          last_sale_date: currentDate,
        },
        where: { byProductListsId: pq.product_lists_id },
        callerTag: 'deliveries/inline-edit/special-price/set',
      }, tx);

      await tx.$executeRawUnsafe(
        `UPDATE product_quantities SET last_sale_date = ? WHERE product_lists_id = ?`,
        currentDate,
        pq.product_lists_id
      );

      const productsSql = skipQuantityMap
        ? `UPDATE products SET products_price_sorter = ? WHERE products_id = ?`
        : `UPDATE products SET products_price_sorter = ?, quantity_map = '1' WHERE products_id = ?`;
      const newProductsSql = skipQuantityMap
        ? `UPDATE new_products SET specials_status = 'Special', specials_price = ? WHERE products_id = ?`
        : `UPDATE new_products SET specials_status = 'Special', specials_price = ?, quantity_map = '1' WHERE products_id = ?`;

      for (const productsId of matchedProductsIds) {
        // Hero-shirt cascade — SET branch only. Legacy does not do this on
        // clear; preserve that asymmetry.
        const children = await tx.$queryRawUnsafe<
          Array<{ products_id: number | bigint; products_model: string | null }>
        >(
          `SELECT products_id, products_model FROM products WHERE hero_shirt_parent = ?`,
          productsId
        );
        if (children.length > 0) {
          const childIds = children.map((c) => toNum(c.products_id));
          // Legacy joins every child's trimmed model then explodes on EVERY comma
          // (app_controller.php ~L2680) — a child's own model can itself be a
          // CSV of codes (same shape the matching above already handles), so
          // this must flatten to atomic product_code tokens, not one entry per child.
          const childModels = children.flatMap((c) =>
            String(c.products_model ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          );
          await tx.$executeRawUnsafe(
            `UPDATE products SET quantity_map = 1 WHERE products_id IN (${childIds.map(() => '?').join(',')})`,
            ...childIds
          );
          await tx.$executeRawUnsafe(
            `UPDATE new_products SET quantity_map = 1 WHERE products_id IN (${childIds.map(() => '?').join(',')})`,
            ...childIds
          );
          if (childModels.length > 0) {
            await tx.$executeRawUnsafe(
              `UPDATE product_lists SET quantity_map = 1 WHERE product_code IN (${childModels.map(() => '?').join(',')})`,
              ...childModels
            );
            await tx.$executeRawUnsafe(
              `UPDATE stock_home_grid_lists SET quantity_map = 1 WHERE product_code IN (${childModels.map(() => '?').join(',')})`,
              ...childModels
            );
          }
        }

        const existing = await tx.$queryRawUnsafe<Array<{ specials_id: number | bigint }>>(
          `SELECT specials_id FROM specials WHERE products_id = ? LIMIT 1`,
          productsId
        );

        await tx.$executeRawUnsafe(productsSql, priceNum, productsId);
        await tx.$executeRawUnsafe(newProductsSql, priceNum, productsId);

        if (existing[0]) {
          await tx.$executeRawUnsafe(
            `UPDATE specials SET specials_last_modified = NOW(), specials_new_products_price = ?, expires_date = '0001-01-01', specials_date_available = ? WHERE specials_id = ?`,
            priceNum,
            currentDate,
            toNum(existing[0].specials_id)
          );
        } else {
          // Legacy's $data['Special'] array never sets status explicitly on
          // insert; we set it to 1 anyway rather than lean on a DB default,
          // matching the sibling setSpecialPrice() in daily-deals.service.ts.
          // sort_order and FBA_special_price are NOT NULL with no DB default —
          // legacy's non-strict connection lets them fall through to 0/0.00, but
          // ours runs strict (errno 1364), so set them explicitly. This is a
          // non-FBA special, so FBA_special_price is 0.
          await tx.$executeRawUnsafe(
            `INSERT INTO specials (products_id, specials_new_products_price, specials_date_added, specials_last_modified, expires_date, specials_date_available, status, sort_order, FBA_special_price)
             VALUES (?, ?, NOW(), NOW(), '0001-01-01', ?, 1, 0, 0)`,
            productsId,
            priceNum,
            currentDate
          );
        }
      }
    } else {
      // CLEAR branch — no hero-shirt cascade here (asymmetric vs. SET).

      await directUpdateGridRow({
        set: {
          special: 0,
          // Literal string "NULL", not SQL NULL — deliveries.service.ts reads
          // pl_special_price !== 'NULL' on the way back out, so this exact
          // string is required for read-side parity.
          special_price: 'NULL',
          special_start_date: '0000-00-00',
          special_expiry_date: '0000-00-00',
        },
        where: { byProductListsId: pq.product_lists_id },
        callerTag: 'deliveries/inline-edit/special-price/clear',
      }, tx);

      // '0001-00-00' (month zero) is what legacy literally writes here — an
      // intentional quirk to reproduce, not a typo.
      await tx.$executeRawUnsafe(
        `UPDATE product_lists SET special = '0', special_end_date = '0001-00-00', special_start_date = '0000-00-00' WHERE product_lists_id = ?`,
        pq.product_lists_id
      );

      for (const productsId of matchedProductsIds) {
        await tx.$executeRawUnsafe(
          `UPDATE new_products SET specials_status = 'Not Special', specials_price = 'NULL' WHERE products_id = ?`,
          productsId
        );

        const priceRows = await tx.$queryRawUnsafe<Array<{ products_price: number | string | null }>>(
          `SELECT products_price FROM products WHERE products_id = ? LIMIT 1`,
          productsId
        );
        const currentPrice = priceRows[0]?.products_price ?? 0;
        await tx.$executeRawUnsafe(
          `UPDATE products SET products_price_sorter = ? WHERE products_id = ?`,
          currentPrice,
          productsId
        );

        // Independent existence check (CLEAR can be called without ever
        // having gone through SET in this request) — no-op if nothing to delete.
        const existing = await tx.$queryRawUnsafe<Array<{ specials_id: number | bigint }>>(
          `SELECT specials_id FROM specials WHERE products_id = ? LIMIT 1`,
          productsId
        );
        if (existing[0]) {
          await tx.$executeRawUnsafe(`DELETE FROM specials WHERE specials_id = ?`, toNum(existing[0].specials_id));
        }
      }
    }

    logger.info(
      {
        productQuantitiesId: pq.product_quantities_id,
        smsUserId,
        productsIds: Array.from(matchedProductsIds),
        cleared: isClear,
      },
      'inline special_price edit applied'
    );

    return {
      productQuantitiesId: pq.product_quantities_id,
      column: 'special_price',
      value: body.value,
    };
  });
}

// --- size quantity (option_<N>) ------------------------------------------

async function applySizeQuantityEdit(
  body: DeliveryInlineEditBody,
  sizeId: number,
  smsUserId: number,
  ipAddress?: string
): Promise<DeliveryInlineEditResult> {
  // Legacy parity: split on '#' and keep prefix (model L104-108).
  const splitValue = String(body.value).split('#')[0];
  const newQty = Number.parseInt(splitValue, 10);
  if (!Number.isFinite(newQty) || newQty < 0) {
    throw new DeliveryWriteError('quantity must be a non-negative integer', 'INVALID_QUANTITY');
  }

  return prisma.$transaction(async (tx) => {
    const pq = await fetchProductQuantity(tx, body.productQuantitiesId);
    if (!pq) throw new DeliveryWriteError('product_quantity not found', 'PQ_NOT_FOUND', 404);

    // `sizeComment` is non-empty only on the unmapped-size fallback path —
    // legacy appends `quantity#<actual_size_options_comments>` to the cache
    // column so the operator can see the actual manufacturer size beneath the
    // standard one (product_quantity.php L269-271).
    let sizeComment = '';
    // Set when the user clicked a column whose `option_<N>` doesn't have a
    // direct PQ row; we resolved it to a manufacturer-specific size via
    // manufacturers_sizes_to_default_sizes. The cache column key still uses
    // the *requested* sizeId (so the column the user clicked shows the value),
    // but the PQ write / pa_status activation key uses `mappedSizeId`.
    let mappedSizeId: number | null = null;

    // The grid emits `option_<size_id>` where size_id matches one of the 14
    // hardcoded sizes (spec §6). The product_quantities row keyed by the
    // incoming productQuantitiesId is one of the rows in the same
    // (product_lists_id, box_lists_id) bucket; the user may have clicked a
    // *different* size's column. Legacy `save_product_data` always resolves
    // by (product_lists_id, size_id, box_lists_id), so we do the same here.
    if (pq.size_id !== sizeId) {
      const siblingRaw = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT product_quantities_id, product_lists_id, box_lists_id, size_id,
                CAST(quantity AS SIGNED) AS quantity,
                CAST(total_added_quantity AS SIGNED) AS total_added_quantity,
                barcode
           FROM product_quantities
          WHERE product_lists_id = ? AND size_id = ? AND box_lists_id = ?
          LIMIT 1`,
        pq.product_lists_id,
        sizeId,
        pq.box_lists_id
      );
      const sibling: ProductQuantityRow[] = siblingRaw.map((r) => ({
        product_quantities_id: toNum(r.product_quantities_id),
        product_lists_id: toNum(r.product_lists_id),
        box_lists_id: toNum(r.box_lists_id),
        size_id: toNum(r.size_id),
        quantity: toNum(r.quantity),
        total_added_quantity:
          r.total_added_quantity == null ? null : toNum(r.total_added_quantity),
        barcode: (r.barcode as string | null) ?? null,
      }));

      if (sibling[0]) {
        // Direct match path — pq row exists for the requested size.
        Object.assign(pq, sibling[0]);
      } else {
        // Legacy unmapped-size fallback (product_quantity.php L210-335):
        //   1. Query manufacturers_sizes_to_default_sizes for the requested
        //      `default_options_values_id` → list of `manufacturers_options_values_id`s.
        //   2. Intersect with the size_ids that DO exist in product_quantities
        //      for this (product_lists_id, box_lists_id).
        //   3. Take the first intersected id as the "effective" mapped size.
        //   4. Update the PQ row keyed by that mapped size_id.
        //   5. Patch the cache column for the *requested* size with
        //      `quantity#<actual_size_options_comments>` (a visual hint).
        //   6. When quantity_map != 1 also kick a full grid rebuild (legacy
        //      L313-323 calls addStockGridList in this branch only).
        const mappingRows = await tx.$queryRawUnsafe<
          Array<{
            manufacturers_options_values_id: number | bigint;
            actual_size_options_comments: string | null;
          }>
        >(
          `SELECT manufacturers_options_values_id, actual_size_options_comments
             FROM manufacturers_sizes_to_default_sizes
            WHERE default_options_values_id = ?`,
          sizeId
        );
        const existingSizesRows = await tx.$queryRawUnsafe<{ size_id: number | bigint }[]>(
          `SELECT size_id FROM product_quantities
            WHERE product_lists_id = ? AND box_lists_id = ?`,
          pq.product_lists_id,
          pq.box_lists_id
        );
        const existingSizeIds = new Set(existingSizesRows.map((r) => Number(r.size_id)));
        const intersected = mappingRows
          .map((m) => ({
            id: Number(m.manufacturers_options_values_id),
            comment: m.actual_size_options_comments ?? '',
          }))
          .filter((m) => existingSizeIds.has(m.id));

        if (intersected.length === 0) {
          throw new DeliveryWriteError(
            'Size mapping not found for this product code. Complete the first-time mapping before retrying.',
            'SIZE_NOT_MAPPED'
          );
        }

        const chosen = intersected[0]!;
        mappedSizeId = chosen.id;
        sizeComment = chosen.comment;

        // Fetch the PQ row keyed by the mapped size_id and re-bind into `pq`.
        const mappedRowRaw = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT product_quantities_id, product_lists_id, box_lists_id, size_id,
                  CAST(quantity AS SIGNED) AS quantity,
                  CAST(total_added_quantity AS SIGNED) AS total_added_quantity,
                  barcode
             FROM product_quantities
            WHERE product_lists_id = ? AND size_id = ? AND box_lists_id = ?
            LIMIT 1`,
          pq.product_lists_id,
          mappedSizeId,
          pq.box_lists_id
        );
        const mappedRow = mappedRowRaw[0];
        if (!mappedRow) {
          // Defensive — intersection said this size exists, but the row
          // vanished between the two queries (concurrent delete). Surface as
          // the same error rather than silently no-op.
          throw new DeliveryWriteError(
            'Size mapping not found for this product code. Complete the first-time mapping before retrying.',
            'SIZE_NOT_MAPPED'
          );
        }
        Object.assign(pq, {
          product_quantities_id: toNum(mappedRow.product_quantities_id),
          product_lists_id: toNum(mappedRow.product_lists_id),
          box_lists_id: toNum(mappedRow.box_lists_id),
          size_id: toNum(mappedRow.size_id),
          quantity: toNum(mappedRow.quantity),
          total_added_quantity:
            mappedRow.total_added_quantity == null
              ? null
              : toNum(mappedRow.total_added_quantity),
          barcode: (mappedRow.barcode as string | null) ?? null,
        });
        logger.info(
          {
            productListsId: pq.product_lists_id,
            requestedSizeId: sizeId,
            mappedSizeId,
            sizeComment,
          },
          'unmapped size resolved via manufacturers_sizes_to_default_sizes'
        );
      }
    }

    const pl = await fetchProductList(tx, pq.product_lists_id);
    if (!pl) throw new DeliveryWriteError('product_list not found', 'PL_NOT_FOUND', 404);

    const previousQty = pq.quantity;
    const isDecrease = newQty < previousQty;
    const isIncrease = newQty > previousQty;

    // 1. product_quantities UPDATE.
    if (isDecrease) {
      await tx.$executeRawUnsafe(
        `UPDATE product_quantities
            SET quantity = ?, sms_users_id = ?, last_sale_date = CURDATE()
          WHERE product_quantities_id = ?`,
        newQty,
        smsUserId,
        pq.product_quantities_id
      );
    } else if (isIncrease) {
      const delta = newQty - previousQty;
      const newTotal = (pq.total_added_quantity ?? 0) + delta;
      await tx.$executeRawUnsafe(
        `UPDATE product_quantities
            SET quantity = ?, sms_users_id = ?, total_added_quantity = ?
          WHERE product_quantities_id = ?`,
        newQty,
        smsUserId,
        newTotal,
        pq.product_quantities_id
      );
    } else {
      // No change in quantity but the user touched the cell — we still update
      // sms_users_id for audit consistency, matching legacy's unconditional save.
      await tx.$executeRawUnsafe(
        `UPDATE product_quantities SET sms_users_id = ? WHERE product_quantities_id = ?`,
        smsUserId,
        pq.product_quantities_id
      );
    }

    // 2. stock_home_grid_lists UPDATE — option_<N> + row-sum quantity.
    //    On decrease also update last_sale_date + modified (legacy parity).
    //    On the unmapped-size fallback path, the cache column gets the
    //    `quantity#<actual_size_options_comments>` form per legacy L269-271.
    const rowSum = await sumProductListsQuantity(tx, pq.product_lists_id, pq.box_lists_id);
    const boxCode = await fetchBoxCode(tx, pq.box_lists_id);
    if (boxCode == null) {
      throw new DeliveryWriteError('box_code missing for product_quantity', 'BOX_NOT_FOUND', 500);
    }
    const optionCellValue =
      mappedSizeId !== null && sizeComment
        ? `${newQty}#${sizeComment}`
        : String(newQty);
    const cacheSet: Parameters<typeof directUpdateGridRow>[0]['set'] = {
      [`option_${sizeId}` as `option_${number}`]: optionCellValue,
      quantity: rowSum,
    } as any;
    if (isDecrease) {
      cacheSet.last_sale_date = mysqlNow().slice(0, 10);
      cacheSet.modified = mysqlNow();
    }
    await directUpdateGridRow({
      set: cacheSet as any,
      where: { byProductListsIdAndBoxcode: { productListsId: pq.product_lists_id, boxcode: boxCode } },
      callerTag: 'deliveries/inline-edit/option',
    }, tx);

    // 3. Quantity-map cascade (legacy product_quantity.php:184-199).
    if (pl.quantity_map === 1) {
      const total = await sumProductListsTotal(tx, pq.product_lists_id);
      // Cake's `updateAll` semantics — patch all matching product_lists_to_products rows.
      await tx.$executeRawUnsafe(
        `UPDATE product_lists_to_products SET sms_quantity = ? WHERE product_lists_id = ?`,
        total,
        pq.product_lists_id
      );
      // Mirror into `products` (one row per mapped product). The legacy code
      // walks `product_lists_to_products` then updates each `products` row
      // individually; UPDATE-by-JOIN does the same in one statement.
      await tx.$executeRawUnsafe(
        `UPDATE products p
            INNER JOIN product_lists_to_products pltp
                    ON pltp.products_id = p.products_id
           SET p.products_quantity = ?, p.products_status = 1
          WHERE pltp.product_lists_id = ?`,
        total,
        pq.product_lists_id
      );
    }

    // 4. products_attributes.pa_status reactivation (only on increase past 0).
    if (newQty > 0 && previousQty === 0) {
      // The legacy helper looks up `products_attributes` rows via the
      // (products_id, options_id, options_values_id) chain. For phase 2 we
      // log and TODO — this needs a join through products_options_values_to_products_options
      // that requires more investigation. The default `pa_status` is 1 for
      // new attribute rows, so the activation only matters for rows that
      // were intentionally deactivated (rare).
      logger.debug(
        { productListsId: pq.product_lists_id, sizeId },
        'pa_status reactivation TODO — phase 2 placeholder (rare path)'
      );
    }

    // 5. stock_system_logs2 INSERT (only if quantity actually changed).
    //    Note: legacy table is `stock_system_logs2` (renamed 2018 after a crash —
    //    see `app/models/stock_system_log.php`). The column is `modified`, not
    //    `created`, and `povtpo_id` carries the manufacturers_options_values_id
    //    when the size was resolved via the manufacturer-sizes fallback (legacy
    //    L238). NULL on the direct-size path.
    //
    //    We deliberately do NOT include `migration_date_added` /
    //    `migration_date_modified` — those columns are absent on the live DB
    //    (documentation/db-columns-verified.json is from a different snapshot
    //    and lists them, but production rejects the insert with
    //    "Unknown column 'migration_date_added'"). The legacy save_product_data
    //    relies on Cake's auto-`modified` + table defaults and omits them too.
    if (previousQty !== newQty) {
      await tx.$executeRawUnsafe(
        `INSERT INTO stock_system_logs2
           (sms_users_id, product_quantities_id, previous_qty, current_qty, modified, ip_address, povtpo_id)
         VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
        smsUserId,
        pq.product_quantities_id,
        previousQty,
        newQty,
        ipAddress ?? '',
        mappedSizeId ?? null
      );
    }

    // 6. products_attributes_infos.pre_order='No' clear when value > 0.
    //    Legacy controller L2461-2509. The exact join keys (products_id +
    //    products_options_values_id) require resolving the size id to an
    //    options_values_id via products_options_values_to_products_options.
    //    Phase 2 placeholder — the most common case is value=0 (which is a
    //    no-op anyway), and the pre-order flag only matters for already-mapped
    //    products on the storefront, which still go through legacy in phase 2.
    if (newQty > 0 && pl.quantity_map === 1) {
      logger.debug(
        { productCode: pl.product_code, sizeId },
        'pre_order clear on quantity increase TODO — phase 2 placeholder'
      );
    }

    // 7. Add_Special_price (no-op for non-special products — see helper).
    await addSpecialPriceIfActive(tx, pl, 'inline-edit/option');

    logger.info(
      {
        productQuantitiesId: pq.product_quantities_id,
        smsUserId,
        sizeId,
        previousQty,
        newQty,
      },
      'inline size-quantity edit applied'
    );

    // Legacy parity note (product_quantity.php L313-323): when the unmapped-size
    // fallback fires AND quantity_map != 1, legacy calls `addStockGridList` to
    // fully rebuild the cache row. We INTENTIONALLY do not call
    // `requestGridRebuild` here:
    //
    //   - requestGridRebuild does a DELETE-then-POST. The DELETE wipes every
    //     stock_home_grid_lists row for the product_lists_id (one per box).
    //     The POST is a cross-host request to the legacy app's
    //     /grid_file/updategridlist endpoint — when it fails (auth, network,
    //     legacy down) the rows are gone until the legacy cron heals,
    //     i.e. 15-30 minutes of missing rows in the grid.
    //   - Incident: editing JZ5773 caused 4 stock_home_grid_lists rows to
    //     vanish because the cross-host rebuild POST didn't return cleanly.
    //   - The direct `directUpdateGridRow` patch above already writes the
    //     visible columns (`option_<sizeId>`, `quantity`, optional
    //     `last_sale_date` / `modified`), so the cell renders correctly
    //     without a rebuild.
    //   - Derived columns we don't patch (e.g. percentage_sold) will be
    //     refreshed by the next legacy cron pass — they don't need real-time
    //     accuracy for the operator's immediate save feedback.
    return {
      productQuantitiesId: pq.product_quantities_id,
      column: body.column,
      value: String(newQty),
      previousQuantity: previousQty,
      newRowQuantity: rowSum,
    };
  });
}

// ---------------------------------------------------------------------------
// Image-added toggle
// ---------------------------------------------------------------------------

export interface ImageAddedResult {
  productCode: string;
  value: '0' | '1';
  productListsAffected: number;
  cacheAffected: number;
}

export async function applyImageAddedToggle(
  productCode: string,
  body: ImageAddedBody,
  smsUserId: number
): Promise<ImageAddedResult> {
  // Legacy: UPDATE product_lists.added_product_code_image WHERE product_code=?
  // (index_controller.php:4129-4133).
  //
  // The flag is read by the grid at SELECT time via the LEFT JOIN on
  // product_lists (see deliveries.query-builder.ts:70 — `p.added_product_code_image`),
  // so a cache patch on stock_home_grid_lists is unnecessary AND impossible —
  // that table has no `added_product_code_image` column. Earlier versions of
  // this code tried to write the column on the cache, which failed with
  // "Unknown column 'added_product_code_image' in 'field list'".
  return prisma.$transaction(async (tx) => {
    const plAffected = await tx.$executeRawUnsafe(
      `UPDATE product_lists SET added_product_code_image = ? WHERE product_code = ?`,
      body.value,
      productCode
    );

    // No cache write — the grid join picks up the new flag on the next read.
    const cacheAffected = 0;

    logger.info(
      { productCode, value: body.value, smsUserId, plAffected: Number(plAffected), cacheAffected },
      'image_added toggled'
    );

    return {
      productCode,
      value: body.value,
      productListsAffected: Number(plAffected),
      cacheAffected,
    };
  });
}

// ---------------------------------------------------------------------------
// Image URLs viewer (read-only)
// ---------------------------------------------------------------------------

export interface SmsImage {
  label: string;
  url: string;
  primary: boolean;
}

export interface ImageUrlsResult {
  productCode: string;
  // Built from product_lists.product_code_image (primary) +
  // product_code_additional_img (CSV). URLs are stitched with
  // HTTP_HTTPS_SERVER (= legacy UKSS_HTTP_SERVER, default
  // https://www.uksoccershop.com):
  //   Primary:    ${HTTP_HTTPS_SERVER}/images/<filename>
  //   Additional: ${HTTP_HTTPS_SERVER}/images/adtnl_prodts_img/<filename>
  sms_image_urls: SmsImage[];
}

// Mirrors legacy add_sms_products_controller.php:5131-5165 URL construction:
//   UKSS_HTTP_SERVER + DIR_WS_IMAGES                          + filename  (primary)
//   UKSS_HTTP_SERVER + DIR_WS_IMAGES + DIR_WS_ADDITIONAL_IMAGES + filename  (each)
function resolveSavedProductImageUrl(
  filename: string | null | undefined,
  isPrimary: boolean,
): string | null {
  if (!filename || filename.length === 0) return null;
  const base = config.HTTP_HTTPS_SERVER.replace(/\/$/, '');
  return isPrimary
    ? `${base}/images/${filename}`
    : `${base}/images/adtnl_prodts_img/${filename}`;
}

export async function getImageUrls(productCode: string): Promise<ImageUrlsResult | null> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      product_code_image: string | null;
      product_code_additional_img: string | null;
    }>
  >(
    `SELECT product_code_image, product_code_additional_img
       FROM product_lists
      WHERE product_code = ?
      LIMIT 1`,
    productCode
  );
  const row = rows[0];
  if (!row) return null;

  const sms_image_urls: SmsImage[] = [];
  const primary = resolveSavedProductImageUrl(row.product_code_image, true);
  if (primary) {
    sms_image_urls.push({ label: 'Primary', url: primary, primary: true });
  }
  const additionalFilenames = (row.product_code_additional_img ?? '')
    .replace(/^,+|,+$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  additionalFilenames.forEach((file, i) => {
    const url = resolveSavedProductImageUrl(file, false);
    if (url) {
      sms_image_urls.push({
        label: i === 0 ? 'Back' : `Additional ${i}`,
        url,
        primary: false,
      });
    }
  });

  return { productCode, sms_image_urls };
}

// ---------------------------------------------------------------------------
// Link / unlink quantity
// ---------------------------------------------------------------------------

export interface LinkQuantityResult {
  productCode: string;
  action: 'linked' | 'unlinked';
  productsAffected: number;
}

/**
 * Toggle quantity_map for a product code.
 *
 * Mirrors `product_quantities_controller.php::link_quantities` (L4337-4764).
 * The legacy endpoint decides direction by reading the current
 * `product_lists.quantity_map`. We accept `action` ('link' | 'unlink' | 'toggle')
 * to let callers be explicit if they want.
 *
 * Tables written (in order, all inside one transaction):
 *  - product_lists_to_products (UPDATE status=1/0)
 *  - product_lists_to_products_histories (INSERT) — plural; the physical table
 *    name. Legacy reaches it via CakePHP's Inflector
 *    (ProductListsToProductsHistory → product_lists_to_products_histories),
 *    so the legacy controller never types the name explicitly.
 *  - products (UPDATE quantity_map, products_quantity, products_last_modified)
 *  - product_lists (UPDATE quantity_map, modified)
 *  - stock_home_grid_lists (direct UPDATE quantity_map, map)
 *
 * Hero-shirt cascade is deferred (legacy L4486-4498, L4615-4626, L4694-4706).
 */
export async function applyLinkQuantity(
  productCode: string,
  body: LinkQuantityBody,
  smsUserId: number
): Promise<LinkQuantityResult> {
  return prisma.$transaction(async (tx) => {
    const plRows = await tx.$queryRawUnsafe<ProductListRow[]>(
      `SELECT product_lists_id, product_code,
              CAST(quantity_map AS SIGNED) AS quantity_map,
              CAST(special AS SIGNED) AS special
         FROM product_lists
        WHERE product_code = ?`,
      productCode
    );
    if (plRows.length === 0) {
      throw new DeliveryWriteError('product code not found', 'PL_NOT_FOUND', 404);
    }

    const currentlyLinked = plRows.every((r) => r.quantity_map === 1);
    let nextLinked: boolean;
    if (body.action === 'link') nextLinked = true;
    else if (body.action === 'unlink') nextLinked = false;
    else nextLinked = !currentlyLinked;

    if (nextLinked === currentlyLinked && body.action === 'toggle') {
      // Partial state — some rows linked, some not. Treat as "link".
      nextLinked = true;
    }

    const newFlag = nextLinked ? 1 : 0;
    const productListsIds = plRows.map((r) => r.product_lists_id);

    // 1. product_lists_to_products — bulk UPDATE status. Fetch the actual
    //    junction rows with their PK + the pre-update
    //    `products.products_quantity` (zc_quantity for history). One query per
    //    call is cheap; we need every column for both the UPDATE and the
    //    history INSERT below.
    let linkRows = await tx.$queryRawUnsafe<
      Array<{
        product_lists_to_products_id: number;
        product_lists_id: number;
        products_id: number;
        products_quantity: number | bigint | null;
      }>
    >(
      `SELECT pltp.product_lists_to_products_id,
              pltp.product_lists_id,
              pltp.products_id,
              CAST(COALESCE(p.products_quantity, 0) AS SIGNED) AS products_quantity
         FROM product_lists_to_products pltp
         LEFT JOIN products p ON p.products_id = pltp.products_id
        WHERE pltp.product_lists_id IN (${productListsIds.map(() => '?').join(',')})`,
      ...productListsIds
    );

    // Legacy "first link ever" path — PQC:4418, 4430, 4446-4456. If the
    // junction is empty, legacy does NOT bail: it queries
    // `products WHERE products_model LIKE '%pcode%' AND quantity_map = 0`,
    // CSV-token-matches `pmodel == pcode`, then INSERTs a junction row per
    // hit and continues with the link flow. Without this, products that have
    // never been quantity-linked before (`product_lists_to_products` has no
    // row yet, but `products.products_model` already carries the SMS code)
    // wrongly fail with NOT_MAPPED — e.g. JV6566 on staging.
    //
    // We only materialise junction rows on a link request. On unlink with an
    // empty junction there is nothing to flip, so we fall through and the
    // product_lists / stock_home_grid_lists writes below still bring the
    // top-level flag back to 0 (matches legacy behaviour where the unlink
    // branch loops over already-mapped products only).
    if (linkRows.length === 0 && nextLinked) {
      const candidates = await tx.$queryRawUnsafe<
        Array<{
          products_id: number | bigint;
          products_model: string | null;
          products_quantity: number | bigint | null;
        }>
      >(
        `SELECT products_id, products_model,
                CAST(COALESCE(products_quantity, 0) AS SIGNED) AS products_quantity
           FROM products
          WHERE products_model LIKE ?`,
        `%${productCode}%`
      );
      const newJunctionRows: typeof linkRows = [];
      for (const c of candidates) {
        const tokens = String(c.products_model ?? '')
          .split(',')
          .map((s) => s.trim());
        // Legacy PQC:4430 uses strict CSV-token equality only.
        if (!tokens.includes(productCode)) continue;

        const productsId = Number(c.products_id);
        const productListsId = productListsIds[0];
        // Race-guard: another tab may have just inserted the junction. Probe
        // before insert so we don't violate the (product_lists_id, products_id)
        // unique constraint.
        const existing = await tx.$queryRawUnsafe<
          Array<{ product_lists_to_products_id: number }>
        >(
          `SELECT product_lists_to_products_id
             FROM product_lists_to_products
            WHERE product_lists_id = ? AND products_id = ?
            LIMIT 1`,
          productListsId,
          productsId
        );
        let pltpId: number;
        if (existing[0]) {
          pltpId = existing[0].product_lists_to_products_id;
        } else {
          // Legacy PQC:4447-4456 inserts with the current SMS total in
          // sms_quantity. The post-insert UPDATE further down (when we loop
          // back through the same path) will refresh it, but we still seed
          // it here for legacy parity.
          await tx.$executeRawUnsafe(
            `INSERT INTO product_lists_to_products
               (product_lists_id, product_code, products_id, zc_quantity, sms_quantity, status)
             VALUES (?, ?, ?, ?, 0, 1)`,
            productListsId,
            productCode,
            productsId,
            Number(c.products_quantity ?? 0)
          );
          const inserted = await tx.$queryRawUnsafe<
            Array<{ product_lists_to_products_id: number | bigint }>
          >(
            `SELECT product_lists_to_products_id
               FROM product_lists_to_products
              WHERE product_lists_id = ? AND products_id = ?
              LIMIT 1`,
            productListsId,
            productsId
          );
          pltpId = Number(inserted[0]?.product_lists_to_products_id ?? 0);
        }
        newJunctionRows.push({
          product_lists_to_products_id: pltpId,
          product_lists_id: productListsId,
          products_id: productsId,
          products_quantity: Number(c.products_quantity ?? 0),
        });
      }
      linkRows = newJunctionRows;
    }

    if (linkRows.length === 0) {
      throw new DeliveryWriteError(
        'No mapped products found. Map the product first.',
        'NOT_MAPPED'
      );
    }
    await tx.$executeRawUnsafe(
      `UPDATE product_lists_to_products SET status = ?
        WHERE product_lists_id IN (${productListsIds.map(() => '?').join(',')})`,
      newFlag,
      ...productListsIds
    );

    // SMS-side total — needed for both the history `sms_quantity` (regardless
    // of direction) and the products UPDATE below (link branch only).
    const smsTotal = await sumProductListsTotal(tx, productListsIds[0]);

    // 2. product_lists_to_products_histories — one row per junction record.
    //
    // Legacy parity (product_quantities_controller.php:4500-4506 / 4630-4636 /
    // 4911-…):
    //   - FK column is `product_lists_to_products_id` (NOT product_lists_id /
    //     products_id).
    //   - `zc_quantity` = the pre-update `products.products_quantity` for the
    //     mapped ZenCart product.
    //   - `sms_quantity` = SUM(product_quantities.quantity) for this
    //     product_lists_id.
    //   - `status` is an enum ('map' | 'unmap').
    //   - `date` is a DATE column (CURDATE(), not NOW()) — legacy uses
    //     `date("Y-m-d")`.
    //
    // The old code wrote a cartesian (N product_lists × M products) and had
    // the columns + table name wrong — see the RCA in this commit message.
    const historyAction = nextLinked ? 'map' : 'unmap';
    for (const lr of linkRows) {
      await tx.$executeRawUnsafe(
        `INSERT INTO product_lists_to_products_histories
           (product_lists_to_products_id, zc_quantity, sms_quantity, status, date)
         VALUES (?, ?, ?, ?, CURDATE())`,
        lr.product_lists_to_products_id,
        Number(lr.products_quantity ?? 0),
        smsTotal,
        historyAction
      );
    }

    // 3. products — quantity_map + (when linking) products_quantity sync from
    //    the live size sum. When unlinking, leave products_quantity as-is
    //    (matches legacy: L4665-4675 only updates quantity_map and last_modified).
    if (nextLinked) {
      // Reuse `smsTotal` from the history step — same legacy semantic
      // (`sumProductListsTotal` over the first product_lists_id).
      const ids = linkRows.map((r) => r.products_id);
      await tx.$executeRawUnsafe(
        `UPDATE products
            SET quantity_map = 1,
                products_quantity = ?,
                products_last_modified = NOW()
          WHERE products_id IN (${ids.map(() => '?').join(',')})`,
        smsTotal,
        ...ids
      );
    } else {
      const ids = linkRows.map((r) => r.products_id);
      await tx.$executeRawUnsafe(
        `UPDATE products SET quantity_map = 0, products_last_modified = NOW()
          WHERE products_id IN (${ids.map(() => '?').join(',')})`,
        ...ids
      );
    }

    // 4. product_lists — flag + modified.
    await tx.$executeRawUnsafe(
      `UPDATE product_lists SET quantity_map = ?, modified = NOW()
        WHERE product_lists_id IN (${productListsIds.map(() => '?').join(',')})`,
      newFlag,
      ...productListsIds
    );

    // 5. stock_home_grid_lists — direct UPDATE matching legacy L4523-4533 / L4655-4665.
    //    Legacy unlink path also writes map='Mapped' but with embedded literal
    //    quotes ('"Mapped"') — a stringification bug. We write the bare value.
    if (nextLinked) {
      await directUpdateGridRow({
        set: { quantity_map: '1' },
        where: { byProductCode: productCode },
        callerTag: 'deliveries/link-quantity/link',
      }, tx);
    } else {
      await directUpdateGridRow({
        set: { quantity_map: '0', map: 'Mapped' },
        where: { byProductCode: productCode },
        callerTag: 'deliveries/link-quantity/unlink',
      }, tx);
    }

    logger.info(
      { productCode, action: historyAction, smsUserId, productListsIds },
      'link-quantity toggle applied'
    );

    return {
      productCode,
      action: nextLinked ? 'linked' : 'unlinked',
      productsAffected: linkRows.length,
    };
  });
}
