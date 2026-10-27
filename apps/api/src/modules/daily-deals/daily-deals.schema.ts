import { z } from 'zod';

// Shared filters for both tabs
const sharedFilters = {
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(10).max(100).default(20),
  minQty: z.coerce.number().min(0).default(0),
  search: z.string().optional(),
  notSoldSinceDays: z.coerce.number().min(0).optional(),
  leagueId: z.coerce.number().optional(),
  teamId: z.coerce.number().optional(),
  productType: z.enum(['all', 'adults', 'womens', 'kids']).default('all'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  visibility: z.enum(['working', 'ignored', 'with-deals', 'all']).default('working'),
};

// Tab 1: Slow Moving Products
export const productListSchema = z.object({
  ...sharedFilters,
  sortBy: z.enum(['last_order_date', 'total_stock', 'price']).default('last_order_date'),
});
export type ProductListInput = z.infer<typeof productListSchema>;

// Tab 2: Single Size Slow Moving Products
export const singleSizeProductsSchema = z.object({
  ...sharedFilters,
  sortBy: z.enum(['last_order_date', 'quantity', 'price']).default('last_order_date'),
});
export type SingleSizeProductsInput = z.infer<typeof singleSizeProductsSchema>;

// Schedule query (7-day grid data)
export const scheduleQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type ScheduleQueryInput = z.infer<typeof scheduleQuerySchema>;

// Save deal
export const saveDealSchema = z.object({
  productsId: z.number(),
  productCode: z.string(),
  discountType: z.enum(['PERCENT', 'FIXED']),
  discountValue: z.number().positive(),
  dealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type SaveDealInput = z.infer<typeof saveDealSchema>;

// Delete deal (path param)
export const deleteDealParamsSchema = z.object({
  id: z.coerce.number(),
});
export type DeleteDealParams = z.infer<typeof deleteDealParamsSchema>;

// Summary
export const summarySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type SummaryInput = z.infer<typeof summarySchema>;

// Product deal info (lazy-loaded for visible page)
export const productDealInfoSchema = z.object({
  productIds: z.string().transform((val) => val.split(',').map(Number).filter((n) => !isNaN(n) && n > 0)),
});
export type ProductDealInfoInput = z.infer<typeof productDealInfoSchema>;

// Product size grid (lazy-loaded for visible page)
export const productSizeGridSchema = z.object({
  productIds: z.string().transform((val) => val.split(',').map(Number).filter((n) => !isNaN(n) && n > 0)),
});
export type ProductSizeGridInput = z.infer<typeof productSizeGridSchema>;

// Product site price (fresh fetch for popup)
export const productSitePriceSchema = z.object({
  productsId: z.coerce.number(),
});
export type ProductSitePriceInput = z.infer<typeof productSitePriceSchema>;

// Run cron (manual trigger)
export const runCronSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RunCronInput = z.infer<typeof runCronSchema>;

// Banner config (title only — image handled via multipart)
export const bannerConfigSchema = z.object({
  title: z.string().min(1).max(100),
});
export type BannerConfigInput = z.infer<typeof bannerConfigSchema>;

// Set special price (mirrors SMS save_specials flow)
export const setSpecialPriceSchema = z.object({
  productsId: z.number(),
  specialPrice: z.number().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type SetSpecialPriceInput = z.infer<typeof setSpecialPriceSchema>;

// Remove special price
export const removeSpecialPriceParamsSchema = z.object({
  id: z.coerce.number(),
});
export type RemoveSpecialPriceParams = z.infer<typeof removeSpecialPriceParamsSchema>;

// Get special price info for a product
export const getSpecialPriceSchema = z.object({
  productsId: z.coerce.number(),
});
export type GetSpecialPriceInput = z.infer<typeof getSpecialPriceSchema>;

// Ignore/unignore product from daily deals
export const ignoreProductSchema = z.object({
  productsId: z.number(),
});
export type IgnoreProductInput = z.infer<typeof ignoreProductSchema>;

export const unignoreProductParamsSchema = z.object({
  id: z.coerce.number(),
});
export type UnignoreProductParams = z.infer<typeof unignoreProductParamsSchema>;

