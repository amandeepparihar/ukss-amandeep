/**
 * Daily Deals Service
 *
 * Business logic and raw SQL queries for the Daily Deals module.
 * Uses existing `deals_management` table with deal_type = 'DAILY'.
 *
 * PERFORMANCE OPTIMIZATION:
 * - Listing queries (Tab 1 & Tab 2) are fast — no deal/revenue JOINs
 * - Deal status + revenue fetched separately via getProductDealInfo() for visible page IDs only
 * - Summary endpoint calculates totals independently
 */

import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { config } from '../../config';
import { ApiError, ConflictError, NotFoundError } from '../../lib/errors';
import type {
  ProductListInput,
  SingleSizeProductsInput,
  ScheduleQueryInput,
  SaveDealInput,
  SummaryInput,
  BannerConfigInput,
  SetSpecialPriceInput,
} from './daily-deals.schema';

const logger = createLogger('daily-deals');

// ---------- TypeScript interfaces ----------

interface ProductRow {
  products_id: number;
  product_code: string;
  products_name: string;
  current_price: number | string | null;
  total_stock: string | number;
  last_order_date: string | null;
  days_since_last_sale: string | number | null;
}

interface SingleSizeRow extends ProductRow {
  size_name: string | null;
}

interface DealInfoRow {
  products_id: number;
  deal_status: string | null;
  deal_revenue: string | number | null;
  deal_units_sold: string | number | null;
}

interface ScheduledDealRow {
  deal_id: number;
  products_id: number;
  product_code: string;
  product_name: string;
  discount_type: string;
  discount_value: number | string;
  current_price: number | string | null;
  start_date: string;
  end_date: string;
  is_active: number;
  to_be_active: number;
}

interface CountRow { total: string | number; }
interface PriceRow { products_price: number | string | null; }
interface DealRow {
  deal_id: number; deal_type: string; deal_target_type: string;
  target_id: number; discount_type: string; discount_value: number | string;
  start_date: string; end_date: string; is_active: number; to_be_active: number;
}
interface RevenueRow {
  total_revenue: string | number | null;
  total_units_sold: string | number | null;
  total_deals_run: string | number | null;
}

// ---------- Helpers ----------

