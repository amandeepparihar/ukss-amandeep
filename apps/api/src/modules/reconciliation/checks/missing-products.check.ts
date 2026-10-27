/**
 * Check 2: Missing Products (Product Count Mismatch)
 *
 * For orders that exist in both the marketplace API and DB,
 * compares the product count. API gives sum(line_items[].quantity),
 * DB count is rows in mop_marketplace_order_products (one row per unit).
 */

import { prisma } from '../../../lib/prisma';
import type { ReconciliationAdapter } from '../adapters/adapter.interface';
import type {
  MarketplaceApiOrder,
  MissingProductsResult,
} from '../reconciliation.types';

export async function checkMissingProducts(
  apiOrders: MarketplaceApiOrder[],
  storeIds: number[],
  adapter?: ReconciliationAdapter
): Promise<MissingProductsResult> {
  if (apiOrders.length === 0) {
    return { mismatches: [] };
  }

  const apiOrderIds = [...new Set(apiOrders.map(o => o.orderId))];

  // Get orders from DB with their product counts
  const dbOrders = await prisma.moMarketplaceOrder.findMany({
    where: {
      moStoreId: { in: storeIds },
      moOrderId: { in: apiOrderIds },
    },
    select: {
      moId: true,
      moOrderId: true,
      moStoreId: true,
      moStoreName: true,
      moUkssOrderId: true,
      _count: {
        select: {
          products: true,
        },
      },
    },
  });

  // Build a map of "storeId:orderId" -> dbProductCount + ukssOrderId
  const dbProductCountMap = new Map<string, { count: number; storeName: string; ukssOrderId?: string }>();
  for (const order of dbOrders) {
    const key = `${order.moStoreId}:${order.moOrderId}`;
    dbProductCountMap.set(key, {
      count: order._count.products,
      storeName: order.moStoreName,
      ukssOrderId: order.moUkssOrderId ? String(order.moUkssOrderId) : undefined,
    });
  }

  // Build API quantity map (deduplicated by storeId:orderId)
  const apiQuantityMap = new Map<string, { qty: number; storeName: string }>();
  for (const order of apiOrders) {
    const key = `${order.storeId}:${order.orderId}`;
    if (!apiQuantityMap.has(key)) {
      apiQuantityMap.set(key, { qty: order.totalProductQuantity, storeName: order.storeName });
    }
  }

  // Compare product counts
  const mismatchPromises = [];
  for (const [key, apiData] of apiQuantityMap) {
    const dbData = dbProductCountMap.get(key);
    if (dbData && dbData.count !== apiData.qty) {
      const [storeIdStr, orderId] = key.split(':');
      const storeId = Number(storeIdStr);
      mismatchPromises.push(
        (async () => {
          const marketplaceUrl = adapter
            ? await adapter.getOrderUrl(orderId, storeId).catch(() => null)
            : null;
          return {
            orderId,
            storeName: apiData.storeName,
            apiQuantity: apiData.qty,
            dbQuantity: dbData.count,
            ukssOrderId: dbData.ukssOrderId,
            marketplaceUrl: marketplaceUrl ?? undefined,
          };
        })()
      );
    }
  }

  const mismatches = await Promise.all(mismatchPromises);

  return { mismatches };
}
