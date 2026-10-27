/**
 * Order Audit Service
 *
 * Orchestrates the full audit: fetches orders from marketplace APIs,
 * cross-references against 4 local DB tables (mo_marketplace_orders,
 * mop_marketplace_order_products, orders, orders_products), assembles
 * composite AuditOrderRecord objects, and stores the report in Redis.
 */

import { nanoid } from 'nanoid';
import { createLogger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import type {
  AuditAdapter,
  AuditMarketplaceOrder,
  AuditOptions,
  AuditOrderRecord,
  AuditReport,
  AuditStatus,
} from './audit.types';
import type { MarketplaceName } from './reconciliation.types';
import { AuditShopifyAdapter } from './adapters/audit-shopify.adapter';
import { AuditToffsAdapter } from './adapters/audit-toffs.adapter';
import { AuditFruugoAdapter } from './adapters/audit-fruugo.adapter';
import { AuditDebenhamsAdapter } from './adapters/audit-debenhams.adapter';
import {
  safeStringify,
  REDIS_KEY_AUDIT_STATUS,
  REDIS_KEY_AUDIT_REPORT,
  AUDIT_STATUS_TTL,
  AUDIT_REPORT_TTL,
} from './reconciliation.utils';

const logger = createLogger('audit-service');

// ============================================
// Exported types
// ============================================

export interface AuditRunResult {
  report: AuditReport;
  runId: string;
}

// ============================================
// Helpers
// ============================================

/** Convert BigInt/Decimal to number safely */
const toNum = (v: bigint | number | null | undefined): number | undefined =>
  v != null ? Number(v) : undefined;

// ============================================
// Adapter Factory
// ============================================

function createAuditAdapter(name: MarketplaceName, storeIds?: number[]): AuditAdapter {
  switch (name) {
    case 'shopify':
      return new AuditShopifyAdapter(storeIds);
    case 'toffs':
      return new AuditToffsAdapter();
    case 'fruugo':
      return new AuditFruugoAdapter();
    case 'debenhams':
      return new AuditDebenhamsAdapter();
  }
}

// ============================================
// Redis Progress Updates
// ============================================

async function updateAuditStatus(status: AuditStatus): Promise<void> {
  try {
    await redis.set(REDIS_KEY_AUDIT_STATUS, JSON.stringify(status), 'EX', AUDIT_STATUS_TTL);
  } catch (err) {
    logger.warn({ err }, 'Failed to update audit status in Redis');
  }
}

// ============================================
// Main Audit Entry Point
// ============================================

export async function runAudit(options: AuditOptions): Promise<AuditRunResult> {
  const runId = nanoid(10);
  const startedAt = new Date();

  logger.info(
    {
      runId,
      marketplace: options.marketplace,
      from: options.fromDate.toISOString(),
      to: options.toDate.toISOString(),
      storeIds: options.storeIds,
    },
    'Starting order audit'
  );

  const adapter = createAuditAdapter(options.marketplace, options.storeIds);

  // Phase 1: Fetching from marketplace API
  await updateAuditStatus({
    status: 'running',
    startedAt: startedAt.toISOString(),
    progress: {
      currentStore: adapter.name,
      fetchedOrders: 0,
      totalStoresProcessed: 0,
      totalStores: adapter.storeIds.length,
      phase: 'fetching',
    },
  });

  let apiOrders: AuditMarketplaceOrder[] = [];
  const errors: AuditReport['errors'] = [];

  try {
    apiOrders = await adapter.fetchOrderDetails(options.fromDate, options.toDate);
    logger.info({ runId, orderCount: apiOrders.length }, 'API fetch complete');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ runId, err: errorMsg }, 'API fetch failed');
    errors.push({
      storeId: adapter.storeIds[0] ?? 0,
      storeName: adapter.name,
      error: errorMsg,
    });
  }

  // Early return for empty results
  if (apiOrders.length === 0) {
    const report: AuditReport = {
      runId,
      marketplace: adapter.name,
      fromDate: options.fromDate,
      toDate: options.toDate,
      generatedAt: new Date(),
      totalOrders: 0,
      summary: {
        totalFromApi: 0,
        foundInMo: 0,
        convertedToUkss: 0,
        missingFromMo: 0,
        unconverted: 0,
        productMismatches: 0,
      },
      orders: [],
      errors,
    };

    await updateAuditStatus({
      status: errors.length > 0 ? 'failed' : 'completed',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      error: errors.length > 0 ? errors[0].error : undefined,
    });

    await storeReport(report);
    return { report, runId };
  }

  // Phase 2: Cross-reference with DB
  await updateAuditStatus({
    status: 'running',
    startedAt: startedAt.toISOString(),
    progress: {
      currentStore: adapter.name,
      fetchedOrders: apiOrders.length,
      totalStoresProcessed: adapter.storeIds.length,
      totalStores: adapter.storeIds.length,
      phase: 'querying_db',
    },
  });

  let orders: AuditOrderRecord[];
  try {
    orders = await crossReferenceWithDb(apiOrders, adapter);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ runId, err: errorMsg }, 'DB cross-reference failed');
    errors.push({
      storeId: adapter.storeIds[0] ?? 0,
      storeName: adapter.name,
      error: `DB query failed: ${errorMsg}`,
    });
    // Build orders without DB data
    orders = apiOrders.map(apiOrder => buildEmptyRecord(apiOrder));
  }

  // Phase 3: Assemble report
  await updateAuditStatus({
    status: 'running',
    startedAt: startedAt.toISOString(),
    progress: {
      currentStore: adapter.name,
      fetchedOrders: apiOrders.length,
      totalStoresProcessed: adapter.storeIds.length,
      totalStores: adapter.storeIds.length,
      phase: 'assembling',
    },
  });

  let foundInMo = 0, convertedToUkss = 0, missingFromMo = 0, unconverted = 0, productMismatches = 0;
  for (const o of orders) {
    if (o.mo.found) foundInMo++;
    if (o.ukssOrder.found) convertedToUkss++;
    if (o.flags.missingFromMo) missingFromMo++;
    if (o.flags.unconverted) unconverted++;
    if (o.flags.productCountMismatch) productMismatches++;
  }

  const summary = {
    totalFromApi: apiOrders.length,
    foundInMo,
    convertedToUkss,
    missingFromMo,
    unconverted,
    productMismatches,
  };

  const report: AuditReport = {
    runId,
    marketplace: adapter.name,
    fromDate: options.fromDate,
    toDate: options.toDate,
    generatedAt: new Date(),
    totalOrders: orders.length,
    summary,
    orders,
    errors,
  };

  await updateAuditStatus({
    status: 'completed',
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
  });

  await storeReport(report);

  logger.info(
    { runId, ...summary, errorCount: errors.length },
    'Audit completed'
  );

  return { report, runId };
}

