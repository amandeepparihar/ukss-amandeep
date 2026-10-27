/**
 * Product Feeds - Product Query Functions
 *
 * Reads paginated rows from `product_variation_view` (the denormalised
 * view the PHP feed used -- see `sql/product-variation-view.sql`).
 *
 * Chunked-query pattern mirrors
 * `marketplaces/adapters/sportdeal/feed-generator.ts:queryProductsChunk`
 * so large result sets (~500k+ variant rows in prod) stream through
 * without buffering the full set in memory.
 *
 * PHP source: `ukss-feed/build_data.php` lines 53-57
 *   $sql = "SELECT * FROM product_variation_view";
 *   $results = executeQueryWithParams($sql, [], true);
 */

import { prisma } from '../../../lib/prisma.js';
import type { ProductVariationRow } from '../product-feeds.types.js';

/**
 * Fetch a chunk of rows from `product_variation_view`.
 *
 * The view is already ordered by `products_id` ASC (see the view DDL),
 * so variants for the same product appear contiguously -- the product
 * builder detects group boundaries by `pfv_product_id` changes.
 *
 * @param chunkSize  Rows per chunk (typically 10_000)
 * @param offset     Starting row (page * chunkSize)
 */
export async function queryProductVariations(
  chunkSize: number,
  offset: number,
): Promise<ProductVariationRow[]> {
  // `$queryRawUnsafe` because we have to interpolate numeric LIMIT/OFFSET
  // -- MySQL does not accept prepared-statement parameters for these.
  // Values are hard-cast to integers to prevent injection.
  const safeLimit = Math.max(0, Math.floor(chunkSize));
  const safeOffset = Math.max(0, Math.floor(offset));

  const rows = await prisma.$queryRawUnsafe<ProductVariationRow[]>(
    `SELECT * FROM product_variation_view LIMIT ${safeLimit} OFFSET ${safeOffset}`,
  );

  return rows;
}

/**
 * Total row count for progress tracking / chunk planning.
 */
export async function getProductVariationCount(): Promise<number> {
  const result = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) AS count FROM product_variation_view
  `;
  return Number(result[0].count);
}
