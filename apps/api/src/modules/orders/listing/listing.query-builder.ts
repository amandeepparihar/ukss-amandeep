/**
 * Orders listing query builder — priority-based SQL assembly.
 * Requirements: REQ-02-021 (query assembly), REQ-02-022 (post-query mods),
 *   REQ-02-006-015 (filters)
 */

import type { OrderListQuery } from '../orders.schema';
import { FC_BOX_NUMBER, FRUUGO_ORDER_ID_STRING, START_FROM_WHICH_ORDER } from '../orders.constants';

// ---------------------------------------------------------------------------
// REQ-02-013: Marketplace column mapping
// ---------------------------------------------------------------------------

const MARKETPLACE_COLUMN_MAP: Record<string, { column: string; siteFilter?: number }> = {
  amazon: { column: 'amazon_orders_id' },
  tesco: { column: 'tesco_customer_order_id' },
  mplaza: { column: 'mplaza_orders_id' },
  fruugo: { column: 'fruugo_orders_id' },
  rakuten: { column: 'rakuten_order_id' },
  lazada: { column: 'lazada_order_id' },
  priceminister: { column: 'priceminister_order_id' },
  gosport: { column: 'gosport_order_id' },
  catch: { column: 'catch_order_id' },
  ebay: { column: 'ebay_orders_id' },
  terracegear: { column: 'multisite_shopify_order_id', siteFilter: 117 },
  racecrate: { column: 'multisite_shopify_order_id', siteFilter: 118 },
  decathlon: { column: 'decathlon_order_id' },
};

// ---------------------------------------------------------------------------
// REQ-02-014: General search fields
// ---------------------------------------------------------------------------

