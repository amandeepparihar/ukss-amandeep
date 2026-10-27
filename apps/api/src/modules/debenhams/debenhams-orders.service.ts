/**
 * Debenhams Orders Service
 *
 * Fetches orders from Debenhams (Mirakl) API and stores them
 * in the marketplace orders tables.
 */

import { prisma } from '../../lib/prisma';
import { createLogger, type Logger } from '../../lib/logger';
import { nanoid } from 'nanoid';
import { config } from '../../config';
import { emailService } from '../../lib/email';
import { prepareDebenhamsOrderData } from '../../lib/debenhams/debenhams-order-data.utils';
import type {
  DebenhamsFetchOrdersResponse,
  DebenhamsFetchOrdersResult,
} from '../../lib/debenhams/debenhams.types';

const defaultLogger = createLogger('debenhams-orders-service');

/**
 * Build the orders API URL with query parameters
 */
function buildOrdersUrl(
  baseUrl: string,
  options: {
    orderId?: string;
    startDate?: Date;
    endDate?: Date;
    orderState?: string;
  }
): string {
  const { orderId, startDate, endDate, orderState } = options;

  // If specific order ID is requested
  if (orderId) {
    return `${baseUrl}/orders?order_ids=${orderId}`;
  }

  // Build URL with query parameters
  const url = new URL(`${baseUrl}/orders?max=${config.DEBENHAMS_FETCH_ORDER_COUNT}`);

  // Filter by order state (WAITING_ACCEPTANCE)
  if (orderState) {
    url.searchParams.set('order_state_codes', orderState);
  }

  // Date range (optional)  
  if (startDate) {
    url.searchParams.set('start_date', startDate.toISOString());
  }
  if (endDate) {
    url.searchParams.set('end_date', endDate.toISOString());
  }

  return url.toString();
}

/**
 * Make API request to Debenhams/Mirakl
 */
async function makeDebenhamsApiRequest<T>(
  url: string,
  method: 'GET' | 'PUT' | 'POST' = 'GET',
  body?: unknown,
  logger?: Logger
): Promise<{ success: boolean; data?: T; error?: string; status?: number }> {
  const log = logger || defaultLogger;

  const apiKey = config.MIRAKL_DEBENHAMS_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      error: 'MIRAKL_DEBENHAMS_API_KEY is not configured',
    };
  }

  try {
    log.debug({ url, method }, 'Making Debenhams API request');

    const headers: Record<string, string> = {
      'Authorization': apiKey,
      'Accept': 'application/json',
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error({ status: response.status, error: errorText, url }, 'Debenhams API request failed');

      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
        status: response.status,
      };
    }

    const data = await response.json() as T;

    return {
      success: true,
      data,
      status: response.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: message, url }, 'Debenhams API request exception');

    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Calculate date range for fetching orders
 */
async function getDateRange(
  storeId: number,
  logger?: Logger
): Promise<{ startDate: Date | undefined; endDate: Date | undefined }> {
  const log = logger || defaultLogger;

  const endDate = new Date();

  try {
    // Get the most recent successfully converted order date
    const lastOrder = await prisma.moMarketplaceOrder.findFirst({
      where: {
        moStoreId: storeId,
        moUkssOrderId: { not: null },
      },
      orderBy: { moOrderPlaceDate: 'desc' },
      select: { moOrderPlaceDate: true },
    });

    if (lastOrder?.moOrderPlaceDate) {
      // Start from 1 day before the last order to catch any stragglers
      const startDate = new Date(lastOrder.moOrderPlaceDate);
      startDate.setDate(startDate.getDate() - 1);

      log.info({ startDate, endDate }, 'Using date range from last order');
      return { startDate, endDate };
    }
  } catch (error) {
    log.warn({ error }, 'Error getting last order date, using default range');
  }
  
  return { startDate: undefined, endDate: undefined };
}

/**
 * Fetch orders from Debenhams API
 *
 * @param orderId - Optional specific order ID to fetch
 * @returns Fetch result with success status and order count
 */
export async function getDebenhamsOrders(orderId?: string): Promise<DebenhamsFetchOrdersResult> {
  const executionId = nanoid(10);
  const logger = defaultLogger.child({ executionId });

  logger.info({ orderId }, 'Starting Debenhams orders fetch');

  const storeId = config.DEBENHAMS_STORE_ID;
  const baseUrl = config.DEBENHAMS_API_BASE_URL;

  if (!baseUrl) {
    logger.error('DEBENHAMS_API_BASE_URL is not configured');
    return {
      success: false,
      message: 'DEBENHAMS_API_BASE_URL is not configured',
    };
  }

  try {
    // Determine date range
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (!orderId) {
      const dateRange = await getDateRange(storeId, logger);
      startDate = dateRange.startDate;
      endDate = dateRange.endDate;
    }

    // Build API URL
    const url = buildOrdersUrl(baseUrl, {
      orderId,
      startDate,
      endDate,
      orderState: orderId ? undefined : 'SHIPPING',
    });

    logger.info({ url }, 'Fetching orders from Debenhams API');

    // Make API request
    const response = await makeDebenhamsApiRequest<DebenhamsFetchOrdersResponse>(
      url,
      'GET',
      undefined,
      logger
    );

    if (!response.success || !response.data) {
      const errorMessage = response.error || 'Failed to fetch orders';
      logger.error({ error: errorMessage }, 'Failed to fetch Debenhams orders');

      await emailService.sendErrorNotification({
        subject: 'Debenhams Order Fetch Failed',
        errorMessage: `Hi Team,<br><br>Failed to fetch orders from Debenhams API.<br><b>Error:</b> ${errorMessage}`,
        module: 'debenhams-orders-service',
        context: { executionId, error: errorMessage },
      });

      return {
        success: false,
        message: errorMessage,
      };
    }

    const orders = response.data.orders || [];
    const totalCount = response.data.total_count || orders.length;

    logger.info({ orderCount: orders.length, totalCount }, 'Fetched orders from Debenhams');

    // Process and save orders
    if (orders.length > 0) {
      const insertResult = await prepareDebenhamsOrderData(orders, logger);
      logger.info({ insertResult }, 'Order insertion completed');
    }

    return {
      success: true,
      message: `Processed ${orders.length} orders`,
      orderCount: orders.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage }, 'Failed to fetch Debenhams orders');

    await emailService.sendErrorNotification({
      subject: 'Debenhams Order Fetch Failed',
      errorMessage: `Hi Team,<br><br>Exception while fetching Debenhams orders.<br><b>Error:</b> ${errorMessage}`,
      module: 'debenhams-orders-service',
      context: { executionId, error: errorMessage },
    });

    return {
      success: false,
      message: errorMessage,
    };
  }
}

