/**
 * Product Feeds - Data Layer Barrel Export
 *
 * Re-exports the raw-SQL loaders and query functions that read from the
 * shared MySQL database. All functions use `prisma.$queryRaw` /
 * `$queryRawUnsafe` (see CLAUDE.md Rule 6; columns verified in
 * `sql/verify-columns.sql`).
 */

export { queryProductVariations, getProductVariationCount } from './product-query.js';
export { loadActiveSales, loadWeekendOffers, checkDeals } from './pricing-data.js';
export {
  loadCurrencyRates,
  loadShippingMethods,
  loadTeamTypes,
  loadPlayerOverrides,
} from './reference-data.js';