function toNumber(val: string | number | bigint | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

function buildPaginationMeta(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function formatDate(val: string | Date): string {
  if (typeof val === 'string') return val.split('T')[0];
  return new Date(val).toISOString().split('T')[0];
}

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

// ---------- Shared filter builder ----------

function buildFilters(params: {
  search?: string;
  minQty?: number;
  notSoldSinceDays?: number;
  leagueId?: number;
  teamId?: number;
  productType?: string;
  visibility?: string;
}) {
  const clauses: string[] = [];
  const values: any[] = [];

  if (params.search) {
    clauses.push(`AND (pl.product_code LIKE ? OR pl.product_name LIKE ?)`);
    values.push(`%${escapeLike(params.search)}%`, `%${escapeLike(params.search)}%`);
  }
  if (params.notSoldSinceDays && params.notSoldSinceDays > 0) {
    clauses.push(`AND DATEDIFF(NOW(), np.last_order_date) >= ?`);
    values.push(params.notSoldSinceDays);
  }
  if (params.teamId) {
    clauses.push(`AND np.np_team_id = ?`);
    values.push(params.teamId);
  } else if (params.leagueId) {
    clauses.push(`AND np.np_team_id IN (SELECT id FROM category_league WHERE parent_league_id = ? AND type = 'nl')`);
    values.push(params.leagueId);
  }
  // minQty handled via HAVING in count query and WHERE in data query
  // Product type filter: Adults/Womens/Kids
  if (params.productType === 'adults') {
    clauses.push(`AND np.size_type = 'Adults'`);
  } else if (params.productType === 'womens') {
    clauses.push(`AND np.np_gender = 'Female'`);
  } else if (params.productType === 'kids') {
    clauses.push(`AND np.size_type = 'Kids'`);
  }
  // Visibility filter.
  // Correlated EXISTS / NOT EXISTS against active/upcoming DAILY product deals — a
  // semi-join/anti-join rather than a plain JOIN. buildFilters only emits WHERE
  // fragments, and a product can map to many deal rows, so an INNER JOIN would fan out
  // and corrupt the per-size rows / SUM(pq.quantity) stock totals in the listing queries.
  // The correlated lookup is index-backed via deals_management_target_id_IDX, and
  // NOT EXISTS also avoids the NOT IN NULL pitfall.
  const dealExists = `
        SELECT 1 FROM deals_management dm
        WHERE dm.target_id = np.products_id
          AND dm.deal_type = 'DAILY' AND dm.deal_target_type = 'PRODUCT'
          AND (dm.is_active = 1 OR (dm.to_be_active = 1 AND dm.start_date >= CURDATE()))`;
  if (params.visibility === 'ignored') {
    clauses.push(`AND np.daily_deals_ignored = 1`);
  } else if (params.visibility === 'with-deals') {
    clauses.push(`AND EXISTS (${dealExists})`);
  } else if (params.visibility !== 'all') {
    // 'working' (default): exclude ignored + exclude products with current/future deals
    clauses.push(`AND np.daily_deals_ignored = 0`);
    clauses.push(`AND NOT EXISTS (${dealExists})`);
  }
  return { where: clauses.join('\n        '), whereParams: values };
}

// Base WHERE for both tabs (no actual_sms_quantity — stock calculated from SUM(product_quantities))
const BASE_WHERE = `
        np.products_status = 1
        AND pl.product_name NOT LIKE '%concept%'
        AND COALESCE(np.virtual_product_type_id, 0) != 4
        AND np.manufacturers_id != 35
        AND np.is_sms_product = 1
        AND np.hero_shirt_parent = 0
        AND np.products_model != ''
        AND COALESCE(np.delete_product_from_front_end, 0) != 1`;

// ---------- Tab 1: Slow Moving Products ----------

export async function getProductsNotSoldRecently(params: ProductListInput) {
  const { page, pageSize, sortBy, sortOrder } = params;
  const offset = (page - 1) * pageSize;

  logger.info({ params }, 'Fetching slow moving products');

  const { where: filterWhere, whereParams } = buildFilters(params);

  const orderByMap: Record<string, string> = {
    last_order_date: 'np.last_order_date',
    total_stock: 'np.actual_sms_quantity',
    price: 'np.products_price',
  };
  const orderColumn = orderByMap[sortBy] || 'np.last_order_date';
  const orderDir = sortOrder === 'desc' ? 'DESC' : 'ASC';

  const minQty = params.minQty && params.minQty > 0 ? params.minQty : 0;
  const havingClause = minQty > 0 ? 'HAVING SUM(pq.quantity) >= ?' : 'HAVING SUM(pq.quantity) > 0';
  const havingParams = minQty > 0 ? [minQty] : [];

  const countSql = `
    SELECT COUNT(*) AS total FROM (
      SELECT np.products_id
      FROM product_quantities pq
      INNER JOIN product_lists pl ON pq.product_lists_id = pl.product_lists_id
      INNER JOIN new_products np ON np.products_model = pl.product_code
      WHERE ${BASE_WHERE}
        AND pq.quantity > 0
        AND np.products_id IN (SELECT DISTINCT products_id FROM orders_products)
        ${filterWhere}
      GROUP BY np.products_id
      ${havingClause}
    ) AS cnt
  `;
  const countRows = await prisma.$queryRawUnsafe<CountRow[]>(countSql, ...whereParams, ...havingParams);
  const total = toNumber(countRows[0]?.total);

  const dataSql = `
    SELECT
      np.products_id,
      pl.product_name AS products_name,
      pl.product_code,
      np.products_price AS current_price,
      (SELECT MAX(npv_onsite_price) FROM new_products_variations WHERE npv_products_id = np.products_id) AS site_price,
      (SELECT COUNT(*) FROM specials WHERE products_id = np.products_id AND status = 1 AND (expires_date = '0001-01-01' OR expires_date >= CURDATE())) AS has_special,
      SUM(pq.quantity) AS total_stock,
      COALESCE(np.total_ordered_qty, 0) AS total_sold,
      np.last_order_date,
      DATEDIFF(NOW(), np.last_order_date) AS days_since_last_sale,
      np.size_type,
      np.np_gender,
      np.daily_deals_ignored
    FROM product_quantities pq
    INNER JOIN product_lists pl ON pq.product_lists_id = pl.product_lists_id
    INNER JOIN new_products np ON np.products_model = pl.product_code
    WHERE ${BASE_WHERE}
      AND pq.quantity > 0
      AND np.products_id IN (SELECT DISTINCT products_id FROM orders_products)
      ${filterWhere}
    GROUP BY np.products_id, pl.product_name, pl.product_code, np.products_price, np.last_order_date, np.total_ordered_qty, np.size_type, np.np_gender, np.daily_deals_ignored
    ${havingClause}
    ORDER BY ${orderColumn} ${orderDir}, np.products_id ASC
    LIMIT ? OFFSET ?
  `;
  const rows = await prisma.$queryRawUnsafe<ProductRow[]>(
    dataSql, ...whereParams, ...havingParams, pageSize, offset
  );

  const data = rows.map((row: any) => ({
    productsId: row.products_id,
    productCode: row.product_code,
    productName: row.products_name,
    currentPrice: toNumber(row.current_price),
    sitePrice: toNumber(row.site_price),
    hasSpecial: toNumber(row.has_special) > 0,
    totalStock: toNumber(row.total_stock),
    totalSold: toNumber(row.total_sold),
    daysSinceLastSale: row.days_since_last_sale === null || row.days_since_last_sale === undefined
      ? null : toNumber(row.days_since_last_sale),
    sizeType: row.size_type || null,
    npGender: row.np_gender || null,
    isIgnored: toNumber(row.daily_deals_ignored) === 1,
  }));

  return { data, meta: buildPaginationMeta(total, page, pageSize) };
}

// ---------- Tab 2: Single Size Slow Moving Products ----------

const SINGLE_SIZE_FILTER = `
        AND pl.product_lists_id IN (
          SELECT product_lists_id FROM product_quantities
          WHERE quantity > 0
          GROUP BY product_lists_id
          HAVING COUNT(DISTINCT size_id) = 1
        )`;

export async function getSingleSizeProducts(params: SingleSizeProductsInput) {
  const { page, pageSize, sortBy, sortOrder } = params;
  const offset = (page - 1) * pageSize;

  logger.info({ params }, 'Fetching single size slow moving products');

  const { where: filterWhere, whereParams } = buildFilters(params);

  const orderByMap: Record<string, string> = {
    last_order_date: 'np.last_order_date',
    quantity: 'pq.quantity',
    price: 'np.products_price',
  };
  const orderColumn = orderByMap[sortBy] || 'np.last_order_date';
  const orderDir = sortOrder === 'desc' ? 'DESC' : 'ASC';

  const minQty = params.minQty && params.minQty > 0 ? params.minQty : 0;
  const minQtyWhere = minQty > 0 ? 'AND pq.quantity >= ?' : '';
  const minQtyParams = minQty > 0 ? [minQty] : [];

  const countSql = `
    SELECT COUNT(*) AS total FROM (
      SELECT np.products_id
      FROM product_quantities pq
      INNER JOIN product_lists pl ON pq.product_lists_id = pl.product_lists_id
      INNER JOIN new_products np ON np.products_model = pl.product_code
      WHERE ${BASE_WHERE}
        AND pq.quantity > 0
        ${SINGLE_SIZE_FILTER}
        ${filterWhere}
        ${minQtyWhere}
    ) AS cnt
  `;
  const countRows = await prisma.$queryRawUnsafe<CountRow[]>(countSql, ...whereParams, ...minQtyParams);
  const total = toNumber(countRows[0]?.total);

  const dataSql = `
    SELECT
      np.products_id,
      pl.product_name AS products_name,
      pl.product_code,
      np.products_price AS current_price,
      (SELECT MAX(npv_onsite_price) FROM new_products_variations WHERE npv_products_id = np.products_id) AS site_price,
      (SELECT COUNT(*) FROM specials WHERE products_id = np.products_id AND status = 1 AND (expires_date = '0001-01-01' OR expires_date >= CURDATE())) AS has_special,
      pq.quantity AS total_stock,
      COALESCE(np.total_ordered_qty, 0) AS total_sold,
      pov.products_options_values_name AS size_name,
      np.last_order_date,
      DATEDIFF(NOW(), np.last_order_date) AS days_since_last_sale,
      np.size_type,
      np.np_gender,
      np.daily_deals_ignored
    FROM product_quantities pq
    INNER JOIN product_lists pl ON pq.product_lists_id = pl.product_lists_id
    INNER JOIN new_products np ON np.products_model = pl.product_code
    LEFT JOIN products_options_values_to_products_options povtpo ON pq.size_id = povtpo.products_options_values_to_products_options_id
    LEFT JOIN products_options_values pov ON povtpo.products_options_values_id = pov.products_options_values_id
    WHERE ${BASE_WHERE}
      AND pq.quantity > 0
      ${SINGLE_SIZE_FILTER}
      ${filterWhere}
      ${minQtyWhere}
    ORDER BY ${orderColumn} ${orderDir}, np.products_id ASC
    LIMIT ? OFFSET ?
  `;
  const rows = await prisma.$queryRawUnsafe<SingleSizeRow[]>(
    dataSql, ...whereParams, ...minQtyParams, pageSize, offset
  );

  const data = rows.map((row: any) => ({
    productsId: row.products_id,
    productCode: row.product_code,
    productName: row.products_name,
    currentPrice: toNumber(row.current_price),
    sitePrice: toNumber(row.site_price),
    hasSpecial: toNumber(row.has_special) > 0,
    totalStock: toNumber(row.total_stock),
    totalSold: toNumber(row.total_sold),
    sizeName: row.size_name || 'Unknown',
    daysSinceLastSale: row.days_since_last_sale === null || row.days_since_last_sale === undefined
      ? null : toNumber(row.days_since_last_sale),
    sizeType: row.size_type || null,
    npGender: row.np_gender || null,
    isIgnored: toNumber(row.daily_deals_ignored) === 1,
  }));

  return { data, meta: buildPaginationMeta(total, page, pageSize) };
}

// ---------- Filter Options (leagues + teams for dropdowns) ----------

interface FilterOption {
  id: number;
  name: string;
}

export async function getFilterOptions() {
  logger.info('Fetching filter options');

  // Only fetch real leagues (those that have teams pointing to them via parent_league_id)
  const leagues = await prisma.$queryRawUnsafe<FilterOption[]>(`
    SELECT cl.id, cl.league_name AS name
    FROM category_league cl
    WHERE cl.type = 'l'
      AND cl.league_name != ''
      AND cl.id IN (SELECT DISTINCT parent_league_id FROM category_league WHERE parent_league_id > 0)
    ORDER BY cl.league_name ASC
  `);

  const teams = await prisma.$queryRawUnsafe<FilterOption[]>(`
    SELECT id, league_name AS name
    FROM category_league
    WHERE type = 'nl' AND league_name != ''
    ORDER BY league_name ASC
  `);

  return {
    data: {
      leagues: leagues.map((r) => ({ id: r.id, name: r.name })),
      teams: teams.map((r) => ({ id: r.id, name: r.name })),
    },
  };
}

// ---------- Product Size Grid (lazy-loaded for visible page) ----------

// Standard size columns matching SMS homepage grid (stock_home_grid_lists option_* columns)
const SIZE_COLUMNS = [
  { key: 'XS', optionId: 2701, label: 'XS' },
  { key: 'S', optionId: 1, label: 'S' },
  { key: 'M', optionId: 2, label: 'M' },
  { key: 'L', optionId: 3, label: 'L' },
  { key: 'XL', optionId: 4, label: 'XL' },
  { key: 'XXL', optionId: 5, label: 'XXL' },
  { key: 'XXXL', optionId: 623, label: 'XXXL' },
  { key: '4XL', optionId: 1640, label: '4XL' },
  { key: '5XL', optionId: 1641, label: '5XL' },
  { key: 'XSB', optionId: 509, label: 'XSB' },
  { key: 'SB', optionId: 441, label: 'SB' },
  { key: 'MB', optionId: 442, label: 'MB' },
  { key: 'LB', optionId: 443, label: 'LB' },
  { key: 'XLB', optionId: 444, label: 'XLB' },
];

interface SizeGridRow {
  products_id: number;
  default_option_id: number;
  quantity: number | string;
}

export async function getProductSizeGrid(productIds: number[]) {
  if (productIds.length === 0) return { data: {}, columns: SIZE_COLUMNS.map(c => c.label) };

  logger.info({ count: productIds.length }, 'Fetching size grid for products');

  const placeholders = productIds.map(() => '?').join(',');

  // Map manufacturer sizes to default sizes (deduplicated), then sum quantities per default option
  const rows = await prisma.$queryRawUnsafe<SizeGridRow[]>(`
    SELECT
      np.products_id,
      msd_dedup.default_options_values_id AS default_option_id,
      SUM(pq.quantity) AS quantity
    FROM product_quantities pq
    INNER JOIN product_lists pl ON pq.product_lists_id = pl.product_lists_id
    INNER JOIN new_products np ON np.products_model = pl.product_code
    INNER JOIN (
      SELECT DISTINCT manufacturers_options_values_id, default_options_values_id
      FROM manufacturers_sizes_to_default_sizes
    ) msd_dedup ON pq.size_id = msd_dedup.manufacturers_options_values_id
    WHERE np.products_id IN (${placeholders})
    GROUP BY np.products_id, msd_dedup.default_options_values_id
  `, ...productIds);

  // Build result: { productsId: { XS: 0, S: 5, M: 10, ... } }
  const result: Record<number, Record<string, number>> = {};
  for (const pid of productIds) {
    result[pid] = {};
    for (const col of SIZE_COLUMNS) {
      result[pid][col.key] = 0;
    }
  }
  for (const row of rows) {
    const col = SIZE_COLUMNS.find(c => c.optionId === toNumber(row.default_option_id));
    if (col && result[row.products_id]) {
      result[row.products_id][col.key] = toNumber(row.quantity);
    }
  }

  return { data: result, columns: SIZE_COLUMNS.map(c => c.label) };
}

// ---------- Product Site Price (fresh fetch for popup) ----------

export async function getProductSitePrice(productsId: number) {
  logger.info({ productsId }, 'Fetching fresh site price');

  const rows = await prisma.$queryRawUnsafe<{ products_price: number | string | null; site_price: number | string | null }[]>(`
    SELECT
      np.products_price,
      (SELECT MAX(npv_onsite_price) FROM new_products_variations WHERE npv_products_id = np.products_id) AS site_price
    FROM new_products np
    WHERE np.products_id = ?
    LIMIT 1
  `, productsId);

  if (rows.length === 0) {
    return { data: { productsPrice: 0, sitePrice: 0, onSale: false } };
  }

  const productsPrice = toNumber(rows[0].products_price);
  const sitePrice = toNumber(rows[0].site_price);

  return {
    data: {
      productsPrice,
      sitePrice: sitePrice > 0 ? sitePrice : productsPrice,
      onSale: sitePrice > 0 && sitePrice < productsPrice,
    },
  };
}

// ---------- Deal Info for Specific Products (lazy-loaded by frontend) ----------

export async function getProductDealInfo(productIds: number[]) {
  if (productIds.length === 0) return { data: {} };

  logger.info({ count: productIds.length }, 'Fetching deal info for products');

  const placeholders = productIds.map(() => '?').join(',');

  const rows = await prisma.$queryRawUnsafe<DealInfoRow[]>(`
    SELECT
      p.products_id,
      CASE
        WHEN dm_active.deal_id IS NOT NULL THEN 'Live'
        WHEN dm_upcoming.deal_id IS NOT NULL THEN 'Upcoming'
        ELSE NULL
      END AS deal_status,
      COALESCE(deal_rev.revenue, 0) AS deal_revenue,
      COALESCE(deal_rev.units_sold, 0) AS deal_units_sold
    FROM products p
    LEFT JOIN deals_management dm_active
      ON dm_active.deal_target_type = 'PRODUCT'
      AND dm_active.target_id = p.products_id
      AND dm_active.deal_type = 'DAILY'
      AND dm_active.is_active = 1
      AND CURDATE() BETWEEN dm_active.start_date AND dm_active.end_date
    LEFT JOIN deals_management dm_upcoming
      ON dm_upcoming.deal_target_type = 'PRODUCT'
      AND dm_upcoming.target_id = p.products_id
      AND dm_upcoming.deal_type = 'DAILY'
      AND dm_upcoming.to_be_active = 1
      AND dm_upcoming.start_date > CURDATE()
      AND dm_active.deal_id IS NULL
    LEFT JOIN (
      SELECT
        op.products_id,
        SUM(op.products_quantity * op.final_price) AS revenue,
        SUM(op.products_quantity) AS units_sold
      FROM orders_products op
      INNER JOIN orders o ON op.orders_id = o.orders_id
      INNER JOIN deals_management dm ON op.products_discount_type = dm.deal_id
      WHERE dm.deal_type = 'DAILY'
        AND o.orders_status NOT IN (18, 19, 111, 112)
        AND op.products_id IN (${placeholders})
      GROUP BY op.products_id
    ) deal_rev ON p.products_id = deal_rev.products_id
    WHERE p.products_id IN (${placeholders})
  `, ...productIds, ...productIds);

  // Return as a map: productsId -> { dealStatus, dealRevenue, dealUnitsSold }
  const result: Record<number, { dealStatus: string | null; dealRevenue: number; dealUnitsSold: number }> = {};
  for (const row of rows) {
    result[row.products_id] = {
      dealStatus: row.deal_status,
      dealRevenue: toNumber(row.deal_revenue),
      dealUnitsSold: toNumber(row.deal_units_sold),
    };
  }

  return { data: result };
}

// ---------- Schedule (7-day grid data) ----------

export async function getSchedule(params: ScheduleQueryInput) {
  const { startDate, endDate } = params;

  logger.info({ startDate, endDate }, 'Fetching schedule');

  const rows = await prisma.$queryRawUnsafe<ScheduledDealRow[]>(`
    SELECT dm.deal_id, dm.target_id AS products_id, pl.product_code,
           pd.products_name AS product_name,
           dm.discount_type, dm.discount_value,
           dm.start_date, dm.end_date,
           dm.is_active, dm.to_be_active,
           np_price.products_price AS current_price,
           np_price.size_type,
           np_price.np_gender
    FROM deals_management dm
    INNER JOIN new_products np_price ON dm.target_id = np_price.products_id
    INNER JOIN products p ON dm.target_id = p.products_id
    INNER JOIN products_description pd ON p.products_id = pd.products_id AND pd.language_id = 1
    INNER JOIN product_lists pl ON p.products_model = pl.product_code
    WHERE dm.deal_type = 'DAILY'
      AND dm.deal_target_type = 'PRODUCT'
      AND (dm.is_active = 1 OR dm.to_be_active = 1)
      AND dm.start_date <= ?
      AND dm.end_date >= ?
    ORDER BY dm.start_date ASC, dm.deal_id ASC
  `, endDate, startDate);

  const grouped: Record<string, Array<{
    dealId: number; productsId: number; productCode: string; productName: string;
    discountType: string; discountValue: number; currentPrice: number;
    startDate: string; endDate: string; isActive: number; toBeActive: number;
    sizeType: string | null; npGender: string | null;
  }>> = {};

  for (const row of rows) {
    const dealStart = formatDate(row.start_date);
    const dealEnd = formatDate(row.end_date);
    const rangeStart = startDate > dealStart ? startDate : dealStart;
    const rangeEnd = endDate < dealEnd ? endDate : dealEnd;

    const d = new Date(rangeStart + 'T00:00:00');
    const end = new Date(rangeEnd + 'T00:00:00');
    while (d <= end) {
      const dateKey = d.toISOString().split('T')[0];
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push({
        dealId: row.deal_id, productsId: row.products_id,
        productCode: row.product_code, productName: (row as any).product_name,
        discountType: row.discount_type, discountValue: toNumber(row.discount_value),
        currentPrice: toNumber(row.current_price),
        startDate: dealStart, endDate: dealEnd,
        sizeType: (row as any).size_type || null, npGender: (row as any).np_gender || null,
        isActive: row.is_active, toBeActive: row.to_be_active,
      });
      d.setDate(d.getDate() + 1);
    }
  }

  return { data: grouped };
}

// ---------- Save Deal ----------

export async function saveDeal(input: SaveDealInput) {
  const { productsId, productCode, discountType, discountValue, dealDate } = input;
  logger.info({ productsId, discountType, discountValue, dealDate }, 'Saving deal');

  const today = todayStr();
  if (dealDate < today) {
    throw new ApiError(400, 'BAD_REQUEST', 'Cannot schedule deals in the past');
  }

  const priceRows = await prisma.$queryRawUnsafe<PriceRow[]>(
    `SELECT products_price FROM new_products WHERE products_id = ? LIMIT 1`,
    productsId,
  );
  const currentPrice = toNumber(priceRows[0]?.products_price);
  if (currentPrice <= 0) {
    throw new ApiError(400, 'BAD_REQUEST', 'Could not determine product price');
  }

  const discountedPrice = discountType === 'PERCENT'
    ? currentPrice - (currentPrice * discountValue / 100)
    : currentPrice - discountValue;

  if (discountedPrice <= 0) {
    throw new ApiError(400, 'BAD_REQUEST', `Discount too large — resulting price would be £${discountedPrice.toFixed(2)}`);
  }
  if (discountedPrice >= currentPrice) {
    throw new ApiError(400, 'BAD_REQUEST', `Discounted price must be less than current price (£${currentPrice.toFixed(2)})`);
  }

  // Check duplicate: same product on same day
  const dupeRows = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT COUNT(*) AS total FROM deals_management
    WHERE deal_type = 'DAILY' AND deal_target_type = 'PRODUCT'
      AND target_id = ?
      AND start_date <= ? AND end_date >= ?
      AND (is_active = 1 OR to_be_active = 1)
  `, productsId, dealDate, dealDate);
  if (toNumber(dupeRows[0]?.total) > 0) {
    throw new ConflictError('This product already has a daily deal for this date');
  }

  // Check max 10 deals per day
  const countRows = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT COUNT(*) AS total FROM deals_management
    WHERE deal_type = 'DAILY' AND deal_target_type = 'PRODUCT'
      AND start_date <= ? AND end_date >= ?
      AND (is_active = 1 OR to_be_active = 1)
  `, dealDate, dealDate);
  if (toNumber(countRows[0]?.total) >= 10) {
    throw new ApiError(400, 'BAD_REQUEST', 'Maximum 10 daily deals per day');
  }

  const isToday = dealDate === today;
  const dealStatus = isToday ? 'CURRENT' : 'FUTURE';
  await prisma.$queryRawUnsafe(`
    INSERT INTO deals_management
      (deal_type, deal_target_type, target_id, discount_type, discount_value,
       start_date, end_date, is_active, to_be_active, deal_status, created_at, updated_at)
    VALUES ('DAILY', 'PRODUCT', ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
  `, productsId, discountType, discountValue, dealDate, dealDate,
     isToday ? 1 : 0, isToday ? 0 : 1, dealStatus);

  // Fetch the created deal by insert params (reliable with connection pooling)
  const created = await prisma.$queryRawUnsafe<DealRow[]>(`
    SELECT deal_id, deal_type, deal_target_type, target_id,
           discount_type, discount_value, start_date, end_date, is_active, to_be_active
    FROM deals_management
    WHERE deal_type = 'DAILY' AND deal_target_type = 'PRODUCT'
      AND target_id = ? AND start_date = ? AND end_date = ?
      AND discount_type = ? AND discount_value = ?
    ORDER BY deal_id DESC
    LIMIT 1
  `, productsId, dealDate, dealDate, discountType, discountValue);

  const row = created[0];
  return {
    data: {
      dealId: row.deal_id, productsId: row.target_id, productCode,
      discountType: row.discount_type, discountValue: toNumber(row.discount_value),
      startDate: formatDate(row.start_date), endDate: formatDate(row.end_date),
      isActive: row.is_active, toBeActive: row.to_be_active,
    },
  };
}

// ---------- Delete Deal ----------

export async function deleteDeal(dealId: number) {
  logger.info({ dealId }, 'Deleting deal');

  const rows = await prisma.$queryRawUnsafe<DealRow[]>(`
    SELECT deal_id, deal_type, target_id, start_date, end_date, is_active, to_be_active
    FROM deals_management WHERE deal_id = ? AND deal_type = 'DAILY' LIMIT 1
  `, dealId);

  if (rows.length === 0) {
    throw new NotFoundError('Deal');
  }

  const deal = rows[0];
  if (formatDate(deal.start_date) < todayStr()) {
    throw new ApiError(400, 'BAD_REQUEST', 'Cannot remove past deals');
  }

  await prisma.$queryRawUnsafe(`
    UPDATE deals_management SET is_active = 0, to_be_active = 0, deal_status = 'REMOVED', updated_at = NOW() WHERE deal_id = ? AND deal_type = 'DAILY'
  `, dealId);

  const categoryId = config.DAILY_DEAL_CATEGORY_ID;
  if (categoryId) {
    await prisma.$queryRawUnsafe(`
      DELETE FROM products_to_categories WHERE products_id = ? AND categories_id = ?
    `, deal.target_id, categoryId);
  }

  return { data: { dealId, status: 'removed' } };
}

// ---------- Summary ----------

export async function getSummary(params: SummaryInput) {
  const endDate = params.endDate || null;
  const startDate = params.startDate || null;

  logger.info({ startDate, endDate }, 'Fetching daily deals summary');

  let revenueSql = `
    SELECT
      COALESCE(SUM(op.products_quantity * op.final_price), 0) AS total_revenue,
      COALESCE(SUM(op.products_quantity), 0) AS total_units_sold,
      COUNT(DISTINCT dm.deal_id) AS total_deals_run
    FROM deals_management dm
    INNER JOIN orders_products op ON op.products_discount_type = dm.deal_id
    INNER JOIN orders o ON op.orders_id = o.orders_id
    WHERE dm.deal_type = 'DAILY'
      AND o.orders_status NOT IN (18, 19, 111, 112)
  `;
  const revenueParams: string[] = [];
  if (startDate) { revenueSql += ' AND dm.start_date >= ?'; revenueParams.push(startDate); }
  if (endDate) { revenueSql += ' AND dm.start_date <= ?'; revenueParams.push(endDate); }

  const revenueRows = await prisma.$queryRawUnsafe<RevenueRow[]>(revenueSql, ...revenueParams);

  const activeRows = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT COUNT(*) AS total FROM deals_management
    WHERE deal_type = 'DAILY' AND is_active = 1
      AND start_date <= CURDATE() AND end_date >= CURDATE()
  `);

  const upcomingRows = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT COUNT(*) AS total FROM deals_management
    WHERE deal_type = 'DAILY' AND to_be_active = 1 AND start_date > CURDATE()
  `);

  const rev = revenueRows[0];
  return {
    data: {
      totalRevenue: Math.round(toNumber(rev?.total_revenue) * 100) / 100,
      totalUnitsSold: toNumber(rev?.total_units_sold),
      totalDealsRun: toNumber(rev?.total_deals_run),
      todayActiveCount: toNumber(activeRows[0]?.total),
      upcomingCount: toNumber(upcomingRows[0]?.total),
    },
  };
}

