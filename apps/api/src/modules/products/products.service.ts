/**
 * New Product Module — Product code CRUD service.
 * Requirements: REQ-1 (product code management), REQ-1.1 through REQ-1.9
 *
 * All writes wrapped in a single transaction that rolls back on any failure.
 * Column names verified against live zenc_main_db (CLAUDE.md Rule 6).
 */

import { prisma, Prisma } from '../../lib/prisma';
import { createLogger, type Logger } from '../../lib/logger';
import { nanoid } from 'nanoid';
import type { TxClient, ProductCodeInput, ProductCodeResult } from './products.types';
import { resolveTeamId, resolveSeasonId, resolveManufacturerId } from './products-lookup.service';
// PMS #166509: the origin details (country of origin + HS Code) are written
// across the whole product code family, not against the one row being edited.
import { saveOriginDetailsForFamily } from './origin-details.service';
import { BadRequestError } from '../../lib/errors';
import { executeRawWithLogging } from './products-sql-logger';
import { directUpdateGridRow } from '../deliveries/stock-grid-cache';

const defaultLogger = createLogger('products-service');

// ---------------------------------------------------------------------------
// products_code_type derivation (REQ-1.1)
// ---------------------------------------------------------------------------

/**
 * Determine product code type based on product type selection.
 * Values: 1=normal (New Product), 2=COPA, 3=T-Shirt, 4=Hero Shirts
 * Default is 1 (normal) for most product types.
 */
function deriveProductsCodeType(productTypeId: number): number {
  // product_types.type_id mappings observed in production:
  // type_id=1 → COPA products → products_code_type=2
  // type_id=3 → T-Shirts → products_code_type=3
  // Everything else defaults to 1 (normal)
  switch (productTypeId) {
    case 1: return 2;  // COPA
    case 3: return 3;  // T-Shirts
    default: return 1; // Normal
  }
}

// ---------------------------------------------------------------------------
// Create or update product code (REQ-1)
// ---------------------------------------------------------------------------

