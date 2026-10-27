import { getLogger } from '../../../lib/logger-context';
import { withCache } from '../lib/cache';
import { queryWithLog } from '../lib/query-logger';

// ─── Types ────────────────────────────────────────────────────────────

export interface InventoryQuadrantParams {
  startDate: string;
  endDate: string;
  turnoverThreshold?: number;
  stockDaysThreshold?: number;
  noCache?: boolean;
}

type Quadrant = 'fast-movers-risk' | 'healthy' | 'slow-stable' | 'dead-stock';

interface StockRow {
  products_id: number;
  products_name: string;
  current_stock: bigint | number | string;
}

interface SalesRow {
  products_id: number;
  units_sold: bigint | number | string;
}

interface ProductResult {
  productId: number;
  productName: string;
  currentStock: number;
  dailySalesRate: number;
  turnoverRate: number;
  daysOfStock: number;
  quadrant: Quadrant;
}

interface QuadrantSummary {
  fastMoversRisk: number;
  healthy: number;
  slowStable: number;
  deadStock: number;
}

interface InventoryQuadrantResponse {
  products: ProductResult[];
  summary: QuadrantSummary;
  thresholds: { turnover: number; stockDays: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function toNumber(val: bigint | number | string | null | undefined): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string') return parseFloat(val) || 0;
  return val;
}

function assignQuadrant(
  turnoverRate: number,
  daysOfStock: number,
  turnoverThreshold: number,
  stockDaysThreshold: number,
): Quadrant {
  if (turnoverRate >= turnoverThreshold && daysOfStock < stockDaysThreshold) {
    return 'fast-movers-risk';
  }
  if (turnoverRate >= turnoverThreshold && daysOfStock >= stockDaysThreshold) {
    return 'healthy';
  }
  if (turnoverRate < turnoverThreshold && daysOfStock >= stockDaysThreshold) {
    return 'slow-stable';
  }
  return 'dead-stock';
}

function emptyResponse(thresholds: { turnover: number; stockDays: number }): InventoryQuadrantResponse {
  return {
    products: [],
    summary: { fastMoversRisk: 0, healthy: 0, slowStable: 0, deadStock: 0 },
    thresholds,
  };
}

// ─── Main Service ─────────────────────────────────────────────────────

export async function getInventoryQuadrant(
  params: InventoryQuadrantParams,
): Promise<InventoryQuadrantResponse> {
  const logger = getLogger();
  const {
    startDate,
    endDate,
    turnoverThreshold = 2,
    stockDaysThreshold = 60,
    noCache = false,
  } = params;

  const thresholds = { turnover: turnoverThreshold, stockDays: stockDaysThreshold };
  const cacheKey = `sales-dashboard:inventory-quadrant:${startDate}:${endDate}:${turnoverThreshold}:${stockDaysThreshold}`;

  return withCache<InventoryQuadrantResponse>(
    cacheKey,
    3600,
    async () => {
      logger.info({ startDate, endDate, turnoverThreshold, stockDaysThreshold }, 'Querying inventory quadrant data');

      // Run both queries in parallel
      const [stockRows, salesRows] = await Promise.all([
        // Query 1 — Current stock per product
        queryWithLog<StockRow>('inventory-quadrant', 'current-stock', `
          SELECT
            np.products_id,
            np.products_name,
            SUM(npv.npv_quantities) AS current_stock
          FROM new_products np
            INNER JOIN new_products_variations npv ON npv.npv_products_id = np.products_id
          GROUP BY np.products_id, np.products_name
          HAVING current_stock > 0
        `),

        // Query 2 — Sales velocity (units sold per product in date range)
        queryWithLog<SalesRow>('inventory-quadrant', 'sales-velocity', `
          SELECT
            op.products_id,
            SUM(op.products_quantity) AS units_sold
          FROM orders_products op
            INNER JOIN orders o ON o.orders_id = op.orders_id
          WHERE o.orders_status = 5
            AND o.date_purchased BETWEEN ? AND ?
            AND (op.box1 NOT IN ('Rejected','Cancelled') OR op.box1 IS NULL)
            AND (op.box2 NOT IN ('Rejected','Cancelled') OR op.box2 IS NULL)
            AND (op.box3 NOT IN ('Rejected','Cancelled') OR op.box3 IS NULL)
            AND (op.return_chk != 'yes' OR op.return_chk IS NULL)
          GROUP BY op.products_id
        `, [`${startDate} 00:00:00`, `${endDate} 23:59:59`]),
      ]);

      if (!stockRows || stockRows.length === 0) {
        logger.info('No stock data found');
        return emptyResponse(thresholds);
      }

      // Build a map of product sales
      const salesMap = new Map<number, number>();
      for (const row of salesRows) {
        salesMap.set(row.products_id, toNumber(row.units_sold));
      }

      // Calculate date range in days
      const startMs = new Date(startDate).getTime();
      const endMs = new Date(endDate).getTime();
      const daysDiff = Math.max(1, (endMs - startMs) / (1000 * 60 * 60 * 24) + 1);

      // Process each product
      const allProducts: ProductResult[] = [];

      for (const row of stockRows) {
        const productId = row.products_id;
        const productName = row.products_name;
        const currentStock = toNumber(row.current_stock);
        const unitsSold = salesMap.get(productId) ?? 0;

        const dailySalesRate = unitsSold / daysDiff;
        const turnoverRate = currentStock > 0
          ? (unitsSold / currentStock) * (365 / daysDiff)
          : 0;
        const daysOfStock = dailySalesRate > 0
          ? currentStock / dailySalesRate
          : 9999;

        const quadrant = assignQuadrant(turnoverRate, daysOfStock, turnoverThreshold, stockDaysThreshold);

        allProducts.push({
          productId,
          productName,
          currentStock,
          dailySalesRate: Math.round(dailySalesRate * 100) / 100,
          turnoverRate: Math.round(turnoverRate * 100) / 100,
          daysOfStock: Math.round(daysOfStock),
          quadrant,
        });
      }

      // Sort by units sold descending, limit to top 200 for chart readability
      allProducts.sort((a, b) => {
        const aSold = (salesMap.get(a.productId) ?? 0);
        const bSold = (salesMap.get(b.productId) ?? 0);
        return bSold - aSold;
      });

      const products = allProducts.slice(0, 200);

      // Compute summary counts
      const summary: QuadrantSummary = {
        fastMoversRisk: 0,
        healthy: 0,
        slowStable: 0,
        deadStock: 0,
      };

      for (const p of products) {
        switch (p.quadrant) {
          case 'fast-movers-risk':
            summary.fastMoversRisk++;
            break;
          case 'healthy':
            summary.healthy++;
            break;
          case 'slow-stable':
            summary.slowStable++;
            break;
          case 'dead-stock':
            summary.deadStock++;
            break;
        }
      }

      logger.info(
        {
          totalStockProducts: stockRows.length,
          productsWithSales: salesMap.size,
          returnedProducts: products.length,
          summary,
        },
        'Inventory quadrant data computed',
      );

      return { products, summary, thresholds };
    },
    noCache,
  );
}
