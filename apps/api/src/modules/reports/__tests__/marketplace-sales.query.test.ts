import { describe, it, expect } from 'vitest';
import {
  buildBreakdownQuery, buildDailyTrendQuery, buildHourlyByChannelQuery, previousRange,
} from '../marketplace-sales.query';

const base = { dateFrom: '2026-06-01', dateTo: '2026-06-17' };

describe('marketplace-sales query builders', () => {
  it('breakdown groups by order_site with revenue/aov and channel label', () => {
    const { sql, values } = buildBreakdownQuery(base);
    expect(sql).toContain('SUM(o.order_total)');
    expect(sql).toContain('AVG(o.order_total)');
    expect(sql).toContain('GROUP BY o.order_site');
    expect(sql).toContain('LEFT JOIN store_management');
    expect(values).toEqual(['2026-06-01 00:00:00', '2026-06-17 23:59:59']);
  });

  it('channel=ukss / marketplace produce the right order_site clause', () => {
    expect(buildBreakdownQuery({ ...base, channel: 'ukss' }).sql).toContain("o.order_site = '0'");
    expect(buildBreakdownQuery({ ...base, channel: 'marketplace' }).sql)
      .toContain("o.order_site <> '0' AND o.order_site IS NOT NULL");
  });

  it('status filter adds an IN clause', () => {
    const { sql, values } = buildBreakdownQuery({ ...base, statuses: [2, 5] });
    expect(sql).toContain('o.orders_status IN (?, ?)');
    expect(values).toEqual(expect.arrayContaining([2, 5]));
  });

  it('daily trend groups by day + order_site', () => {
    const { sql } = buildDailyTrendQuery(base);
    expect(sql).toContain("DATE_FORMAT(o.date_purchased, '%Y-%m-%d') AS day");
    expect(sql).toContain('GROUP BY day, o.order_site');
  });

  it('hourly-by-channel groups by order_site + hour', () => {
    const { sql } = buildHourlyByChannelQuery(base);
    expect(sql).toContain('HOUR(o.date_purchased) AS hour');
    expect(sql).toContain('GROUP BY o.order_site, HOUR(o.date_purchased)');
  });

  it('previousRange returns the equal-length window immediately before', () => {
    expect(previousRange('2026-06-10', '2026-06-17')).toEqual({ from: '2026-06-02', to: '2026-06-09' });
  });
});