export async function createOrUpdateProductCode(
  data: ProductCodeInput,
  userId: number,
  logger?: Logger,
): Promise<ProductCodeResult> {
  // Generate unique execution ID for tracing all logs belonging to this execution
  const executionId = nanoid(10);
  const log = (logger || defaultLogger).child({ executionId });

  log.info({ userId, productCode: data.productCode, executionId }, 'Starting createOrUpdateProductCode');

  return prisma.$transaction(async (tx: TxClient) => {
    const code = data.productCode.trim();

    // 1. Check if product code already exists
    const existing = await tx.$queryRaw<Array<{ product_lists_id: number }>>(
      Prisma.sql`SELECT product_lists_id FROM product_lists WHERE product_code = ${code} LIMIT 1`
    );
    log.debug({ productCode: code, exists: existing.length > 0 }, 'Product code existence check completed');

    // 2. Resolve team and season (auto-create if needed) — REQ-1.4, REQ-1.5
    const teamsId = await resolveTeamId(tx, data.teamName, log);
    const seasonsId = await resolveSeasonId(tx, data.season, log);

    // Manufacturer is a curated lookup — resolveManufacturerId returns null
    // (no auto-create) when the name is empty or unmatched.
    const manufacturersId = await resolveManufacturerId(tx, data.manufacturerName, log);

    // 3. Derive products_code_type
    const productsCodeType = deriveProductsCodeType(data.productTypeId);
    log.debug({ teamsId, seasonsId, manufacturersId, productTypeId: data.productTypeId, productsCodeType }, 'Resolved ids for product code');

    // 4. Prepare image URLs (empty string → null)
    const frontImage = data.frontImage || null;
    const backImage = data.backImage || null;
    const additionalImage = data.additionalImage || null;
    // Stored as TINYINT(1); coerce explicitly so undefined doesn't slip through.
    const allowsPersonalisation = data.allowsPersonalisation ? 1 : 0;
    const price = data.price ?? 0;

    let productListsId: number;
    let isNew: boolean;

    if (existing.length > 0) {
      // UPDATE existing product code (REQ-1.2)
      productListsId = Number(existing[0].product_lists_id);
      isNew = false;

      log.debug({ productListsId, productCode: code }, 'Updating existing product code');

      const updateSql = Prisma.sql`
        UPDATE product_lists SET
          product_name = ${data.productName},
          teams_id = ${teamsId},
          seasons_id = ${seasonsId},
          price = ${price},
          product_type = ${data.productTypeId},
          manufacturers_id = ${manufacturersId},
          products_code_type = ${productsCodeType},
          front_image_url = ${frontImage},
          back_image_url = ${backImage},
          additional_image_url = ${additionalImage},
          allows_personalisation = ${allowsPersonalisation},
          modified = NOW()
        WHERE product_lists_id = ${productListsId}
      `;

      await executeRawWithLogging(tx, updateSql, log, {
        table: 'product_lists',
        operation: 'UPDATE',
        extra: { productListsId },
        values: {
          product_name: data.productName,
          teams_id: teamsId,
          seasons_id: seasonsId,
          price,
          product_type: data.productTypeId,
          manufacturers_id: manufacturersId,
          products_code_type: productsCodeType,
          front_image_url: frontImage,
          back_image_url: backImage,
          additional_image_url: additionalImage,
          allows_personalisation: allowsPersonalisation,
        },
      });
      log.debug({ productListsId, productCode: code }, 'Product code updated successfully');
    } else {
      // INSERT new product code (REQ-1.1)
      isNew = true;

      // Compute sort order: MAX(sort)+1 for this team+season combination
      const sortRows = await tx.$queryRaw<Array<{ max_sort: number | null }>>(
        Prisma.sql`SELECT MAX(sort) AS max_sort FROM product_lists WHERE teams_id = ${teamsId} AND seasons_id = ${seasonsId}`
      );
      const nextSort = Number(sortRows[0]?.max_sort ?? 0) + 1;
      log.debug({ teamsId, seasonsId, nextSort, productCode: code, productName: data.productName }, 'Inserting new product code');
      const insertSql = Prisma.sql`
            INSERT INTO product_lists (
              product_code, product_name, teams_id, seasons_id, price, special,
              sort, products_code_type, product_type, manufacturers_id, map_status, quantity_map,
              front_image_url, back_image_url, additional_image_url,
              allows_personalisation,
              parent_product_lists_id, FBA_price, newer_product_code,
              special_start_date, special_end_date, created
            ) VALUES (
              ${code}, ${data.productName}, ${teamsId}, ${seasonsId}, ${price}, 0,
              ${nextSort}, ${productsCodeType}, ${data.productTypeId}, ${manufacturersId}, 0, 0,
              ${frontImage}, ${backImage}, ${additionalImage},
              ${allowsPersonalisation},
              0, 0, '',
              '0000-00-00', '0000-00-00', NOW()
            )
          `;
      await executeRawWithLogging(tx, insertSql, log, {
        table: 'product_lists',
        operation: 'INSERT',
        extra: { columnCount: 22 },
        values: {
          product_code: code,
          product_name: data.productName,
          teams_id: teamsId,
          seasons_id: seasonsId,
          price,
          special: 0,
          sort: nextSort,
          products_code_type: productsCodeType,
          product_type: data.productTypeId,
          manufacturers_id: manufacturersId,
          map_status: 0,
          quantity_map: 0,
          front_image_url: frontImage,
          back_image_url: backImage,
          additional_image_url: additionalImage,
          allows_personalisation: allowsPersonalisation,
          parent_product_lists_id: 0,
          FBA_price: 0,
          newer_product_code: '',
          special_start_date: '0000-00-00',
          special_end_date: '0000-00-00',
          created: 'NOW()',
        },
      });

      const idRows = await tx.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT LAST_INSERT_ID() AS id`
      );
      productListsId = Number(idRows[0].id);
      log.debug({ productListsId, productCode: code }, 'New product code inserted successfully');
    }

    // 4b. Persist the origin details — country of origin (FK id + derived name)
    // and HS Code — ACROSS THE WHOLE PRODUCT CODE FAMILY, not just the row being
    // edited (PMS #166509).
    //
    // This is a deliberate behaviour change to the country of origin, which
    // until #166509 was written to this one row only. Both fields are properties
    // of the product rather than of the size, so SMS holds them on the parent
    // product code and carries them to every child (PMS #166526). Leaving Stock2
    // writing one row would mean a value saved here against a child size
    // silently disagreed with what SMS Checkpoint 1 reads off the parent, and the
    // scan gun would ask the warehouse for it again. Both systems read the same
    // product_lists row, so they have to write it the same way.
    //
    // The `!= null` guard per field is kept: an edit that omits a field never
    // clobbers a previously-saved value, and saveOriginDetailsForFamily() carries
    // that through to the family UPDATE by building its SET list from only the
    // fields actually supplied.
    if (data.countryOfOriginId != null || data.hsCode != null) {
      const familyResult = await saveOriginDetailsForFamily(
        code,
        data.countryOfOriginId,
        data.hsCode,
        tx,
      );
      if (!familyResult.status) {
        // Surfaced rather than swallowed: the caller asked for these values and
        // a silent no-op is what let the two systems drift in the first place.
        throw new BadRequestError(familyResult.msg || 'Origin details could not be saved');
      }
      log.debug(
        {
          productListsId,
          parentProductCode: familyResult.parent_product_code,
          childrenUpdated: familyResult.children_updated,
          countryOfOrigin: familyResult.country_of_origin,
          hsCode: familyResult.hs_code,
          fcBarcodesRequeued: familyResult.fc_barcodes_requeued,
        },
        'Origin details persisted across the product code family',
      );
    }

    // 5. Check map_status: if products.products_model matches this code → set map_status=1 (REQ-1.6)
    const mapRows = await tx.$queryRaw<Array<{ products_id: number }>>(
      Prisma.sql`SELECT products_id FROM products WHERE products_model = ${code} LIMIT 1`
    );
    const mapStatus = mapRows.length > 0 ? 1 : 0;
    log.debug({ productCode: code, mapStatus, matchFound: mapRows.length > 0 }, 'Map status check completed');

    if (mapStatus === 1) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE product_lists SET map_status = 1 WHERE product_lists_id = ${productListsId}`
      );
      log.debug({ productListsId }, 'Map status updated to 1');
    }

    // 6. Dual-write season/price into the stock_home_grid_lists cache — the
    // deliveries "stock-home-grid" reads these two columns from the
    // denormalised cache, NOT from product_lists (legacy parity: SMS's
    // add_new_products flow patches both tables inline). Without this, an
    // edit here never surfaces on the grid at all until an unrelated
    // inventory save rebuilds the row via refreshStockHomeGrid — the legacy
    // 30-min cron does NOT heal it, since that cron only rebuilds rows whose
    // product_lists.pl_stock_grid_delete_time sentinel is set, which this
    // handler never sets. Guarded by `!isNew`: a brand-new product code has
    // no cache row yet — that row is only created when inventory is first
    // added via refreshStockHomeGrid — so patching it here would be a
    // pointless 0-row no-op. `tx` (not the module-level `prisma`) is threaded
    // through so the cache patch commits/rolls back atomically with the
    // product_lists writes above (see stock-grid-cache.ts docblock).
    //
    // NOTE: season_sort is intentionally NOT patched here (matches the sibling
    // deliveries season edit). A season change therefore updates the grid's
    // season label immediately but leaves its sort key until the next full
    // rebuild — tracked as a fast-follow for both call sites.
    if (!isNew) {
      await directUpdateGridRow({
        set: { season: data.season, price: price.toFixed(2) },
        where: { byProductListsId: productListsId },
        callerTag: 'products/product-code/season-price',
      }, tx);
      log.debug({ productListsId, season: data.season, price }, 'Patched stock_home_grid_lists season/price cache');
    }

    const result: ProductCodeResult = {
      productListsId,
      isNew,
      productCode: code,
      mapStatus,
    };

    log.info({ productListsId, productCode: code, isNew, mapStatus }, 'createOrUpdateProductCode completed successfully');
    return result;
  }, { timeout: 30_000 });
}