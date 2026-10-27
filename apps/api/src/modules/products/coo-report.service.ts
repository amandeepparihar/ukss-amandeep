/**
 * Country-of-Origin report — shared SQL WHERE builder + fetchers.
 *
 * `cooReportWhere` is the ONLY place filters are translated to SQL. Both the
 * paginated read (Task 3) and the export (Task 4) call it, so they can never
 * drift out of sync on what "matches the current filters" means.
 */

import { prisma, Prisma } from '../../lib/prisma';
import { resolveSavedProductImageUrl } from './products-image.service';
import type { CooReportQuery, CooReportRow } from './coo-report.schema';

type Filters = Pick<CooReportQuery, 'brandId' | 'countryId' | 'cooStatus' | 'codeSearch' | 'includeHeroShirts'>;

/** Shared WHERE builder — the ONLY place filters are translated to SQL.
 *  Both the paginated read and the export call this, so they can never drift. */
export function cooReportWhere(f: Filters): Prisma.Sql {
  const where: Prisma.Sql[] = [Prisma.sql`1 = 1`];
  // Brand lives on new_products (product_lists.manufacturers_id is populated
  // for only ~21/346k rows — effectively unused). Joined via
  // new_products.products_model = product_lists.product_code.
  if (f.brandId != null) where.push(Prisma.sql`np.manufacturers_id = ${f.brandId}`);
  if (f.countryId != null) where.push(Prisma.sql`pl.country_of_origin_id = ${f.countryId}`);
  if (f.cooStatus === 'missing') where.push(Prisma.sql`pl.country_of_origin_id IS NULL`);
  if (f.cooStatus === 'set') where.push(Prisma.sql`pl.country_of_origin_id IS NOT NULL`);
  if (f.codeSearch) where.push(Prisma.sql`pl.product_code LIKE ${'%' + f.codeSearch + '%'}`);
  // Exclude hero-shirt children by default. A child has a non-zero
  // parent_product_lists_id (same detection as marketplace-orders.service.ts);
  // parents (=0 / NULL) stay — they're real sellable products that need a COO.
  if (!f.includeHeroShirts) {
    where.push(Prisma.sql`(pl.parent_product_lists_id = 0 OR pl.parent_product_lists_id IS NULL)`);
  }
  return Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}`;
}

// Whitelist sort columns → real SQL expressions (never interpolate user input).
const SORT_COLUMNS: Record<CooReportQuery['sortBy'], Prisma.Sql> = {
  code: Prisma.sql`pl.product_code`,
  name: Prisma.sql`pl.product_name`,
  brand: Prisma.sql`np.manufacturers_name`,
  // 'coo' default → blanks first (the work queue), then country name.
  coo: Prisma.sql`(pl.country_of_origin_id IS NOT NULL), pl.country_of_origin`,
};

interface RawRow {
  product_lists_id: number | bigint;
  product_code: string;
  product_name: string | null;
  brand: string | null;
  country_of_origin: string | null;
  products_image: string | null;
}

function mapRow(r: RawRow): CooReportRow {
  return {
    productListsId: Number(r.product_lists_id),
    productCode: r.product_code,
    productName: r.product_name,
    brand: r.brand,
    countryOfOrigin: r.country_of_origin,
    // new_products.products_image → CDN url via the shared resolver (its own
    // doc header lists new_products among the tables it serves).
    thumbnailUrl: resolveSavedProductImageUrl(r.products_image, true),
  };
}

// Brand name + thumbnail come from new_products (LEFT JOIN so codes without a
// new_products row — ~116k, incl. 2 of the 7 COO-set codes — are NOT dropped;
// they render with a blank brand/thumbnail). Join is 1:1 (0 codes map to >1
// new_products row). new_products.manufacturers_name is denormalized, so no
// second join to the manufacturers table is needed.
const BASE_SELECT = Prisma.sql`
  SELECT pl.product_lists_id, pl.product_code, pl.product_name,
         np.manufacturers_name AS brand,
         pl.country_of_origin, np.products_image
  FROM product_lists pl
  LEFT JOIN new_products np ON np.products_model = pl.product_code
`;

export async function fetchCooReportPage(q: CooReportQuery): Promise<{ rows: CooReportRow[]; total: number }> {
  const where = cooReportWhere(q);
  // Default sort (`coo`) is a non-indexable expression — MySQL filesorts all
  // ~346k rows on the landing view. Acceptable for an internal report;
  // revisit with an index if product_lists grows.
  const orderBy = SORT_COLUMNS[q.sortBy];
  const dir = q.sortOrder === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const offset = (q.page - 1) * q.pageSize;

  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    ${BASE_SELECT} ${where}
    ORDER BY ${orderBy} ${dir}
    LIMIT ${q.pageSize} OFFSET ${offset}
  `);

  // Join is required here now: the brand filter references np.manufacturers_id,
  // so the count must see new_products too. The join is 1:1 (0 codes map to >1
  // new_products row), so it never inflates the count.
  const countRows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS total FROM product_lists pl
    LEFT JOIN new_products np ON np.products_model = pl.product_code
    ${where}
  `);

  return { rows: rows.map(mapRow), total: Number(countRows[0]?.total ?? 0) };
}
