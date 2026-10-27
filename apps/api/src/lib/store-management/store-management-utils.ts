import { prisma } from '../prisma';
import { createLogger, type Logger } from '../logger';
import { config } from '../../config';

const defaultLogger = createLogger('store-management-utils');

export interface StoreDetails {
    storeId: number;
    storeUrl: string;
    storeName: string;
}

export interface StoreInfo {
    store_id: number;
    store_name: string;
    status: string;
}

export async function getStoreDetails(storeName: string, logger?: Logger): Promise<StoreDetails | null> {
    const log = logger || defaultLogger;

    log.info({ storeName }, 'Getting store details');
    try{
        const storeDetails = await prisma.storeManagement.findFirst({
            where: {
                storeName: storeName,
            },
            select: {
                storeId: true,
                storeUrl: true,
                storeName: true,
            },
        });

        if (!storeDetails) {
            log.error({ storeName }, 'Store not found in store_management table');
            return null;
        }

        return storeDetails;
    } catch (error: any) {
        log.error({ error, storeName }, 'Failed to get store details');
        return null;
    }
}

/**
 * Get store information by store ID
 * Used by marketplace sync and other integrations
 */
export async function getStoreInfo(storeId: number, logger?: Logger): Promise<StoreInfo | null> {
    const log = logger || defaultLogger;

    log.info({ storeId }, 'Getting store info');
    try {
        const store = await prisma.storeManagement.findFirst({
            where: {
                storeId: storeId,
            },
            select: {
                storeId: true,
                storeName: true,
                status: true,
            },
        });

        if (!store) {
            log.warn({ storeId }, 'Store not found in store_management table');
            return null;
        }

        return {
            store_id: store.storeId,
            store_name: store.storeName,
            status: store.status,
        };
    } catch (error: any) {
        log.error({ error, storeId }, 'Failed to get store info');
        return null;
    }
}

/**
 * Get eBay UK store information from the database.
 * WHY: Store ID is configured in .env (EBAY_STORE_ID), then fetched from store_management table.
 * This allows store details (name, status) to come from the database while ID is in config.
 *
 * @returns Store info with store_id, store_name, status or null if not found
 */
export async function getEbayUkStoreInfo(logger?: Logger): Promise<StoreInfo | null> {
    const log = logger || defaultLogger;
    const storeId = config.EBAY_STORE_ID;

    log.info({ storeId }, 'Getting eBay UK store info from database');
    try {
        const store = await prisma.storeManagement.findFirst({
            where: {
                storeId: storeId,
            },
            select: {
                storeId: true,
                storeName: true,
                status: true,
            },
        });

        if (!store) {
            log.error({ storeId }, 'eBay UK store not found in store_management table');
            return null;
        }

        log.info({ storeId: store.storeId, storeName: store.storeName }, 'eBay UK store found');

        return {
            store_id: store.storeId,
            store_name: store.storeName,
            status: store.status,
        };
    } catch (error: any) {
        log.error({ error, storeId }, 'Failed to get eBay UK store info');
        return null;
    }
}