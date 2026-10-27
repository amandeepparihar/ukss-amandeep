/**
 * Debenhams Status Update Service
 *
 * Pushes order status updates (Ship/Cancel) to Debenhams (Mirakl) API.
 */

import { prisma } from '../../lib/prisma';
import { createLogger, type Logger } from '../../lib/logger';
import { nanoid } from 'nanoid';
import { config } from '../../config';
import { emailService } from '../../lib/email';
import { getOrderProductDetails } from '../../lib/marketplace-orders/marketplace-orders-products-util';
import type {
  DebenhamsStatusUpdateResult,
  DebenhamsStatusUpdateInput,
} from '../../lib/debenhams/debenhams.types';
import { cancelDebenhamsOrderLinesEmailTemplate } from './email-template';

const defaultLogger = createLogger('debenhams-status-update-service');

/**
 * Map a UKSS carrier slug to the code Debenhams (Mirakl) expects (PM #166488), using the
 * `DEBENHAMS_CARRIER_MAP` env config. Royal Mail must resolve to `ROYALMAIL` exactly, otherwise
 * Mirakl cannot build the tracking URL passed to Debenhams CS. Unmapped carriers and
 * null/undefined/empty inputs pass through unchanged so existing behaviour is preserved.
 */
function mapDebenhamsCarrier(carrierSlug: string | null | undefined): string {
  if (!carrierSlug) return carrierSlug ?? '';
  return config.DEBENHAMS_CARRIER_MAP[carrierSlug] ?? carrierSlug;
}

/**
 * Ship order on Debenhams (Mirakl)
 * Step 1: Update tracking information
 * Step 2: Mark order as shipped
 *
 * @param orderId - Debenhams order ID
 * @param lineItems - Line items with tracking info
 * @param logger - Optional logger
 */
async function shipDebenhamsOrder(
  orderId: string,
  lineItems: Array<{ id: string; quantity: number; trackingNumber?: string; carrier?: string }>,
  logger?: Logger
): Promise<{ success: boolean; error?: string }> {
  const log = logger || defaultLogger;

  log.info({ orderId, lineItems }, 'Shipping Debenhams order');

  const baseUrl = config.DEBENHAMS_API_BASE_URL;
  const debenhamsOrderId = orderId;
  const debenhamsOrderLineId = lineItems[0].id || '';
  // Map UKSS carrier slug to the code Mirakl expects (PM #166488): Royal Mail must be `ROYALMAIL`
  // exactly, otherwise Mirakl cannot build the tracking URL passed to Debenhams CS.
  const debenhamsCarrierCode = mapDebenhamsCarrier(lineItems[0].carrier || '');
  const debenhamsQuantity = Number(lineItems[0].quantity || 1);
  const debenhamsTrackingNumber = lineItems[0].trackingNumber || '';

  // Step 1: Create Shipment
  const carrierUrl = `${baseUrl}/shipments`;

  const requestBody = {
    "shipments": [
      {
        "order_id": debenhamsOrderId,
        "tracking": {
          "carrier_name": debenhamsCarrierCode,
          "tracking_number": debenhamsTrackingNumber,
        },
        "shipment_lines": [
          {
            "order_line_id": debenhamsOrderLineId,
            "quantity": debenhamsQuantity,
          }
        ],
        "shipped": true
      }
    ]
  };

  try {
    const apiKey = config.MIRAKL_DEBENHAMS_API_KEY;

    if (!apiKey) {
      log.error('MIRAKL_DEBENHAMS_API_KEY is not configured');
      return { success: false, error: 'MIRAKL_DEBENHAMS_API_KEY is not configured' };
    }

    log.info({ requestBody }, 'Debenhams shipment create request body');

    const headers: Record<string, string> = {
      'Authorization': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    const response = await fetch(carrierUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    log.info({ response: responseText }, 'Debenhams shipment create response');

    if (!response.ok) {
      const errorText = responseText;
      log.error({ status: response.status, error: errorText, carrierUrl }, 'Debenhams shipment create API failed');

      await emailService.sendErrorNotification({
        subject: `Debenhams Shipment Create Failed - Order ${orderId}`,
        errorMessage: `Hi Team,<br><br>Failed to create shipment on Debenhams.<br><br><b>Order ID:</b> ${orderId}<br><b>Carrier:</b> ${debenhamsCarrierCode}<br><b>Tracking Number:</b> ${debenhamsTrackingNumber}<br><b>API URL:</b> ${carrierUrl}<br><b>HTTP Status:</b> ${response.status}<br><b>Error Response:</b> ${errorText}`,
        module: 'debenhams-status-update-service',
        context: { orderId, carrierUrl, status: response.status, error: errorText },
      });

      return {
        success: false,
        error: `Shipment create failed - HTTP ${response.status}: ${errorText}`,
      };
    }

    log.info({ orderId, status: response.status }, 'Debenhams shipment created successfully');

    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: errorMessage, orderId }, 'Exception creating Debenhams shipment');
    return { success: false, error: errorMessage };
  }
}

