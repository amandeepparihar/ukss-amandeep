import { describe, it, expect } from 'vitest';
import { buildHourlyOrdersQuery } from '../hourly-orders.query';

describe('buildHourlyOrdersQuery', () => {
  const base = { dateFrom: '2026-06-09', dateTo: '2026-06-11' };

  it('produces 24 hour columns and a date range bound', () => {
    const { sql, values } = buildHourlyOrdersQuery(base);
    expect(sql).toContain('SUM(HOUR(o.date_purchased)=0) AS h00');
    expect(sql).toContain('SUM(HOUR(o.date_purchased)=23) AS h23');
    expect(sql).toContain('o.date_purchased BETWEEN ? AND ?');
    expect(values).toEqual(['2026-06-09 00:00:00', '2026-06-11 23:59:59']);
  });

  it('formats day as a YYYY-MM-DD string in SQL (avoids mysql2 Date/timezone coercion)', () => {
    const { sql } = buildHourlyOrdersQuery(base);
    expect(sql).toContain("DATE_FORMAT(o.date_purchased, '%Y-%m-%d') AS day");
    expect(sql).not.toMatch(/SELECT\s+DATE\(o\.date_purchased\) AS day/);
  });

  it('adds an IN clause only when orderStatuses is non-empty', () => {
    expect(buildHourlyOrdersQuery(base).sql).not.toContain('o.orders_status IN');
    const withStatus = buildHourlyOrdersQuery({ ...base, orderStatuses: [2, 5] });
    expect(withStatus.sql).toContain('o.orders_status IN (?, ?)');
    expect(withStatus.values).toEqual(expect.arrayContaining([2, 5]));
  });

  it('channel=ukss filters first-party only', () => {
    const { sql } = buildHourlyOrdersQuery({ ...base, channel: 'ukss' });
    expect(sql).toContain("o.order_site = '0'");
  });

  it('channel=marketplace (no specific store) excludes first-party', () => {
    const { sql } = buildHourlyOrdersQuery({ ...base, channel: 'marketplace' });
    expect(sql).toContain("o.order_site <> '0' AND o.order_site IS NOT NULL");
  });

  it('channel=marketplace with a specific store parameterizes order_site', () => {
    const { sql, values } = buildHourlyOrdersQuery({ ...base, channel: 'marketplace', marketplace: '150' });
    expect(sql).toContain('o.order_site = ?');
    expect(values).toContain('150');
  });

  it('rejects an inverted date range', () => {
    expect(() => buildHourlyOrdersQuery({ dateFrom: '2026-06-11', dateTo: '2026-06-09' }))
      .toThrow(/dateFrom/);
  });
});
