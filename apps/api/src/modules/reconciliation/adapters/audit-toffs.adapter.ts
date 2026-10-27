/**
 * Toffs (Magento 2) Audit Adapter
 *
 * Fetches detailed order data from the Toffs Magento 2 API for audit reports.
 * Delegates HTTP fetching to ToffsAdapter.fetchOrdersRaw() to avoid duplication.
 */

import type { AuditAdapter, AuditMarketplaceOrder, AuditLineItem } from '../audit.types';
import { ToffsAdapter } from './toffs.adapter';
import { config } from '../../../config';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('audit-toffs');

/** Shared adapter instance for raw API fetching */
const toffsAdapter = new ToffsAdapter();

export class AuditToffsAdapter implements AuditAdapter {
  name = 'TOFFS';
  storeIds: number[];
  useExternalOrderId = true;

  constructor() {
    this.storeIds = config.TOFFS_STORE_ID ? [config.TOFFS_STORE_ID] : [];
  }

  async fetchOrderDetails(fromDate: Date, toDate: Date): Promise<AuditMarketplaceOrder[]> {
    const storeName = config.TOFFS_STORE_NAME;
    const storeId = config.TOFFS_STORE_ID;

    if (!storeId) {
      throw new Error('TOFFS_STORE_ID is not configured');
    }

    const toffsOrders = await toffsAdapter.fetchOrdersRaw(fromDate, toDate);

    const orders: AuditMarketplaceOrder[] = toffsOrders.map((order: any) => {
      // Extract shipping address from extension_attributes, fall back to billing_address
      const shippingAddr =
        order.extension_attributes?.shipping_assignments?.[0]?.shipping?.address ||
        order.billing_address;

      const shippingAddress = {
        line1: Array.isArray(shippingAddr?.street)
          ? shippingAddr.street.join(', ')
          : (shippingAddr?.street || ''),
        city: shippingAddr?.city || '',
        postcode: shippingAddr?.postcode || '',
        country: shippingAddr?.country_id || '',
      };

      // Map line items
      const lineItems: AuditLineItem[] = (order.items || []).map((item: any) => ({
        sku: item.sku || '',
        productName: item.name || '',
        quantity: item.qty_ordered || 0,
        price: parseFloat(item.price) || 0,
      }));

      const orderId = String(order.increment_id || order.entity_id);

      return {
        orderId,
        storeName,
        storeId,
        orderDate: new Date(order.created_at),
        status: order.status || 'unknown',
        customerName: `${order.customer_firstname || ''} ${order.customer_lastname || ''}`.trim(),
        customerEmail: order.customer_email || '',
        shippingAddress,
        lineItems,
        marketplaceUrl: this.buildOrderUrl(orderId),
      };
    });

    logger.info({ orderCount: orders.length }, 'Fetched order details from Toffs for audit');
    return orders;
  }

  async getOrderUrl(orderId: string, _storeId: number): Promise<string | null> {
    return this.buildOrderUrl(orderId);
  }

  private buildOrderUrl(orderId: string): string | null {
    const baseUrl = config.TOFFS_API_BASE_URL;
    if (!baseUrl) return null;
    return `${baseUrl}/sales/order/view/order_id/${orderId}`;
  }
}