/**
 * Cancel Debenhams order - sends email notification for manual cancellation
 * Note: Orders in SHIPPING state cannot be cancelled via API, requires manual action
 *
 * @param orderId - Debenhams order ID
 * @param logger - Optional logger
 */
async function cancelDebenhamsOrderLines(orderId: string, ukssOrderId: string, logger?: Logger) {
  const log = logger || defaultLogger;

  const sellerPanelUrl = `${config.DEBENHAMS_API_BASE_URL.replace('/api', '')}/mmp/shop/order/${orderId}`;
  const ukssEditOrderUrl = `${config.HTTP_HTTPS_SERVER}/webadmin/orders.php?oID=${ukssOrderId}&action=edit`;
  const emailHtml = cancelDebenhamsOrderLinesEmailTemplate(orderId, sellerPanelUrl, ukssEditOrderUrl);

  // Build recipient list - Simon + Dev team
  const recipients: string[] = [];

  // Add Simon's email
  recipients.push(config.CLIENT_EMAIL);

  // Add dev team email if configured
  if (config.DEVELOPMENT_TEAM_EMAIL) {
    recipients.push(config.DEVELOPMENT_TEAM_EMAIL);
  }

  await emailService.queueEmail({
    to: recipients,
    subject: `Cancel Debenhams Order Manually - ${orderId}`,
    html: emailHtml,
  });

  log.info({ orderId, recipients }, 'Debenhams cancellation email sent');
  return { success: true };
}

/**
 * Update single order status on Debenhams
 *
 * @param input - Status update input
 * @param logger - Optional logger
 */
async function updateDebenhamsOrderStatus(
  input: DebenhamsStatusUpdateInput,
  logger?: Logger
): Promise<{ success: boolean; mopId: number; status: string; error?: string }> {
  const log = logger || defaultLogger;

  const { mopId, orderId, ukssOrderId, orderLineId, quantity, status, trackingNumber, trackingCarrier } = input;

  log.info({ mopId, orderId, ukssOrderId, orderLineId, quantity, status, trackingNumber, trackingCarrier }, 'Updating Debenhams order status');

  try {
    let result: { success: boolean; error?: string };
    let updatedStatus = '';

    switch (status) {
      case 'SHIPPED':
        result = await shipDebenhamsOrder(
          orderId,
          [{ id: orderLineId, quantity, trackingNumber, carrier: trackingCarrier }],
          log
        );
        updatedStatus = 'Shipped';
        break;

      case 'CANCELED':
        result = await cancelDebenhamsOrderLines(orderId, ukssOrderId, log);
        updatedStatus = 'Cancelled';
        break;

      default:
        log.error({ status }, 'Unknown status type');
        return {
          success: false,
          mopId,
          status,
          error: `Unknown status type: ${status}`,
        };
    }

    if (result.success) {
      await prisma.mopMarketplaceOrderProduct.update({
        where: { mopId: BigInt(mopId) },
        data: {
          mopOrderStatusOfOrder: updatedStatus,
          mopApiResponse: 'Success',
        },
      });

      log.info({ mopId, orderId, updatedStatus }, 'Debenhams status updated successfully');

      return {
        success: true,
        mopId,
        status: updatedStatus,
      };
    } else {
      log.error({ mopId, orderId, error: result.error }, 'Debenhams status update failed');

      await emailService.sendErrorNotification({
        subject: `Debenhams Order Status Update Failed`,
        errorMessage: `Hi Team,<br><br>Failed to update Debenhams order status.<br><b>Order ID:</b> ${orderId}<br><b>Line ID:</b> ${orderLineId}<br><b>Status:</b> ${status}<br><b>Error:</b> ${result.error}`,
        module: 'debenhams-status-update-service',
        context: { mopId, orderId, orderLineId, status, error: result.error },
      });

      return {
        success: false,
        mopId,
        status,
        error: result.error,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: errorMessage, mopId, orderId }, 'Exception updating Debenhams status');

    await emailService.sendErrorNotification({
      subject: `Debenhams Order Status Update Exception`,
      errorMessage: `Hi Team,<br><br>Exception updating Debenhams order status.<br><b>Order ID:</b> ${orderId}<br><b>Error:</b> ${errorMessage}`,
      module: 'debenhams-status-update-service',
      context: { mopId, orderId, error: errorMessage },
    });

    return {
      success: false,
      mopId,
      status,
      error: errorMessage,
    };
  }
}

