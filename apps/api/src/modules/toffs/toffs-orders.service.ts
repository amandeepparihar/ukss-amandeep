import { prisma } from '../../lib/prisma';
import { createLogger, type Logger } from '../../lib/logger';
import { nanoid } from 'nanoid';
import { config } from '../../config';
import fs from 'fs/promises';
import path from 'path';

import { fetchToffsAccessToken } from '../../lib/toffs-token/toffs-token-utils';
import { getThreeDaysAgoDate } from '../../lib/helpers/common-utils';
import { ProxyAgent } from 'undici';
import { emailService } from '../../lib/email';
import { prepareToffsOrderData } from '../../lib/toffs-token/toffs-order-data.utils';
import {
    UpdateToffsOrderStatusInput,
    UpdateToffsOrderStatusResult,
    BatchUpdateToffsOrderStatusResult,
} from './toffs.schema';
import { getOrderProductDetails } from '../../lib/marketplace-orders/marketplace-orders-products-util';

const defaultLogger = createLogger('toffs-orders-service');

const TOFFS_MANUAL_ORDERS_DIR = path.join(process.cwd(), 'data');
const TOFFS_MANUAL_ORDERS_FILE = path.join(TOFFS_MANUAL_ORDERS_DIR, 'toffs-orders.json');
const TOFFS_ARCHIVE_DIR = path.join(TOFFS_MANUAL_ORDERS_DIR, 'archive');

const CLOUDFLARE_BLOCK_INDICATORS = [
    'Please enable cookies',
    'you have been blocked',
    'security by Cloudflare',
];

function isCloudflareBlock(body: string): boolean {
    return CLOUDFLARE_BLOCK_INDICATORS.some(indicator => body.includes(indicator));
}

async function archiveToffsOrderFile(logger: Logger): Promise<void> {
    try {
        await fs.mkdir(TOFFS_ARCHIVE_DIR, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archivePath = path.join(TOFFS_ARCHIVE_DIR, `toffs-orders-${timestamp}.json`);
        await fs.rename(TOFFS_MANUAL_ORDERS_FILE, archivePath);
        logger.info({ archivePath }, 'Archived toffs-orders.json');
    } catch (error) {
        logger.error({ error }, 'Failed to archive toffs-orders.json');
    }
}

async function processOrdersFromFile(
    orderId: string | undefined,
    logger: Logger,
    storeName: string,
    accessToken: string
): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
        const fileContent = await fs.readFile(TOFFS_MANUAL_ORDERS_FILE, 'utf-8');
        const data = JSON.parse(fileContent);

        if (!data.items || !Array.isArray(data.items)) {
            return { success: false, error: 'Invalid file format: missing items array' };
        }

        const toffsOrders = data.items;
        logger.info({ orderCount: toffsOrders.length }, 'Processing orders from manual file');

        if (toffsOrders.length > 0) {
            if (orderId) {
                const entityId = toffsOrders[0].entity_id;

                if (entityId) {
                    const existingOrder = await prisma.moMarketplaceOrder.findFirst({
                        where: { moOrderId: String(entityId) },
                        select: { moId: true },
                    });

                    if (existingOrder) {
                        await prisma.moMarketplaceOrder.delete({
                            where: { moId: existingOrder.moId },
                        });
                        logger.info({ orderId }, 'TOFFS order deleted successfully (from file)');
                    }
                }
            }

            await prepareToffsOrderData(toffsOrders, accessToken, logger, storeName);
        }

        await archiveToffsOrderFile(logger);

        return { success: true, data };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { success: false, error: 'Manual orders file not found. Waiting for manual data to be placed at data/toffs-orders.json (relative to API working directory)' };
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        return { success: false, error: `Failed to process orders from file: ${message}` };
    }
}

