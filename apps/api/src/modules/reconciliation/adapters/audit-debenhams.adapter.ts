/**
 * Debenhams (Mirakl) Audit Adapter
 *
 * Fetches detailed order data from the Debenhams/Mirakl REST API for audit reports.
 * Delegates HTTP fetching and pagination to DebenhamsAdapter.fetchOrdersRaw() to avoid duplication.
 */

import type { AuditAdapter, AuditMarketplaceOrder, AuditLineItem } from '../audit.types';
import { DebenhamsAdapter } from './debenhams.adapter';
import { config } from '../../../config';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('audit-debenhams');

/** Shared adapter instance for raw API fetching */
const debenhamsAdapter = new DebenhamsAdapter();

export class AuditDebenhamsAdapter implements AuditAdapter {
  name = 'DEBENHAMS';
  storeIds: number[];

  constructor() {
    this.storeIds = [config.DEBENHAMS_STORE_ID];
  }

  async fetchOrderDetails(fromDate: Date, toDate: Date): Promise<AuditMarketplaceOrder[]> {
    const storeId = config.DEBENHAMS_STORE_ID;
    const storeName = config.DEBENHAMS_STORE_NAME;

    const rawOrders = await debenhamsAdapter.fetchOrdersRaw(fromDate, toDate);

    const allOrders: AuditMarketplaceOrder[] = rawOrders.map((order: any) => {
      const orderId = String(order.order_id || order.commercial_id);

      // Extract customer name: prefer customer object, fall back to shipping address
      const customerName = order.customer?.firstname && order.customer?.lastname
        ? `${order.customer.firstname} ${order.customer.lastname}`.trim()
        : `${order.shipping_address?.firstname || ''} ${order.shipping_address?.lastname || ''}`.trim();

      // Map line items
      const lineItems: AuditLineItem[] = (order.order_lines || []).map((line: any) => ({
        sku: line.offer_sku || line.product_sku || '',
        productName: line.product_title || '',
        quantity: line.quantity || 1,
        price: parseFloat(line.price || line.offer_price || '0'),
      }));

      return {
        orderId,
        storeName,
        storeId,
        orderDate: new Date(order.created_date || order.acceptance_decision_date),
        status: order.order_state || 'unknown',
        customerName,
        customerEmail: order.customer?.email || '',
        shippingAddress: {
          line1: order.shipping_address?.street_1 || '',
          city: order.shipping_address?.city || '',
          postcode: order.shipping_address?.zip_code || '',
          country: order.shipping_address?.country_iso_code || order.shipping_address?.country || '',
        },
        lineItems,
        marketplaceUrl: `https://debenhamsuk-prod.mirakl.net/order/${orderId}`,
      };
    });

    logger.info({ orderCount: allOrders.length }, 'Fetched order details from Debenhams/Mirakl for audit');
    return allOrders;
  }

  async getOrderUrl(orderId: string, _storeId: number): Promise<string | null> {
    return `https://debenhamsuk-prod.mirakl.net/order/${orderId}`;
  }
}
