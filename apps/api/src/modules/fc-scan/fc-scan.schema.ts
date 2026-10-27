import { z } from 'zod';

export const GetBarcodeLookupParamsSchema = z.object({
  barcode: z
    .string()
    .trim()
    .regex(/^\d{12}$|^\d{13}$/, 'Barcode must be a 12 or 13 digit number'),
});

export const GetBarcodeLookupQuerySchema = z.object({
  boxCode: z
    .string()
    .trim()
    .min(1, 'boxCode query parameter is required')
    .toUpperCase(),
});

export type GetBarcodeLookupParams = z.infer<typeof GetBarcodeLookupParamsSchema>;
export type GetBarcodeLookupQuery = z.infer<typeof GetBarcodeLookupQuerySchema>;

export const GetProductsSearchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'query is required')
    .max(100, 'query must be at most 100 characters'),
});

export type GetProductsSearchQuery = z.infer<typeof GetProductsSearchQuerySchema>;

export interface ProductSearchResult {
  productListsId: number;
  productCode: string | null;
  productName: string;
  teamName: string;
  seasonName: string;
  productTypeName: string | null;
  price: number | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  additionalImageUrl: string | null;
  sizesCount: number;
}

export interface BarcodeLookupResult {
  productQuantitiesId: number;
  productListsId: number;
  productCode: string | null;
  productName: string;
  teamName: string;
  seasonName: string;
  sizeName: string | null;
  barcode: string;
  quantity: number;
  sizeWeight: number;
  boxCode: string;
  fcProductId: number | null;
  isSynced: boolean;
}
