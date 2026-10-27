/**
 * Geographic Revenue Service
 *
 * Aggregates revenue by delivery region/country with geo-coordinates
 * for map visualization. Includes delivery time and return rate metrics.
 */

import { getLogger } from '../../../lib/logger-context';
import { withCache } from '../lib/cache';
import { queryWithLog } from '../lib/query-logger';
import type { GeoRevenueQuery } from '../sales-dashboard.schema';

// ─── Types ────────────────────────────────────────────────────────────

interface RawGeoRow {
  region: string;
  country: string;
  order_count: bigint | number | string;
  total_revenue: number | string | null;
  avg_delivery_days: number | string | null;
  returned_count: bigint | number | string;
  total_products: bigint | number | string;
}

interface GeoRegionData {
  region: string;
  country: string;
  lat: number;
  lng: number;
  totalRevenue: number;
  orderCount: number;
  avgDeliveryDays: number | null;
  returnRate: number;
}

interface GeoRevenueResult {
  regions: GeoRegionData[];
  topRegions: GeoRegionData[];
  bottomRegions: GeoRegionData[];
}

// ─── Helpers ──────────────────────────────────────────────────────────

function toNumber(val: bigint | number | string | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

// ─── UK Region Coordinates Lookup ─────────────────────────────────────

const UK_REGION_COORDS: Record<string, { lat: number; lng: number }> = {
  'London': { lat: 51.5074, lng: -0.1278 },
  'Greater London': { lat: 51.5074, lng: -0.1278 },
  'Manchester': { lat: 53.4808, lng: -2.2426 },
  'Greater Manchester': { lat: 53.4808, lng: -2.2426 },
  'Birmingham': { lat: 52.4862, lng: -1.8904 },
  'West Midlands': { lat: 52.4862, lng: -1.8904 },
  'Leeds': { lat: 53.8008, lng: -1.5491 },
  'West Yorkshire': { lat: 53.8008, lng: -1.5491 },
  'Glasgow': { lat: 55.8642, lng: -4.2518 },
  'Liverpool': { lat: 53.4084, lng: -2.9916 },
  'Merseyside': { lat: 53.4084, lng: -2.9916 },
  'Bristol': { lat: 51.4545, lng: -2.5879 },
  'Sheffield': { lat: 53.3811, lng: -1.4701 },
  'South Yorkshire': { lat: 53.3811, lng: -1.4701 },
  'Edinburgh': { lat: 55.9533, lng: -3.1883 },
  'Cardiff': { lat: 51.4816, lng: -3.1791 },
  'Newcastle upon Tyne': { lat: 54.9783, lng: -1.6178 },
  'Tyne and Wear': { lat: 54.9783, lng: -1.6178 },
  'Nottingham': { lat: 52.9548, lng: -1.1581 },
  'Nottinghamshire': { lat: 52.9548, lng: -1.1581 },
  'Southampton': { lat: 50.9097, lng: -1.4044 },
  'Hampshire': { lat: 51.0577, lng: -1.3081 },
  'Leicester': { lat: 52.6369, lng: -1.1398 },
  'Leicestershire': { lat: 52.6369, lng: -1.1398 },
  'Coventry': { lat: 52.4068, lng: -1.5197 },
  'Brighton': { lat: 50.8225, lng: -0.1372 },
  'East Sussex': { lat: 50.8225, lng: -0.1372 },
  'Plymouth': { lat: 50.3755, lng: -4.1427 },
  'Devon': { lat: 50.7184, lng: -3.5339 },
  'Stoke-on-Trent': { lat: 53.0027, lng: -2.1794 },
  'Staffordshire': { lat: 52.8793, lng: -2.0572 },
  'Aberdeen': { lat: 57.1497, lng: -2.0943 },
  'Belfast': { lat: 54.5973, lng: -5.9301 },
  'Derby': { lat: 52.9225, lng: -1.4746 },
  'Derbyshire': { lat: 53.1, lng: -1.5 },
  'Swansea': { lat: 51.6214, lng: -3.9436 },
  'Essex': { lat: 51.7343, lng: 0.4691 },
  'Kent': { lat: 51.2787, lng: 0.5217 },
  'Surrey': { lat: 51.2587, lng: -0.3856 },
  'Lancashire': { lat: 53.8, lng: -2.5 },
  'Norfolk': { lat: 52.6139, lng: 0.8864 },
  'Suffolk': { lat: 52.1872, lng: 0.9708 },
  'Cornwall': { lat: 50.2660, lng: -5.0527 },
  'Dorset': { lat: 50.7488, lng: -2.3445 },
  'Somerset': { lat: 51.1051, lng: -2.9262 },
  'Oxfordshire': { lat: 51.7520, lng: -1.2577 },
  'Cambridgeshire': { lat: 52.2053, lng: 0.1218 },
  'Cheshire': { lat: 53.2, lng: -2.6 },
  'Cumbria': { lat: 54.5772, lng: -2.7975 },
  'Hertfordshire': { lat: 51.8098, lng: -0.2379 },
  'Berkshire': { lat: 51.4, lng: -1.1 },
  'Wiltshire': { lat: 51.3492, lng: -1.9927 },
  'Lincolnshire': { lat: 53.2, lng: -0.3 },
  'Northumberland': { lat: 55.2, lng: -2.1 },
  'County Durham': { lat: 54.7753, lng: -1.5849 },
  'Durham': { lat: 54.7753, lng: -1.5849 },
  'North Yorkshire': { lat: 54.1, lng: -1.5 },
  'East Yorkshire': { lat: 53.8, lng: -0.5 },
  'Buckinghamshire': { lat: 51.8137, lng: -0.8095 },
  'Gloucestershire': { lat: 51.8642, lng: -2.2382 },
  'Worcestershire': { lat: 52.2, lng: -2.2 },
  'Shropshire': { lat: 52.7, lng: -2.8 },
  'Warwickshire': { lat: 52.3, lng: -1.6 },
  'Northamptonshire': { lat: 52.2, lng: -0.9 },
  'Bedfordshire': { lat: 52.1, lng: -0.4 },
  'Middlesex': { lat: 51.5, lng: -0.4 },
  'United Kingdom': { lat: 54.0, lng: -2.0 },
  'UK': { lat: 54.0, lng: -2.0 },
};

/**
 * Build a case-insensitive lookup map for faster matching.
 */
const COORDS_LOWER = new Map<string, { lat: number; lng: number }>();
for (const [key, val] of Object.entries(UK_REGION_COORDS)) {
  COORDS_LOWER.set(key.toLowerCase(), val);
}

function lookupCoords(region: string): { lat: number; lng: number } | null {
  // Try exact case-insensitive match
  const coords = COORDS_LOWER.get(region.toLowerCase());
  if (coords) return coords;
  return null;
}

// ─── Cache keys & TTL ─────────────────────────────────────────────────

const CACHE_TTL = 3600; // 1 hour

function buildCacheKey(params: GeoRevenueQuery): string {
  const parts = [
    'sales-dashboard:geo-revenue',
    params.startDate,
    params.endDate,
  ];
  if (params.country) parts.push(`country:${params.country}`);
  return parts.join(':');
}

// ─── Main service function ────────────────────────────────────────────

export async function getGeoRevenue(params: GeoRevenueQuery): Promise<GeoRevenueResult> {
  const logger = getLogger();
  const cacheKey = buildCacheKey(params);

  return withCache<GeoRevenueResult>(
    cacheKey,
    CACHE_TTL,
    async () => {
      logger.info({ params }, 'Fetching geo revenue data from database');

      const endDateTime = `${params.endDate} 23:59:59`;

      // Build WHERE conditions
      const conditions: string[] = [
        `o.orders_status = 5`,
        `o.date_purchased BETWEEN ? AND ?`,
        `(op.box1 NOT IN ('Rejected', 'Cancelled') OR op.box1 IS NULL)`,
        `(op.box2 NOT IN ('Rejected', 'Cancelled') OR op.box2 IS NULL)`,
        `(op.box3 NOT IN ('Rejected', 'Cancelled') OR op.box3 IS NULL)`,
        `(op.return_chk IS NULL OR op.return_chk != 'yes')`,
      ];

      const queryParams: (string | number)[] = [params.startDate, endDateTime];

      if (params.country) {
        conditions.push(`TRIM(o.delivery_country) = ?`);
        queryParams.push(params.country);
      }

      const whereClause = conditions.join(' AND ');

      const sql = `
        SELECT
          COALESCE(NULLIF(TRIM(o.delivery_state), ''), 'Unknown') AS region,
          COALESCE(NULLIF(TRIM(o.delivery_country), ''), 'Unknown') AS country,
          COUNT(DISTINCT o.orders_id) AS order_count,
          SUM(op.final_price * op.products_quantity) AS total_revenue,
          AVG(CASE
            WHEN o.date_completed IS NOT NULL AND o.date_completed > o.date_purchased
            THEN DATEDIFF(o.date_completed, o.date_purchased)
            ELSE NULL
          END) AS avg_delivery_days,
          SUM(CASE WHEN op.return_chk = 'yes' THEN 1 ELSE 0 END) AS returned_count,
          COUNT(*) AS total_products
        FROM orders_products op
          INNER JOIN orders o ON o.orders_id = op.orders_id
        WHERE ${whereClause}
        GROUP BY region, country
        HAVING total_revenue > 0
        ORDER BY total_revenue DESC
      `;

      const rows = await queryWithLog<RawGeoRow>('geo-revenue', 'region-data', sql, queryParams);

      logger.info({ rowCount: rows.length }, 'Geo revenue raw query returned');

      // Post-process: map to typed result with coordinates
      const allRegions: GeoRegionData[] = [];
      const mappedRegions: GeoRegionData[] = [];

      for (const row of rows) {
        const totalProducts = toNumber(row.total_products);
        const returnedCount = toNumber(row.returned_count);
        const totalRevenue = Math.round(toNumber(row.total_revenue) * 100) / 100;
        const returnRate = totalProducts > 0
          ? Math.round((returnedCount / totalProducts) * 10000) / 100
          : 0;
        const avgDeliveryDays = row.avg_delivery_days !== null
          ? Math.round(toNumber(row.avg_delivery_days) * 10) / 10
          : null;

        const coords = lookupCoords(row.region) || lookupCoords(row.country);

        const regionData: GeoRegionData = {
          region: row.region,
          country: row.country,
          lat: coords?.lat ?? 0,
          lng: coords?.lng ?? 0,
          totalRevenue,
          orderCount: toNumber(row.order_count),
          avgDeliveryDays,
          returnRate,
        };

        allRegions.push(regionData);

        // Only include in map data if we have valid coordinates
        if (coords) {
          mappedRegions.push(regionData);
        }
      }

      // Sort by revenue DESC for top/bottom lists (allRegions already sorted by SQL)
      const topRegions = allRegions.slice(0, 10);
      const bottomRegions = allRegions.length > 10
        ? allRegions.slice(-10).reverse()
        : [];

      return {
        regions: mappedRegions,
        topRegions,
        bottomRegions,
      };
    },
    params.noCache,
  );
}
