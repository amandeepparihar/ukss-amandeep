/**
 * Check 3: Status Sync (Stuck Statuses)
 *
 * Finds orders in mop_marketplace_order_products where:
 * - mop_api_response = 'Waiting'
 * - mop_order_status_to_update is set (not 'Pending')
 * - The record has been in this state longer than the threshold
 *
 * These are status pushes that should have completed but haven't.
 * This check is DB-only and always runs, even if the API is down.
 */

import { prisma } from '../../../lib/prisma';
import type { ReconciliationAdapter } from '../adapters/adapter.interface';
import type { StatusSyncResult } from '../reconciliation.types';

export async function checkStatusSync(
  storeIds: number[],
  stuckThresholdHours: number,
  adapter?: ReconciliationAdapter
): Promise<StatusSyncResult> {
  const thresholdDate = new Date();
  thresholdDate.setHours(thresholdDate.getHours() - stuckThresholdHours);

  // Find stuck status pushes: Waiting for longer than threshold
  const stuckProducts = await prisma.mopMarketplaceOrderProduct.findMany({
    where: {
      moOrder: {
        moStoreId: { in: storeIds },
      },
      mopApiResponse: 'Waiting',
      mopOrderStatusToUpdate: { not: 'Pending' },
      mopDateModified: { lt: thresholdDate },
    },
    select: {
      mopId: true,
      mopOrderId: true,
      mopStoreName: true,
      mopOrderStatusToUpdate: true,
      mopDateModified: true,
      moOrder: { select: { moUkssOrderId: true, moStoreId: true } },
    },
    take: 1000,
  });

  const now = new Date();
  const stuckStatuses = await Promise.all(
    stuckProducts.map(async p => {
      const marketplaceUrl = adapter
        ? await adapter.getOrderUrl(p.mopOrderId, p.moOrder.moStoreId).catch(() => null)
        : undefined;

      return {
        mopId: String(p.mopId),
        orderId: p.mopOrderId,
        storeName: p.mopStoreName,
        statusToUpdate: p.mopOrderStatusToUpdate,
        waitingSinceHours: Math.round((now.getTime() - p.mopDateModified.getTime()) / (1000 * 60 * 60) * 10) / 10,
        ukssOrderId: p.moOrder?.moUkssOrderId ? String(p.moOrder.moUkssOrderId) : undefined,
        marketplaceUrl: marketplaceUrl ?? undefined,
      };
    })
  );

  return { stuckStatuses };
}
