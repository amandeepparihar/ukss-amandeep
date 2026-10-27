/**
 * Deliveries grid SQL assembly.
 *
 * Migration source: IndexController::new_stock at app/controllers/index_controller.php:2352-2832.
 *
 * Differences from legacy, both intentional (spec §15 calls them out):
 *  - sort=3 quirk fixed: the base quantity condition is preserved across every branch
 *    (legacy threw it away when `sort=3` reset $conditions).
 *  - Unmapped products are shown regardless of quantity (mapped still require quantity > 0).
 *  - The per-row N+1 on product_lists for special_end_date / added_product_code_image
 *    (legacy line 2704) is folded into the main JOIN. Other product_lists columns
 *    needed for the row transform (special, special_start_date) are already on
 *    stock_home_grid_lists but legacy uses the product_lists copy for the
 *    "special" computation — we read both and match legacy semantics in the service.
 */

import type { DeliveryListQuery } from './deliveries.schema';

export interface QueryParts {
  selectClause: string;
  fromClause: string;
  whereConditions: string[];
  orderByClause: string;
  groupByClause: string;
  /** Parameters in the order they appear across SELECT → FROM → WHERE. */
  params: unknown[];
}

const SELECT_FIELDS = [
  // Identity
  's.id AS shgl_id',
  's.product_quantities_id',
  's.product_lists_id',
  's.product_list_id',
  's.product_code',
  's.product_name',
  's.boxcode',
  's.team_id',
  's.product_code_type',
  's.special_price as pl_special_price',
  's.FBA_quantity',
  // Display / state
  's.season',
  // Season sort columns — used by order_mode='season' (ORDER BY). Selected to
  // match the other non-aggregated columns this GROUP BY query already returns
  // (the shared DB runs without ONLY_FULL_GROUP_BY enforced).
  's.season_sort',
  's.product_lists_sort',
  's.price',
  's.map',
  's.quantity',
  's.quantity_map',
  's.amazon_low_price',
  's.ebay_product',
  's.percentage_sold',
  's.assign_font',
  's.one_size',
  's.attr',
  // The MySQL DB uses '0000-00-00' as a "never sold" sentinel which the Prisma
  // driver refuses to coerce to JS Date. Cast to string so the service can
  // treat it like the legacy PHP did (string compare).
  "DATE_FORMAT(NULLIF(s.last_sale_date,'0000-00-00'), '%Y-%m-%d') AS last_sale_date",
  's.product_code_image AS shgl_product_code_image',
  // Size columns (spec §6)
  's.option_2701', 's.option_1', 's.option_2', 's.option_3', 's.option_4', 's.option_5',
  's.option_623', 's.option_1640', 's.option_509', 's.option_441', 's.option_442',
  's.option_443', 's.option_444', 's.option_1641',
  // Product list join (folds legacy N+1 from controller line 2704 into the main query)
  'p.front_image_url',
  'p.back_image_url',
  'p.additional_image_url',
  'p.product_code_image AS pl_product_code_image',
  'p.special AS pl_special',
  // Same zero-date handling as last_sale_date above. We keep '0001-01-01'
  // (legacy open-ended sentinel) so isSpecialActive can still detect it.
  "DATE_FORMAT(NULLIF(p.special_start_date,'0000-00-00'), '%Y-%m-%d') AS pl_special_start_date",
  "DATE_FORMAT(NULLIF(p.special_end_date,'0000-00-00'), '%Y-%m-%d') AS pl_special_end_date",
  'p.added_product_code_image',
].join(', ');

const BASE_FROM =
  'FROM stock_home_grid_lists s LEFT JOIN product_lists p ON p.product_lists_id = s.product_lists_id';

/**
 * Local-zone Monday as YYYY-MM-DD — lower bound for the `special` filter
 * ("specials whose window starts this week or later"). Duplicated here rather
 * than imported from stock-home-grid because that module is being phased out
 * (deliveries absorbs it); this is its canonical home going forward.
 */
