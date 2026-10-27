/**
 * Pure SQL builders for the marketplace-sync DB layer.
 *
 * Kept free of `prisma`/runtime imports (mirrors modules/reports/*.query.ts) so the
 * generated SQL can be asserted in unit tests without a database connection.
 */

/**
 * Builds the raw SQL for `getListingsNeedingSync`. Pure (depends only on
 * `bestsellersOnly`) so the re-pick-loop invariant — the SELECT `normalized_quantity`
 * CASE and the WHERE quantity CASE must be byte-identical — can be asserted in a unit
 * test without a database.
 *
 * The `?` placeholders are positional and filled by the caller in this order:
 *   maxQuantityCap, maxQuantityCap, maxQuantityCap,   (SELECT normalized_quantity CASE)
 *   storeId,
 *   maxQuantityCap, maxQuantityCap, maxQuantityCap,   (WHERE quantity CASE)
 *   maxRetries,
 *   limit
 * The conditional bestseller arms inject no `?`, so this ordering is independent of
 * `bestsellersOnly`.
 */
export function buildListingsNeedingSyncQuery(bestsellersOnly: boolean): string {
  // Conditionally include bestsellers JOIN and ORDER BY based on bestsellersOnly flag.
  //
  // LEFT (not INNER) JOIN: in bestsellersOnly mode we still need NON-bestsellers in
  // the result set so they can be force-pushed to quantity 0 on eBay. An INNER JOIN
  // dropped them entirely, which meant a non-bestseller that sold out was never
  // delisted and stayed buyable -> oversells / out-of-stock orders (rule #7 / #165717).
  // For a non-bestseller `bestsellers.products_id` is NULL, which both the SELECT and
  // WHERE quantity CASE arms below use to force normalized_quantity = 0.
  const bestsellersJoin = bestsellersOnly ? `
    LEFT JOIN (
        SELECT products_id, np_best_seller_lifetime
        FROM new_products
        WHERE np_best_seller_lifetime > 0
    ) bestsellers ON bestsellers.products_id = ml.products_id
  ` : '';

  // eBay (bestsellersOnly) quantity arms, injected into BOTH the SELECT normalized_quantity
  // CASE and the WHERE quantity CASE so they stay byte-identical (the re-pick-loop invariant
  // from fix/ebay-sync-skip-loop). Order matters — evaluated after the inactive/deleted arms
  // (an inactive/deleted listing is always 0) and before the cap arms:
  //   1. T-shirts (virtual_product_type_id=4) are print-on-demand -> always available (1).
  //   2. npv_always_in_stock='Yes' -> 0. The single source of truth is
  //      new_products_variations.npv_always_in_stock (NOT products_barcodes); an
  //      always-in-stock variation must NOT push real stock to eBay regardless of
  //      fc_product_id. T-shirts already matched above, so they are exempt.
  //   3. No FC product (fc_product_id IS NULL or 0) -> 0. A variation with no fulfilment-
  //      centre product cannot be shipped, so it must never carry stock on eBay. T-shirts
  //      (POD, matched above) are exempt. Without this arm a no-FC bestseller computes
  //      target=1 == last_synced=1, so the change-detector never re-picks it and it sits
  //      live at qty 1 = oversell risk (refs #166187).
  //   4. Any other non-bestseller -> 0 (delist; rule #7 / #165717).
  // Empty when bestsellersOnly is false, so `bestsellers` is never referenced when its
  // JOIN is absent and the OFF path is unchanged. No `?` placeholder added here.
  const ebayQuantityArms = bestsellersOnly
    ? `WHEN np.virtual_product_type_id = 4 THEN 1
        WHEN npv.npv_always_in_stock = 'Yes' THEN 0
        WHEN npv.fc_product_id IS NULL OR npv.fc_product_id = 0 THEN 0
        WHEN bestsellers.products_id IS NULL THEN 0
        `
    : '';

  // Real bestsellers first; non-bestsellers (NULL np_best_seller_lifetime under the
  // LEFT JOIN) sort last via COALESCE so the LIMIT-capped queue prioritises sellers.
  const orderByClause = bestsellersOnly
    ? 'COALESCE(bestsellers.np_best_seller_lifetime, 0) DESC, ml.last_synced_at ASC, ml.retry_count ASC'
    : 'ml.last_synced_at ASC, ml.retry_count ASC';

  const query = buildSyncSelect(bestsellersJoin, ebayQuantityArms, orderByClause);

  return query;
}

