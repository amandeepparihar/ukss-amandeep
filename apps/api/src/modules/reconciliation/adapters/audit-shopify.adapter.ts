/**
 * Shopify Audit Adapter
 *
 * Fetches detailed order data from all active Shopify stores for the audit report.
 * Delegates HTTP fetching to ShopifyAdapter.fetchStoreOrdersRaw() to avoid duplication.
 */

import type { AuditAdapter, AuditMarketplaceOrder } from '../audit.types';
import { ShopifyAdapter, SHOPIFY_STORE_IDS } from './shopify.adapter';
import { createLogger } from '../../../lib/logger';
import { prisma } from '../../../lib/prisma';

const logger = createLogger('audit-shopify');

/** Shared adapter instance for raw API fetching */
const shopifyAdapter = new ShopifyAdapter();

export class AuditShopifyAdapter implements AuditAdapter {
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

  async fetchOrderDetails(fromDate: Date, toDate: Date): Promise<AuditMarketplaceOrder[]> {
    const allOrders: AuditMarketplaceOrder[] = [];

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
        const storeOrders = await this.fetchStoreOrderDetails(store.storeId, store.storeName, fromDate, toDate);
        allOrders.push(...storeOrders);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ storeId: store.storeId, storeName: store.storeName, error: msg }, 'Failed to fetch audit orders for store');
        // Continue with other stores - don't let one failure block all
      }
    }

    return allOrders;
  }

  private async fetchStoreOrderDetails(
    storeId: number,
    storeName: string,
    fromDate: Date,
    toDate: Date
  ): Promise<AuditMarketplaceOrder[]> {
    const { orders: rawOrders, shopDomain } = await shopifyAdapter.fetchStoreOrdersRaw(storeId, storeName, fromDate, toDate);

    return rawOrders.map((order: any) => {
      const customerName = `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim()
        || order.shipping_address?.name
        || 'Unknown';

      const shippingAddr = order.shipping_address || {};

      return {
        orderId: String(order.id),
        storeName,
        storeId,
        orderDate: new Date(order.created_at),
        status: order.fulfillment_status || 'unfulfilled',
        financialStatus: order.financial_status,
        customerName,
        customerEmail: order.customer?.email || order.email || '',
        shippingAddress: {
          line1: shippingAddr.address1 || '',
          city: shippingAddr.city || '',
          postcode: shippingAddr.zip || '',
          country: shippingAddr.country || '',
        },
        lineItems: (order.line_items || []).map((item: any) => ({
          sku: item.sku || '',
          productName: item.name || item.title,
          quantity: item.quantity,
          price: parseFloat(item.price),
        })),
        marketplaceUrl: `https://${shopDomain}/admin/orders/${order.id}`,
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