function getLocalMondayDateString(): string {
  const today = new Date();
  const day = today.getDay();
  const dropDays = day === 0 ? 6 : day - 1;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dropDays);
  return [
    monday.getFullYear(),
    String(monday.getMonth() + 1).padStart(2, '0'),
    String(monday.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Build the SELECT/WHERE/ORDER/GROUP parts for the grid query.
 *
 * @param ukssPriceCodes  Product codes returned by
 *   PreSaveSmsCodeProductData::getProductCodesForWhichUKSSPriceUploaded — the
 *   service fetches this once and passes it in so the query builder stays pure.
 */
export function buildDeliveriesQuery(
  query: DeliveryListQuery,
  ukssPriceCodes: string[]
): QueryParts {
  const where: string[] = [];
  const params: unknown[] = [];

  // removed this condition alltogether to show all the products.
  // Unmapped products are shown regardless of quantity; mapped products require quantity > 0.
  // where.push("(s.quantity > 0 OR s.map != 'Mapped')");

  // Filter By (sort) — spec §4 step 7 / §5.1
  switch (query.sort) {
    case '1':
      // Recently Arrived and Unmapped
      where.push("s.map != 'Mapped'");
      where.push("(p.product_code_image IS NULL OR p.product_code_image = '')");
      break;
    case '2':
      // Products With Images
      where.push("s.map != 'Mapped'");
      where.push("p.product_code_image IS NOT NULL AND p.product_code_image != ''");
      break;
    case '3':
      // Unmapped with Image URL — fix the legacy bug that dropped quantity > 0.
      where.push("(p.product_code_image IS NULL OR p.product_code_image = '')");
      where.push(
        "(IFNULL(p.front_image_url,'') != '' OR IFNULL(p.back_image_url,'') != '' OR IFNULL(p.additional_image_url,'') != '')"
      );
      break;
    default:
      // No "Filter By" — base condition only.
      break;
  }

  // Filter By UKSS Price — spec §5.2. Only honoured for sort ∈ {1,2,3}.
  if (query.sort !== '0' && query.ukss_price_upload_status !== '0') {
    if (ukssPriceCodes.length === 0) {
      // sort=1 with empty list → no rows have an uploaded price. NOT IN with
      // an empty list is invalid SQL, so we short-circuit either way.
      if (query.ukss_price_upload_status === '1') {
        where.push('1 = 0');
      }
      // status=2 ("without UKSS price") with an empty list → no exclusion needed.
    } else {
      const placeholders = ukssPriceCodes.map(() => '?').join(',');
      if (query.ukss_price_upload_status === '1') {
        where.push(`p.product_code IN (${placeholders})`);
      } else {
        where.push(`p.product_code NOT IN (${placeholders})`);
      }
      params.push(...ukssPriceCodes);
    }
  }

  // Team filter — spec §4 step 9 / §5.4
  if (query.team_id > 0) {
    where.push('s.team_id = ?');
    params.push(query.team_id);
  }

  // Country of origin filter — product_lists.country_of_origin_id.
  if (query.country_of_origin_id > 0) {
    where.push('p.country_of_origin_id = ?');
    params.push(query.country_of_origin_id);
  }

  // Product code filter — spec §4 step 10
  if (query.productcode) {
    where.push('p.product_code = ?');
    params.push(query.productcode);
  }

  // Stock-home-grid consolidation filters (additive AND). Each narrows the set
  // independently — mirrors deliveries' existing additive model, NOT the legacy
  // stock-home exclusive if/else-if chain. That chain existed only to pick a
  // default in-stock branch; the base condition was removed (show all), so there
  // is no default branch to select. UI calls send one mode at a time, so
  // additive AND reproduces every legacy result while letting filters combine.
  let fromClause = BASE_FROM;

  if (query.archive === '1') {
    where.push('s.quantity = 0');
  }

  if (query.special === '1') {
    // "specials starting this week or later" (a planning view) — distinct from
    // the per-row isSpecialActive display flag. product_lists is the source of
    // truth; the cache copy (s.special_start_date) lags ~30 min.
    where.push('p.special = 1 AND p.special_start_date >= ?');
    params.push(getLocalMondayDateString());
  }

  if (query.keyword) {
    where.push("s.product_name LIKE CONCAT('%', ?, '%')");
    params.push(query.keyword);
  }

  if (query.letter) {
    fromClause += '\n  LEFT JOIN teams t ON t.teams_id = s.team_id';
    where.push('UPPER(LEFT(t.team_name, 1)) = ?');
    params.push(query.letter.toUpperCase());
  }

  // Order by — owned exclusively by order_mode. sort keeps its WHERE filters
  // (above) but no longer touches ORDER BY. 'recent' preserves existing
  // deliveries ordering; 'season' mirrors the stock-home-grid sort. sort=1's old
  // `ORDER BY s.map` prefix was a no-op (map is binary 'Mapped'/not and sort=1
  // already filters to not-Mapped), so dropping it changes no behavior.
  const orderByClause =
    query.order_mode === 'season'
      ? 'ORDER BY s.season_sort ASC, s.product_lists_sort ASC'
      : 'ORDER BY s.first_quantity_added DESC, s.created DESC';

  // GROUP BY — spec §4 step 8 / §5.3. Default is on (remove duplicates).
  const groupByClause =
    query.remove_duplicate_product_code === '1' ? 'GROUP BY s.product_code' : '';

  return {
    selectClause: `SELECT ${SELECT_FIELDS}`,
    fromClause,
    whereConditions: where,
    orderByClause,
    groupByClause,
    params,
  };
}

/** Compose query parts into a final paginated SQL string + params. */
export function composePaginatedSql(parts: QueryParts, limit: number, offset: number): {
  sql: string;
  params: unknown[];
} {
  const whereClause = parts.whereConditions.length
    ? `WHERE ${parts.whereConditions.join(' AND ')}`
    : '';
  const sql = [
    parts.selectClause,
    parts.fromClause,
    whereClause,
    parts.groupByClause,
    parts.orderByClause,
    'LIMIT ? OFFSET ?',
  ]
    .filter(Boolean)
    .join('\n');
  return { sql, params: [...parts.params, limit, offset] };
}

/**
 * Build the COUNT query so pagination metadata can report totalRows.
 * The GROUP BY (when present) means we count distinct product codes that match.
 */
export function composeCountSql(parts: QueryParts): { sql: string; params: unknown[] } {
  const whereClause = parts.whereConditions.length
    ? `WHERE ${parts.whereConditions.join(' AND ')}`
    : '';
  if (parts.groupByClause) {
    const sql = [
      'SELECT COUNT(*) AS total FROM (',
      'SELECT 1',
      parts.fromClause,
      whereClause,
      parts.groupByClause,
      ') sub',
    ]
      .filter(Boolean)
      .join('\n');
    return { sql, params: [...parts.params] };
  }
  const sql = ['SELECT COUNT(*) AS total', parts.fromClause, whereClause]
    .filter(Boolean)
    .join('\n');
  return { sql, params: [...parts.params] };
}
