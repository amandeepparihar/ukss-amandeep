/**
 * Fruugo Status Update Service
 * 
 * Updates order statuses to marketplaces (Fruugo and others)
 * Converted from CakePHP function: update_order_status_to_marketplaces()
 */

import { createLogger, type Logger } from "../../lib/logger";
import { nanoid } from "nanoid";
import { config } from "../../config";
import { prisma } from "../../lib/prisma";
import { emailService } from "../../lib/email";
import { getOrderProductDetails } from "../../lib/marketplace-orders/marketplace-orders-products-util";
import { makeFruugoApiRequest } from "./fruugo-order-service";
import { UpdateFruugoOrderStatusInput, UpdateFruugoOrderStatusResult } from "./fruugo.schema";

const defaultLogger = createLogger('fruugo-status-update-service');


export async function updateFruugoOrderStatusToFruugo(input: UpdateFruugoOrderStatusInput, logger?: Logger): Promise<UpdateFruugoOrderStatusResult> {
    const log = logger || defaultLogger;

    const {
        mopId,
        storeId,
        mopOrderId,
        mopOrderProductId,
        quantityOfOrderProduct,
        cancelReason,
        mopSkuId,
        status,
        trackingNo,
        trackingCompany,
    } = input;

    log.info({
        mopId,
        storeId,
        mopOrderId,
        mopOrderProductId,
        quantityOfOrderProduct,
        cancelReason,
        mopSkuId,
    }, 'Updating Fruugo order status to Fruugo');

    try {
        const apiId = config.Fruugo_API_ID;
        const apiPassword = config.Fruugo_API_Password;

        const fruugoOrderId = mopOrderId;
        const fruugoProductId = mopOrderProductId;
        const fruugoSkuId = mopSkuId;
        const quantity = quantityOfOrderProduct;
        const item = `${fruugoProductId},${fruugoSkuId},${quantity}`;

        let url: string;
        let fields: Record<string, string>;

        const statusUpdateUrlBase = config.Fruugo_API_STATUS_UPDATE_URL;

        if (!apiId || !apiPassword || !statusUpdateUrlBase) {
            throw new Error('Fruugo API credentials or status update URL not configured');
        }

        if (status === 'Confirmed') {
            url = `${statusUpdateUrlBase}confirm`;
            fields = {
                orderId: fruugoOrderId,
                item: item,
            };
        } else if (status === 'Shipped') {
            url = `${statusUpdateUrlBase}ship`;
            fields = {
                orderId: fruugoOrderId,
                item: item,
                trackingCode: trackingNo || '',
                trackingUrl: trackingCompany || '',
            };
        } else if (status === 'Cancelled') {
            url = `${statusUpdateUrlBase}cancel`;
            fields = {
                orderId: fruugoOrderId,
                item: item,
                cancellationReason: cancelReason,
            };
        } else {
            url = `${statusUpdateUrlBase}return`;
            fields = {
                orderId: fruugoOrderId,
                item: item,
                returnReason: 'other',
            };
        }

        const response = await makeFruugoApiRequest(url, apiId, apiPassword,fields, log);
        const httpCode = response.httpCode;
        const data = response.data;
        const curlErrorMsg = response.curlErrorMsg;

        if (httpCode === 200) {
            log.info({ data, httpCode, curlErrorMsg }, 'Fruugo order status updated successfully');

            await prisma.mopMarketplaceOrderProduct.update({
                where: { mopId: BigInt(mopId) },
                data: {
                    mopOrderStatusOfOrder: status,
                    mopApiResponse: 'Success',
                },
            });

            log.info({ mopId, status }, 'Fruugo order status updated successfully in marketplace order product table');

        } else {
            log.error({ data, httpCode, curlErrorMsg }, 'Fruugo order status update failed');
            await emailService.sendErrorNotification({
                subject: 'Error: Fruugo Order status API Failed.',
                errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Order Status Management <br><b>File:</b> apps/api/src/modules/fruugo/fruugo-status-update-service.ts<br> <b>Marketplace:</b> FRUUGO <br><b>Error:</b> ${curlErrorMsg}`,
                module: 'fruugo-status-update',
                context: {
                    data,
                    httpCode,
                    curlErrorMsg,
                },
            });

            throw new Error(`Fruugo order status update failed: ${curlErrorMsg}`);
        }

        return { success: true, mopId, status };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error({ error, errorMessage }, 'Failed to update Fruugo order status to Fruugo');
        return { success: false, mopId, status, error: errorMessage };
    }
}

/**
 * Update Fruugo order statuses to Fruugo
 * 
 * @returns Promise that resolves when the operation completes
 */
export async function updateFruugoOrderStatusesToFruugo() {
    const executionId = nanoid(10);
    const logger = defaultLogger.child({ executionId });

    logger.info('Starting updateFruugoOrderStatusesToFruugo function');

    try {

        const fruugoStoreId = config.FRUUGO_STORE_ID;

        if (!fruugoStoreId) {
            logger.error('Fruugo store ID not configured');
            return {
                success: false,
                processed: 0,
                succeeded: 0,
                failed: 0,
                results: [],
            };
        }

        const orderProductsDetails = await getOrderProductDetails([fruugoStoreId], logger);

        // Check if order products exist
        if (!orderProductsDetails || orderProductsDetails.length === 0) {
            logger.info('No order products found for status update');
            return {
                success: true,
                processed: 0,
                succeeded: 0,
                failed: 0,
                results: [],
            };
        }

        logger.info({ count: orderProductsDetails.length }, 'Found order products for status update');

        // Process each order product
        const results: UpdateFruugoOrderStatusResult[] = [];
        let succeeded = 0;
        let failed = 0;

        // Process each order product
        for (const orderProductsDetail of orderProductsDetails) {
            const input: UpdateFruugoOrderStatusInput = {
                mopId: Number(orderProductsDetail.mopId),
                storeId: orderProductsDetail.moOrder.moStoreId || 0,
                mopOrderId: orderProductsDetail.mopOrderId || '',
                mopOrderProductId: orderProductsDetail.mopProductId || '',
                quantityOfOrderProduct: orderProductsDetail.mopProductQuantity || 1,
                cancelReason: 'out_of_stock',
                mopSkuId: orderProductsDetail.mopProductSku || '',
                status: orderProductsDetail.mopOrderStatusToUpdate || '',
                trackingNo: orderProductsDetail.mopUkssTrackingCode || '',
                trackingCompany: orderProductsDetail.mopUkssShippingCarrier || '',
            }

            const result = await updateFruugoOrderStatusToFruugo(input, logger);
            results.push(result);

            if (result.success) {
                succeeded++;
            } else {
                failed++;
            }

            await new Promise((resolve) => setTimeout(resolve, 200));

        }

        logger.info({
            processed: orderProductsDetails.length,
            succeeded,
            failed,
        }, 'Completed processing order products');


        return {
            success: failed === 0,
            processed: orderProductsDetails.length,
            succeeded,
            failed,
            results,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error, errorMessage }, 'Failed to update Fruugo order statuses to Fruugo');

        await emailService.sendErrorNotification({
            subject: 'Error: Fruugo Order Statuses to Fruugo Update Failed.',
            errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Order Status Management <br><b>File:</b> apps/api/src/modules/fruugo/fruugo-status-update-service.ts<br> <b>Marketplace:</b> FRUUGO <br><b>Error:</b> ${errorMessage}`,
            module: 'fruugo-status-update',
            context: {
                error: errorMessage,
            },
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
