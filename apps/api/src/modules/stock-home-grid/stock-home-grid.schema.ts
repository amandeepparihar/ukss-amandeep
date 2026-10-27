
import { z } from 'zod';

export const DeliverySortSchema = z.enum(['0', '1', '2', '3']).default('0');
export type DeliverySort = z.infer<typeof DeliverySortSchema>;

export const UkssPriceStatusSchema = z.enum(['0', '1', '2']).default('0');
export type UkssPriceStatus = z.infer<typeof UkssPriceStatusSchema>;

export const MysteryProductSchema = z.object({
    // size_id = grid DEFAULT size id (SlickGrid column `option_<default_options_values_id>`,
    // i.e. legacy $_POST['size']). NOT the products_options_values_to_products_options PK.
    // The service resolves it to the potvpto products_options_values_id before storing.
    size_id: z.coerce.number().int(),
    product_lists_id: z.coerce.number().int(),
    box_code: z.string()
});

export const SupplierBarcodeFetchQuerySchema = z.object({
    product_lists_id: z.coerce.number().int(),
    // grid column option_<default_options_values_id> value = legacy $_POST['size'];
    // matched against manufacturers_sizes_to_default_sizes.default_options_values_id (NOT pq.size_id)
    size: z.coerce.number().int(),
});

export const SupplierBarcodeUniqueQuerySchema = z.object({
    barcode: z.string().min(1),
});

export const SupplierBarcodeSaveSchema = z.object({
    barcode: z.string().min(1),
    size_id: z.coerce.number().int(),
    product_lists_id: z.coerce.number().int(),
    supplier_barcode_1: z.string().regex(/^\d{12,25}$/).or(z.literal('')).optional(),
});

export const RemapCheckQuerySchema = z.object({
    productListsId: z.coerce.number().int().positive(),
    sizeId: z.coerce.number().int().positive(),
    boxCode: z.string().min(1).max(64),
});

export const RemapSizeBodySchema = z.object({
    productListsId: z.number().int().positive(),
    barcode: z.string().min(1),
    targetSizeId: z.number().int().positive(),
    targetSizeGroupId: z.number().int().positive().optional(),
});

export const RemapValidateSizeQuerySchema = z.object({
    productListsId: z.coerce.number().int().positive(),
    barcode: z.string().min(1),
    targetSizeId: z.coerce.number().int().positive(),
});

export type MysteryProductBody = z.infer<typeof MysteryProductSchema>;
export type SupplierBarcodeFetchQuery = z.infer<typeof SupplierBarcodeFetchQuerySchema>;
export type SupplierBarcodeUniqueQuery = z.infer<typeof SupplierBarcodeUniqueQuerySchema>;
export type SupplierBarcodeSavePayload = z.infer<typeof SupplierBarcodeSaveSchema>;
export type RemapCheckQuery = z.infer<typeof RemapCheckQuerySchema>;
export type RemapSizeBody = z.infer<typeof RemapSizeBodySchema>;
export type RemapValidateSizeQuery = z.infer<typeof RemapValidateSizeQuerySchema>;
