/**
 * Check 1: Missing Orders
 *
 * Compares orders fetched from the marketplace API against
 * orders stored in mo_marketplace_orders. Reports any orders
 * that exist on the marketplace but not in the local DB.
 */

import { prisma } from '../../../lib/prisma';
import type { ReconciliationAdapter } from '../adapters/adapter.interface';
import type {
  MarketplaceApiOrder,
  MissingOrderDetail,
  MissingOrdersResult,
} from '../reconciliation.types';

export async function checkMissingOrders(
  apiOrders: MarketplaceApiOrder[],
  storeIds: number[],
  adapter?: ReconciliationAdapter
): Promise<MissingOrdersResult> {
  if (apiOrders.length === 0) {
    return { apiOrderCount: 0, dbOrderCount: 0, missingOrders: [] };
  }

  // Get all unique order IDs from API, grouped by storeId+orderId
  const apiOrderKeys = apiOrders.map(o => ({ storeId: o.storeId, orderId: o.orderId }));

  // Query DB for all orders matching these store IDs within the time window
  // We use the order IDs from the API to check which ones exist
  const apiOrderIds = [...new Set(apiOrders.map(o => o.orderId))];

  // Toffs stores the marketplace increment_id in moExternalOrderId, not moOrderId
  const useExternalOrderId = adapter?.useExternalOrderId ?? false;

  const dbOrders = await prisma.moMarketplaceOrder.findMany({
    where: {
      moStoreId: { in: storeIds },
      ...(useExternalOrderId
        ? { moExternalOrderId: { in: apiOrderIds } }
        : { moOrderId: { in: apiOrderIds } }),
    },
    select: {
      moOrderId: true,
      moExternalOrderId: true,
      moStoreId: true,
    },
  });

  // Build a set of "storeId:orderId" keys that exist in DB
  // For Toffs, match against moExternalOrderId; for others, moOrderId
  const dbOrderSet = new Set(
    dbOrders.map(o => `${o.moStoreId}:${useExternalOrderId ? o.moExternalOrderId : o.moOrderId}`)
  );

  // Find orders in API but not in DB
  const missingApiOrders = apiOrders
    .filter(o => !dbOrderSet.has(`${o.storeId}:${o.orderId}`))
    // Deduplicate (same order might appear in multiple API pages)
    .filter((o, i, arr) => arr.findIndex(x => x.storeId === o.storeId && x.orderId === o.orderId) === i);

  // Build missing order details, enriching with marketplace URLs when adapter is available
  const missingOrders: MissingOrderDetail[] = await Promise.all(
    missingApiOrders.map(async (o) => {
      const detail: MissingOrderDetail = {
        orderId: o.orderId,
        storeName: o.storeName,
        orderDate: o.orderDate,
      };

      if (adapter) {
        const url = await adapter.getOrderUrl(o.orderId, o.storeId);
        if (url) {
          detail.marketplaceUrl = url;
        }
      }

      return detail;
    })
  );

  return {
    apiOrderCount: apiOrders.length,
    dbOrderCount: dbOrders.length,
    missingOrders,
  };
}