export async function getToffsOrders(orderId?: string) {
    const logger = defaultLogger.child({ executionId: nanoid(10) });

    logger.info({ orderId }, 'Starting TOFFS orders fetch');

    try {

        let url = ''

        const storeName = config.TOFFS_STORE_NAME

        if (orderId) {
            url = `${config.TOFFS_API_ORDERS_URL}?searchCriteria[filterGroups][0][filters][0][field]=increment_id&searchCriteria[filterGroups][0][filters][0][value]=${orderId}&searchCriteria[filterGroups][0][filters][0][condition_type]=eq`

            logger.info({ url }, 'TOFFS orders URL');
        } else {
            const lastOrderDate = await prisma.moMarketplaceOrder.findFirst({
                where: {
                    moStoreName: storeName,
                    moUkssOrderId: {
                        not: null,
                    },
                    moOrderUpdateDate: {
                        not: null,
                    }
                },
                select: {
                    moOrderUpdateDate: true,
                },
                orderBy: {
                    moOrderUpdateDate: 'desc',
                },
            })

            logger.info({ lastOrderDate }, 'Last order date');

            const fromDate = lastOrderDate?.moOrderUpdateDate ? lastOrderDate.moOrderUpdateDate : await getThreeDaysAgoDate();

            const fromDateValue = fromDate instanceof Date ? fromDate.toISOString() : fromDate;

            logger.debug({ fromDate, fromDateValue }, 'From date');

            url = `${config.TOFFS_API_ORDERS_URL}?searchCriteria[filter_groups][0][filters][0][field]=status&searchCriteria[filter_groups][0][filters][0][value]=processing&searchCriteria[filter_groups][1][filters][0][field]=updated_at&searchCriteria[filter_groups][1][filters][0][condition_type]=gt&searchCriteria[filter_groups][1][filters][0][value]=${fromDateValue}`

            logger.info({ url }, 'TOFFS orders URL');
        }

        const accessToken = await fetchToffsAccessToken(logger);

        if (!accessToken) {
            throw new Error('Failed to fetch TOFFS access token');
        }

        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'authorization': `Bearer ${accessToken}`,
        }

        if (config.TOFFS_PROXY_ENABLED) {
            headers['accept'] = 'application/json';
            headers['user-agent'] = 'PostmanRuntime/7.39.0';
        }

        const fetchOptions: any = {
            method: 'GET',
            headers,
        }

        if (config.TOFFS_PROXY_ENABLED) {
            const proxyUrl = `http://${config.TOFFS_PROXY_HOST}:${config.TOFFS_PROXY_PORT}`;
            const proxyAgent = new ProxyAgent({
                uri: proxyUrl,
                // Disable SSL verification when using proxy (matching PHP: CURLOPT_SSL_VERIFYPEER = false)
                requestTls: {
                    rejectUnauthorized: false,
                },
            });

            logger.info({ proxyUrl }, 'Using proxy for TOFFS API request');

            fetchOptions.dispatcher = proxyAgent;
        }

        const response = await fetch(url, fetchOptions);

        const responseText = await response.text();

        // Detect Cloudflare block
        if (isCloudflareBlock(responseText)) {
            logger.warn({ status: response.status, url }, 'TOFFS API blocked by Cloudflare');

            if (config.TOFFS_MANUAL_ORDER_FALLBACK_ENABLED) {
                // Send instructional email to team
                await emailService.sendErrorNotification({
                    subject: 'TOFFS API Blocked by Cloudflare - Manual Order Fetch Required',
                    errorMessage: `Hi Team,<br><br>` +
                        `The TOFFS API is currently blocked by Cloudflare and orders cannot be fetched automatically.<br><br>` +
                        `<b>Action Required:</b><br>` +
                        `1. Use Postman to fetch orders from the TOFFS API<br>` +
                        `2. URL that was being called: <code>${url}</code><br>` +
                        `3. Save the full API JSON response (with <code>items</code> array) to: <code>data/toffs-orders.json</code> (relative to the API working directory)<br>` +
                        `4. The system will automatically pick up and process the file on the next run<br><br>` +
                        `<b>Note:</b> After processing, the file will be archived automatically.`,
                    module: 'toffs-orders-service',
                    context: {
                        error: 'Cloudflare block detected',
                        url,
                        orderId,
                    },
                    priority: 3,
                    delay: 5000,
                });

                // Attempt to process from manual file
                const fileResult = await processOrdersFromFile(orderId, logger, storeName, accessToken);

                if (fileResult.success) {
                    logger.info('Successfully processed TOFFS orders from manual file');
                    return { success: true, data: fileResult.data };
                }

                logger.info({ message: fileResult.error }, 'Manual fallback file not available');
                return { success: false, error: fileResult.error };
            }

            // Fallback not enabled - throw error as before
            throw new Error(`Failed to fetch TOFFS orders: Cloudflare block detected`);
        }

        if (!response.ok) {
            logger.error({ errorText: responseText, status: response.status }, 'Failed to fetch TOFFS orders');
            throw new Error(`Failed to fetch TOFFS orders: ${responseText}`);
        }

        let data: any;
        try {
            data = JSON.parse(responseText);
        } catch {
            throw new Error(`Failed to parse TOFFS API response as JSON: ${responseText.substring(0, 200)}`);
        }

        const toffsOrders = data.items || [];

        if (toffsOrders.length > 0) {
            if (orderId) {
                const entityId = toffsOrders[0].entity_id;

                if (entityId) {
                    // First find the record to get the unique identifier (moId)
                    const existingOrder = await prisma.moMarketplaceOrder.findFirst({
                        where: {
                            moOrderId: String(entityId),
                        },
                        select: {
                            moId: true,
                        },
                    });

                    if (existingOrder) {
                        await prisma.moMarketplaceOrder.delete({
                            where: {
                                moId: existingOrder.moId,
                            },
                        });

                        logger.info({ orderId }, 'TOFFS order deleted successfully');
                    } else {
                        logger.warn({ orderId }, 'TOFFS order not found in database');
                    }
                } else {
                    logger.error({ orderId }, 'TOFFS order not found');
                }
            }

            await prepareToffsOrderData(toffsOrders, accessToken, logger, storeName);
        }

        return {
            success: true,
            data: data,
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
        logger.error({ error: errorMessage }, 'Failed to fetch TOFFS orders');
        emailService.sendErrorNotification({
            subject: `Error fetching TOFFS orders`,
            errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Get Toffs Orders <br><b>File:</b> apps/api/src/modules/toffs/toffs-orders.service.ts <br><b>Error:</b> Error fetching TOFFS orders: ${error}`,
            module: 'toffs-orders-service',
            context: {
                error: errorMessage,
                orderId: orderId,
            },
        });
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error',
        }
    }
}

/**
 * Update order status to TOFFS (Magento2)
 * Equivalent to PHP: case '143' in update_order_status_to_marketplaces()
 *
 * @param input - Order status update input
 * @param logger - Optional logger instance
 * @returns Update result
 */
export async function updateToffsOrderStatusToToffs(
    input: UpdateToffsOrderStatusInput,
    logger?: Logger,
): Promise<UpdateToffsOrderStatusResult> {
    const log = logger || defaultLogger;

    const {
        mopId,
        storeId,
        entity_id,
        order_item_id,
        statusToUpdate,
        trackingNumber,
        trackingCompany,
        storeName,
        quantity,
    } = input;

    log.info(
        { mopId, storeId, entity_id, order_item_id, statusToUpdate, trackingNumber, trackingCompany, storeName, quantity },
        'Starting TOFFS order status update'
    );

    try {
        const baseUrl = config.TOFFS_API_BASE_URL;

        const accessToken = await fetchToffsAccessToken(log);

        if (!accessToken) {
            const error = 'Failed to fetch TOFFS access token';
            log.error({ storeId, mopId }, error);

            await emailService.sendErrorNotification({
                subject: `Failed to fetch TOFFS access token`,
                errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Update TOFFS order status <br><b>File:</b> apps/api/src/modules/toffs/toffs-orders.service.ts <br><b>Error:</b> Failed to fetch TOFFS access token`,
                module: 'toffs-orders-service',
                context: {
                    storeId,
                    mopId,
                    entity_id,
                },
                priority: 3,
                delay: 5000,
            });

            return {
                success: false,
                mopId,
                status: statusToUpdate,
                error,
            };
        }

        let url = '';
        let requestBody: Record<string, unknown> = {};
        let updatedStatus = '';

        if (statusToUpdate === 'canceled') {
            // Cancel Order API - add comment + status
            url = `${baseUrl}/rest/V1/orders/${entity_id}/comments`;

            requestBody = {
                statusHistory: {
                    comment: 'Out of Stock',
                    status: 'canceled',
                    is_visible_on_front: 0,
                    is_customer_notified: 0,
                },
            };

            updatedStatus = 'Cancelled';
        } else if (statusToUpdate === 'complete') {
            // Ship Order API
            url = `${baseUrl}/rest/V1/order/${entity_id}/ship`;

            requestBody = {
                items: [
                    {
                        order_item_id: String(order_item_id),
                        qty: Number(quantity),
                    },
                ],
                tracks: [
                    {
                        track_number: trackingNumber || '',
                        title: trackingCompany || '',
                        carrier_code: trackingCompany ? trackingCompany.toLowerCase() : '',
                    },
                ],
            };

            updatedStatus = 'Shipped';
        } else {
            const error = `Unknown status type: ${statusToUpdate}`;
            log.error({ mopId, statusToUpdate }, error);
            return {
                success: false,
                mopId,
                status: statusToUpdate,
                error,
            };
        }

        log.info({ url, requestBody: JSON.stringify(requestBody) }, 'TOFFS API request');

        // Build headers
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        };

        // Build fetch options
        const fetchOptions: RequestInit & { dispatcher?: unknown } = {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
        };

        // Configure proxy if enabled
        if (config.TOFFS_PROXY_ENABLED) {
            headers['User-Agent'] = 'PostmanRuntime/7.39.0';

            const proxyUrl = `http://${config.TOFFS_PROXY_HOST}:${config.TOFFS_PROXY_PORT}`;
            const proxyAgent = new ProxyAgent({
                uri: proxyUrl,
                requestTls: {
                    rejectUnauthorized: false,
                },
            });

            log.info({ proxyUrl }, 'Using proxy for TOFFS API request');
            fetchOptions.dispatcher = proxyAgent;
        }

        // Make API call
        const response = await fetch(url, fetchOptions as RequestInit);
        const statusCode = response.status;
        const result = await response.text();

        log.info({ statusCode, result }, 'TOFFS API response');

        if (statusCode === 200) {
            // Update mop_marketplace_order_products
            await prisma.mopMarketplaceOrderProduct.update({
                where: { mopId: BigInt(mopId) },
                data: {
                    mopOrderStatusOfOrder: updatedStatus,
                    mopApiResponse: 'Success',
                },
            });

            log.info(
                { mopId, entity_id, newStatus: updatedStatus },
                `Order status ${updatedStatus} updated successfully for Toffs`
            );

            return {
                success: true,
                mopId,
                status: updatedStatus,
            };
        } else {
            const error = `TOFFS API failed with status ${statusCode}: ${result}`;
            log.error({ mopId, entity_id, statusCode, result }, error);

            await emailService.sendErrorNotification({
                subject: `Error: Toffs Order status API Failed`,
                errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module:</b> Order Status Management<br><b>Marketplace:</b> TOFFS<br><b>Marketplace Order ID:</b> ${entity_id}<br><b>Error:</b> The order status update API failed.<br><b>API Response:</b> ${result}`,
                module: 'toffs-orders-service',
                context: {
                    mopId,
                    entity_id,
                    statusCode,
                    result,
                    statusToUpdate,
                },
                priority: 3,
                delay: 5000,
            });

            return {
                success: false,
                mopId,
                status: statusToUpdate,
                error,
            };
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error(
            { error: message, mopId, entity_id, statusToUpdate },
            'Failed to update TOFFS order status'
        );

        await emailService.sendErrorNotification({
            subject: `Error: Toffs Order status update failed`,
            errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module:</b> Order Status Management<br><b>Marketplace:</b> TOFFS<br><b>Marketplace Order ID:</b> ${entity_id}<br><b>Error:</b> ${message}`,
            module: 'toffs-orders-service',
            context: {
                mopId,
                entity_id,
                statusToUpdate,
                error: message,
            },
            priority: 3,
            delay: 5000,
        });

        return {
            success: false,
            mopId,
            status: statusToUpdate,
            error: message,
        };
    }
}

