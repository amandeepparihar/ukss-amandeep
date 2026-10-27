import { describe, it, expect } from 'vitest';
import { cooReportQuerySchema } from '../coo-report.schema';

describe('cooReportQuerySchema', () => {
  it('applies defaults when empty', () => {
    const q = cooReportQuerySchema.parse({});
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(20);
    // COO dashboard baseline: COO-assigned only, hero-shirt children excluded.
    expect(q.cooStatus).toBe('set');
    expect(q.includeHeroShirts).toBe(false);
    expect(q.sortBy).toBe('coo'); // missing-first surfaced via service
    expect(q.sortOrder).toBe('asc');
  });

  it('parses includeHeroShirts=true from the query string, but only literal "true"', () => {
    expect(cooReportQuerySchema.parse({ includeHeroShirts: 'true' }).includeHeroShirts).toBe(true);
    // z.coerce.boolean() would make any non-empty string true — verify 'false' stays false.
    expect(cooReportQuerySchema.parse({ includeHeroShirts: 'false' }).includeHeroShirts).toBe(false);
  });

  it('coerces numeric strings and clamps pageSize', () => {
    const q = cooReportQuerySchema.parse({ page: '3', pageSize: '5000', brandId: '12' });
    expect(q.page).toBe(3);
    expect(q.pageSize).toBe(200); // max clamp
    expect(q.brandId).toBe(12);
  });

  it('rejects an invalid cooStatus', () => {
    expect(() => cooReportQuerySchema.parse({ cooStatus: 'nope' })).toThrow();
  });

  it('treats empty strings as undefined for optional ids', () => {
    const q = cooReportQuerySchema.parse({ brandId: '', countryId: '', codeSearch: '' });
    expect(q.brandId).toBeUndefined();
    expect(q.countryId).toBeUndefined();
    expect(q.codeSearch).toBeUndefined();
  });
});