/**
 * Builds the raw SQL for `getEbayRelistCandidates` — eBay listings that were marked
 * terminal `deleted` due to error 21916750 ("FixedPrice item ended") but which STILL
 * have stock and should therefore be relisted (rather than left dead).
 *
 * Reuses the SAME eBay quantity arms as the sync query (t-shirt = 1, always-in-stock = 0,
 * no FC product = 0, non-bestseller = 0, otherwise capped UKSS stock) so the quantity we
 * relist at is exactly what the sync would push — and so items that would just be delisted
 * again (non-bestsellers, no-FC, always-in-stock) are filtered out via `normalized_quantity > 0`.
 *
 * `?` placeholders, in order: maxQuantityCap ×3 (quantity CASE), storeId,
 * [ghost ItemIDs... when opts.ghostItemIdCount is set], limit.
 */
export function buildEbayRelistCandidatesQuery(opts?: { ghostItemIdCount?: number }): string {
  // eBay always runs bestsellers-only in production; apply those arms unconditionally
  // here so the relist set matches what eBay actually carries stock for.
  const bestsellersJoin = `
    LEFT JOIN (
        SELECT products_id, np_best_seller_lifetime
        FROM new_products
        WHERE np_best_seller_lifetime > 0
    ) bestsellers ON bestsellers.products_id = ml.products_id
  `;
  const ebayQuantityArms = `WHEN np.virtual_product_type_id = 4 THEN 1
        WHEN npv.npv_always_in_stock = 'Yes' THEN 0
        WHEN npv.fc_product_id IS NULL OR npv.fc_product_id = 0 THEN 0
        WHEN bestsellers.products_id IS NULL THEN 0
        `;

  // Default path: terminal-`deleted` rows carrying the 21916750 ("FixedPrice item
  // ended") error. Ghost path (opts.ghostItemIdCount set): explicit ItemIDs that are
  // still live in the DB (active/confirmed) but absent from eBay's ActiveList — scoped
  // by ItemID instead of by error code, since ghosts never got an error written.
  const statusWhere =
    opts?.ghostItemIdCount && opts.ghostItemIdCount > 0
      ? `ml.marketplace_listing_status IN ('active','confirmed')
        AND ml.marketplace_item_identifier IN (${Array(opts.ghostItemIdCount).fill('?').join(',')})`
      : `ml.marketplace_listing_status = 'deleted'
        AND ml.api_last_error_code = '21916750'`;

  // Filter on the computed alias via an outer wrapper (avoids HAVING-without-GROUP-BY).
  return `
    SELECT * FROM (
      SELECT /* app/modules/marketplace-sync/marketplace-sync.db.ts: relist-candidates */
        ml.marketplace_listings_id,
        ml.marketplace_item_identifier,
        ml.products_sku,
        ml.price_adjustment,
        ml.api_last_error_code,
        np.specials_status,
        np.specials_price,
        np.products_price,
        (CASE
          WHEN np.specials_status = 'Special' AND np.specials_price > 0
          THEN np.specials_price
          ELSE np.products_price
        END) AS current_price,
        GREATEST(0, (CASE
          WHEN npv.npv_delete_status = '1' THEN 0
          ${ebayQuantityArms}WHEN ? = 0 THEN npv.npv_quantities
          WHEN npv.npv_quantities >= ? THEN ?
          ELSE npv.npv_quantities
        END)) AS normalized_quantity
      FROM marketplace_listings ml
      INNER JOIN new_products_variations npv
        ON ml.products_sku = npv.npv_products_sku
      INNER JOIN new_products np
        ON ml.products_id = np.products_id${bestsellersJoin}
      WHERE
        ml.store_id = ?
        AND ${statusWhere}
        AND ml.marketplace_item_identifier IS NOT NULL
        AND ml.marketplace_item_identifier != ''
        AND ml.products_sku IS NOT NULL
        AND ml.products_sku != ''
    ) candidates
    WHERE candidates.normalized_quantity > 0
    ORDER BY candidates.marketplace_listings_id ASC
    LIMIT ?
  `;
}

