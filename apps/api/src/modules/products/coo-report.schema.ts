import { z } from 'zod';

const emptyToUndef = (v: unknown) =>
  v === '' || v === null || v === undefined ? undefined : v;

export const cooReportQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().transform(v => Math.min(v, 200)).default(20),
  sortBy: z.enum(['code', 'name', 'brand', 'coo']).default('coo'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  brandId: z.preprocess(emptyToUndef, z.coerce.number().int().positive().optional()),
  countryId: z.preprocess(emptyToUndef, z.coerce.number().int().positive().optional()),
  // Defaults to 'set': this report doubles as a "COO dashboard" whose baseline
  // view is products that already have a country assigned. Overridable to
  // 'missing' (the assignment work queue) or 'all'.
  cooStatus: z.enum(['all', 'set', 'missing']).default('set'),
  codeSearch: z.preprocess(emptyToUndef, z.string().trim().max(100).optional()),
  // Hero-shirt CHILDREN (product_lists.parent_product_lists_id <> 0) are the
  // ~234k SEO variants that inherit their parent's COO — noise for this report,
  // so they're excluded by default. Query string sends 'true'/'false'; treat
  // only the literal 'true' as true (z.coerce.boolean() would make 'false' true).
  includeHeroShirts: z.preprocess((v) => v === 'true' || v === true, z.boolean()),
});

export type CooReportQuery = z.infer<typeof cooReportQuerySchema>;

export interface CooReportRow {
  productListsId: number;
  productCode: string;
  productName: string | null;
  brand: string | null;
  countryOfOrigin: string | null;
  thumbnailUrl: string | null;
}