// ============================================
// Store Report in Redis
// ============================================

async function storeReport(report: AuditReport): Promise<void> {
  try {
    await redis.set(REDIS_KEY_AUDIT_REPORT, safeStringify(report), 'EX', AUDIT_REPORT_TTL);
  } catch (err) {
    logger.warn({ err }, 'Failed to store audit report in Redis');
  }
}

// ============================================
// DB Cross-Referencing (Task 7)
// ============================================

async function crossReferenceWithDb(
  apiOrders: AuditMarketplaceOrder[],
  adapter: AuditAdapter
): Promise<AuditOrderRecord[]> {
  const orderIds = apiOrders.map(o => o.orderId);
  const storeIds = adapter.storeIds;

  // Step 1: Query mo_marketplace_orders
  const moRecords = await prisma.moMarketplaceOrder.findMany({
    where: adapter.useExternalOrderId
      ? { moStoreId: { in: storeIds }, moExternalOrderId: { in: orderIds } }
      : { moStoreId: { in: storeIds }, moOrderId: { in: orderIds } },
    select: {
      moId: true,
      moOrderId: true,
      moExternalOrderId: true,
      moStoreId: true,
      moOrderStatus: true,
      moOrderCustomerName: true,
      moOrderCustomerEmail: true,
      moOrderShippingLine1: true,
      moOrderShippingCity: true,
      moOrderShippingCountry: true,
      moOrderShippingZipcode: true,
      moUkssOrderId: true,
      moDateAdded: true,
    },
  });

  // Build lookup map: orderId -> moRecord
  const moMap = new Map<string, (typeof moRecords)[number]>();
  for (const rec of moRecords) {
    const key = adapter.useExternalOrderId
      ? (rec.moExternalOrderId ?? rec.moOrderId)
      : rec.moOrderId;
    moMap.set(key, rec);
  }

  // Derive IDs needed for parallel queries
  const moIds = moRecords.map((r: (typeof moRecords)[number]) => r.moId);
  type MoRecord = (typeof moRecords)[number];
  const ukssOrderIds = moRecords
    .filter((r: MoRecord) => r.moUkssOrderId != null)
    .map((r: MoRecord) => r.moUkssOrderId!);

  // Steps 2-4: Query mop, orders, and orders_products in parallel
  const [mopRecords, ukssOrders, ukssProducts] = await Promise.all([
    // Step 2: mop_marketplace_order_products
    moIds.length > 0
      ? prisma.mopMarketplaceOrderProduct.findMany({
          where: { mopMoId: { in: moIds } },
          select: {
            mopId: true,
            mopMoId: true,
            mopProductSku: true,
            mopProductName: true,
            mopProductQuantity: true,
            mopProductPrice: true,
            mopUkssProductSku: true,
            mopUkssOrdersProductsId: true,
          },
        })
      : Promise.resolve([] as Array<{
          mopId: bigint;
          mopMoId: bigint;
          mopProductSku: string | null;
          mopProductName: string | null;
          mopProductQuantity: bigint | null;
          mopProductPrice: any;
          mopUkssProductSku: string;
          mopUkssOrdersProductsId: number | null;
        }>),
    // Step 3: orders (raw SQL)
    ukssOrderIds.length > 0
      ? prisma.$queryRawUnsafe<any[]>(
          `SELECT orders_id, orders_status, customers_name, customers_email_address,
                  delivery_street_address, delivery_city, delivery_postcode, delivery_country,
                  order_total, date_purchased
           FROM orders WHERE orders_id IN (${ukssOrderIds.map(() => '?').join(',')})`,
          ...ukssOrderIds
        )
      : Promise.resolve([] as any[]),
    // Step 4: orders_products (raw SQL)
    ukssOrderIds.length > 0
      ? prisma.$queryRawUnsafe<any[]>(
          `SELECT orders_products_id, orders_id, products_model, products_name,
                  products_quantity, products_price, final_price
           FROM orders_products WHERE orders_id IN (${ukssOrderIds.map(() => '?').join(',')})`,
          ...ukssOrderIds
        )
      : Promise.resolve([] as any[]),
  ]);

  // Build lookup map: moId -> mopRecord[]
  const mopMap = new Map<bigint, typeof mopRecords>();
  for (const rec of mopRecords) {
    const existing = mopMap.get(rec.mopMoId);
    if (existing) {
      existing.push(rec);
    } else {
      mopMap.set(rec.mopMoId, [rec]);
    }
  }

  // Fetch order status name mapping
  const statusNameMap = new Map<number, string>();
  try {
    const statusRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT orders_status_id, orders_status_name FROM orders_status WHERE language_id = 1`
    );
    for (const row of statusRows) {
      statusNameMap.set(Number(row.orders_status_id), row.orders_status_name);
    }
  } catch {
    logger.warn('Failed to fetch order status names — will show IDs only');
  }

  // Build lookup map: orders_id -> ukssOrder
  const ukssOrderMap = new Map<number, any>();
  for (const row of ukssOrders) {
    ukssOrderMap.set(Number(row.orders_id), row);
  }

  // Build lookup map: orders_id -> ukssProduct[]
  const ukssProductMap = new Map<number, any[]>();
  for (const row of ukssProducts) {
    const orderId = Number(row.orders_id);
    const existing = ukssProductMap.get(orderId);
    if (existing) {
      existing.push(row);
    } else {
      ukssProductMap.set(orderId, [row]);
    }
  }

  // Step 5: Assemble AuditOrderRecord[]
  const records: AuditOrderRecord[] = apiOrders.map(apiOrder => {
    const moRecord = moMap.get(apiOrder.orderId);

    if (!moRecord) {
      return buildEmptyRecord(apiOrder);
    }

    const moId = moRecord.moId;
    const products = mopMap.get(moId) ?? [];
    const ukssOrderId = moRecord.moUkssOrderId;
    const ukssOrder = ukssOrderId != null ? ukssOrderMap.get(ukssOrderId) : undefined;
    const ukssProds = ukssOrderId != null ? (ukssProductMap.get(ukssOrderId) ?? []) : [];

    const moData: AuditOrderRecord['mo'] = {
      found: true,
      moId: Number(moId),
      moOrderStatus: moRecord.moOrderStatus ?? undefined,
      moCustomerName: moRecord.moOrderCustomerName ?? undefined,
      moCustomerEmail: moRecord.moOrderCustomerEmail ?? undefined,
      moShippingLine1: moRecord.moOrderShippingLine1 ?? undefined,
      moShippingCity: moRecord.moOrderShippingCity ?? undefined,
      moShippingCountry: moRecord.moOrderShippingCountry ?? undefined,
      moShippingZipcode: moRecord.moOrderShippingZipcode ?? undefined,
      moUkssOrderId: moRecord.moUkssOrderId ?? undefined,
      moDateAdded: moRecord.moDateAdded,
    };

    const mopData: AuditOrderRecord['mop'] = {
      products: products.map(p => ({
        mopId: Number(p.mopId),
        mopProductSku: p.mopProductSku ?? '',
        mopProductName: p.mopProductName ?? '',
        mopProductQuantity: toNum(p.mopProductQuantity) ?? 0,
        mopProductPrice: Number(p.mopProductPrice),
        mopUkssProductSku: p.mopUkssProductSku,
        mopUkssOrdersProductsId: p.mopUkssOrdersProductsId ?? undefined,
      })),
    };

    const ukssOrderData: AuditOrderRecord['ukssOrder'] = ukssOrder
      ? {
          found: true,
          ordersId: Number(ukssOrder.orders_id),
          ordersStatus: Number(ukssOrder.orders_status),
          ordersStatusName: statusNameMap.get(Number(ukssOrder.orders_status)) ?? `Status ${ukssOrder.orders_status}`,
          customersName: ukssOrder.customers_name ?? undefined,
          customersEmailAddress: ukssOrder.customers_email_address ?? undefined,
          deliveryStreetAddress: ukssOrder.delivery_street_address ?? undefined,
          deliveryCity: ukssOrder.delivery_city ?? undefined,
          deliveryPostcode: ukssOrder.delivery_postcode ?? undefined,
          deliveryCountry: ukssOrder.delivery_country ?? undefined,
          orderTotal: ukssOrder.order_total != null ? Number(ukssOrder.order_total) : undefined,
          datePurchased: ukssOrder.date_purchased ?? undefined,
        }
      : { found: false };

    const ukssProductsData: AuditOrderRecord['ukssProducts'] = {
      products: ukssProds.map((p: any) => ({
        ordersProductsId: Number(p.orders_products_id),
        productsModel: p.products_model ?? '',
        productsName: p.products_name ?? '',
        productsQuantity: Number(p.products_quantity),
        productsPrice: Number(p.products_price),
        finalPrice: Number(p.final_price),
      })),
    };

    const productCountMismatch = detectProductMismatch(apiOrder.lineItems, products);

    return {
      marketplace: apiOrder,
      mo: moData,
      mop: mopData,
      ukssOrder: ukssOrderData,
      ukssProducts: ukssProductsData,
      flags: {
        missingFromMo: false,
        unconverted: ukssOrderId == null,
        productCountMismatch,
      },
    };
  });

  return records;
}

// ============================================
// Helper: Product mismatch detection
// ============================================

// FP rounding across multiple line items can drift by ~1 cent; 2 cents covers that.
const PRICE_TOLERANCE = 0.02;

const roundCents = (n: number) => Math.round(n * 100) / 100;

/**
 * Compares API line items with DB mop records using unique-SKU-based
 * quantity comparison rather than naive row count.
 *
 * Handles two known patterns:
 * 1. SKU-less line items (e.g. personalisation fees) — the DB absorbs
 *    their price into the parent product's mop_product_price rather than
 *    storing a separate row. We verify the amount is accounted for.
 * 2. Quantity splitting — the DB may store qty:2 as two separate rows
 *    (qty:1 each) for per-unit tracking. Grouping by SKU and summing
 *    quantities resolves these.
 */
function detectProductMismatch(
  apiLineItems: AuditMarketplaceOrder['lineItems'],
  dbProducts: Array<{
    mopProductSku: string | null;
    mopProductQuantity: bigint | null;
    mopProductPrice: number | string | null;
  }>
): boolean {
  if (dbProducts.length === 0 && apiLineItems.length > 0) return true;

  // Separate SKU-less items (e.g. personalisation add-ons) from real products
  const skuItems = apiLineItems.filter(li => li.sku && li.sku.trim() !== '');
  const skuLessItems = apiLineItems.filter(li => !li.sku || li.sku.trim() === '');

  const apiQtyMap = new Map<string, number>();
  for (const li of skuItems) {
    apiQtyMap.set(li.sku, (apiQtyMap.get(li.sku) ?? 0) + li.quantity);
  }

  const dbQtyMap = new Map<string, number>();
  for (const p of dbProducts) {
    const sku = p.mopProductSku ?? '';
    if (!sku) continue;
    dbQtyMap.set(sku, (dbQtyMap.get(sku) ?? 0) + Number(p.mopProductQuantity ?? 0));
  }

  // Check if SKU formats match between API and DB (e.g. Fruugo stores its own
  // product IDs like '691394598' while the API returns UKSS SKUs like 'p-386290-2641')
  const skuFormatsMatch = [...apiQtyMap.keys()].some(sku => dbQtyMap.has(sku));

  if (skuFormatsMatch || (apiQtyMap.size === 0 && dbQtyMap.size === 0)) {
    // SKU formats match — do exact per-SKU quantity comparison
    if (apiQtyMap.size !== dbQtyMap.size) return true;
    for (const [sku, apiQty] of apiQtyMap) {
      const dbQty = dbQtyMap.get(sku);
      if (dbQty == null || dbQty !== apiQty) return true;
    }
  } else {
    // SKU formats differ — fall back to comparing unique SKU count + total quantity
    if (apiQtyMap.size !== dbQtyMap.size) return true;
    const apiTotalQty = [...apiQtyMap.values()].reduce((a, b) => a + b, 0);
    const dbTotalQty = [...dbQtyMap.values()].reduce((a, b) => a + b, 0);
    if (apiTotalQty !== dbTotalQty) return true;
  }

  // Verify SKU-less item amounts are absorbed into DB product prices
  if (skuLessItems.length > 0) {
    const skuLessTotal = skuLessItems.reduce((sum, li) => sum + roundCents(li.price * li.quantity), 0);
    const apiSkuTotal = skuItems.reduce((sum, li) => sum + roundCents(li.price * li.quantity), 0);
    const dbTotal = dbProducts.reduce((sum, p) => sum + roundCents(Number(p.mopProductPrice ?? 0) * Number(p.mopProductQuantity ?? 0)), 0);

    if (Math.abs(dbTotal - (apiSkuTotal + skuLessTotal)) > PRICE_TOLERANCE) return true;
  }

  return false;
}

// ============================================
// Helper: Build empty record (no DB match)
// ============================================

function buildEmptyRecord(apiOrder: AuditMarketplaceOrder): AuditOrderRecord {
  return {
    marketplace: apiOrder,
    mo: { found: false },
    mop: { products: [] },
    ukssOrder: { found: false },
    ukssProducts: { products: [] },
    flags: {
      missingFromMo: true,
      unconverted: false, // Not applicable when missing from MO
      productCountMismatch: false,
    },
  };
}
