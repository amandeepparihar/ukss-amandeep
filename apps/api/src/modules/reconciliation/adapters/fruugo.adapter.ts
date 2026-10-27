/**
 * Fruugo Reconciliation Adapter
 *
 * Fetches orders from the Fruugo XML API for reconciliation.
 * Reuses existing makeFruugoApiRequest() and fast-xml-parser.
 */

import type { ReconciliationAdapter } from './adapter.interface';
import type { MarketplaceApiOrder } from '../reconciliation.types';
import { makeFruugoApiRequest } from '../../fruugo/fruugo-order-service';
import { config } from '../../../config';
import { createLogger } from '../../../lib/logger';
import { XMLParser } from 'fast-xml-parser';

const logger = createLogger('reconciliation-fruugo');

/** Format a Date for the Fruugo API (Y-m-dTH:i:s format) */
export function formatDateForFruugo(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export class FruugoAdapter implements ReconciliationAdapter {
  name = 'FRUUGO';
  storeIds: number[];

  constructor() {
    this.storeIds = config.FRUUGO_STORE_ID ? [config.FRUUGO_STORE_ID] : [];
  }

  /**
   * Fetch raw Fruugo order objects from the XML API.
   * Shared by both reconciliation and audit adapters.
   * Returns parsed order objects (handling XML namespace variants).
   */
  async fetchOrdersRaw(fromDate: Date, toDate: Date): Promise<any[]> {
    const apiId = config.Fruugo_API_ID;
    const apiPassword = config.Fruugo_API_Password;
    const requestUrlTemplate = config.Fruugo_API_REQUEST_URL;

    if (!apiId || !apiPassword || !requestUrlTemplate || !config.FRUUGO_STORE_ID) {
      throw new Error('Fruugo API credentials, request URL, or store ID not configured');
    }

    // Format dates for Fruugo API (Y-m-dTH:i:s format)
    const fromTime = formatDateForFruugo(fromDate);
    const toTime = formatDateForFruugo(toDate);

    // Build URL (template uses %s placeholders or {from}/{to})
    let url = requestUrlTemplate;
    if (url.includes('%s')) {
      url = url.replace('%s', fromTime).replace('%s', toTime);
    } else {
      url = url.replace('{from}', fromTime).replace('{to}', toTime);
    }

    const response = await makeFruugoApiRequest(url, apiId, apiPassword, undefined, logger);

    if (response.curlErrorMsg || response.httpCode !== 200) {
      throw new Error(`Fruugo API error (${response.httpCode}): ${response.curlErrorMsg}`);
    }

    if (!response.data) {
      return [];
    }

    // Parse XML response
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    const parsed = parser.parse(response.data);

    // Fruugo XML structure: <orders><order>...</order></orders>
    // Or v2: <o:orders><o:order>...</o:order></o:orders>
    const ordersRoot = parsed.orders || parsed['o:orders'] || {};
    let rawOrders = ordersRoot.order || ordersRoot['o:order'] || [];

    // Ensure it's always an array
    if (!Array.isArray(rawOrders)) {
      rawOrders = [rawOrders];
    }

    return rawOrders.filter((order: any) => order);
  }

  async fetchOrders(fromDate: Date, toDate: Date): Promise<MarketplaceApiOrder[]> {
    const storeId = config.FRUUGO_STORE_ID;

    if (!storeId) {
      throw new Error('FRUUGO_STORE_ID is not configured');
    }

    const rawOrders = await this.fetchOrdersRaw(fromDate, toDate);

    const orders: MarketplaceApiOrder[] = rawOrders.map((order: any) => {
      // Calculate total product quantity
      let totalQty = 0;
      let orderLines = order.orderLines?.orderLine || order['o:orderLines']?.['o:orderLine'] || [];
      if (!Array.isArray(orderLines)) {
        orderLines = [orderLines];
      }
      for (const line of orderLines) {
        const qty = parseInt(line.totalNumberOfItems || line['o:totalNumberOfItems'] || '1', 10);
        totalQty += qty;
      }

      const orderId = String(order.orderId || order['o:orderId'] || '');
      const orderDate = order.orderDate || order['o:orderDate'] || new Date().toISOString();

      return {
        orderId,
        storeName: 'Fruugo',
        storeId,
        orderDate: new Date(orderDate),
        totalProductQuantity: totalQty,
        raw: { status: order.orderStatus || order['o:orderStatus'] },
      };
    });

    logger.info({ orderCount: orders.length }, 'Fetched orders from Fruugo');
    return orders;
  }

  async getOrderUrl(orderId: string, _storeId: number): Promise<string | null> {
    return `https://sell.fruugo.com/orders/order-detail/${orderId}`;
  }
}
