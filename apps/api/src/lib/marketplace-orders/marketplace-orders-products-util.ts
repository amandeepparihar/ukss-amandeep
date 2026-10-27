import { prisma } from '../prisma';
import { createLogger, type Logger } from '../logger';

const defaultLogger = createLogger('marketplace-orders-products-utils');

/**
 * Get marketplace order products
 * 
 * @param moId - Marketplace order ID
 * @param logger - Logger instance
 * @returns Array of marketplace order products
 */
export async function getMarketplaceOrderProducts(moId: bigint, logger?: Logger) {
    const log = logger || defaultLogger;
    try {
        log.debug({ moId: moId.toString() }, 'Fetching marketplace order products');

        const products = await prisma.mopMarketplaceOrderProduct.findMany({
            where: {
                mopMoId: moId,
            },
        });

        log.debug({
            moId: moId.toString(),
            productCount: products.length
        }, 'Marketplace order products fetched successfully');

        return products;
    } catch (error) {
        log.error({ error: error instanceof Error ? error.message : 'Unknown error', moId: moId.toString() }, 'Failed to fetch marketplace order products');
        throw error;
    }
}

/**
 * Get order product details from marketplace order products table
 * @param storeIdList - List of store IDs
 * @param logger - Logger instance
 * @returns Array of order product details
 */
export async function getOrderProductDetails(storeIdList: number[], logger?: Logger): Promise<any[]> {
    const log = logger || defaultLogger;

    try {
        log.info({ storeIdList }, "Fetching order product details for the store ids");
        const pendingProducts = await prisma.mopMarketplaceOrderProduct.findMany({
            where: {
                mopApiResponse: 'Waiting',
                mopOrderStatusToUpdate: {
                    notIn: ['Pending', 'awaiting_dispatch', '', 'Created', 'New orders'],
                },
                moOrder: {
                    moStoreId: {
                        in: storeIdList,
                    },
                },
                mopUkssOrdersProductsId: {
                    not: null,
                },
            },
            select: {
                mopId: true,
                moOrder: {
                    select: {
                        moStoreId: true,
                        moStoreName: true,
                        moUkssOrderId: true,
                    },
                },
                mopStoreName: true,
                mopOrderId: true,
                mopMoId: true,
                mopProductId: true,
                mopProductSku: true,
                mopProductQuantity: true,
                mopOrderStatusToUpdate: true,
                mopUkssOrdersProductsId: true,
                mopUkssTrackingCode: true,
                mopUkssShippingCarrier: true,
                // PM #164896 — read by Walmart status push (sets intentToCancelOverride and
                // sends override-shipped email when '1'). Other marketplaces ignore these fields.
                customerCancellationRequest: true,
                cancellationRequestDate: true,
            },
            orderBy: {
                mopId: 'desc',
            },
        });
        log.info(
            { pendingProducts: JSON.parse(JSON.stringify(pendingProducts, (_k, v) =>
                typeof v === 'bigint' ? v.toString() : v)) },
            "Order product details fetched successfully"
        );     
        return pendingProducts;
    } catch (error) {
        log.error({ error: error instanceof Error ? error.message : 'Unknown error', storeIdList }, "Failed to fetch order product details");
        throw error;
    }
}


/**
 * Get last fetched order date from marketplace order table
 * @param storeId - Store ID
 * @param logger - Logger instance
 * @returns Last fetched order date
 */
export async function getLastFetchedOrderDate(
    storeId: number, logger?: Logger
): Promise<{ startDate: Date, endDate: Date }> {
    const log = logger || defaultLogger;

    const endDate = new Date();

    try{
        // WHY: We query any inserted order (not just linked ones) to avoid
        // re-fetching orders that are still in the pipeline (unlinked).
        // Filtering by moUkssOrderId IS NOT NULL causes repeated 7-day lookbacks.
        const lastOrderDate = await prisma.moMarketplaceOrder.findFirst({
            where: {
                moStoreId: storeId,
            },
            select: {
                moOrderPlaceDate: true,
            },
            orderBy: {
                moOrderPlaceDate: 'desc',
            }
        });

        const startDate = lastOrderDate?.moOrderPlaceDate;

        log.info({ startDate, endDate }, 'Last fetched order date');
        return { startDate, endDate };
    } catch (error) {
        log.error({ error: error instanceof Error ? error.message : 'Unknown error', storeId }, 'Failed to get last fetched order date');
        throw error;
    }
}