/**
 * Deliveries service — query execution, row transform, dropdown loaders.
 *
 * Migration source: IndexController::new_stock (spec §4 step 15 transform,
 * §14 table touch-map). Phase 1 is read-only — no writes from this service.
 */

import { Prisma, prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import type { DeliveryListQuery } from './deliveries.schema';
import {
  buildDeliveriesQuery,
  composePaginatedSql,
  composeCountSql,
} from './deliveries.query-builder';

const logger = createLogger('deliveries');

// ---------------------------------------------------------------------------
// Raw row shape from MySQL — every field from buildDeliveriesQuery SELECT.
// ---------------------------------------------------------------------------

interface DeliveryRow {
  shgl_id: number;
  product_quantities_id: number | null;
  product_lists_id: number | null;
  product_list_id: number | null;
  product_code: string | null;
  product_name: string | null;
  boxcode: string | null;
  team_id: number | null;
  product_code_type: number | null;
  season: string | null;
  price: string | number | null;
  map: string | null;
  quantity: number | null;
  quantity_map: string | number | null;
  amazon_low_price: string | number | null;
  ebay_product: string | null;
  percentage_sold: string | number | null;
  assign_font: string | null;
  one_size: string | number | null;
  attr: string | null;
  last_sale_date: Date | string | null;
  shgl_product_code_image: string | null;
  option_2701: string | number | null;
  option_1: string | number | null;
  option_2: string | number | null;
  option_3: string | number | null;
  option_4: string | number | null;
  option_5: string | number | null;
  option_623: string | number | null;
  option_1640: string | number | null;
  option_509: string | number | null;
  option_441: string | number | null;
  option_442: string | number | null;
  option_443: string | number | null;
  option_444: string | number | null;
  option_1641: string | number | null;
  front_image_url: string | null;
  back_image_url: string | null;
  additional_image_url: string | null;
  pl_product_code_image: string | null;
  pl_special: string | number | null;
  pl_special_price: string | number | null;
  pl_special_start_date: Date | string | null;
  pl_special_end_date: Date | string | null;
  added_product_code_image: string | number | null;
  FBA_quantity: string | number | null;
}

export interface DeliveryListItem {
  id: number;
  product_quantities_id: number | null;
  product_lists_id: number | null;
  product_list_id: number | null;
  product_code: string;
  product_name: string;
  boxcode: string;
  team_id: number | null;
  product_code_type: number | null;
  season: string;
  price: string;
  map: string;
  quantity_map: string;
  amazon_low_price: string;
  ebay_product: string;
  percentage_sold: string;
  assign_font: string;
  one_size: string;
  attr: string;
  last_sale_day: string;
  // Size columns
  option_2701: string;
  option_1: string;
  option_2: string;
  option_3: string;
  option_4: string;
  option_5: string;
  option_623: string;
  option_1640: string;
  option_509: string;
  option_441: string;
  option_442: string;
  option_443: string;
  option_444: string;
  option_1641: string;
  // Per-row, per-size descriptor (the legacy `actual_size_options_comments`
  // suffix that used to live after `#` in each option cell). Surfaced as a map
  // so the inline editor still sees a clean integer in the option_* fields,
  // while the grid formatter reads `size_comments[option_X]` for the hover
  // tooltip. Legacy: grid_file_controller.php:312 sets
  // `option_X = qty . "#" . $comments` where $comments comes from the
  // ManufacturersSizesToDefaultSize join.
  size_comments: Record<string, string>;
  // Computed flags driving formatters + row background colors
  special: '0' | '1';
  special_price: string | null | number;
  FBA_quantity: string | number | null;
  is_fba: 'Yes' | 'No';
  add_product_status: '' | 'partially_complete';
  upload_image: '0' | '1';
  image_added: string;            // "<bit>#<product_code>#<boxcode>" — for ImageAddedFormatter
  image_added_bit: '0' | '1';
  submitted_for_review: '0' | '1';
  image_urls: '0' | '1';
}

export interface DeliveryListResponse {
  data: DeliveryListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
}

// ---------------------------------------------------------------------------
// Per-row transform — spec §4 step 15.
// ---------------------------------------------------------------------------

// Legacy parity: PHP outputs literal "n\a" (backslash-a, 3 chars) for the
// never-sold sentinel, and "<days> days" for the sold case
// (index_controller.php:2697-2701). We match that exactly so the frontend
// formatter can stay identical.
const NEVER_SOLD = 'n\\a';

/**
 * Strip the legacy `<qty>#<size descriptor>` suffix and return just the qty
 * prefix as a string. Empty / null → "". The descriptor is surfaced separately
 * via `optionSuffix` so the cell formatter can show it as a hover tooltip.
 */
function optionPrefix(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const s = String(value);
  const hash = s.indexOf('#');
  return hash === -1 ? s : s.slice(0, hash);
}

/**
 * Extract the `<size descriptor>` suffix from a `<qty>#<descriptor>` cell
 * value. Returns '' when the cell has no `#`. Legacy parity:
 * grid_file_controller.php:312 — `$comments` is the per-row, per-size
 * `actual_size_options_comments` from manufacturers_sizes_to_default_size,
 * e.g. "Small 36-38\" Chest". We surface it under `size_comments` so the
 * frontend's hover popup matches legacy 1:1.
 */
function optionSuffix(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const s = String(value);
  const hash = s.indexOf('#');
  return hash === -1 ? '' : s.slice(hash + 1);
}

function daysSinceLastSale(lastSale: Date | string | null): string {
  if (!lastSale) return NEVER_SOLD;
  const s =
    typeof lastSale === 'string' ? lastSale : lastSale.toISOString().slice(0, 10);
  if (s.startsWith('0000-00-00')) return NEVER_SOLD;
  const last = new Date(s);
  if (Number.isNaN(last.getTime())) return NEVER_SOLD;
  const diffMs = Date.now() - last.getTime();
  if (diffMs < 0) return NEVER_SOLD;
  return `${Math.floor(diffMs / (1000 * 60 * 60 * 24))} days`;
}

export function isSpecialActive(
  special: string | number | null,
  startDate: Date | string | null,
  endDate: Date | string | null
): '0' | '1' {
  if (special === null || Number(special) !== 1) return '0';
  if (!startDate) return '0';
  const start = typeof startDate === 'string' ? startDate.slice(0, 10) : startDate.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const startOk = start === '0001-01-01' || start <= today;
  let endOk = true;
  if (endDate) {
    const end = typeof endDate === 'string' ? endDate.slice(0, 10) : endDate.toISOString().slice(0, 10);
    endOk = end === '0001-01-01' || today <= end;
  }
  return startOk && endOk ? '1' : '0';
}

function transformRow(
  row: DeliveryRow,
  reviewCodes: Set<string>,
  rowId: number
): DeliveryListItem {
  const productCode = row.product_code ?? '';
  const boxcode = row.boxcode ?? '';

  // Spec §4 step 15c
  const special = isSpecialActive(row.pl_special, row.pl_special_start_date, row.pl_special_end_date);

  // Spec §4 step 15d — upload_image flag is "0" when not yet mapped (so the
  // upload button is shown), "1" when mapped (button hidden).
  const upload_image: '0' | '1' = row.map !== 'Mapped' ? '0' : '1';

  // Spec §4 step 15e — partially_complete when stock_home_grid_lists has its own
  // product_code_image set.
  const add_product_status: '' | 'partially_complete' =
    row.shgl_product_code_image && row.shgl_product_code_image !== ''
      ? 'partially_complete'
      : '';

  // Spec §4 step 15f — t-shirt suppression (product_code_type == 4 hides eBay).
  const ebay_product =
    row.product_code_type === 4 ? 'N/A' : (row.ebay_product ?? 'N/A');

  // Spec §4 step 15g — review queue lookup.
  const submitted_for_review: '0' | '1' = reviewCodes.has(productCode) ? '1' : '0';

  // Spec §4 step 15h — image_urls flag
  const image_urls: '0' | '1' =
    (row.front_image_url && row.front_image_url !== '') ||
      (row.back_image_url && row.back_image_url !== '') ||
      (row.additional_image_url && row.additional_image_url !== '')
      ? '1'
      : '0';

  // image_added is encoded as "<bit>#<product_code>#<boxcode>" — the legacy
  // ImageAddedFormatter parses this triple. image_added_bit is the raw flag,
  // which drives the lightblue row background (spec §7 priority 2).
  const added = String(row.added_product_code_image ?? '0');
  const image_added_bit: '0' | '1' = added === '1' ? '1' : '0';
  const image_added = `${added}#${productCode}#${boxcode}`;

  // assign_font is "assign_font#product_code#boxcode" (spec §6 row table).
  const assign_font = `${row.assign_font ?? ''}#${productCode}#${boxcode}`;

  let displaySpecialPrice = special === '1' && row.pl_special_price != null && row.pl_special_price !== 'NULL'
    ? row.pl_special_price : null

  return {
    id: rowId,
    product_quantities_id: row.product_quantities_id,
    product_lists_id: row.product_lists_id,
    product_list_id: row.product_list_id,
    product_code: productCode,
    product_name: row.product_name ?? '',
    boxcode,
    team_id: row.team_id,
    product_code_type: row.product_code_type,
    season: row.season ?? '',
    price: row.price !== null ? String(row.price) : '',
    map: row.map ?? '',
    quantity_map: String(row.quantity_map ?? ''),
    amazon_low_price:
      row.amazon_low_price === null || row.amazon_low_price === ''
        ? '0.00'
        : String(row.amazon_low_price),
    ebay_product,
    percentage_sold: `${row.percentage_sold ?? 0}%`,
    assign_font,
    one_size: String(row.one_size ?? '0'),
    attr: row.attr ?? '',
    last_sale_day: daysSinceLastSale(row.last_sale_date),
    // Legacy cache stores each size cell as "<qty>#<size descriptor>" — see
    // grid_file_controller.php:312. We split into:
    //   • option_<id> → the numeric prefix only (clean integer for the inline
    //     editor + SlickGrid's no-op-change detection)
    //   • size_comments[option_<id>] → the descriptor for the hover popup
    //     (legacy CommentFormatter reads `string[1]` for the same purpose)
    option_2701: optionPrefix(row.option_2701),
    option_1: optionPrefix(row.option_1),
    option_2: optionPrefix(row.option_2),
    option_3: optionPrefix(row.option_3),
    option_4: optionPrefix(row.option_4),
    option_5: optionPrefix(row.option_5),
    option_623: optionPrefix(row.option_623),
    option_1640: optionPrefix(row.option_1640),
    option_509: optionPrefix(row.option_509),
    option_441: optionPrefix(row.option_441),
    option_442: optionPrefix(row.option_442),
    option_443: optionPrefix(row.option_443),
    option_444: optionPrefix(row.option_444),
    option_1641: optionPrefix(row.option_1641),
    size_comments: {
      option_2701: optionSuffix(row.option_2701),
      option_1: optionSuffix(row.option_1),
      option_2: optionSuffix(row.option_2),
      option_3: optionSuffix(row.option_3),
      option_4: optionSuffix(row.option_4),
      option_5: optionSuffix(row.option_5),
      option_623: optionSuffix(row.option_623),
      option_1640: optionSuffix(row.option_1640),
      option_509: optionSuffix(row.option_509),
      option_441: optionSuffix(row.option_441),
      option_442: optionSuffix(row.option_442),
      option_443: optionSuffix(row.option_443),
      option_444: optionSuffix(row.option_444),
      option_1641: optionSuffix(row.option_1641),
    },
    special,
    special_price: displaySpecialPrice,
    FBA_quantity: row.FBA_quantity,
    is_fba: Number(row.FBA_quantity) > 0 ? 'Yes' : 'No',
    add_product_status,
    upload_image,
    image_added,
    image_added_bit,
    submitted_for_review,
    image_urls,
  };
}

// ---------------------------------------------------------------------------
// Dropdown loaders — kept module-private; routes call thin wrappers.
// ---------------------------------------------------------------------------

interface UkssCodeRow { pscpd_code: string }
async function getUkssPriceCodes(): Promise<string[]> {
  // Spec §14: SELECT pscpd_code FROM pre_save_sms_code_product_data WHERE pscpd_price > 0
  const rows = await prisma.$queryRawUnsafe(`SELECT pscpd_code FROM pre_save_sms_code_product_data WHERE pscpd_price > 0`
  ) as UkssCodeRow[];
  return rows.map((r) => r.pscpd_code).filter(Boolean);
}

interface ReviewCodeRow { product_code: string }
async function getReviewProductCodes(): Promise<Set<string>> {
  // Spec §14: SELECT product_code FROM sms_products_for_review WHERE review_product_status = 1
  const rows = await prisma.$queryRawUnsafe(`SELECT product_code FROM sms_products_for_review WHERE review_product_status = 1`
  ) as ReviewCodeRow[];
  return new Set(rows.map((r) => r.product_code).filter(Boolean));
}

interface TeamRow { teams_id: number; team_name: string }
export interface TeamOption { id: number; name: string }
export async function getTeams(): Promise<TeamOption[]> {
  // Spec §14: teams.invalid_team_for_amazon = 'Valid' AND team_name != ''
  // ORDER BY team_name (legacy Team::getTeamName).
  const rows = await prisma.$queryRawUnsafe(`
      SELECT teams_id, team_name
      FROM teams
      WHERE team_name != '' AND invalid_team_for_amazon = 'Valid'
      ORDER BY team_name ASC
    `
  ) as TeamRow[];
  return rows.map((r) => ({ id: r.teams_id, name: r.team_name }));
}

interface CountryRow { countries_id: number; countries_name: string }
export interface CountryOption { id: number; name: string }
// product_lists.country_of_origin_id FKs to countries.countries_id — ORDER BY name.
export async function getCountries(): Promise<CountryOption[]> {
  const rows = await prisma.$queryRawUnsafe(`
      SELECT countries_id, countries_name
      FROM countries
      WHERE countries_name != ''
      ORDER BY countries_name ASC
    `
  ) as CountryRow[];
  return rows.map((r) => ({ id: r.countries_id, name: r.countries_name }));
}

// ---------------------------------------------------------------------------
// Main listing service
// ---------------------------------------------------------------------------

interface CountRow { total: number | bigint }

export async function getDeliveriesListing(
  query: DeliveryListQuery
): Promise<DeliveryListResponse> {
  // Spec §14: load UKSS-priced codes only when the filter actually needs them.
  const ukssCodes =
    query.sort !== '0' && query.ukss_price_upload_status !== '0'
      ? await getUkssPriceCodes()
      : [];

  const parts = buildDeliveriesQuery(query, ukssCodes);
  const offset = (query.page - 1) * query.pageSize;
  const { sql, params } = composePaginatedSql(parts, query.pageSize, offset);
  const { sql: countSql, params: countParams } = composeCountSql(parts);

  // Reviews lookup happens in parallel with the main query.
  const [rows, countRows, reviewCodes] = await Promise.all([
    prisma.$queryRawUnsafe(sql, ...params) as DeliveryRow[],
    prisma.$queryRawUnsafe(countSql, ...countParams) as CountRow[],
    getReviewProductCodes(),
  ]);

  const totalRows = Number(countRows[0]?.total ?? 0);

  logger.debug(
    { rowCount: rows.length, totalRows, page: query.page, sort: query.sort },
    'deliveries listing executed'
  );

  // Row `id` is the real `stock_home_grid_lists` PK (`s.id AS shgl_id`), NOT a
  // page-position ordinal. A positional id changes per page and can collide
  // across rows, so inline edits that key off row id would target the wrong
  // product once the list sorts or paginates. shgl_id is stable per row.
  const data = rows.map((row) => transformRow(row, reviewCodes, row.shgl_id));

  return {
    data,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / query.pageSize)),
    },
  };
}
