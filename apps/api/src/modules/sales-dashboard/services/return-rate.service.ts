/**
 * Return Rate by Product Type Service
 *
 * Computes return rates per product type with reason breakdowns,
 * plus a monthly trend of overall return rate.
 *
 * Filters: orders_status = 5 (Shipped), excludes rejected/cancelled products.
 */

import { prisma, Prisma } from '../../../lib/prisma';
import { getLogger } from '../../../lib/logger-context';
import { withCache } from '../lib/cache';

// ─── Parameter & Row Interfaces ──────────────────────────────────────

interface ReturnRateParams {
  startDate: string;
  endDate: string;
  typeId?: number;
  alertThreshold?: number;
  noCache?: boolean;
}

interface TotalByTypeRow {
  type_id: number;
  type_name: string;
  total_products: bigint;
}

interface ReturnedByTypeRow {
  type_id: number;
  type_name: string;
  return_reason: string;
  returned_count: bigint;
}

interface TrendRow {
  period: string;
  total_products: bigint;
  returned_products: bigint;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function toNumber(val: bigint | number | string): number {
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string') return parseFloat(val);
  return val;
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

/**
 * Strip common prefixes like "Product - " from type names for cleaner display.
 */
function cleanTypeName(name: string): string {
  return name.replace(/^Product\s*-\s*/i, '').trim();
}

// ─── Main Service Function ───────────────────────────────────────────

export async function getReturnRate(params: ReturnRateParams) {
  const {
    startDate,
    endDate,
    typeId,
    alertThreshold = 15,
    noCache = false,
  } = params;
  const logger = getLogger();

  const cacheKey = `sales-dashboard:return-rate:${startDate}:${endDate}:${typeId ?? 'all'}:${alertThreshold}`;

  return withCache(cacheKey, 3600, async () => {
    logger.info({ startDate, endDate, typeId, alertThreshold }, 'Fetching return rate by product type');

    // Append time to endDate so BETWEEN includes the full day
    const endDateTime = `${endDate} 23:59:59`;

    // Optional type filter
    const typeFilter = typeId
      ? Prisma.sql`AND np.products_type = ${typeId}`
      : Prisma.sql``;

    // Run all 3 queries in parallel
    const queryStart = Date.now();

    const [totalByType, returnedByType, trendRows] = await Promise.all([
      // Query 1a — Total shipped products per type
      (async () => {
        const start = Date.now();
        logger.info(
          { chart: 'return-rate', label: 'total-by-type', params: { startDate, endDate, typeId } },
          '[return-rate] Executing query: total-by-type',
        );
        const rows = await prisma.$queryRaw<TotalByTypeRow[]>`
          SELECT
            pt.type_id,
            pt.type_name,
            COUNT(*) AS total_products
          FROM orders_products op
            INNER JOIN orders o ON o.orders_id = op.orders_id
            INNER JOIN new_products np ON np.products_id = op.products_id
            INNER JOIN product_types pt ON pt.type_id = np.products_type
          WHERE o.orders_status = 5
            AND o.date_purchased BETWEEN ${startDate} AND ${endDateTime}
            AND (op.box1 NOT IN ('Rejected', 'Cancelled') OR op.box1 IS NULL)
            AND (op.box2 NOT IN ('Rejected', 'Cancelled') OR op.box2 IS NULL)
            AND (op.box3 NOT IN ('Rejected', 'Cancelled') OR op.box3 IS NULL)
            ${typeFilter}
          GROUP BY pt.type_id, pt.type_name
        `;
        logger.info(
          { chart: 'return-rate', label: 'total-by-type', durationMs: Date.now() - start, rowCount: rows.length },
          '[return-rate] Query complete: total-by-type',
        );
        return rows;
      })(),

      // Query 1b — Returned products per type with reason
      // Uses return_chk = 'yes' as primary return indicator, LEFT JOIN CRI for reason
      (async () => {
        const start = Date.now();
        logger.info(
          { chart: 'return-rate', label: 'returned-by-type', params: { startDate, endDate, typeId } },
          '[return-rate] Executing query: returned-by-type',
        );
        const rows = await prisma.$queryRaw<ReturnedByTypeRow[]>`
          SELECT
            pt.type_id,
            pt.type_name,
            COALESCE(cri.return_reason, 'Unknown') AS return_reason,
            COUNT(*) AS returned_count
          FROM orders_products op
            INNER JOIN orders o ON o.orders_id = op.orders_id
            INNER JOIN new_products np ON np.products_id = op.products_id
            INNER JOIN product_types pt ON pt.type_id = np.products_type
            LEFT JOIN customer_return_item_details cri
              ON cri.return_order_id = o.orders_id
              AND cri.return_order_product_id = op.orders_products_id
              AND cri.return_status = 'accept'
          WHERE o.orders_status = 5
            AND o.date_purchased BETWEEN ${startDate} AND ${endDateTime}
            AND op.return_chk = 'yes'
            ${typeFilter}
          GROUP BY pt.type_id, pt.type_name, return_reason
        `;
        logger.info(
          { chart: 'return-rate', label: 'returned-by-type', durationMs: Date.now() - start, rowCount: rows.length },
          '[return-rate] Query complete: returned-by-type',
        );
        return rows;
      })(),

      // Query 2 — Monthly trend
      (async () => {
        const start = Date.now();
        logger.info(
          { chart: 'return-rate', label: 'monthly-trend', params: { startDate, endDate } },
          '[return-rate] Executing query: monthly-trend',
        );
        const rows = await prisma.$queryRaw<TrendRow[]>`
          SELECT
            DATE_FORMAT(o.date_purchased, '%Y-%m') AS period,
            COUNT(*) AS total_products,
            SUM(CASE WHEN op.return_chk = 'yes' THEN 1 ELSE 0 END) AS returned_products
          FROM orders_products op
            INNER JOIN orders o ON o.orders_id = op.orders_id
          WHERE o.orders_status = 5
            AND o.date_purchased BETWEEN ${startDate} AND ${endDateTime}
            AND (op.box1 NOT IN ('Rejected', 'Cancelled') OR op.box1 IS NULL)
            AND (op.box2 NOT IN ('Rejected', 'Cancelled') OR op.box2 IS NULL)
            AND (op.box3 NOT IN ('Rejected', 'Cancelled') OR op.box3 IS NULL)
          GROUP BY period
          ORDER BY period
        `;
        logger.info(
          { chart: 'return-rate', label: 'monthly-trend', durationMs: Date.now() - start, rowCount: rows.length },
          '[return-rate] Query complete: monthly-trend',
        );
        return rows;
      })(),
    ]);

    logger.info(
      { chart: 'return-rate', durationMs: Date.now() - queryStart },
      '[return-rate] All 3 parallel queries complete',
    );

    // ─── Merge total + returned per type ─────────────────────────────

    interface TypeAccumulator {
      typeId: number;
      typeName: string;
      totalProducts: number;
      returnedProducts: number;
      reasons: Map<string, number>;
    }

    const typeMap = new Map<number, TypeAccumulator>();

    for (const row of totalByType) {
      const id = toNumber(row.type_id);
      typeMap.set(id, {
        typeId: id,
        typeName: cleanTypeName(row.type_name),
        totalProducts: toNumber(row.total_products),
        returnedProducts: 0,
        reasons: new Map(),
      });
    }

    for (const row of returnedByType) {
      const id = toNumber(row.type_id);
      let entry = typeMap.get(id);
      if (!entry) {
        // Type appeared in returns but not totals — unlikely but handle it
        entry = {
          typeId: id,
          typeName: cleanTypeName(row.type_name),
          totalProducts: 0,
          returnedProducts: 0,
          reasons: new Map(),
        };
        typeMap.set(id, entry);
      }
      const count = toNumber(row.returned_count);
      entry.returnedProducts += count;
      const existing = entry.reasons.get(row.return_reason) ?? 0;
      entry.reasons.set(row.return_reason, existing + count);
    }

    // ─── Build byType array sorted by returnRate DESC ────────────────

    let byType = Array.from(typeMap.values())
      .map((t) => {
        const returnRate = safeRate(t.returnedProducts, t.totalProducts);
        const reasons = Array.from(t.reasons.entries())
          .map(([reason, count]) => ({
            reason,
            count,
            percentage: safeRate(count, t.totalProducts),
          }))
          .sort((a, b) => b.count - a.count);

        return {
          typeId: t.typeId,
          typeName: t.typeName,
          totalProducts: t.totalProducts,
          returnedProducts: t.returnedProducts,
          returnRate,
          exceedsThreshold: returnRate > alertThreshold,
          reasons,
        };
      })
      .sort((a, b) => b.returnRate - a.returnRate);

    // Take top 5 unless filtering by specific typeId
    if (!typeId) {
      byType = byType.slice(0, 5);
    }

    // ─── Build trend array ───────────────────────────────────────────

    const trend = trendRows.map((row) => {
      const total = toNumber(row.total_products);
      const returned = toNumber(row.returned_products);
      return {
        period: row.period,
        returnRate: safeRate(returned, total),
        totalProducts: total,
        returnedProducts: returned,
      };
    });

    logger.info(
      {
        typeCount: byType.length,
        trendPeriods: trend.length,
        topReturnRate: byType[0]?.returnRate ?? 0,
      },
      'Return rate query complete',
    );

    return { byType, trend, alertThreshold };
  }, noCache);
}
