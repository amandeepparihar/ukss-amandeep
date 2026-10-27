/**
 * Debenhams (Mirakl) Reconciliation Adapter
 *
 * Fetches orders from the Debenhams/Mirakl REST API for reconciliation.
 * Reuses the API pattern from debenhams-orders.service.ts.
 */

import type { ReconciliationAdapter } from './adapter.interface';
import type { MarketplaceApiOrder } from '../reconciliation.types';
import { config } from '../../../config';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('reconciliation-debenhams');

export class DebenhamsAdapter implements ReconciliationAdapter {
  name = 'DEBENHAMS';
  storeIds: number[];

  constructor() {
    this.storeIds = [config.DEBENHAMS_STORE_ID];
  }

  /**
   * Fetch raw Debenhams/Mirakl order objects from the API with pagination.
   * Shared by both reconciliation and audit adapters.
   */
  async fetchOrdersRaw(fromDate: Date, toDate: Date): Promise<any[]> {
    const apiKey = config.MIRAKL_DEBENHAMS_API_KEY;

    if (!apiKey) {
      throw new Error('MIRAKL_DEBENHAMS_API_KEY is not configured');
    }

    // Determine the base URL based on environment
    const baseUrl = config.MIRAKL_TEST_ENVIRONMENT
      ? config.MIRAKL_DEBENHAMS_STAGING_URL
      : config.MIRAKL_DEBENHAMS_PRODUCTION_URL;

    const allRawOrders: any[] = [];
    let offset = 0;
    const maxPerPage = config.DEBENHAMS_FETCH_ORDER_COUNT || 50;
    let hasMore = true;

    while (hasMore) {
      const url = new URL(`${baseUrl}/api/orders`);
      url.searchParams.set('start_date', fromDate.toISOString());
      url.searchParams.set('end_date', toDate.toISOString());
      url.searchParams.set('max', String(maxPerPage));
      url.searchParams.set('offset', String(offset));

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': apiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Debenhams/Mirakl API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as { orders?: any[]; total_count?: number };
      const miraklOrders = data.orders || [];

      allRawOrders.push(...miraklOrders);

      // Check if there are more pages
      if (miraklOrders.length < maxPerPage) {
        hasMore = false;
      } else {
        offset += maxPerPage;
      }
    }

    return allRawOrders;
  }

  async fetchOrders(fromDate: Date, toDate: Date): Promise<MarketplaceApiOrder[]> {
    const storeId = config.DEBENHAMS_STORE_ID;
    const storeName = config.DEBENHAMS_STORE_NAME;

    const rawOrders = await this.fetchOrdersRaw(fromDate, toDate);

    const allOrders: MarketplaceApiOrder[] = rawOrders.map((order: any) => {
      // Each Mirakl order has order_lines with quantities
      let totalQty = 0;
      const orderLines = order.order_lines || [];
      for (const line of orderLines) {
        totalQty += (line.quantity || 1);
      }

      return {
        orderId: String(order.order_id || order.commercial_id),
        storeName,
        storeId,
        orderDate: new Date(order.created_date || order.acceptance_decision_date),
        totalProductQuantity: totalQty,
        raw: { state: order.order_state, commercial_id: order.commercial_id },
      };
    });

    logger.info({ orderCount: allOrders.length }, 'Fetched orders from Debenhams/Mirakl');
    return allOrders;
  }

  async getOrderUrl(orderId: string, _storeId: number): Promise<string | null> {
    return `https://debenhamsuk-prod.mirakl.net/order/${orderId}`;
  }
}