const GENERAL_SEARCH_FIELDS = [
  'customers_city', 'customers_postcode', 'date_purchased',
  'billing_name', 'billing_company', 'billing_street_address',
  'delivery_city', 'delivery_postcode', 'delivery_name',
  'delivery_company', 'delivery_street_address', 'billing_city',
  'billing_postcode', 'customers_email_address', 'customers_name',
  'customers_company', 'customers_street_address', 'customers_telephone',
  'ip_address',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryParts {
  selectClause: string;
  fromClause: string;
  whereConditions: string[];
  orderByClause: string;
  params: unknown[];
  /** Parameters for correlated subqueries in the SELECT clause (positioned before WHERE params). */
  selectParams: unknown[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * REQ-02-021: Build query parts from listing parameters.
 * Priority-based query assembly — first matching branch determines base query.
 */
export function buildQueryParts(query: OrderListQuery): QueryParts {
  const params: unknown[] = [];
  const whereConditions: string[] = [];
  let fromClause = 'FROM orders o INNER JOIN orders_status os ON o.orders_status = os.orders_status_id';
  let orderByClause = 'ORDER BY o.orders_id DESC';
  let needsProductJoin = false;

  whereConditions.push("o.order_total IS NOT NULL");
  whereConditions.push("os.language_id = 1");
  whereConditions.push('o.orders_id >= ?');
  params.push(START_FROM_WHICH_ORDER);

  // Priority-based query assembly (REQ-02-021)
  if (query.customerId) {
    whereConditions.push('o.customers_id = ?');
    params.push(query.customerId);
  } else if (query.status === 200) {
    fromClause += ' INNER JOIN orders_status_history osh ON o.orders_id = osh.orders_id';
    whereConditions.push("osh.orders_status_id = 16");
    whereConditions.push("osh.date_added >= CURDATE()");
    whereConditions.push("osh.date_added < DATE_FORMAT(CURDATE(), '%Y-%m-%d 15:00:00')");
    whereConditions.push("o.orders_status = 16");
  } else if (query.status === 14 && query.sortBy === 'statusChanged') {
    fromClause += ' INNER JOIN orders_status_history osh14 ON (osh14.orders_id = o.orders_id AND osh14.orders_status_id = 14)';
    whereConditions.push('o.orders_status = 14');
    orderByClause = 'ORDER BY osh14.date_added DESC';
  } else if (query.status === 14 && query.scanningStatus) {
    whereConditions.push('o.orders_status = 14');
    if (query.scanningStatus === 'scanned') {
      whereConditions.push("o.scanned = 'yes'");
    } else if (query.scanningStatus === 'non-scanned') {
      whereConditions.push("(o.scanned = 'no' OR o.scanned IS NULL)");
    } else if (query.scanningStatus === 'amazon-premium') {
      // PHP orders_listing.php lines 723-736: amazon_orders_id != '' + NextDay + exclude statuses 5/112
      whereConditions.push("o.amazon_orders_id != ''");
      whereConditions.push("o.shipping_method = 'NextDay'");
      whereConditions.push("os.orders_status_id NOT IN ('5', '112')");
    }
  } else if (query.status === 101) {
    whereConditions.push("o.fc_order_id IS NOT NULL");
    whereConditions.push("o.fc_order_status = 'DESPATCHED'");
    whereConditions.push("o.orders_status != 5");
  } else if (query.status === 102) {
    whereConditions.push("o.fc_order_id IS NOT NULL");
    whereConditions.push("o.fc_order_status != 'DESPATCHED'");
  } else if (query.status === 1224) {
    whereConditions.push("o.refund_review_status = 1");
  } else if (query.status === 1225) {
    // PHP: SELECT DISTINCT(dr_orders_id) FROM delivery_review, then IN(...)
    // Using EXISTS for better performance (no index on dr_orders_id)
    whereConditions.push("EXISTS (SELECT 1 FROM delivery_review dr WHERE dr.dr_orders_id = o.orders_id)");
  } else if (query.toffsCode) {
    needsProductJoin = true;
    // PHP: LEFT JOIN orders_products → LEFT JOIN products on products_id, filter p.toffs
    fromClause += ' LEFT JOIN products p_toffs ON op.products_id = p_toffs.products_id';
    whereConditions.push('p_toffs.toffs = ?');
    params.push(query.toffsCode);
  } else if (query.fsBarcode) {
    needsProductJoin = true;
    // PHP: LEFT JOIN orders_products → LEFT JOIN products on products_id, filter p.football_souvenir_barcode
    fromClause += ' LEFT JOIN products p_fsb ON op.products_id = p_fsb.products_id';
    whereConditions.push('p_fsb.football_souvenir_barcode = ?');
    params.push(query.fsBarcode);
  } else if (query.marketplace && query.marketplaceSearchValue) {
    const mapping = MARKETPLACE_COLUMN_MAP[query.marketplace];
    if (mapping) {
      // Fruugo: newer orders (post-March-2023) have fruugo_orders_id = NULL in the orders
      // table — their order ID is only in mo_marketplace_orders.mo_order_id. Search both
      // sources to match PHP behavior (orders.php:3201-3231).
      if (query.marketplace === 'fruugo') {
        // PHP (orders.php:3201-3231) appends FRUUGO_ORDER_ID_STRING to the search value before
        // querying, unless the value already ends with the suffix. Fruugo order IDs are stored
        // with the suffix (e.g. '12345001004571'), so a short user input like '12345' would
        // otherwise fail to match.
        const rawValue = query.marketplaceSearchValue;
        const fruugoSearchValue = rawValue.endsWith(FRUUGO_ORDER_ID_STRING)
          ? rawValue
          : rawValue + FRUUGO_ORDER_ID_STRING;
        whereConditions.push(
          `(o.${mapping.column} = ? OR EXISTS (SELECT 1 FROM mo_marketplace_orders mo WHERE mo.mo_ukss_order_id = o.orders_id AND mo.mo_order_id = ?))`
        );
        params.push(fruugoSearchValue, fruugoSearchValue);
      } else {
        whereConditions.push(`o.${mapping.column} = ?`);
        params.push(query.marketplaceSearchValue);
      }
      if (mapping.siteFilter) {
        whereConditions.push(`o.order_site = ?`);
        params.push(mapping.siteFilter);
      }
    }
  } else if (query.productSearch) {
    needsProductJoin = true;
    if (query.productSearch.startsWith('ID:')) {
      const productId = parseInt(query.productSearch.substring(3).trim(), 10);
      if (!isNaN(productId)) {
        whereConditions.push('op.products_id = ?');
        params.push(productId);
      }
    } else {
      // PHP: model uses CONTAINS (%term%), name uses STARTS-WITH (term%) matching orders.php behavior
      whereConditions.push('(op.products_model LIKE ? OR op.products_name LIKE ?)');
      const modelTerm = `%${query.productSearch}%`;
      const nameTerm = `${query.productSearch}%`;
      params.push(modelTerm, nameTerm);
    }
  } else if (query.popupProductId || query.popupCategoryId) {
    needsProductJoin = true;
    if (query.popupProductId) {
      whereConditions.push('op.products_id = ?');
      params.push(query.popupProductId);
    }
    if (query.popupCategoryId) {
      // ptc JOIN is deferred — added AFTER the orders_products (op) join below,
      // because its ON clause references op.products_id (C1 fix)
      whereConditions.push('ptc.categories_id = ?');
      params.push(query.popupCategoryId);
    }
  } else {
    if (query.status && query.status > 0) {
      whereConditions.push('o.orders_status = ?');
      params.push(query.status);
    }
  }

  // Cross-branch filters
  appendSellerFilter(query, whereConditions, params);
  appendSupplierFilter(query, whereConditions, params);
  appendGeneralSearch(query, whereConditions, params);

  if (needsProductJoin) {
    fromClause += ' LEFT JOIN orders_products op ON o.orders_id = op.orders_id';
  }

  // ptc join must come AFTER the orders_products (op) join — its ON clause references op (C1 fix)
  if (query.popupCategoryId) {
    fromClause += ' INNER JOIN products_to_categories ptc ON op.products_id = ptc.products_id';
  }

  // I-1/I-2 fix: Size filter needs product join first, then attributes join
  // #236: sizeFilter is now a coerced number (products_options_values_id), not a string
  if (query.sizeFilter && needsProductJoin) {
    fromClause += ' LEFT JOIN orders_products_attributes opa2 ON op.orders_products_id = opa2.orders_products_id';
    whereConditions.push("opa2.products_options_values_id = ?");
    params.push(query.sizeFilter);
  }

  // Post-query modifications (REQ-02-022)
  // Skip interval filter for marketplace order ID searches (PHP does direct lookup without date
  // filtering — orders.php:3201-3231) and toBeRefund tab (refund orders show regardless of date)
  const isMarketplaceSearch = query.marketplace && query.marketplaceSearchValue;
  if (!isMarketplaceSearch && query.tab !== 'toBeRefund') {
    appendIntervalFilter(query, whereConditions, params);
  }
  appendOrderTypeFilter(query, whereConditions);
  appendTabFilter(query, whereConditions, params);

  // StatusChanged sort needs orders_status_history JOIN (unless a priority branch already handled it)
  // PHP: LEFT JOIN orders_status_history osh ON (o.orders_id = osh.orders_id AND o.orders_status = osh.orders_status_id)
  //      + SELECT MAX(osh.orders_status_history_id) AS osh_orders_status_history_id
  //      + GROUP BY o.orders_id
  //      + ORDER BY osh_orders_status_history_id ASC
  // (orders_listing.php:759-772, 1069-1073)
  const needsStatusChangedSort = query.sortBy === 'statusChanged' && !fromClause.includes('orders_status_history');
  if (needsStatusChangedSort) {
    fromClause += ' LEFT JOIN orders_status_history osh ON (o.orders_id = osh.orders_id AND o.orders_status = osh.orders_status_id)';
  }

  orderByClause = resolveOrderBy(query, orderByClause);

  if (whereConditions.length === 0) {
    whereConditions.push('1 = 1');
  }

  const { clause: selectClause, params: selectParams } = buildSelectClause(needsStatusChangedSort);
  return { selectClause, fromClause, whereConditions, orderByClause, params, selectParams };
}

/**
 * Build base query parts (excluding tab) for tab count queries.
 * Returns the full parts to avoid calling buildQueryParts twice (I-7 fix).
 */
export function buildBaseQueryParts(query: OrderListQuery): QueryParts {
  return buildQueryParts({ ...query, tab: undefined });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// PHP seller-name mappings (orders_listing.php:578-591)
// The dropdown value (store_url) doesn't always match the orders_from column value
const SELLER_NAME_MAP: Record<string, string> = {
  'rakuten.co.uk': 'Rakuten',
  'lazada.com.my': 'Lazada MY',
  'fruugo.com': 'Fruugo',
  'catch': 'https://www.catch.com.au/',
};

function appendSellerFilter(
  query: OrderListQuery, where: string[], params: unknown[]
): void {
  if (!query.seller) return;

  // PHP: amazonukprime => is_prime_order = 'true' + orders_from = 'Amazon.co.uk' (orders_listing.php:612-615)
  if (query.seller === 'amazonukprime') {
    where.push("o.is_prime_order = 'true'");
    where.push("o.orders_from = 'Amazon.co.uk'");
    return;
  }

  // Apply seller-name mapping, then filter by orders_from (orders_listing.php:651-653)
  const mappedSeller = SELLER_NAME_MAP[query.seller] ?? query.seller;
  where.push('o.orders_from = ?');
  params.push(mappedSeller);
}

function appendSupplierFilter(
  query: OrderListQuery, where: string[], params: unknown[]
): void {
  if (!query.supplier) return;
  where.push("(o.suppliers LIKE ? OR o.suppliers LIKE ? OR o.suppliers LIKE ? OR o.suppliers = ?)");
  params.push(
    `${query.supplier};%`, `%;${query.supplier};%`,
    `%;${query.supplier}`, query.supplier
  );
}

function appendGeneralSearch(
  query: OrderListQuery, where: string[], params: unknown[]
): void {
  if (!query.search) return;
  const clauses = GENERAL_SEARCH_FIELDS.map((f) => `o.${f} LIKE ?`);
  where.push(`(${clauses.join(' OR ')})`);
  const term = `%${query.search}%`;
  for (let i = 0; i < GENERAL_SEARCH_FIELDS.length; i++) {
    params.push(term);
  }
}

function appendIntervalFilter(query: OrderListQuery, where: string[], params: unknown[]): void {
  const months = query.interval ?? 3;
  where.push('o.date_purchased > NOW() - INTERVAL ? MONTH');
  params.push(months);
}

function appendOrderTypeFilter(query: OrderListQuery, where: string[]): void {
  if (query.orderType === 'wholesale') {
    where.push("o.order_type != 'Online'");
  } else if (query.orderType === 'online') {
    where.push("o.order_type = 'Online'");
  }
}

function appendTabFilter(
  query: OrderListQuery, where: string[], params: unknown[]
): void {
  if (!query.tab) return;
  const today = formatDateOnly(new Date());
  const tomorrow = formatDateOnly(addDays(new Date(), 1));
  const twoDays = formatDateOnly(addDays(new Date(), 2));

  switch (query.tab) {
    case 'today':
      where.push('DATE(o.ship_by_date) = ?'); params.push(today); break;
    case 'tomorrow':
      where.push('DATE(o.ship_by_date) = ?'); params.push(tomorrow); break;
    case 'twoDays':
      where.push('DATE(o.ship_by_date) = ?'); params.push(twoDays); break;
    case 'afterTwoDays':
      where.push('DATE(o.ship_by_date) > ?'); params.push(twoDays); break;
    case 'toBeRefund':
      where.push("o.refund_status_for_reject_orders = '1'"); break;
  }
}

function resolveOrderBy(query: OrderListQuery, defaultClause: string): string {
  // Only apply general statusChanged sort if a priority branch didn't already set a custom ORDER BY.
  // Uses the osh_max_history_id alias from the SELECT clause (matching PHP orders_listing.php:1069-1073)
  // rather than putting MAX() directly in ORDER BY, which is more portable and matches PHP exactly.
  if (query.sortBy === 'statusChanged' && defaultClause === 'ORDER BY o.orders_id DESC') {
    return 'ORDER BY osh_max_history_id ASC, o.orders_id DESC';
  }
  if (query.sortBy === 'orderValue') return 'ORDER BY o.order_total DESC';
  if (query.status === 12) {
    if (query.sortBy === 'recent_touchpoint') return 'ORDER BY o.last_added_touchpoint_date DESC, o.orders_id DESC';
    // Default for status=12 (including maximum_touchpoint): sort by most touchpoints DESC
    return 'ORDER BY o.touchpoints DESC, o.orders_id DESC';
  }
  return defaultClause;
}

function buildSelectClause(includeStatusChangedSort: boolean): { clause: string; params: unknown[] } {
  const cols = [
    'o.orders_id', 'o.payment_method', 'o.shipping_module_code',
    'o.customers_name', 'o.billing_name', 'o.billing_company',
    'o.customers_company', 'o.delivery_name', 'o.delivery_company',
    'o.billing_street_address', 'o.delivery_street_address',
    "NULLIF(o.ship_by_date, '0000-00-00 00:00:00') AS ship_by_date", 'o.ship_by_date_status', 'o.order_total',
    'o.currency', 'o.currency_value',
    "NULLIF(o.date_purchased, '0000-00-00 00:00:00') AS date_purchased", 'o.orders_status', 'os.orders_status_name',
    'o.refund_status_for_reject_orders', 'o.bulk_refund_amount',
    'o.order_type', 'o.sift_score', 'o.risk_score', 'o.touchpoints',
    'o.scanned', 'o.order_site', 'o.id_of_original_order',
    'o.is_prime_order', 'o.shipping_method',
    'o.amazon_orders_id', 'o.mplaza_orders_id', 'o.tesco_customer_order_id',
    'o.ebay_orders_id', 'o.rakuten_order_id', 'o.lazada_order_id',
    'o.priceminister_order_id', 'o.gosport_order_id', 'o.catch_order_id',
    'CAST(o.fruugo_orders_id AS CHAR) AS fruugo_orders_id', 'o.decathlon_order_id', 'o.multisite_order_id',
    'o.customers_id', 'o.delivery_country',
    'o.fc_order_status', 'o.fc_auto_creation_bit',
    // C-1 fix: parameterize FC_BOX_NUMBER instead of string interpolation
    '(SELECT COUNT(*) FROM orders_products op_fc WHERE op_fc.orders_id = o.orders_id AND op_fc.box_number = ? AND op_fc.backorder = ?) as has_fc_onbackorder',
    "(SELECT COUNT(*) FROM orders_products op_jit WHERE op_jit.orders_id = o.orders_id AND (op_jit.box_number = 'DELIVERY' OR op_jit.jit_marked = 'yes')) as has_jit_products",
    // PHP: per-row check for products_barcodes — if any product has a barcode, hero_shirt_tshirt_flag=1
    // This prevents Amazon Premium coloring for hero shirt orders (orders_listing.php:1108-1155)
    '(SELECT COUNT(*) FROM orders_products op_hero INNER JOIN products_barcodes pb ON op_hero.products_id = pb.products_id WHERE op_hero.orders_id = o.orders_id LIMIT 1) AS has_hero_shirt_products',
  ];
  // PHP: SELECT MAX(osh.orders_status_history_id) osh_orders_status_history_id ... ORDER BY osh_orders_status_history_id ASC
  // Adding the aggregate as a named SELECT column (matching PHP orders_listing.php:761) allows the
  // ORDER BY to reference the alias, which is more portable than putting MAX() directly in ORDER BY.
  if (includeStatusChangedSort) {
    cols.push('MAX(osh.orders_status_history_id) AS osh_max_history_id');
  }
  // selectParams are for the correlated subqueries in the SELECT clause —
  // they must be positioned BEFORE the WHERE params in the final query
  return { clause: cols.join(', '), params: [FC_BOX_NUMBER, 'Yes'] };
}

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
