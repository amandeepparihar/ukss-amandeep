/**
 * Toffs (Magento 2) Reconciliation Adapter
 *
 * Fetches orders from the Toffs Magento 2 API for reconciliation.
 * Reuses existing proxy configuration and access token fetching.
 */

import type { ReconciliationAdapter } from './adapter.interface';
import type { MarketplaceApiOrder } from '../reconciliation.types';
import { fetchToffsAccessToken } from '../../../lib/toffs-token/toffs-token-utils';
import { config } from '../../../config';
import { createLogger } from '../../../lib/logger';
import { fetch, ProxyAgent } from 'undici';

const logger = createLogger('reconciliation-toffs');

export class ToffsAdapter implements ReconciliationAdapter {
  name = 'TOFFS';
  storeIds: number[];
  useExternalOrderId = true;

  constructor() {
    this.storeIds = config.TOFFS_STORE_ID ? [config.TOFFS_STORE_ID] : [];
  }

  /**
   * Fetch raw Toffs/Magento order objects from the API.
   * Shared by both reconciliation and audit adapters.
   */
  async fetchOrdersRaw(fromDate: Date, toDate: Date): Promise<any[]> {
    const baseUrl = config.TOFFS_API_ORDERS_URL;

    if (!baseUrl || !config.TOFFS_STORE_ID) {
      throw new Error('TOFFS_API_ORDERS_URL or TOFFS_STORE_ID is not configured');
    }

    const accessToken = await fetchToffsAccessToken(logger);
    if (!accessToken) {
      throw new Error('Failed to fetch TOFFS access token');
    }

    // Build search criteria for orders within date range
    const url = `${baseUrl}?` +
      `searchCriteria[filter_groups][0][filters][0][field]=created_at` +
      `&searchCriteria[filter_groups][0][filters][0][condition_type]=gteq` +
      `&searchCriteria[filter_groups][0][filters][0][value]=${fromDate.toISOString()}` +
      `&searchCriteria[filter_groups][1][filters][0][field]=created_at` +
      `&searchCriteria[filter_groups][1][filters][0][condition_type]=lteq` +
      `&searchCriteria[filter_groups][1][filters][0][value]=${toDate.toISOString()}`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'authorization': `Bearer ${accessToken}`,
    };

    if (config.TOFFS_PROXY_ENABLED) {
      headers['accept'] = 'application/json';
      headers['user-agent'] = 'PostmanRuntime/7.39.0';
    }

    const fetchOptions: any = {
      method: 'GET',
      headers,
    };

    if (config.TOFFS_PROXY_ENABLED) {
      const proxyUrl = `http://${config.TOFFS_PROXY_HOST}:${config.TOFFS_PROXY_PORT}`;
      const proxyAgent = new ProxyAgent({
        uri: proxyUrl,
        requestTls: { rejectUnauthorized: false },
      });
      fetchOptions.dispatcher = proxyAgent;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Toffs API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as { items?: any[]; total_count?: number };
    return data.items || [];
  }

  async fetchOrders(fromDate: Date, toDate: Date): Promise<MarketplaceApiOrder[]> {
    const storeName = config.TOFFS_STORE_NAME;
    const storeId = config.TOFFS_STORE_ID;

    if (!storeId) {
      throw new Error('TOFFS_STORE_ID is not configured');
    }

    const toffsOrders = await this.fetchOrdersRaw(fromDate, toDate);

    const orders: MarketplaceApiOrder[] = toffsOrders.map((order: any) => {
      const totalQty = (order.items || []).reduce(
        (sum: number, item: any) => sum + (item.qty_ordered || 0),
        0
      );

      return {
        orderId: String(order.increment_id || order.entity_id),
        storeName,
        storeId,
        orderDate: new Date(order.created_at),
        totalProductQuantity: totalQty,
        raw: { status: order.status, entity_id: order.entity_id },
      };
    });

    logger.info({ orderCount: orders.length }, 'Fetched orders from Toffs');
    return orders;
  }

  async getOrderUrl(orderId: string, _storeId: number): Promise<string | null> {
    const baseUrl = config.TOFFS_API_BASE_URL;
    if (!baseUrl) return null;
    return `${baseUrl}/sales/order/view/order_id/${orderId}`;
  }
}
