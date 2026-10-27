/**
 * Check 4: Unconverted Orders
 *
 * Finds orders in mo_marketplace_orders where:
 * - mo_ukss_order_id IS NULL
 * - The order is older than the unconverted threshold
 *
 * These orders were fetched from the marketplace but never
 * converted to UKSS orders. This check is DB-only.
 */

import { prisma } from '../../../lib/prisma';
import type { ReconciliationAdapter } from '../adapters/adapter.interface';
import type { UnconvertedOrdersResult } from '../reconciliation.types';

export async function checkUnconvertedOrders(
  storeIds: number[],
  unconvertedThresholdHours: number,
  windowFromDate: Date,
  adapter?: ReconciliationAdapter
): Promise<UnconvertedOrdersResult> {
  const thresholdDate = new Date();
  thresholdDate.setHours(thresholdDate.getHours() - unconvertedThresholdHours);

  const unconverted = await prisma.moMarketplaceOrder.findMany({
    where: {
      moStoreId: { in: storeIds },
      moUkssOrderId: null,
      moDateAdded: {
        gte: windowFromDate,
        lt: thresholdDate,
      },
    },
    select: {
      moId: true,
      moOrderId: true,
      moStoreId: true,
      moStoreName: true,
      moOrderPlaceDate: true,
      moDateAdded: true,
    },
    take: 1000,
  });

  const now = new Date();
  const unconvertedOrders = await Promise.all(
    unconverted.map(async o => ({
      moId: String(o.moId),
      orderId: o.moOrderId,
      storeName: o.moStoreName,
      orderDate: o.moOrderPlaceDate || o.moDateAdded,
      ageHours: Math.round((now.getTime() - o.moDateAdded.getTime()) / (1000 * 60 * 60) * 10) / 10,
      marketplaceUrl: (await adapter?.getOrderUrl(o.moOrderId, o.moStoreId)) ?? undefined,
    }))
  );

  return { unconvertedOrders };
}
