import { prisma } from '../prisma';
import { createLogger, type Logger } from '../logger';
import { emailService } from '../email';

const defaultLogger = createLogger('orders-products-utils');

// Type helper for Prisma transaction client
type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Insert order header into orders table using raw SQL
 * Returns the inserted orders_id
 * @param tx - Optional transaction client. If provided, operation will be part of the transaction.
 */
export async function insertOrderHeader(
    orderData: Record<string, any>,
    logger?: Logger,
    tx?: PrismaTransactionClient
): Promise<number | null> {
    const log = logger || defaultLogger;
    const startTime = Date.now();
    const marketplaceOrderId = orderData.marketplace_orders_id;
    const client = tx || prisma;

    try {
        log.debug({
            marketplaceOrderId,
            customerName: orderData.customers_name,
            orderTotal: orderData.order_total
        }, 'Inserting order header into orders table');

        // Build the INSERT query dynamically with proper escaping
        const fields = Object.keys(orderData).map(field => `\`${field}\``).join(', ');
        const values = Object.values(orderData);
        const placeholders = values.map(() => '?').join(', ');

        const sql = `INSERT INTO orders (${fields}) VALUES (${placeholders})`;

        // Execute raw SQL query using transaction client if provided
        await client.$executeRawUnsafe(sql, ...values);

        // Get the last inserted ID
        const insertIdResult = await client.$queryRawUnsafe<Array<{ LAST_INSERT_ID: bigint }>>(
            'SELECT LAST_INSERT_ID() as LAST_INSERT_ID'
        );

        const insertedId = Number(insertIdResult[0]?.LAST_INSERT_ID ?? null);
        const duration = Date.now() - startTime;

        log.info({
            ordersId: insertedId,
            marketplaceOrderId,
            duration
        }, 'Order header inserted successfully');

        return insertedId;
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error({
            error: error instanceof Error ? error.message : 'Unknown error',
            marketplaceOrderId,
            duration,
            customerName: orderData.customers_name
        }, 'Failed to insert order header');
        // Only send email notification if not in transaction (to avoid duplicate emails)
        if (!tx) {
            await emailService.sendErrorNotification({
                subject: `Marketplace Order(${marketplaceOrderId}) Insert Failed - Order Header Insert Failed`,
                errorMessage: `Marketplace Order(${marketplaceOrderId}) Insert Failed because order header insert failed - ${error instanceof Error ? error.message : String(error)}`,
                module: 'marketplace-orders',
                context: {
                    marketplaceOrderId,
                    error: error instanceof Error ? error.message : String(error)
                },
            });
        }
        throw error;
    }
}


/**
 * Insert order product into orders_products table using raw SQL
 * Returns the inserted orders_products_id
 * @param tx - Optional transaction client. If provided, operation will be part of the transaction.
 */
export async function insertOrderProduct(
    productData: Record<string, any>,
    logger?: Logger,
    tx?: PrismaTransactionClient
): Promise<number | null> {
    const log = logger || defaultLogger;
    const client = tx || prisma;
    try {
        log.debug({
            ordersId: productData.orders_id,
            productsId: productData.products_id,
            productName: productData.products_name
        }, 'Inserting order product');

        const fields = Object.keys(productData).map(field => `\`${field}\``).join(', ');
        const values = Object.values(productData);
        const placeholders = values.map(() => '?').join(', ');

        const sql = `INSERT INTO orders_products (${fields}) VALUES (${placeholders})`;

        await client.$executeRawUnsafe(sql, ...values);

        // Get the last inserted ID
        const insertIdResult = await client.$queryRawUnsafe<Array<{ LAST_INSERT_ID: bigint }>>(
            'SELECT LAST_INSERT_ID() as LAST_INSERT_ID'
        );

        const insertedId = Number(insertIdResult[0]?.LAST_INSERT_ID ?? null);

        log.debug({
            ordersProductsId: insertedId,
            ordersId: productData.orders_id
        }, 'Order product inserted successfully');

        return insertedId;
    } catch (error) {
        log.error({
            error: error instanceof Error ? error.message : 'Unknown error',
            ordersId: productData.orders_id,
            productName: productData.products_name
        }, 'Failed to insert order product');
        throw error;
    }
}

