/**
 * Orders listing service — execution, row mapping, tab counts, stores.
 * Requirements: REQ-02-021 (query assembly), REQ-02-022 (post-query mods),
 *   REQ-02-023 (pagination), REQ-02-020 (row coloring), REQ-02-007 (stores)
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import type { OrderListQuery, OrderTabCountsQuery } from '../orders.schema';
import { determineRowClass } from './listing.colors';
import {
  buildQueryParts,
  buildBaseQueryParts,
  formatDateOnly,
  addDays,
} from './listing.query-builder';

const logger = createLogger('orders-listing');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrderListRow {
  orders_id: number;
  payment_method: string | null;
  shipping_module_code: string | null;
  customers_name: string | null;
  billing_name: string | null;
  billing_company: string | null;
  customers_company: string | null;
  delivery_name: string | null;
  delivery_company: string | null;
  billing_street_address: string | null;
  delivery_street_address: string | null;
  ship_by_date: Date | string | null;
  ship_by_date_status: number | null;
  order_total: number | null;
  currency: string | null;
  currency_value: number | null;
  date_purchased: Date | string | null;
  orders_status: number;
  orders_status_name: string;
  refund_status_for_reject_orders: number | null;
  bulk_refund_amount: number | null;
  order_type: string | null;
  sift_score: number | null;
  risk_score: number | null;
  touchpoints: number | null;
  scanned: string | null;
  order_site: number | null;
  id_of_original_order: number | null;
  is_prime_order: string | null;
  shipping_method: string | null;
  amazon_orders_id: string | null;
  mplaza_orders_id: string | null;
  tesco_customer_order_id: string | null;
  ebay_orders_id: string | null;
  rakuten_order_id: string | null;
  lazada_order_id: string | null;
  priceminister_order_id: string | null;
  gosport_order_id: string | null;
  catch_order_id: string | null;
  fruugo_orders_id: string | null;
  decathlon_order_id: string | null;
  multisite_order_id: string | null;
  customers_id: number | null;
  delivery_country: string | null;
  fc_order_status: string | null;
  fc_auto_creation_bit: string | null;
  has_fc_onbackorder: number;
  has_jit_products: number;
  has_hero_shirt_products: number;
}

export interface OrderListItem {
  orderId: number;
  customerId: number | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  customerName: string | null;
  companyName: string | null;
  shipByDate: string | null;
  shipByDateStatus: number | null;
  orderTotal: number | null;
  currency: string | null;
  currencyValue: number | null;
  datePurchased: string | null;
  status: number;
  statusName: string;
  refundInfo: { type: string; amount: number | null } | null;
  orderType: string | null;
  siftScore: number | null;
  riskScore: number | null;
  touchpoints: number | null;
  scanned: boolean;
  isExchange: boolean;
  originalOrderId: number | null;
  billingShippingMismatch: boolean;
  rowClass: string;
}

export interface OrderListResult {
  data: OrderListItem[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

interface CountRow { cnt: bigint }

// ---------------------------------------------------------------------------
// Main listing query (REQ-02-021 + REQ-02-023)
// ---------------------------------------------------------------------------

/**
 * Build and execute the paginated order listing query.
 */
