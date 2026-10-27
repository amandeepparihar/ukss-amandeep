/**
 * Shopify Sync Drill-Down — paginated failing-SKU list + streaming CSV export.
 *
 * Reads shopify_tracking_history (failures only), joins to current
 * shopify_products_variations + shopify_products for live SKU/status context.
 *
 * Parameter ordering in baseSql (one ? per position):
 *   pos 1 → store_id = ?          (inner subquery WHERE store_id = ?)
 *   pos 2 → ? HOUR                (inner subquery interval)
 *   pos 3 → v.sm_store_id = ?     (LEFT JOIN shopify_products_variations)
 *   pos 4 → p.sm_store_id = ?     (LEFT JOIN shopify_products)
 *   JSON path appends:
 *   pos 5 → LIMIT ?               (pageSize)
 *   pos 6 → OFFSET ?              (offset)
 */
import { Readable } from 'node:stream';
import { prisma } from '../../lib/prisma';
import type { ShopifySyncFailureRow, ShopifySyncFailuresResponse } from '@admin/shared';

const num = (v: unknown): number => Number((v as number | bigint | string) ?? 0);

const SORT_COLUMNS: Record<string, string> = {
  lastSeen: 'last_seen',
  sku: 'spv_sku',
  productStatus: 'sp_status',
};

interface FailRaw {
  spv_variation_id: string;
  sp_product_id: string;
  spv_sku: string | null;
  spv_inventory_item_id: string | null;
  sp_status: string | null;
  last_message: string | null;
  last_seen: Date | string;
}

/**
 * Core failing-items query. Placeholders in order:
 *   ? 1 = store_id  (inner subquery)
 *   ? 2 = windowHours  (inner subquery INTERVAL)
 *   ? 3 = store_id  (LEFT JOIN shopify_products_variations ON ... sm_store_id = ?)
 *   ? 4 = store_id  (LEFT JOIN shopify_products ON ... sm_store_id = ?)
 * Caller appends LIMIT ? OFFSET ? for JSON path (pos 5, 6).
 *
 * GROUP_CONCAT separator is the MySQL hex literal 0x01 (ASCII SOH).
 * This control character cannot appear in Shopify error messages, so
 * SUBSTRING_INDEX safely extracts only the most-recent message without
 * splitting on commas inside the text.  0x01 is a binary literal -- no
 * quoting -- which avoids any JS/SQL string-escaping loss of the character.
 */
function baseSql(orderBy: string): string {
  return `
    SELECT f.spv_variation_id, f.sp_product_id, v.spv_sku, v.spv_inventory_item_id,
           p.sp_status, f.last_message, f.last_seen
    FROM (
      SELECT spv_variation_id, sp_product_id,
             MAX(sth_created_at) AS last_seen,
             SUBSTRING_INDEX(
               GROUP_CONCAT(sth_message ORDER BY sth_created_at DESC SEPARATOR 0x01),
               0x01, 1) AS last_message
      FROM shopify_tracking_history
      WHERE store_id = ? AND sth_status = 'failure'
        AND sth_created_at >= NOW() - INTERVAL ? HOUR
      GROUP BY spv_variation_id, sp_product_id
    ) f
    LEFT JOIN shopify_products_variations v
      ON v.spv_variation_id = f.spv_variation_id AND v.sm_store_id = ?
    LEFT JOIN shopify_products p
      ON p.sp_product_id = f.sp_product_id AND p.sm_store_id = ?
    ORDER BY ${orderBy}
  `;
}

const COUNT_SQL = `
  SELECT COUNT(*) AS total FROM (
    SELECT 1 FROM shopify_tracking_history
    WHERE store_id = ? AND sth_status = 'failure'
      AND sth_created_at >= NOW() - INTERVAL ? HOUR
    GROUP BY spv_variation_id, sp_product_id
  ) c
`;

function mapRow(r: FailRaw): ShopifySyncFailureRow {
  return {
    variationId: r.spv_variation_id,
    productId: r.sp_product_id,
    sku: r.spv_sku,
    inventoryItemId: r.spv_inventory_item_id,
    productStatus: r.sp_status,
    lastMessage: r.last_message,
    lastSeen: new Date(r.last_seen).toISOString(),
  };
}

/** Paginated list of distinct failing items for a single store. */
export async function getShopifySyncFailures(args: {
  storeId: number;
  windowHours: number;
  page: number;
  pageSize: number;
  sort: keyof typeof SORT_COLUMNS;
  dir: 'asc' | 'desc';
}): Promise<ShopifySyncFailuresResponse> {
  const { storeId, windowHours, page, pageSize, sort, dir } = args;
  const col = SORT_COLUMNS[sort] ?? 'last_seen';
  const orderBy = `${col} ${dir === 'asc' ? 'ASC' : 'DESC'}`;
  const offset = (page - 1) * pageSize;

  const [countRows, rows] = await Promise.all([
    // COUNT_SQL: pos 1=storeId, pos 2=windowHours
    prisma.$queryRawUnsafe<{ total: unknown }[]>(COUNT_SQL, storeId, windowHours),
    // baseSql: pos 1=storeId, pos 2=windowHours, pos 3=storeId (JOIN v), pos 4=storeId (JOIN p)
    // + LIMIT pos 5=pageSize, OFFSET pos 6=offset
    prisma.$queryRawUnsafe<FailRaw[]>(
      `${baseSql(orderBy)} LIMIT ? OFFSET ?`,
      storeId, windowHours, storeId, storeId, pageSize, offset,
    ),
  ]);

  return {
    storeId,
    total: num(countRows[0]?.total),
    page,
    pageSize,
    rows: rows.map(mapRow),
  };
}

/** Full (unpaginated) result set streamed as CSV — download starts immediately. */
export async function streamShopifySyncFailuresCsv(args: {
  storeId: number;
  windowHours: number;
}): Promise<Readable> {
  // baseSql: pos 1=storeId, pos 2=windowHours, pos 3=storeId (JOIN v), pos 4=storeId (JOIN p)
  const rows = await prisma.$queryRawUnsafe<FailRaw[]>(
    baseSql('last_seen DESC'),
    args.storeId, args.windowHours, args.storeId, args.storeId,
  );

  const stream = new Readable({ read() {} });
  const esc = (s: string | null) => `"${(s ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;

  stream.push('"Product ID","SKU","Inventory Item ID","Product Status","Last Error","Last Seen"\n');
  for (const raw of rows) {
    const r = mapRow(raw);
    stream.push(
      `${esc(r.productId)},${esc(r.sku)},${esc(r.inventoryItemId)},${esc(r.productStatus)},${esc(r.lastMessage)},${esc(r.lastSeen)}\n`,
    );
  }
  stream.push(null);
  return stream;
}
