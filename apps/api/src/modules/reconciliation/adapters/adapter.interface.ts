/**
 * Reconciliation Adapter Interface
 *
 * Each marketplace implements this to fetch orders from their API
 * for comparison against the local database.
 */

import type { MarketplaceApiOrder } from '../reconciliation.types';

export interface ReconciliationAdapter {
  /** Display name of the marketplace (e.g., "SHOPIFY", "TOFFS") */
  name: string;

  /** Store IDs this adapter checks (Shopify has multiple, others have 1) */
  storeIds: number[];

  /**
   * When true, the adapter's orderId maps to mo_external_order_id in the DB
   * rather than mo_order_id. Used for Toffs (increment_id vs entity_id).
   */
  useExternalOrderId?: boolean;

  /**
   * Fetch orders from the marketplace API within a date range.
   * Returns normalized MarketplaceApiOrder objects.
   */
  fetchOrders(fromDate: Date, toDate: Date): Promise<MarketplaceApiOrder[]>;

  /**
   * Generate a deep link URL to the marketplace's order admin page.
   * Returns null if the URL cannot be generated (e.g., store not found).
   */
  getOrderUrl(orderId: string, storeId: number): Promise<string | null>;
}