/**
 * Batch update order statuses to TOFFS
 *
 * Processes multiple order status updates for TOFFS store
 *
 * @returns Batch update results
 */
export async function updateToffsOrderStatusesToToffs(): Promise<BatchUpdateToffsOrderStatusResult> {
    const executionId = nanoid(10);
    const logger = defaultLogger.child({ executionId });

    logger.info({ executionId }, 'Starting batch TOFFS order status update');

    try {
        // Get TOFFS store ID from config
        const toffsStoreId = config.TOFFS_STORE_ID;

        if (!toffsStoreId) {
            logger.warn('TOFFS_STORE_ID not configured');
            return {
                success: true,
                processed: 0,
                succeeded: 0,
                failed: 0,
                results: [],
            };
        }

        // Fetch order products with pending status updates
        const pendingProducts = await getOrderProductDetails([toffsStoreId], logger);

        logger.info(
            { pendingCount: pendingProducts.length },
            'Found pending order products for TOFFS status update'
        );

        if (pendingProducts.length === 0) {
            return {
                success: true,
                processed: 0,
                succeeded: 0,
                failed: 0,
                results: [],
            };
        }

        // Process each order product
        const results: UpdateToffsOrderStatusResult[] = [];
        let succeeded = 0;
        let failed = 0;

        for (const product of pendingProducts) {
            const input: UpdateToffsOrderStatusInput = {
                mopId: Number(product.mopId),
                storeId: product.moOrder.moStoreId || 0,
                entity_id: product.mopOrderId || '',
                order_item_id: product.mopProductId || '',
                statusToUpdate: product.mopOrderStatusToUpdate as 'canceled' | 'complete',
                trackingNumber: product.mopUkssTrackingCode || undefined,
                trackingCompany: product.mopUkssShippingCarrier || undefined,
                storeName: product.moOrder.moStoreName || undefined,
                quantity: product.mopProductQuantity || 1,
            };

            const result = await updateToffsOrderStatusToToffs(input, logger);
            results.push(result);

            if (result.success) {
                succeeded++;
            } else {
                failed++;
            }

            // Small delay between API calls to respect rate limits
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        logger.info(
            {
                processed: pendingProducts.length,
                succeeded,
                failed,
            },
            'Batch TOFFS order status update completed'
        );

        return {
            success: failed === 0,
            processed: pendingProducts.length,
            succeeded,
            failed,
            results,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error: message }, 'Batch TOFFS order status update failed');

        await emailService.sendErrorNotification({
            subject: `TOFFS Order Status Update Failed`,
            errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module:</b> Order Status Management<br><b>Marketplace:</b> TOFFS<br><b>Error:</b> ${message}`,
            module: 'toffs-orders-service',
            context: {
                error: message,
            },
        });

        return {
            success: false,
            processed: 0,
            succeeded: 0,
            failed: 0,
            results: [],
            error: message,
        };
    }
}
