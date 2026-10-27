/**
 * Fruugo Audit Adapter
 *
 * Fetches detailed order data from the Fruugo XML API for the audit report.
 * Delegates HTTP fetching and XML parsing to FruugoAdapter.fetchOrdersRaw() to avoid duplication.
 * Handles Fruugo's XML namespace variants (with and without 'o:' prefix).
 */

import type { AuditAdapter, AuditMarketplaceOrder, AuditLineItem } from '../audit.types';
import { FruugoAdapter } from './fruugo.adapter';
import { config } from '../../../config';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('audit-fruugo');

/** Shared adapter instance for raw API fetching */
const fruugoAdapter = new FruugoAdapter();

/**
 * Helper to get a field value from a Fruugo XML object,
 * handling the 'o:' namespace prefix variant.
 */
function getField(obj: any, key: string): any {
  if (!obj) return undefined;
  return obj[key] !== undefined ? obj[key] : obj[`o:${key}`];
}

export class AuditFruugoAdapter implements AuditAdapter {
  name = 'FRUUGO';
  storeIds: number[];

  constructor() {
    this.storeIds = config.FRUUGO_STORE_ID ? [config.FRUUGO_STORE_ID] : [];
  }

  async fetchOrderDetails(fromDate: Date, toDate: Date): Promise<AuditMarketplaceOrder[]> {
    const storeId = config.FRUUGO_STORE_ID;

    if (!storeId) {
      throw new Error('FRUUGO_STORE_ID is not configured');
    }

    const rawOrders = await fruugoAdapter.fetchOrdersRaw(fromDate, toDate);

    const orders: AuditMarketplaceOrder[] = rawOrders.map((order: any) => {
      const orderId = String(getField(order, 'orderId') || '');
      const orderDate = getField(order, 'orderDate') || new Date().toISOString();
      const status = String(getField(order, 'orderStatus') || 'unknown');

      // Customer details
      const customer = getField(order, 'customer');
      const firstName = String(getField(customer, 'firstName') || '');
      const lastName = String(getField(customer, 'lastName') || '');
      const customerName = `${firstName} ${lastName}`.trim() || 'Unknown';
      const customerEmail = String(getField(customer, 'email') || '');

      // Shipping address
      const shippingAddr = getField(order, 'shippingAddress');
      const shippingAddress = {
        line1: String(getField(shippingAddr, 'address1') || ''),
        city: String(getField(shippingAddr, 'city') || ''),
        postcode: String(getField(shippingAddr, 'postCode') || ''),
        country: String(getField(shippingAddr, 'countryCode') || ''),
      };

      // Order lines
      const orderLinesRoot = getField(order, 'orderLines');
      let orderLines = getField(orderLinesRoot, 'orderLine') || [];

      // Ensure it's always an array (single line item becomes an object)
      if (!Array.isArray(orderLines)) {
        orderLines = [orderLines];
      }

      const lineItems: AuditLineItem[] = orderLines
        .filter((line: any) => line)
        .map((line: any) => ({
          sku: String(getField(line, 'skuId') || ''),
          productName: String(getField(line, 'productTitle') || ''),
          quantity: parseInt(String(getField(line, 'totalNumberOfItems') || '1'), 10),
          price: parseFloat(String(getField(line, 'itemPricePerUnit') || '0')),
        }));

      return {
        orderId,
        storeName: 'Fruugo',
        storeId,
        orderDate: new Date(orderDate),
        status,
        customerName,
        customerEmail,
        shippingAddress,
        lineItems,
        marketplaceUrl: `https://sell.fruugo.com/orders/order-detail/${orderId}`,
      };
    });

    logger.info({ orderCount: orders.length }, 'Fetched audit orders from Fruugo');
    return orders;
  }

  async getOrderUrl(orderId: string, _storeId: number): Promise<string | null> {
    return `https://sell.fruugo.com/orders/order-detail/${orderId}`;
  }
}
