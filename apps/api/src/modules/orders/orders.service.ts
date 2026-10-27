/**
 * Orders foundation service — config loading, order validation, status data.
 * Requirements: REQ-01-010, REQ-01-013, REQ-01-021
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import type { OrderStatus } from './orders.schema';

const logger = createLogger('orders');

// ---------------------------------------------------------------------------
// Types for raw query results
// ---------------------------------------------------------------------------

interface ConfigurationRow {
  configuration_key: string;
  configuration_value: string;
}

interface OrderValidationRow {
  orders_id: number;
  sift_score_bit: number | null;
  customers_id: number;
}

interface OrderStatusRow {
  orders_status_id: number;
  orders_status_name: string;
  display_order: number;
}

// ---------------------------------------------------------------------------
// DB Config cache (REQ-01-010)
// ---------------------------------------------------------------------------

let dbConfigCache: Map<string, string> | null = null;
let dbConfigCacheExpiry = 0;
const DB_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute TTL (CX-009)

/**
 * REQ-01-010: Load all configuration rows from the `configuration` table
 * and `product_type_layout` table. Results are cached for 5 minutes.
 */
export async function loadDbConfiguration(): Promise<Map<string, string>> {
  const now = Date.now();
  if (dbConfigCache && now < dbConfigCacheExpiry) {
    return dbConfigCache;
  }

  const configMap = new Map<string, string>();

  // Load from configuration table
  const configRows = await prisma.$queryRaw<ConfigurationRow[]>(
    Prisma.sql`SELECT configuration_key, configuration_value FROM configuration`
  );
  for (const row of configRows) {
    configMap.set(row.configuration_key, row.configuration_value);
  }

  // Load from product_type_layout table
  const layoutRows = await prisma.$queryRaw<ConfigurationRow[]>(
    Prisma.sql`SELECT configuration_key, configuration_value FROM product_type_layout`
  );
  for (const row of layoutRows) {
    configMap.set(row.configuration_key, row.configuration_value);
  }

  dbConfigCache = configMap;
  dbConfigCacheExpiry = now + DB_CONFIG_CACHE_TTL_MS;

  logger.info({ count: configMap.size }, 'Loaded DB configuration');
  return configMap;
}

/**
 * REQ-01-010: Get a single DB-defined constant by key.
 * Throws if the key is not found.
 */
export async function getDbConfig(key: string): Promise<string> {
  const config = await loadDbConfiguration();
  const value = config.get(key);
  if (value === undefined) {
    throw new Error(`Missing DB configuration key: ${key}`);
  }
  return value;
}

/**
 * REQ-01-010: Get a DB-defined constant, returning a default if not found.
 */
export async function getDbConfigOrDefault(
  key: string,
  defaultValue: string
): Promise<string> {
  const config = await loadDbConfiguration();
  return config.get(key) ?? defaultValue;
}

/** Clear the DB config cache (useful for testing or admin config changes). */
export function clearDbConfigCache(): void {
  dbConfigCache = null;
  dbConfigCacheExpiry = 0;
}

// ---------------------------------------------------------------------------
// Order Validation (REQ-01-013)
// ---------------------------------------------------------------------------

export interface OrderValidationResult {
  exists: boolean;
  orderId: number;
  siftScoreBit: number | null;
  customersId: number | null;
}

/**
 * REQ-01-013: Validate order exists for edit mode.
 * Single query retrieves all needed fields (orders_id, sift_score_bit, customers_id).
 * Returns order metadata if found, or exists=false if not.
 */
export async function validateOrderExists(
  orderId: number
): Promise<OrderValidationResult> {
  if (orderId <= 0) {
    return { exists: false, orderId, siftScoreBit: null, customersId: null };
  }

  const rows = await prisma.$queryRaw<OrderValidationRow[]>(
    Prisma.sql`SELECT orders_id, sift_score_bit, customers_id FROM orders WHERE orders_id = ${orderId}`
  );

  if (rows.length === 0) {
    return { exists: false, orderId, siftScoreBit: null, customersId: null };
  }

  return {
    exists: true,
    orderId,
    siftScoreBit: rows[0].sift_score_bit,
    customersId: rows[0].customers_id,
  };
}

// ---------------------------------------------------------------------------
// Order Status Data (REQ-01-021)
// ---------------------------------------------------------------------------

// Cache keyed by languageId to support multiple languages (I-6 fix)
const statusCacheMap = new Map<number, { statuses: OrderStatus[]; expiry: number }>();
const STATUS_CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute TTL

/**
 * REQ-01-021: Load order status dropdown data, filtered by language.
 * Returns all active statuses (status = 1) ordered by display_order, then name.
 * Matches PHP order_status_data() in general.php which uses:
 *   WHERE status = 1 ORDER BY sort_order ASC
 * (sort_order in PHP maps to display_order in the database)
 */
export async function getOrderStatuses(
  languageId: number = 1
): Promise<OrderStatus[]> {
  const now = Date.now();
  const cached = statusCacheMap.get(languageId);
  if (cached && now < cached.expiry) {
    return cached.statuses;
  }

  const rows = await prisma.$queryRaw<OrderStatusRow[]>(
    Prisma.sql`
      SELECT orders_status_id, orders_status_name, display_order
      FROM orders_status
      WHERE language_id = ${languageId}
        AND status = 1
      ORDER BY display_order ASC, orders_status_name ASC
    `
  );

  const statuses: OrderStatus[] = rows.map((row) => ({
    id: row.orders_status_id,
    name: row.orders_status_name,
    displayOrder: row.display_order,
  }));

  statusCacheMap.set(languageId, { statuses, expiry: now + STATUS_CACHE_TTL_MS });
  return statuses;
}

/** Clear the order status cache. */
export function clearOrderStatusCache(): void {
  statusCacheMap.clear();
}
