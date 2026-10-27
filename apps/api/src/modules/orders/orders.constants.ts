/**
 * Orders module constants — ported from PHP configure.php, localconfigure.php, sagepay.php
 * Requirements: REQ-01-009 (file-defined), REQ-01-011 (table names)
 *
 * DB-defined constants (REQ-01-010) are loaded at runtime via OrdersConfigService.
 */

// ---------------------------------------------------------------------------
// REQ-01-009: File-Defined Constants
// ---------------------------------------------------------------------------

/** Default FC box identifier. Source: localconfigure.php:299 */
export const FC_BOX_NUMBER = 'FC2023';

/**
 * Box codes that auto-mark an order line as JIT when it is picked into them.
 * Source: webadmin configure define `JIT_BOX_CODES`
 *   (zenc webadmin includes/zencconfigure.php:541 = 'TSHIRTS,HOLD,DELIVERY').
 * Stock2 ports the webadmin/orders.php behaviour, so the webadmin value is authoritative.
 * NOTE — per-environment divergence: the storefront and UAT configs define only
 * 'TSHIRTS,HOLD'. Prod cutover MUST re-verify the production webadmin define before
 * go-live (different env files can carry different lists). PMS #164876.
 */
export const JIT_BOX_CODES = 'TSHIRTS,HOLD,DELIVERY';

/** Option IDs indicating a product has printing/personalization. Source: localconfigure.php:315 */
export const PRINTING_OPTIONS_IDS = '3, 4, 63, 64, 65';

/** Manufacturer IDs treated as Airo-type suppliers. Source: configure.php:220 */
export const AIRO_TYPE_MANUFACTURER_MAPPING = '79,82,85,86,87';

/**
 * Manufacturer IDs treated as Toffs-type suppliers (toffs.com-sourced retro shirts).
 * Source: production FRONTEND config define `TOFFS_TYPE_MANUFACTURER_MAPPING` (PMS #165061,
 * deployed 2026-03-06). 35='Toffs', 107='Football Town' (verified in zenc_main_db manufacturers).
 */
export const TOFFS_TYPE_MANUFACTURER_MAPPING = '35,107';

/** Parsed Toffs-type manufacturer IDs as number array */
export const TOFFS_TYPE_MANUFACTURER_ID_LIST: number[] = TOFFS_TYPE_MANUFACTURER_MAPPING
  .split(',')
  .map((id) => parseInt(id.trim(), 10));

/**
 * Store IDs for Toffs.com sites. Source: order_processing_new.php toffs detection
 * (order_site IN 143,146). 143='Toffs', 146='TOFFS UK' (verified in store_management).
 */
export const TOFFS_STORE_IDS: number[] = [143, 146];

/** SagePay vendor identifier. Source: sagepay.php:8 */
export const SAGEPAY_VENDOR = 'uksoccershoplim';

/** SagePay refund API endpoint. Source: sagepay.php:9 */
export const SAGEPAY_REFUND_URL = 'https://live.sagepay.com/gateway/service/refund.vsp';

/** All available shipment module codes. Source: configure.php:181 */
export const ALL_SHIPMENT_MODULES_CODES =
  'dhl,dpd,norsk,royal_mail,spring_global,wn_direct,deutsche_post,pro_carrier';

/** Minimum order ID for queries (excludes ancient data). Source: configure.php:229 */
export const START_FROM_WHICH_ORDER = 1472158;

/** Orders per processing archive batch (dev). Source: configure.php:127 */
export const NEW_ARCHIVE_ORDERS_COUNT_DEV = 100;

/** Orders per processing archive batch (live). Source: configure.php:127 */
export const NEW_ARCHIVE_ORDERS_COUNT_LIVE = 200;

/** Separate archive batch limit. Source: configure.php:127 */
export const ARCHIVE_ORDERS_COUNT = 15;

/** Prefix for Fruugo order IDs. Source: localconfigure.php:252 */
export const FRUUGO_ORDER_ID_STRING = '001004571';

/** Cutoff for old/new Fruugo integration. Source: localconfigure.php:251 */
export const LAST_FRUUGO_ORDER_ID_IN_FRUUGO_ORDERS_TABLE = '62665106001004571';

// ---------------------------------------------------------------------------
// REQ-01-011: Database Table Name Constants
// ---------------------------------------------------------------------------
// In TypeScript we reference table names directly in $queryRaw queries.
// These constants ensure consistent table names across the codebase.

export const TABLE = {
  ADMIN: 'admin',
  ADMIN_FILES: 'admin_files',
  ADMIN_ALLOWED_PAGES: 'admin_allowed_pages',
  PERMISSION_TO_ADMIN: 'permission_to_admin',
  ADMIN_PERMISSION: 'admin_permission',
  ORDERS: 'orders',
  ORDERS_PRODUCTS: 'orders_products',
  ORDERS_STATUS: 'orders_status',
  ORDERS_STATUS_HISTORY: 'orders_status_history',
  ORDERS_TOTAL: 'orders_total',
  CONFIGURATION: 'configuration',
  PRODUCT_TYPE_LAYOUT: 'product_type_layout',
  STORE_MANAGEMENT: 'store_management',
  STORE_CUSTOMIZATION: 'store_customization',
  DELIVERY_REVIEW: 'delivery_review',
  DELIVERY_MANAGEMENT_ACTION_HISTORY: 'delivery_management_action_history',
  // Known discrepancies from PHP (preserved for backward compat)
  ORDER_STATUS_PREDEFINED_TEMPLATE: 'order_status_predefined_template',
  BUNDLE_PRODUCT_BARCODE_MAPPINGS: 'bundle_product_barcode_mappings',
  AFFILIATE_PUBLISHERS_NAMES: 'affiliate_publishers_names',
  PRE_ORDERED_ORDERS: 'pre_orderded_orders', // typo in actual table name
  PRE_PROCESSED_ORDER_PRODUCTS: 'pre_processed_order_products',
  // SPEC-13: Order Processing Engine tables
  REMOTE_ORDER_PROCESSING: 'remote_order_processing',
  ORDER_PROCESSING_SIMULATION_COMMENTS: 'order_processing_simulation_comments',
  PRINTING_SHEETS: 'printing_sheets',
  MULTIPART_FC_ORDERS: 'multipart_fc_orders',
} as const;