/**
 * Insert order product attribute into orders_products_attributes table
 * Returns the inserted orders_products_attributes_id
 * @param tx - Optional transaction client. If provided, operation will be part of the transaction.
 */
export async function insertOrderProductAttribute(
    attributeData: Record<string, any>,
    logger?: Logger,
    tx?: PrismaTransactionClient
): Promise<number | null> {
    const log = logger || defaultLogger;
    const client = tx || prisma;
    try {
        const fields = Object.keys(attributeData).map(field => `\`${field}\``).join(', ');
        const values = Object.values(attributeData);
        const placeholders = values.map(() => '?').join(', ');

        const sql = `INSERT INTO orders_products_attributes (${fields}) VALUES (${placeholders})`;

        await client.$executeRawUnsafe(sql, ...values);

        // Get the last inserted ID
        const insertIdResult = await client.$queryRawUnsafe<Array<{ LAST_INSERT_ID: bigint }>>(
            'SELECT LAST_INSERT_ID() as LAST_INSERT_ID'
        );

        const insertedId = Number(insertIdResult[0]?.LAST_INSERT_ID ?? null);

        return insertedId;
    } catch (error) {
        log.error({ error: error instanceof Error ? error.message : 'Unknown error', attributeData }, 'Failed to insert order product attribute');
        throw error;
    }
}


/**
 * Insert order total into orders_total table
 * Returns the inserted orders_total_id
 * @param tx - Optional transaction client. If provided, operation will be part of the transaction.
 */
export async function insertOrderTotal(
    totalData: Record<string, any>,
    logger?: Logger,
    tx?: PrismaTransactionClient
): Promise<string | null> {
    const log = logger || defaultLogger;
    const client = tx || prisma;
    try {
        const fields = Object.keys(totalData).map(field => `\`${field}\``).join(', ');
        const values = Object.values(totalData);
        const placeholders = values.map(() => '?').join(', ');

        const sql = `INSERT INTO orders_total (${fields}) VALUES (${placeholders})`;

        await client.$executeRawUnsafe(sql, ...values);

        // Get the last inserted ID
        const insertIdResult = await client.$queryRawUnsafe<Array<{ LAST_INSERT_ID: bigint }>>(
            'SELECT LAST_INSERT_ID() as LAST_INSERT_ID'
        );

        const insertedId = insertIdResult[0]?.LAST_INSERT_ID?.toString() || null;

        return insertedId;
    } catch (error) {
        log.error({ error: error instanceof Error ? error.message : 'Unknown error', totalData }, 'Failed to insert order total');
        throw error;
    }
}

/**
 * Insert order status history into orders_status_history table
 * Returns the inserted orders_status_history_id
 * @param tx - Optional transaction client. If provided, operation will be part of the transaction.
 */
export async function insertOrderStatusHistory(
    statusHistoryData: Record<string, any>,
    logger?: Logger,
    tx?: PrismaTransactionClient
): Promise<string | null> {
    const log = logger || defaultLogger;
    const client = tx || prisma;
    try {
        const fields = Object.keys(statusHistoryData).map(field => `\`${field}\``).join(', ');
        const values = Object.values(statusHistoryData);
        const placeholders = values.map(() => '?').join(', ');

        const sql = `INSERT INTO orders_status_history (${fields}) VALUES (${placeholders})`;

        await client.$executeRawUnsafe(sql, ...values);

        // Get the last inserted ID
        const insertIdResult = await client.$queryRawUnsafe<Array<{ LAST_INSERT_ID: bigint }>>(
            'SELECT LAST_INSERT_ID() as LAST_INSERT_ID'
        );

        const insertedId = insertIdResult[0]?.LAST_INSERT_ID?.toString() || null;

        return insertedId;
    } catch (error) {
        log.error({ error: error instanceof Error ? error.message : 'Unknown error', statusHistoryData }, 'Failed to insert order status history');
        throw error;
    }
}