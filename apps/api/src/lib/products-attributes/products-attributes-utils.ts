import { prisma } from '../prisma';
import { createLogger, type Logger } from '../logger';
import { getAllOptionIds } from '../products-options/products-options-utils';

const defaultLogger = createLogger('products-attributes-utils');

/**
 * Get the size option ID associated with a product
 * Finds the first option ID from the product's attributes that matches a "Size" option
 * @param productsId - The product ID to look up
 * @param logger - Optional logger instance
 * @returns The size option ID if found, null otherwise
 */
export async function getSizeOptionToProduct(
    productsId: number,
    logger?: Logger
): Promise<number | null> {
    const log = logger || defaultLogger;

    try {
        // Get all size option IDs
        const sizeOptionsIdMap = await getAllOptionIds('Size', true, [], log);

        if (!sizeOptionsIdMap || Object.keys(sizeOptionsIdMap).length === 0) {
            log.warn('No size options found');
            return null;
        }

        // Get distinct option IDs for the product
        const optionIdsToProduct = await prisma.productsAttribute.findMany({
            where: {
                productsId: productsId,
            },
            select: {
                optionsId: true,
            },
            distinct: ['optionsId'],
            orderBy: {
                optionsId: 'asc',
            },
        });

        if (optionIdsToProduct.length === 0) {
            log.info('No product attributes found', { productsId });
            return null;
        }

        // Find the first matching size option ID
        for (const attribute of optionIdsToProduct) {
            if (attribute.optionsId in sizeOptionsIdMap) {
                log.info('Size option found for product', {
                    productsId,
                    sizeOptionId: attribute.optionsId
                });
                return Number(attribute.optionsId);
            }
        }

        log.info('No size option found for product', { productsId });
        return null;
    } catch (error) {
        log.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to get size option for product');
        throw error;
    }
}

