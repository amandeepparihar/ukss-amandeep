import { prisma } from '../prisma';
import { createLogger, type Logger } from '../logger';
const defaultLogger = createLogger('new-product-variations-utils');

export interface NewProductsVariation {
  npvProductsId: number;
  npvProductsBarcodes: string;
  npvSku: string;
  npvSizeOptionsValueId: number;
  npvProductsOptionsValuesToProductsOptionsId: number;
  npvProductsName: string;
  npvProductsModel: string;
}

/**
 * Get product details data from SKU
 */
export async function getProductVariationDataFromSKU(
  sku: string | null,
  logger?: Logger
): Promise<NewProductsVariation | null> {
  const log = logger || defaultLogger;
  try {

    if (!sku || sku.trim() === '') {
      log.error({ sku }, 'SKU is required');
      return null;
    }

    log.info({ sku }, 'Looking up product variation');

    const newProductVariation = await prisma.newProductsVariation.findFirst({
      where: {
        npvSku: sku,
      },
      select: {
        npvProductsId: true,
        npvProductsBarcodes: true,
        npvSku: true,
        npvSizeOptionsValueId: true,
        npvProductsOptionsValuesToProductsOptionsId: true,
        npvProductsName: true,
        npvProductsModel: true,
      },
    });

    if (newProductVariation?.npvProductsId) {
      log.info({ sku }, 'Product variation found');
      return newProductVariation;
    }

    log.info({ sku }, 'Product variation not found');
    return null;
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : 'Unknown error', sku }, 'Error looking up product variation');
    return null;
  }
}