export async function getOrderListing(query: OrderListQuery): Promise<OrderListResult> {
  const { selectClause, fromClause, whereConditions, orderByClause, params, selectParams } =
    buildQueryParts(query);

  const whereStr = whereConditions.join(' AND ');
  const offset = (query.page - 1) * query.pageSize;

  const countSql = `SELECT COUNT(DISTINCT o.orders_id) as cnt ${fromClause} WHERE ${whereStr}`;
  // selectParams must come first — they correspond to ? placeholders in the SELECT clause
  const dataSql = `SELECT ${selectClause} ${fromClause} WHERE ${whereStr} GROUP BY o.orders_id ${orderByClause} LIMIT ${query.pageSize} OFFSET ${offset}`;

  const [countResult, rows] = await Promise.all([
    prisma.$queryRawUnsafe<CountRow[]>(countSql, ...params),
    prisma.$queryRawUnsafe<OrderListRow[]>(dataSql, ...selectParams, ...params),
  ]);

  const total = Number(countResult[0]?.cnt ?? 0);

  return {
    data: rows.map(mapRowToListItem),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

// ---------------------------------------------------------------------------
// REQ-02-017: Tab counts
// ---------------------------------------------------------------------------

export async function getTabCounts(
  query: OrderTabCountsQuery
): Promise<Record<string, number>> {
  const today = formatDateOnly(new Date());
  const tomorrow = formatDateOnly(addDays(new Date(), 1));
  const twoDays = formatDateOnly(addDays(new Date(), 2));

  const baseQuery: OrderListQuery = {
    ...query, page: 1, pageSize: 1, sortBy: 'default', sortOrder: 'desc',
  };

  // I-7 fix: single call instead of buildQueryParts + buildBaseWhereConditions
  const { fromClause, whereConditions, params } = buildBaseQueryParts(baseQuery);

  // Ship-by-date tab counts use the filtered query (status, seller, etc.).
  // COUNT(DISTINCT CASE...) ensures an order with N line items (from toffs/fsb/product/size
  // LEFT JOINs added by buildBaseQueryParts) is counted exactly once per tab.
  const shipByDateSql = `
    SELECT
      COUNT(DISTINCT CASE WHEN DATE(o.ship_by_date) = ? THEN o.orders_id END) AS today_count,
      COUNT(DISTINCT CASE WHEN DATE(o.ship_by_date) = ? THEN o.orders_id END) AS tomorrow_count,
      COUNT(DISTINCT CASE WHEN DATE(o.ship_by_date) = ? THEN o.orders_id END) AS two_days_count,
      COUNT(DISTINCT CASE WHEN DATE(o.ship_by_date) > ? THEN o.orders_id END) AS after_two_days_count
    ${fromClause} WHERE ${whereConditions.join(' AND ')}
  `;

  // #213 fix: "To Be Refund" is always a global count with no status/seller filters,
  // matching legacy PHP: SELECT count(orders_id) FROM orders WHERE refund_status_for_reject_orders = '1'
  const refundSql = `SELECT COUNT(*) AS cnt FROM orders WHERE refund_status_for_reject_orders = '1'`;

  try {
    const [shipByDateResult, refundResult] = await Promise.all([
      // I-6 fix: date params come FIRST to match the ? placeholder order in the SELECT clause
      prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        shipByDateSql, today, tomorrow, twoDays, twoDays, ...params
      ),
      prisma.$queryRawUnsafe<CountRow[]>(refundSql),
    ]);
    const row = shipByDateResult[0] ?? {};
    return {
      today: Number(row.today_count ?? 0),
      tomorrow: Number(row.tomorrow_count ?? 0),
      twoDays: Number(row.two_days_count ?? 0),
      afterTwoDays: Number(row.after_two_days_count ?? 0),
      toBeRefund: Number(refundResult[0]?.cnt ?? 0),
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get tab counts');
    return { today: 0, tomorrow: 0, twoDays: 0, afterTwoDays: 0, toBeRefund: 0 };
  }
}

// ---------------------------------------------------------------------------
// REQ-02-007: Store/seller dropdown data
// ---------------------------------------------------------------------------

interface StoreRow { store_url: string }

export async function getStores(): Promise<Array<{ id: string; name: string }>> {
  // PHP: SELECT store_url FROM store_management WHERE store_url NOT LIKE '%http%' AND store_url NOT LIKE '%www%'
  // PHP uses store_url as both the dropdown value and display text
  const rows = await prisma.$queryRaw<StoreRow[]>(
    Prisma.sql`SELECT store_url FROM store_management WHERE store_url NOT LIKE '%http%' AND store_url NOT LIKE '%www%' AND store_url != '' ORDER BY store_url ASC`
  );
  const stores: Array<{ id: string; name: string }> = [];
  // PHP: hardcoded Amazon UK Prime at top (orders_header.php:564-567)
  stores.push({ id: 'amazonukprime', name: 'Amazon UK Prime' });
  // DB-driven entries (filter out empty store_url — breaks Radix Select)
  for (const r of rows) {
    if (r.store_url) stores.push({ id: r.store_url, name: r.store_url });
  }
  // PHP: hardcoded Catch at bottom (orders_header.php:577-580)
  stores.push({ id: 'catch', name: 'Catch' });
  return stores;
}

// ---------------------------------------------------------------------------
// Cascade filter endpoints: categories → products → sizes
// ---------------------------------------------------------------------------

/**
 * GET /filter/categories — all categories for the Filter Products cascade.
 * Joined to categories table to drop orphaned descriptions (review M1).
 */
export async function getFilterCategories(): Promise<{ id: number; name: string }[]> {
  const rows = await prisma.$queryRaw<{ id: bigint; name: string }[]>(Prisma.sql`
    SELECT cd.categories_id AS id, cd.categories_name AS name
    FROM categories_description cd
    INNER JOIN categories c ON c.categories_id = cd.categories_id
    WHERE cd.language_id = 1
    ORDER BY cd.categories_name ASC
  `);
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

/**
 * GET /filter/products?categoryId=<n> — products in a category.
 * Mirrors legacy aja_cat_updateproducts (orders.php:4773).
 */
export async function getFilterProducts(
  categoryId: number
): Promise<{ id: number; name: string }[]> {
  const rows = await prisma.$queryRaw<{ id: bigint; name: string }[]>(Prisma.sql`
    SELECT p.products_id AS id, pd.products_name AS name
    FROM products p
    JOIN products_description pd ON p.products_id = pd.products_id
    JOIN products_to_categories p2c ON p.products_id = p2c.products_id
    WHERE pd.language_id = 1 AND pd.products_name <> '' AND p2c.categories_id = ${categoryId}
    GROUP BY p.products_id
    ORDER BY pd.products_name ASC
  `);
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

/**
 * GET /filter/sizes?productId=<n> — sizes for a specific product.
 * Mirrors legacy aja_product_updatesize (orders.php:4821).
 */
export async function getFilterSizes(
  productId: number
): Promise<{ id: number; name: string }[]> {
  const rows = await prisma.$queryRaw<{ id: bigint; name: string }[]>(Prisma.sql`
    SELECT DISTINCT pa.options_values_id AS id, pov.products_options_values_name AS name
    FROM products_attributes pa
    JOIN products_options po ON po.products_options_id = pa.options_id
    JOIN products_options_values pov ON pov.products_options_values_id = pa.options_values_id
    WHERE pa.products_id = ${productId}
      AND po.products_options_name LIKE '%Size%'
      AND pov.language_id = 1
    ORDER BY pov.products_options_values_name ASC
  `);
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

// ---------------------------------------------------------------------------
// Row mapping (REQ-02-018, REQ-02-019, REQ-02-020)
// ---------------------------------------------------------------------------

function mapRowToListItem(row: OrderListRow): OrderListItem {
  const customerName = row.customers_name?.trim() || row.billing_name?.trim() || '';
  const companyName = row.customers_company?.trim() || row.billing_company?.trim() || '';
  const isExchange = !!row.id_of_original_order && row.id_of_original_order > 0;

  const billingShippingMismatch =
    (row.billing_name ?? '') !== (row.delivery_name ?? '') ||
    (row.billing_street_address ?? '') !== (row.delivery_street_address ?? '');

  let refundInfo: OrderListItem['refundInfo'] = null;
  if (row.refund_status_for_reject_orders === 1) {
    refundInfo = row.bulk_refund_amount && row.bulk_refund_amount > 0
      ? { type: 'partial', amount: row.bulk_refund_amount }
      : { type: 'full', amount: null };
  }

  return {
    orderId: row.orders_id,
    customerId: row.customers_id ?? null,
    paymentMethod: row.payment_method ?? null,
    shippingMethod: row.shipping_module_code ?? null,
    customerName,
    companyName: companyName || null,
    shipByDate: row.ship_by_date ? formatDate(row.ship_by_date) : null,
    shipByDateStatus: row.ship_by_date_status ?? null,
    orderTotal: row.order_total ?? null,
    currency: row.currency ?? null,
    currencyValue: row.currency_value != null ? Number(row.currency_value) : null,
    datePurchased: row.date_purchased ? formatDateTime(row.date_purchased) : null,
    status: row.orders_status,
    statusName: row.orders_status_name,
    refundInfo,
    orderType: row.order_type ?? null,
    siftScore: row.sift_score && row.sift_score > 0 ? row.sift_score : null,
    riskScore: row.risk_score && row.risk_score > 0 ? row.risk_score : null,
    touchpoints: row.touchpoints ?? null,
    scanned: row.scanned === 'yes',
    isExchange,
    originalOrderId: isExchange ? row.id_of_original_order : null,
    billingShippingMismatch,
    rowClass: determineRowClass(row),
  };
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getUTCFullYear()}`;
}

function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day}-${month}-${d.getUTCFullYear()} ${hours}:${minutes}`;
}
