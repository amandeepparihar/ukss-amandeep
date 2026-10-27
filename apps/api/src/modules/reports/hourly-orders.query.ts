export type Channel = 'both' | 'ukss' | 'marketplace';

export interface HourlyOrdersParams {
  dateFrom?: string;       // 'YYYY-MM-DD'
  dateTo?: string;         // 'YYYY-MM-DD'
  orderStatuses?: Array<number | string>;
  channel?: Channel;
  marketplace?: string;    // store_id; only honoured when channel === 'marketplace'
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 6); // last 7 days inclusive
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(today) };
}

export function buildHourlyOrdersQuery(params: HourlyOrdersParams): { sql: string; values: unknown[] } {
  const def = defaultRange();
  const dateFrom = params.dateFrom || def.from;
  const dateTo = params.dateTo || def.to;
  if (dateFrom > dateTo) {
    throw new Error(`Invalid range: dateFrom (${dateFrom}) is after dateTo (${dateTo})`);
  }

  const values: unknown[] = [`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`];
  let where = 'o.date_purchased BETWEEN ? AND ?';

  const statuses = (params.orderStatuses ?? []).filter((s) => s !== '' && s !== null && s !== undefined);
  if (statuses.length > 0) {
    where += ` AND o.orders_status IN (${statuses.map(() => '?').join(', ')})`;
    values.push(...statuses.map((s) => Number(s)));
  }

  const channel: Channel = params.channel || 'both';
  if (channel === 'ukss') {
    where += " AND o.order_site = '0'";
  } else if (channel === 'marketplace') {
    const mk = params.marketplace;
    if (mk !== undefined && mk !== null && mk !== '' && mk !== 'all') {
      where += ' AND o.order_site = ?';
      values.push(String(mk));
    } else {
      where += " AND o.order_site <> '0' AND o.order_site IS NOT NULL";
    }
  }

  const hourCols = Array.from({ length: 24 }, (_, h) =>
    `SUM(HOUR(o.date_purchased)=${h}) AS h${pad2(h)}`
  ).join(',\n           ');

  // Format the day in SQL as a 'YYYY-MM-DD' string rather than returning a
  // raw DATE. mysql2 would otherwise coerce a DATE to a JS Date at midnight in
  // the connection's local timezone (Europe/London); JSON-serializing that
  // yields a full UTC datetime and, during BST, an off-by-one calendar day.
  // DATE_FORMAT keeps it a plain string end-to-end.
  const sql = `
    SELECT DATE_FORMAT(o.date_purchased, '%Y-%m-%d') AS day,
           ${hourCols},
           COUNT(*) AS total
    FROM orders o
    WHERE ${where}
    GROUP BY DATE(o.date_purchased)
    ORDER BY day`;

  return { sql, values };
}