/**
 * Batch update all pending status updates for Debenhams
 *
 * Processes orders where mopApiResponse = 'Waiting' and status is actionable.
 */
export async function updateDebenhamsOrderStatuses(): Promise<DebenhamsStatusUpdateResult> {
  const executionId = nanoid(10);
  const logger = defaultLogger.child({ executionId });

  logger.info('Starting batch Debenhams order status update');

  try {
    const storeId = config.DEBENHAMS_STORE_ID;

    if (!storeId) {
      logger.warn('DEBENHAMS_STORE_ID not configured');
      return {
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };
    }

    const pendingProducts = await getOrderProductDetails([storeId], logger);

    logger.info({ pendingCount: pendingProducts.length }, 'Found pending Debenhams status updates');

    if (pendingProducts.length === 0) {
      return {
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };
    }

    const results: Array<{
      mopId: number;
      orderId: string;
      status: string;
      success: boolean;
      error?: string;
    }> = [];
    let succeeded = 0;
    let failed = 0;

    for (const product of pendingProducts) {
      const debenhamsStatus = product.mopOrderStatusToUpdate || '';

      if (!debenhamsStatus) {
        logger.warn(
          { mopId: product.mopId.toString() },
          'Empty status, skipping'
        );
        continue;
      }

      if (debenhamsStatus === 'SHIPPING') {
        logger.info({ mopId: product.mopId.toString() }, 'SHIPPING status, skipping');
        continue;
      }

      const input: DebenhamsStatusUpdateInput = {
        mopId: Number(product.mopId),
        orderId: product.mopOrderId || '',
        ukssOrderId: product.moOrder.moUkssOrderId || '',
        orderLineId: product.mopProductId || '',
        quantity: Number(product.mopProductQuantity || 1),
        status: debenhamsStatus,
        trackingNumber: product.mopUkssTrackingCode || undefined,
        trackingCarrier: product.mopUkssShippingCarrier || undefined,
      };

      const result = await updateDebenhamsOrderStatus(input, logger);

      results.push({
        mopId: result.mopId,
        orderId: input.orderId,
        status: result.status,
        success: result.success,
        error: result.error,
      });

      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }

      // Rate limit: 200ms between API calls
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    logger.info(
      { processed: pendingProducts.length, succeeded, failed },
      'Batch Debenhams order status update completed'
    );

    return {
      success: failed === 0,
      processed: pendingProducts.length,
      succeeded,
      failed,
      results,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage }, 'Batch Debenhams status update failed');

    await emailService.sendErrorNotification({
      subject: 'Debenhams Batch Status Update Failed',
      errorMessage: `Hi Team,<br><br>Batch Debenhams status update failed.<br><b>Error:</b> ${errorMessage}`,
      module: 'debenhams-status-update-service',
      context: { executionId, error: errorMessage },
    });

    return {
      success: false,
      processed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      error: errorMessage,
    };
  }
}
