/**
 * SportDeal Marketplace Types
 * 
 * Type definitions for SportDeal inventory sync
 * 
 * @taskId #164914
 */

import type { ListingNeedingSync } from '../common/types';

/**
 * SportDeal inventory item for XML feed
 */
export interface SportdealInventoryItem {
  id: string;        // SKU
  price: string;     // Price with 2 decimals (e.g., "19.99")
  gtin: string;      // Barcode/GTIN (empty string if not available)
  qty: number;       // Current quantity
}

/**
 * SportDeal XML feed generation options
 */
export interface SportdealFeedOptions {
  /** Output file path override */
  outputPath?: string;
  /** Archive old feed before generating new one */
  archive?: boolean;
}

/**
 * SportDeal feed generation result
 */
export interface SportdealFeedResult {
  success: boolean;
  filePath?: string;
  itemCount: number;
  error?: string;
  duration: number;
}

/**
 * Re-export common types for convenience
 */
export type { ListingNeedingSync };
