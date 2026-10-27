import { z } from 'zod';

export const getTshirtsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z
    .enum([
      'products_name',
      'np_best_seller_7days',
      'np_best_seller_6months',
      'np_best_seller_1year',
      'np_best_seller_lifetime',
      'products_price',
      'products_date_added',
    ])
    .default('np_best_seller_lifetime'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().max(100).optional(),
  approved: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const approveProductsSchema = z.object({
  // Per product, not per batch: the approver decides customisability one T-shirt at a time.
  // `isCustomisable` is required rather than defaulted — the client always knows the value
  // (the dialog seeds each row from the product's current Is_Your_Name), and silently
  // defaulting a missing field would overwrite that flag with a value nobody chose.
  products: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        // true -> Is_Your_Name 'Yes' -> Flag 'UKSS-CUST'; false -> 'No' -> 'UKSS-POD'.
        isCustomisable: z.boolean(),
      })
    )
    .min(1)
    .max(500)
    // A repeated id with conflicting flags has no correct answer — the last write would win
    // arbitrarily. Reject it instead of picking one.
    .refine(
      (products) => new Set(products.map((p) => p.productId)).size === products.length,
      { message: 'productId values must be unique' }
    ),
});

export type GetTshirtsQuery = z.infer<typeof getTshirtsQuerySchema>;
export type ApproveProductsInput = z.infer<typeof approveProductsSchema>;
