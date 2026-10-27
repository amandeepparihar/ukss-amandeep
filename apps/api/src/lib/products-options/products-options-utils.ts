import { prisma } from '../prisma';
import { createLogger, type Logger } from '../logger';

const defaultLogger = createLogger('products-options-utils');

export async function getAllOptionIds(
    optionName: string,
    name: boolean = true,
    ids: number[] = [],
    logger?: Logger
): Promise<Record<number, string> | null> {
    const log = logger || defaultLogger;
    try {
        const where = name ? {
            productsOptionsName: {
                contains: optionName,
            },
        } : {
            productsOptionsId: {
                in: ids,
            },
        };

        const options = await prisma.productsOption.findMany({
            where,
            select: {
                productsOptionsId: true,
                productsOptionsName: true,
            },
            orderBy: {
                productsOptionsName: 'asc',
            },
        });

        log.info('All option ids fetched', { optionCount: options.length });

        return options.reduce<Record<number, string>>((acc, option) => {
            acc[option.productsOptionsId] = option.productsOptionsName;
            return acc;
        }, {});
    } catch (error) {
        log.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to fetch product options');
        throw error;
    }
}

export async function getProductOptionDetails(
    optionId?: number,
    optionName?: string,
    logger?: Logger
): Promise<{ productsOptionsId: number; productsOptionsName: string } | null> {
    const log = logger || defaultLogger;
    if (!optionId && !optionName) {
        log.error('Option id or option name is required');
        return null;
    }
    try {
        const where = optionId
            ? { productsOptionsId: optionId }
            : { productsOptionsName: optionName };

        const optionDetails = await prisma.productsOption.findFirst({
            where,
            select: {
                productsOptionsId: true,
                productsOptionsName: true,
            },
        });

        return optionDetails;
    } catch (error) {
        log.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to fetch product option details');
        return null;
    }
}

export async function getSizeOptionValueName(
    productOptionValueId:number, logger?: Logger
): Promise<{ productsOptionsValuesName: string, shortname: string } | null> {
    const log = logger || defaultLogger;

    try{
        const sizeOptionValueDetails = await prisma.productsOptionsValue.findFirst({
            where: {
                productsOptionsValuesId: productOptionValueId,
            },
            select: {
                productsOptionsValuesName: true,
                shortname: true,
            },
        });

        return sizeOptionValueDetails;
    } catch (error) {
        log.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to fetch size option value name');
        return null;
    }
}