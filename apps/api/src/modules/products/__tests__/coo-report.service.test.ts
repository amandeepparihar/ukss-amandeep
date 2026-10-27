import { describe, it, expect, vi } from 'vitest';

// coo-report.service imports resolveSavedProductImageUrl from
// products-image.service, which reads `config` at module load time
// (PRODUCT_IMAGES_PATH via path.resolve). Real config validation requires
// env vars (JWT_SECRET, EBAY_STORE_ID, etc.) that aren't set in this test
// environment and calls process.exit(1) on failure — same problem solved
// the same way in ebay-relist.service.test.ts. cooReportWhere itself is a
// pure function and never touches config, so a minimal stub is enough.
vi.mock('../../../config', () => ({
  config: {
    PRODUCT_IMAGES_PATH: '/tmp/coo-report-test-images',
    PRODUCT_FEED_CDN_URL: 'https://cdn.example.com',
  },
}));

// products-image.service also constructs a real pino logger at module scope
// (`createLogger('products-image')`), which needs config.LOG_LEVEL/NODE_ENV
// and touches the filesystem (log dir creation). Stub it out — none of the
// cooReportWhere assertions exercise logging.
vi.mock('../../../lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }),
}));

import { cooReportWhere } from '../coo-report.service';

describe('cooReportWhere', () => {
  it('no filters → only the base predicate, no bound filter values', () => {
    const sql = cooReportWhere({ cooStatus: 'all' });
    expect(sql.values).toEqual([]); // no brand/country/search params bound
  });

  it('binds brandId, countryId and code search term', () => {
    const sql = cooReportWhere({ brandId: 12, countryId: 5, cooStatus: 'all', codeSearch: 'NIKE' });
    expect(sql.values).toContain(12);
    expect(sql.values).toContain(5);
    expect(sql.values).toContain('%NIKE%');
  });

  it('cooStatus=missing adds an IS NULL predicate with no bound value', () => {
    const sql = cooReportWhere({ cooStatus: 'missing' });
    expect(sql.sql.toUpperCase()).toContain('COUNTRY_OF_ORIGIN_ID IS NULL');
  });

  it('cooStatus=set adds an IS NOT NULL predicate', () => {
    const sql = cooReportWhere({ cooStatus: 'set' });
    expect(sql.sql.toUpperCase()).toContain('COUNTRY_OF_ORIGIN_ID IS NOT NULL');
  });

  it('excludes hero-shirt children by default (includeHeroShirts falsy)', () => {
    const sql = cooReportWhere({ cooStatus: 'set' });
    expect(sql.sql.toUpperCase()).toContain('PARENT_PRODUCT_LISTS_ID');
  });

  it('includeHeroShirts=true drops the parent_product_lists_id predicate', () => {
    const sql = cooReportWhere({ cooStatus: 'set', includeHeroShirts: true });
    expect(sql.sql.toUpperCase()).not.toContain('PARENT_PRODUCT_LISTS_ID');
  });
});