// ---------------------------------------------------------------------------
// REQ-01-009: Parsed helper arrays derived from constants
// ---------------------------------------------------------------------------

/** Parsed printing option IDs as number array */
export const PRINTING_OPTIONS_ID_LIST: number[] = PRINTING_OPTIONS_IDS
  .split(',')
  .map((id) => parseInt(id.trim(), 10));

/** Parsed Airo manufacturer IDs as number array */
export const AIRO_TYPE_MANUFACTURER_ID_LIST: number[] = AIRO_TYPE_MANUFACTURER_MAPPING
  .split(',')
  .map((id) => parseInt(id.trim(), 10));

/** Parsed shipment module codes as string array */
export const SHIPMENT_MODULE_CODES: string[] = ALL_SHIPMENT_MODULES_CODES.split(',');

/** Parsed JIT box codes, upper-cased for case-insensitive comparison (matches existing TSHIRTS handling). */
export const JIT_BOX_CODE_LIST: string[] = JIT_BOX_CODES
  .split(',')
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Permission IDs (used in permission_to_admin table)
// ---------------------------------------------------------------------------

export const PERMISSION_IDS = {
  REFUND: 1,
  REJECT: 2,
} as const;

/** Order status ID for rejected orders (REQ-03-010) */
export const REJECTED_ORDER_STATUS = 112;

/** Admin ID with hardcoded full permissions (REQ-01-004) */
export const SUPERUSER_ADMIN_ID = 10;

/** Static bypass token for internal cross-system calls (REQ-01-001, REQ-01-020) */
export const WEBADMIN_BYPASS_TOKEN = '0Az8Bys3dbk2kSDJ147Ca4sdcDS124CAOB23';

// ---------------------------------------------------------------------------
// SPEC-06: Site IDs for multi-site notifications (ported from orders.php)
// ---------------------------------------------------------------------------

/** UKRS site ID (ukrugbyshop.com) */
export const UKRS_SITE_ID = 81;

/** Teamzo site ID (teamzo.com) */
export const TEAMZO_SITE_ID = 99;

/** Fruugo site ID */
export const FRUUGO_SITE_ID = 95;

// ---------------------------------------------------------------------------
// SPEC-07: Status Management Constants (ported from orders.php)
// ---------------------------------------------------------------------------

/** Status IDs with special business rules */
export const STATUS = {
  PENDING: 1,
  PROCESSING: 2,
  SHIPPED: 5,
  READY: 7,
  PRE_ORDERED: 12,
  AWAITING_PRINTING: 14,
  BEING_PICKED: 16,
  CANCELLED: 18,
  RETRO_SHIRTS: 22,
  AWAITING_DELIVERY: 23,
  READY_TO_SHIP: 24,
  REJECTED: 112,
  IN_TRANSIT: 128,
} as const;

/** Statuses that set order_process_status = 1 (PHP lines 7223-7225) */
export const PROCESS_STATUS_ACTIVE = [
  STATUS.SHIPPED, STATUS.PRE_ORDERED, STATUS.AWAITING_PRINTING,
  STATUS.BEING_PICKED, STATUS.RETRO_SHIRTS, STATUS.AWAITING_DELIVERY,
  STATUS.READY_TO_SHIP, STATUS.IN_TRANSIT,
] as const;

/** Statuses that reset order_process_status = 0 (PHP lines 7223-7225) */
export const PROCESS_STATUS_RESET = [
  STATUS.PENDING, STATUS.PROCESSING, STATUS.READY, STATUS.CANCELLED,
] as const;

/** Statuses that trigger pre_ordered_orders insert (PHP lines 7236-7272) */
export const PRE_ORDER_INSERT_STATUSES = [
  STATUS.PRE_ORDERED, STATUS.AWAITING_DELIVERY, STATUS.IN_TRANSIT,
] as const;

/** Virtual product type ID for pre-own/hero shirt products */
export const HERO_SHIRT_VIRTUAL_TYPE = 5;

/** FC box lists ID for committed quantity operations. Source: localconfigure.php:525 */
export const FC_BOX_LISTS_ID = 25039;

/** Virtual product type IDs from products.virtual_product_type_id */
export const VIRTUAL_PRODUCT_TYPE = {
  KEYRING: 2,
  TSHIRT: 4,
  HERO_SHIRT: 5,
} as const;

/** Order process status values for orders.order_process_status */
export const PROCESS_STATUS = {
  RESET: '0',
  ACTIVE: '1',
  COMPLETED: '2',
  SIMULATION_DONE: '3',
} as const;

/** Squad Player option ID (only counts as printing if value != 'None') */
export const SQUAD_PLAYER_OPTION_ID = 3;

/** Page identifiers for status_change_from audit trail — must match zenc values */
export const PAGE_FOR_LOG = {
  EDIT_ORDER: 'EditOrderPage',
  PAGE: 'Page',
} as const;