// ---------- Banner Config ----------

interface BannerRow {
  seo_title: string | null;
  categories_banner: string | null;
}

export async function getBannerConfig() {
  const categoryId = config.DAILY_DEAL_CATEGORY_ID;
  if (!categoryId) throw new ApiError(500, 'CONFIG_ERROR', 'DAILY_DEAL_CATEGORY_ID not configured');

  const rows = await prisma.$queryRawUnsafe<BannerRow[]>(`
    SELECT cd.seo_title, c.categories_banner
    FROM categories c
    JOIN categories_description cd ON cd.categories_id = c.categories_id AND cd.language_id = 1
    WHERE c.categories_id = ?
    LIMIT 1
  `, categoryId);

  const row = rows[0];
  const cdnUrl = config.DAILY_DEALS_BANNER_URL || '';
  const imageFilename = row?.categories_banner || '';

  return {
    data: {
      title: row?.seo_title || '',
      imageFilename,
      imageUrl: imageFilename && cdnUrl ? `${cdnUrl}/${imageFilename}` : '',
    },
  };
}

export async function saveBannerConfig(
  input: BannerConfigInput,
  imageBuffer?: Buffer,
  imageFilename?: string,
) {
  const categoryId = config.DAILY_DEAL_CATEGORY_ID;
  if (!categoryId) throw new ApiError(500, 'CONFIG_ERROR', 'DAILY_DEAL_CATEGORY_ID not configured');

  // Update title
  await prisma.$queryRawUnsafe(`
    UPDATE categories_description SET seo_title = ? WHERE categories_id = ? AND language_id = 1
  `, input.title, categoryId);

  logger.info({ categoryId, title: input.title }, 'Updated banner title');

  // Update image if provided
  if (imageBuffer && imageFilename) {
    const sharp = (await import('sharp')).default;
    const fs = await import('fs/promises');
    const path = await import('path');

    // Validate dimensions
    const metadata = await sharp(imageBuffer).metadata();
    if (metadata.width !== 275 || metadata.height !== 275) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Image must be exactly 275x275 pixels (got ${metadata.width}x${metadata.height})`);
    }

    // Validate file size
    if (imageBuffer.length > 512000) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Image file size must be under 500KB');
    }

    // Validate filename length
    if (imageFilename.length > 64) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Image filename must be under 64 characters');
    }

    const imagesPath = config.DAILY_DEALS_BANNER_PATH;
    if (!imagesPath) throw new ApiError(500, 'CONFIG_ERROR', 'DAILY_DEALS_BANNER_PATH not configured');

    const destPath = path.join(imagesPath, imageFilename);
    await fs.writeFile(destPath, imageBuffer);

    // Update DB
    await prisma.$queryRawUnsafe(`
      UPDATE categories SET categories_banner = ? WHERE categories_id = ?
    `, imageFilename, categoryId);

    logger.info({ categoryId, imageFilename }, 'Updated banner image');
  }

  return { data: { success: true } };
}

// ---------- Special Price (mirrors SMS save_specials flow) ----------

interface SpecialRow {
  specials_id: number;
  products_id: number;
  specials_new_products_price: number | string;
  specials_date_available: string;
  expires_date: string;
  status: number;
}

interface ProductModelRow {
  products_model: string;
  products_price: number | string;
}

interface ProductListIdRow {
  product_lists_id: number;
}

export async function getSpecialPriceInfo(productsId: number) {
  logger.info({ productsId }, 'Fetching special price info');

  const rows = await prisma.$queryRawUnsafe<(SpecialRow & { products_price: number | string })[]>(`
    SELECT s.specials_id, s.products_id, s.specials_new_products_price,
           s.specials_date_available, s.expires_date, s.status,
           np.products_price
    FROM new_products np
    LEFT JOIN specials s ON s.products_id = np.products_id AND s.status = 1
    WHERE np.products_id = ?
    LIMIT 1
  `, productsId);

  if (rows.length === 0) {
    return { data: { productsId, currentPrice: 0, hasSpecial: false } };
  }

  const row = rows[0];
  return {
    data: {
      productsId,
      currentPrice: toNumber(row.products_price),
      hasSpecial: !!row.specials_id,
      specialPrice: row.specials_id ? toNumber(row.specials_new_products_price) : null,
      startDate: row.specials_id ? formatDate(row.specials_date_available) : null,
      endDate: row.specials_id ? formatDate(row.expires_date) : null,
    },
  };
}

export async function setSpecialPrice(input: SetSpecialPriceInput) {
  const { productsId, specialPrice, startDate, endDate } = input;
  const expiresDate = endDate || '0001-01-01';

  logger.info({ productsId, specialPrice, startDate, expiresDate }, 'Setting special price');

  // Validate product exists and get current price
  const productRows = await prisma.$queryRawUnsafe<ProductModelRow[]>(
    `SELECT products_model, products_price FROM products WHERE products_id = ? LIMIT 1`,
    productsId,
  );
  if (productRows.length === 0) {
    throw new NotFoundError('Product');
  }
  const currentPrice = toNumber(productRows[0].products_price);
  const productsModel = productRows[0].products_model;

  if (specialPrice >= currentPrice) {
    throw new ApiError(400, 'BAD_REQUEST', `Special price must be less than current price (£${currentPrice.toFixed(2)})`);
  }

  // Check if special record already exists (any status)
  const existingRows = await prisma.$queryRawUnsafe<SpecialRow[]>(
    `SELECT specials_id FROM specials WHERE products_id = ? LIMIT 1`,
    productsId,
  );

  if (existingRows.length > 0) {
    await prisma.$queryRawUnsafe(`
      UPDATE specials SET
        specials_new_products_price = ?,
        specials_last_modified = NOW(),
        expires_date = ?,
        date_status_change = NOW(),
        status = 1,
        specials_date_available = ?
      WHERE specials_id = ?
    `, specialPrice, expiresDate, startDate, existingRows[0].specials_id);
  } else {
    await prisma.$queryRawUnsafe(`
      INSERT INTO specials (products_id, specials_new_products_price,
        specials_date_added, specials_last_modified, expires_date,
        date_status_change, status, specials_date_available)
      VALUES (?, ?, NOW(), NOW(), ?, NOW(), 1, ?)
    `, productsId, specialPrice, expiresDate, startDate);
  }

  // Sync products.products_price_sorter (mirrors product_quantities_controller line 2152)
  await prisma.$queryRawUnsafe(`
    UPDATE products SET products_price_sorter = ? WHERE products_id = ?
  `, specialPrice, productsId);

  // Sync product_lists
  await prisma.$queryRawUnsafe(`
    UPDATE product_lists SET special = 1, special_start_date = ?, special_end_date = ?
    WHERE product_code = ?
  `, startDate, expiresDate, productsModel);

  // Sync stock_home_grid_lists
  const plRows = await prisma.$queryRawUnsafe<ProductListIdRow[]>(
    `SELECT product_lists_id FROM product_lists WHERE product_code = ? LIMIT 1`,
    productsModel,
  );
  if (plRows.length > 0) {
    await prisma.$queryRawUnsafe(`
      UPDATE stock_home_grid_lists SET special = 1, special_start_date = ?, special_price = ?, special_expiry_date = ?
      WHERE product_lists_id = ?
    `, startDate, specialPrice, expiresDate, plRows[0].product_lists_id);
  }

  logger.info({ productsId, specialPrice }, 'Special price set successfully');
  return { data: { productsId, specialPrice, startDate, endDate: expiresDate, status: 'set' } };
}

export async function removeSpecialPrice(productsId: number) {
  logger.info({ productsId }, 'Removing special price');

  // Get product model and original price for syncing related tables
  const productRows = await prisma.$queryRawUnsafe<ProductModelRow[]>(
    `SELECT products_model, products_price FROM products WHERE products_id = ? LIMIT 1`,
    productsId,
  );
  if (productRows.length === 0) {
    throw new NotFoundError('Product');
  }
  const productsModel = productRows[0].products_model;
  const originalPrice = toNumber(productRows[0].products_price);

  // Delete from specials (mirrors SMS: $this->Special->delete())
  await prisma.$queryRawUnsafe(
    `DELETE FROM specials WHERE products_id = ?`,
    productsId,
  );

  // Reset products.products_price_sorter to original price
  await prisma.$queryRawUnsafe(`
    UPDATE products SET products_price_sorter = ? WHERE products_id = ?
  `, originalPrice, productsId);

  // Reset product_lists
  await prisma.$queryRawUnsafe(`
    UPDATE product_lists SET special = 0, special_start_date = '0000-00-00', special_end_date = '0000-00-00'
    WHERE product_code = ?
  `, productsModel);

  // Reset stock_home_grid_lists
  const plRows = await prisma.$queryRawUnsafe<ProductListIdRow[]>(
    `SELECT product_lists_id FROM product_lists WHERE product_code = ? LIMIT 1`,
    productsModel,
  );
  if (plRows.length > 0) {
    await prisma.$queryRawUnsafe(`
      UPDATE stock_home_grid_lists SET special = 0, special_price = NULL, special_start_date = '0000-00-00', special_expiry_date = '0000-00-00'
      WHERE product_lists_id = ?
    `, plRows[0].product_lists_id);
  }

  logger.info({ productsId }, 'Special price removed successfully');
  return { data: { productsId, status: 'removed' } };
}

// ---------- Ignore / Unignore ----------

export async function ignoreProduct(productsId: number) {
  logger.info({ productsId }, 'Ignoring product from daily deals');

  await prisma.$queryRawUnsafe(
    `UPDATE new_products SET daily_deals_ignored = 1 WHERE products_id = ?`,
    productsId,
  );

  return { data: { productsId, status: 'ignored' } };
}

export async function unignoreProduct(productsId: number) {
  logger.info({ productsId }, 'Unignoring product from daily deals');

  await prisma.$queryRawUnsafe(
    `UPDATE new_products SET daily_deals_ignored = 0 WHERE products_id = ?`,
    productsId,
  );

  return { data: { productsId, status: 'unignored' } };
}
