/**
 * Database Types for Marketplace Module
 *
 * These types match the Prisma models defined in schema.mysql.prisma.
 * Using local types instead of importing from Prisma client for better
 * compatibility with the dual-database setup (PostgreSQL/MySQL).
 */

// Re-export prisma instance from central location
export { prisma } from '../../../lib/prisma';

/**
 * Marketplace sync status enum.
 * Matches Prisma enum: MarketplaceSyncStatus
 */
export type MarketplaceSyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

/**
 * Sync history status enum.
 * Matches Prisma enum: MarketplaceSyncHistoryStatus
 */
export type MarketplaceSyncHistoryStatus =
  | 'RUNNING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERRORS'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Marketplace listing record.
 * Matches Prisma model: MarketplaceListing
 */
export interface MarketplaceListing {
  id: string;
  storeId: number;
  marketplaceName: string;
  ukssSku: string;
  ukssProductId: number | null;
  ukssQuantity: number;
  ukssPrice: number; // Decimal in DB, number in JS
  externalSkuId: string | null;
  externalProductId: string | null;
  isActive: boolean;
  listedAt: Date | null;
  delistedAt: Date | null;
  syncAllowed: boolean;
  lastSyncStatus: MarketplaceSyncStatus | null;
  lastSyncedAt: Date | null;
  retryCount: number;
  lastSyncError: string | null;
  lastSyncedQuantity: number | null;
  lastSyncedPrice: number | null; // Decimal in DB
  priority: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Marketplace sync history record.
 * Matches Prisma model: MarketplaceSyncHistory
 */
export interface MarketplaceSyncHistory {
  id: string;
  storeId: number;
  marketplaceName: string;
  operation: string;
  correlationId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  status: MarketplaceSyncHistoryStatus;
  totalItems: number;
  newItemsListed: number;
  itemsUpdated: number;
  itemsFailed: number;
  errorSummary: string | null;
  errorDetails: Record<string, unknown> | null;
  triggeredBy: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Create data for new marketplace listing.
 */
export interface MarketplaceListingCreateInput {
  id?: string;
  storeId: number;
  marketplaceName: string;
  ukssSku: string;
  ukssProductId?: number | null;
  ukssQuantity?: number;
  ukssPrice?: number;
  externalSkuId?: string | null;
  externalProductId?: string | null;
  isActive?: boolean;
  syncAllowed?: boolean;
  priority?: number;
  metadata?: Record<string, unknown> | null;
}

/**
 * Update data for marketplace listing.
 */
export interface MarketplaceListingUpdateInput {
  ukssQuantity?: number;
  ukssPrice?: number;
  externalSkuId?: string | null;
  externalProductId?: string | null;
  isActive?: boolean;
  syncAllowed?: boolean;
  listedAt?: Date | null;
  delistedAt?: Date | null;
  lastSyncStatus?: MarketplaceSyncStatus | null;
  lastSyncedAt?: Date | null;
  retryCount?: number;
  lastSyncError?: string | null;
  lastSyncedQuantity?: number | null;
  lastSyncedPrice?: number | null;
  priority?: number;
  metadata?: Record<string, unknown> | null;
}

/**
 * Create data for sync history record.
 */
export interface MarketplaceSyncHistoryCreateInput {
  id?: string;
  storeId: number;
  marketplaceName: string;
  operation: string;
  correlationId?: string | null;
  startedAt?: Date;
  completedAt?: Date | null;
  durationMs?: number | null;
  status?: MarketplaceSyncHistoryStatus;
  totalItems?: number;
  newItemsListed?: number;
  itemsUpdated?: number;
  itemsFailed?: number;
  errorSummary?: string | null;
  errorDetails?: Record<string, unknown> | null;
  triggeredBy?: string | null;
  metadata?: Record<string, unknown> | null;
}
