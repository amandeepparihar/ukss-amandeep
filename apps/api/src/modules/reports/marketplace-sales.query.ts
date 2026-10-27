export type MsChannel = 'both' | 'ukss' | 'marketplace';

export interface MarketplaceSalesParams {
  dateFrom?: string;
  dateTo?: string;
  channel?: MsChannel;
  statuses?: Array<number | string>;
}

export function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 29); // last 30 days inclusive
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(today) };
}

// Shared WHERE: date range + channel + status. Returns clause + values.
function baseWhere(p: MarketplaceSalesParams): { where: string; values: unknown[] } {
  const def = defaultRange();
  const dateFrom = p.dateFrom || def.from;
  const dateTo = p.dateTo || def.to;
  if (dateFrom > dateTo) throw new Error(`Invalid range: dateFrom (${dateFrom}) is after dateTo (${dateTo})`);

  const values: unknown[] = [`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`];
  let where = 'o.date_purchased BETWEEN ? AND ?';

  const channel: MsChannel = p.channel || 'both';
  if (channel === 'ukss') where += " AND o.order_site = '0'";
  else if (channel === 'marketplace') where += " AND o.order_site <> '0' AND o.order_site IS NOT NULL";

  const statuses = (p.statuses ?? []).filter((s) => s !== '' && s !== null && s !== undefined);
  if (statuses.length > 0) {
    where += ` AND o.orders_status IN (${statuses.map(() => '?').join(', ')})`;
    values.push(...statuses.map((s) => Number(s)));
  }
  return { where, values };
}

export function buildBreakdownQuery(p: MarketplaceSalesParams): { sql: string; values: unknown[] } {
  const { where, values } = baseWhere(p);
  const sql = `
    SELECT o.order_site AS order_site,
           CASE WHEN o.order_site = '0' THEN 'UKSS' ELSE COALESCE(sm.store_name, o.order_site) END AS channel,
           COUNT(*) AS orders,
           SUM(o.order_total) AS revenue,
           AVG(o.order_total) AS aov
    FROM orders o
    LEFT JOIN store_management sm ON o.order_site = sm.store_id
    WHERE ${where}
    GROUP BY o.order_site
    ORDER BY revenue DESC`;
  return { sql, values };
}

export function buildDailyTrendQuery(p: MarketplaceSalesParams): { sql: string; values: unknown[] } {
  const { where, values } = baseWhere(p);
  const sql = `
    SELECT DATE_FORMAT(o.date_purchased, '%Y-%m-%d') AS day,
           o.order_site AS order_site,
           COUNT(*) AS orders
    FROM orders o
    WHERE ${where}
    GROUP BY day, o.order_site
    ORDER BY day`;
  return { sql, values };
}

export function buildHourlyByChannelQuery(p: MarketplaceSalesParams): { sql: string; values: unknown[] } {
  const { where, values } = baseWhere(p);
  const sql = `
    SELECT o.order_site AS order_site,
           HOUR(o.date_purchased) AS hour,
           COUNT(*) AS orders
    FROM orders o
    WHERE ${where}
    GROUP BY o.order_site, HOUR(o.date_purchased)`;
  return { sql, values };
}

export function previousRange(dateFrom: string, dateTo: string): { from: string; to: string } {
  const from = new Date(`${dateFrom}T00:00:00Z`);
  const to = new Date(`${dateTo}T00:00:00Z`);
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1; // inclusive
  const prevTo = new Date(from.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}
