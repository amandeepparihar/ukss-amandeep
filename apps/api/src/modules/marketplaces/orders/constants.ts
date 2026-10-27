/**
 * Marketplace Order Constants
 *
 * Shared constants for the 5-stage marketplace order pipeline:
 *   Stage 1: Fetch orders from marketplace API
 *   Stage 2: Insert into MOP tables (mo_marketplace_orders, etc.)
 *   Stage 3: Convert to UKSS orders (orders table)
 *   Stage 4: Sync UKSS status back to MOP tables
 *   Stage 5: Push status updates to marketplace API
 */

/**
 * Order status values used across the pipeline.
 *
 * These are the statuses stored in mop_order_status_to_update and mo_order_status.
 * Each marketplace maps its own API statuses to/from these shared values.
 */
export const OrderStatus = {
  /** Initial status when order is first fetched from marketplace (Stage 1) */
  PENDING: 'Pending',

  /** Order has been confirmed with the marketplace (Stage 5) */
  CONFIRMED: 'Confirmed',

  /** Order has been shipped — tracking info available (Stage 4/5) */
  SHIPPED: 'Shipped',

  /** Order has been cancelled (Stage 4/5) */
  CANCELLED: 'Cancelled',

  /** Order has been returned — Fruugo-specific (Stage 4/5) */
  RETURN: 'Return',

  /** Status could not be mapped from marketplace status code */
  UNKNOWN: 'UNKNOWN',
} as const;

export type OrderStatusValue = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * API response status values stored in mop_api_response.
 * Indicates whether the marketplace API has been called for this product.
 */
export const ApiResponseStatus = {
  /** Status update not yet sent to marketplace API */
  WAITING: 'Waiting',

  /** Status update successfully sent to marketplace API */
  SUCCESS: 'Success',

  /** Status update failed — check logs for details */
  FAILED: 'Failed',

  /** Status requires manual intervention on marketplace dashboard */
  MANUAL_UPDATE: 'Need to update manually',
} as const;

/**
 * Default "created by" label pattern for audit trail.
 * Each marketplace uses: `Get {MarketplaceName} Orders`
 */
export function getCreatedByLabel(marketplaceName: string): string {
  return `Get ${marketplaceName} Orders`;
}

/**
 * Default "modified by" value for audit trail fields.
 * Used in moCreatedBy, moModifiedBy, mopCreatedBy, mopModifiedBy.
 */
export const AUDIT_USER = 'footykit';

/**
 * Default initial status mapping ID.
 *
 * WHY: This references muosm_marketplcae_ukss_order_status_mappings.muosm_id = 1,
 * which is the "Pending" mapping row. Ideally this should be looked up from DB,
 * but all existing marketplaces use BigInt(1) for the initial status history entry.
 */
export const DEFAULT_INITIAL_STATUS_MAPPING_ID = BigInt(1);

/**
 * UKSS orders_status values (ZenCart order status IDs from the orders_status table).
 *
 * These are the numeric status codes stored in orders.orders_status.
 * Stage 3 sets initial status; Stage 4 reads current status for mapping.
 */
export const UkssOrderStatus = {
  /** All new marketplace orders start as Processing (needs warehouse pick/pack) */
  PROCESSING: 2,
  /** Order has been shipped with tracking info */
  SHIPPED: 5,
} as const;

/**
 * Default transaction timeout for multi-table order operations (ms).
 * Used in Stage 3 Prisma.$transaction() for atomic order insertion.
 */
export const TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * Audit label for Stage 4 status sync operations.
 * Stored in mosh_created_by and mosh_modified_by.
 */
export const STATUS_SYNC_AUDIT_USER = 'Order Status Sync';

/**
 * products_options_id for "Other Name & Number" personalization.
 * References products_options.products_options_id = 4 in the DB.
 */
export const PERSONALIZE_OPTION_ID = 4;
export const PERSONALIZE_OPTION_NAME = 'Other Name & Number';

/**
 * orders_total class identifiers (ZenCart order total module codes).
 * Each order has multiple rows in orders_total, distinguished by class.
 */
export const OrderTotalClass = {
  SUBTOTAL: 'ot_subtotal',
  SHIPPING: 'ot_shipping',
  TAX: 'ot_tax',
  TOTAL: 'ot_total',
} as const;

/**
 * orders_total sort_order values.
 * Controls display order of total rows in ZenCart order views.
 */
export const OrderTotalSortOrder = {
  SUBTOTAL: '100',
  SHIPPING: '200',
  TAX: '300',
  TOTAL: '999',
} as const;
