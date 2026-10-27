import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import type { BarcodeLookupResult, ProductSearchResult } from './fc-scan.schema';

const logger = createLogger('fc-scan-service');

/**
 * @taskId #164991
 * Look up a barcode in product_quantities filtered by boxCode.
 * Returns enriched product variation details or null if not found.
 */
export async function lookupBarcodeByBox(
  barcode: string,
  boxCode: string
): Promise<BarcodeLookupResult | null> {
  let row: Awaited<
    ReturnType<typeof prisma.productQuantity.findFirst>
  > | undefined;
  try {
    row = await prisma.productQuantity.findFirst({
      where: {
        barcode,
        boxList: {
          boxCode,
        },
      },
      select: {
        productQuantitiesId: true,
        productListsId: true,
        barcode: true,
        quantity: true,
        sizeWeight: true,
        fcProductId: true,
        productList: {
          select: {
            productCode: true,
            productName: true,
            team: { select: { teamName: true } },
            season: { select: { season: true } },
          },
        },
        boxList: { select: { boxCode: true } },
        sizeMapping: {
          select: {
            productsOptionsValue: { select: { productsOptionsValuesName: true } },
          },
        },
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('Inconsistent query result') ||
      msg.includes('required to return data')
    ) {
      logger.warn(
        { err, barcode, boxCode, message: msg },
        'Barcode lookup returned null due to Prisma inconsistent query result; possible data or schema issue'
      );
      return null;
    }
    throw err;
  }

  if (!row) {
    return null;
  }

  const sizeName =
    row.sizeMapping?.productsOptionsValue?.productsOptionsValuesName ?? null;

  return {
    productQuantitiesId: row.productQuantitiesId,
    productListsId: row.productListsId,
    productCode: row.productList.productCode,
    productName: row.productList.productName,
    teamName: row.productList.team.teamName,
    seasonName: row.productList.season.season,
    sizeName,
    barcode: row.barcode,
    quantity: row.quantity,
    sizeWeight: Number(row.sizeWeight),
    boxCode: row.boxList.boxCode,
    fcProductId: row.fcProductId,
    isSynced: row.fcProductId != null,
  };
}

/** Shape of product list row from Prisma for searchProducts mapping. */
interface ProductListSearchRow {
  productListsId: number;
  productCode: string | null;
  productName: string;
  team: { teamName: string };
  season: { season: string };
  productType: { typeName: string } | null;
  price: unknown;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  additionalImageUrl: string | null;
  productQuantities: { sizeId: number }[];
}

/**
 * @taskId #164991
 * Search product_lists by partial match on product code or product name.
 * Returns up to 20 results with team, season, and distinct sizes count.
 */
export async function searchProducts(query: string): Promise<ProductSearchResult[]> {
  const rows = await prisma.productList.findMany({
    where: {
      OR: [
        { productCode: { contains: query, mode: 'insensitive' } },
        { productName: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: {
      productListsId: true,
      productCode: true,
      productName: true,
      team: { select: { teamName: true } },
      season: { select: { season: true } },
      productType: { select: { typeName: true } },
      price: true,
      frontImageUrl: true,
      backImageUrl: true,
      additionalImageUrl: true,
      productQuantities: { select: { sizeId: true } },
    },
    orderBy: { productCode: 'asc' },
    take: 20,
  });

  return (rows as ProductListSearchRow[]).map((row) => ({
    productListsId: row.productListsId,
    productCode: row.productCode,
    productName: row.productName,
    teamName: row.team.teamName,
    seasonName: row.season.season,
    productTypeName: row.productType?.typeName ?? null,
    price: row.price != null ? Number(row.price) : null,
    frontImageUrl: row.frontImageUrl ?? null,
    backImageUrl: row.backImageUrl ?? null,
    additionalImageUrl: row.additionalImageUrl ?? null,
    sizesCount: new Set(row.productQuantities.map((pq) => pq.sizeId)).size,
  }));
}
