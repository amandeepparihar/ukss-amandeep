/**
 * Shopify Reconciliation Adapter
 *
 * Fetches orders from all active Shopify stores for reconciliation.
 * Uses cursor-based pagination via Link header for complete coverage.
 */

import type { ReconciliationAdapter } from './adapter.interface';
import type { MarketplaceApiOrder } from '../reconciliation.types';
import { getTokenCredentials } from '../../shopify/shopify-orders.service';
import { config } from '../../../config';
import { createLogger } from '../../../lib/logger';
import { prisma } from '../../../lib/prisma';

const logger = createLogger('reconciliation-shopify');

/** All active Shopify store IDs (verified against store_management table) */
export const SHOPIFY_STORE_IDS = [118, 124, 126, 129, 134, 141, 142, 145, 146, 117];

/** Personalised product IDs to exclude from quantity comparison (DB does not store these) */
const PERSONALISED_PRODUCT_IDS = new Set(
  (config.SOCCERCLASSICO_PERSONALIZED_OPTION_PRODUCT_ID ?? '').split(',').map(s => s.trim()).filter(Boolean)
);

export class ShopifyAdapter implements ReconciliationAdapter {
  name = 'SHOPIFY';
  storeIds: number[];

  constructor(filterStoreIds?: number[]) {
    if (filterStoreIds && filterStoreIds.length > 0) {
      // Intersect with known Shopify store IDs
      this.storeIds = SHOPIFY_STORE_IDS.filter(id => filterStoreIds.includes(id));
    } else {
      this.storeIds = SHOPIFY_STORE_IDS;
    }
  }

  async fetchOrders(fromDate: Date, toDate: Date): Promise<MarketplaceApiOrder[]> {
    const allOrders: MarketplaceApiOrder[] = [];

    // Fetch active Shopify stores from DB
    const stores = await prisma.storeManagement.findMany({
      where: {
        storeId: { in: this.storeIds },
        status: '1',
        storePlatform: 'Shopify',
      },
      select: {
        storeId: true,
        storeName: true,
      },
    });

    // Process each store sequentially to respect rate limits
    for (const store of stores) {
      try {
        const storeOrders = await this.fetchStoreOrders(store.storeId, store.storeName, fromDate, toDate);
        allOrders.push(...storeOrders);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ storeId: store.storeId, storeName: store.storeName, error: msg }, 'Failed to fetch orders for store');
        // Continue with other stores - don't let one failure block all
      }
    }

    return allOrders;
  }

  /**
   * Fetch raw Shopify order objects from a single store with cursor-based pagination.
   * Shared by both reconciliation and audit adapters.
   */
  async fetchStoreOrdersRaw(
    storeId: number,
    storeName: string,
    fromDate: Date,
    toDate: Date
  ): Promise<{ orders: any[]; shopDomain: string }> {
    const credentials = await getTokenCredentials(storeId);
    if (credentials === 'fail') {
      throw new Error(`Failed to get credentials for store ${storeId} (${storeName})`);
    }

    const rawOrders: any[] = [];
    let hasNextPage = true;
    let pageInfo: string | undefined;

    const params: Record<string, any> = {
      status: 'any',
      created_at_min: fromDate.toISOString(),
      created_at_max: toDate.toISOString(),
      limit: 250,
    };

    const shopDomain = credentials.ShopUrl;
    const apiVersion = config.SHOPIFY_API_VERSION || '2023-07';

    while (hasNextPage) {
      let apiUrl: string;

      if (pageInfo) {
        // Use page_info for subsequent pages (cursor-based pagination)
        apiUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders.json?page_info=${pageInfo}&limit=250`;
      } else {
        // First page uses regular params
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) {
            queryParams.append(key, String(value));
          }
        }
        apiUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders.json?${queryParams.toString()}`;
      }

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': credentials.AccessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as { orders?: any[] };
      rawOrders.push(...(data.orders || []));

      // Parse Link header for pagination
      const linkHeader = response.headers.get('link');
      hasNextPage = false;

      if (linkHeader) {
        const nextMatch = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        if (nextMatch) {
          pageInfo = nextMatch[1];
          hasNextPage = true;
        }
      }
    }

    logger.info({ storeId, storeName, orderCount: rawOrders.length }, 'Fetched raw orders from Shopify store');
    return { orders: rawOrders, shopDomain };
  }

  private async fetchStoreOrders(
    storeId: number,
    storeName: string,
    fromDate: Date,
    toDate: Date
  ): Promise<MarketplaceApiOrder[]> {
    const { orders: rawOrders } = await this.fetchStoreOrdersRaw(storeId, storeName, fromDate, toDate);

    return rawOrders.map((order: any) => {
      const totalQty = (order.line_items || []).reduce(
        (sum: number, item: any) =>
          PERSONALISED_PRODUCT_IDS.has(String(item.product_id)) ? sum : sum + (item.quantity || 0),
        0
      );

      return {
        orderId: String(order.id),
        storeName,
        storeId,
        orderDate: new Date(order.created_at),
        totalProductQuantity: totalQty,
        raw: { name: order.name, financial_status: order.financial_status },
      };
    });
  }

  async getOrderUrl(orderId: string, storeId: number): Promise<string | null> {
    try {
      const store = await prisma.storeManagement.findFirst({
        where: { storeId },
        select: { storeOrderIntegrationApiHostname: true },
      });

      if (!store?.storeOrderIntegrationApiHostname) return null;

      return `https://${store.storeOrderIntegrationApiHostname}/admin/orders/${orderId}`;
    } catch {
      return null;
    }
  }
}