function buildSyncSelect(
  bestsellersJoin: string,
  ebayQuantityArms: string,
  orderByClause: string
): string {
  const query = `
    SELECT /* app/modules/marketplace-sync/marketplace-sync.db.ts */
      ml.marketplace_listings_id,
      ml.products_id,
      ml.store_id,
      ml.marketplace_item_identifier,
      ml.products_sku,
      ml.upc,
      ml.ean,
      ml.gtin,
      ml.last_synced_quantity,
      ml.last_synced_price,
      ml.last_synced_special_price,
      ml.last_synced_price_currency,
      ml.retry_count,
      ml.marketplace_listing_status,
      ml.price_adjustment,
      npv.npv_quantities as current_quantity,
      npv.npv_products_sku,
      npv.npv_products_id,
      npv.npv_id,
      np.products_price,
      np.specials_status,
      np.specials_price,
      np.virtual_product_type_id,
      (CASE
        WHEN np.specials_status = 'Special' AND np.specials_price > 0
        THEN np.specials_price
        ELSE np.products_price
      END) AS current_price,
      -- GREATEST(0, ...) floors negative source stock (oversold variants whose
      -- npv_quantities went below 0) to 0. Marketplaces reject negative stock,
      -- so an unfloored -1 fails the listing (and, for bulk APIs like OnBuy,
      -- poisons the whole batch). 0 = out of stock, which is the correct signal.
      GREATEST(0, (CASE
        WHEN ml.marketplace_listing_status = 'inactive' THEN 0
        WHEN npv.npv_delete_status = '1' THEN 0
        ${ebayQuantityArms}WHEN ? = 0 THEN npv.npv_quantities
        WHEN npv.npv_quantities >= ? THEN ?
        ELSE npv.npv_quantities
      END)) AS normalized_quantity,
      -- Current price converted to the marketplace currency (for non-GBP stores)
      -- If last_synced_price_currency is GBP or NULL, returns the GBP price unchanged.
      -- Otherwise, converts using the currencies table exchange rate.
      (CASE
        WHEN ml.last_synced_price_currency IS NOT NULL
          AND ml.last_synced_price_currency != 'GBP'
          AND cur.value IS NOT NULL
        THEN ROUND(
          (CASE
            WHEN np.specials_status = 'Special' AND np.specials_price > 0
            THEN np.specials_price
            ELSE np.products_price
          END) * cur.value, 2)
        ELSE
          (CASE
            WHEN np.specials_status = 'Special' AND np.specials_price > 0
            THEN np.specials_price
            ELSE np.products_price
          END)
      END) AS current_price_in_synced_currency
    FROM marketplace_listings ml
    INNER JOIN new_products_variations npv
      ON ml.products_sku = npv.npv_products_sku
    INNER JOIN new_products np
      ON ml.products_id = np.products_id
    LEFT JOIN currencies cur
      ON cur.code = ml.last_synced_price_currency
      AND ml.last_synced_price_currency IS NOT NULL
      AND ml.last_synced_price_currency != 'GBP'${bestsellersJoin}
    WHERE
      ml.store_id = ?
      AND ml.marketplace_listing_status IN ('confirmed', 'active', 'inactive')
      AND ml.marketplace_item_identifier IS NOT NULL
      AND ml.marketplace_item_identifier != ''
      AND ml.products_sku IS NOT NULL
      AND ml.products_sku != ''
      AND (
        (
          ml.marketplace_listing_status IN ('confirmed', 'active')
          AND (
            (ml.last_synced_quantity IS NULL OR ml.last_synced_quantity != (
              -- Must mirror normalized_quantity above EXACTLY (same CASE arms),
              -- otherwise the WHERE and the SELECT disagree on the target quantity
              -- and the listing is selected every run but skipped as a no-op by the
              -- adapter (last_synced never updates) -> re-picked forever, starving
              -- the LIMIT-capped queue. The inactive/npv_delete_status arms below
              -- were previously missing, so deleted variants with stock were flagged
              -- with target=cap (e.g. 1) while the adapter pushed 0 == last_synced 0.
              GREATEST(0, (CASE
                WHEN ml.marketplace_listing_status = 'inactive' THEN 0
                WHEN npv.npv_delete_status = '1' THEN 0
                ${ebayQuantityArms}WHEN ? = 0 THEN npv.npv_quantities
                WHEN npv.npv_quantities >= ?
                THEN ?
                ELSE npv.npv_quantities
              END))
            ))
            OR
            (ml.last_synced_price IS NULL OR ml.last_synced_price != (
              CASE
                WHEN ml.last_synced_price_currency IS NOT NULL
                  AND ml.last_synced_price_currency != 'GBP'
                  AND cur.value IS NOT NULL
                THEN ROUND(
                  (CASE
                    WHEN np.specials_status = 'Special' AND np.specials_price > 0
                    THEN np.specials_price
                    ELSE np.products_price
                  END) * cur.value, 2)
                ELSE
                  (CASE
                    WHEN np.specials_status = 'Special' AND np.specials_price > 0
                    THEN np.specials_price
                    ELSE np.products_price
                  END)
              END
            ))
          )
        )
        OR
        (
          ml.marketplace_listing_status = 'inactive'
          AND (ml.last_synced_quantity IS NULL OR ml.last_synced_quantity != 0)
        )
        OR
        (
          -- Variant retired in UKSS (soft-deleted) but eBay still believes stock exists.
          -- Force a resync to push quantity to 0 so the listing is delisted.
          -- See issue #822 / order 1982271.
          npv.npv_delete_status = '1'
          AND (ml.last_synced_quantity IS NULL OR ml.last_synced_quantity != 0)
        )
      )
      AND ml.retry_count < ?
    ORDER BY ${orderByClause}
    LIMIT ?
  `;

  return query;
}
