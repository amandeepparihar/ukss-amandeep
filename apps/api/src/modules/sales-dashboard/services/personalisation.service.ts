import { getLogger } from '../../../lib/logger-context';
import { withCache } from '../lib/cache';
import { queryWithLog } from '../lib/query-logger';

interface PersonalisationParams {
  startDate: string;
  endDate: string;
  granularity?: 'daily' | 'weekly' | 'monthly';
  noCache?: boolean;
}

interface PersonalisationSegment {
  totalOrders: number;
  totalUnitsSold: number;
  totalRevenue: number;
  averageOrderValue: number;
  percentageOfTotal: number;
}

interface PersonalisationTimeSeriesEntry {
  period: string;
  personalised: { unitsSold: number; revenue: number };
  nonPersonalised: { unitsSold: number; revenue: number };
}

interface PersonalisationResponse {
  summary: {
    personalised: PersonalisationSegment;
    nonPersonalised: PersonalisationSegment;
  };
  personalisationPremium: number;
  timeSeries: PersonalisationTimeSeriesEntry[];
}

interface RawRow {
  period: string;
  personalisation_status: string;
  total_orders: string | number;
  total_units: string | number;
  total_revenue: string | number;
}

function getDateFormat(granularity: string): string {
  switch (granularity) {
    case 'daily':
      return `DATE_FORMAT(o.date_purchased, '%Y-%m-%d')`;
    case 'weekly':
      return `DATE_FORMAT(DATE_SUB(o.date_purchased, INTERVAL WEEKDAY(o.date_purchased) DAY), '%Y-%m-%d')`;
    case 'monthly':
    default:
      return `DATE_FORMAT(o.date_purchased, '%Y-%m')`;
  }
}

function emptyResponse(): PersonalisationResponse {
  const emptySegment: PersonalisationSegment = {
    totalOrders: 0,
    totalUnitsSold: 0,
    totalRevenue: 0,
    averageOrderValue: 0,
    percentageOfTotal: 0,
  };
  return {
    summary: {
      personalised: { ...emptySegment },
      nonPersonalised: { ...emptySegment },
    },
    personalisationPremium: 0,
    timeSeries: [],
  };
}

export async function getPersonalisationSales(
  params: PersonalisationParams
): Promise<PersonalisationResponse> {
  const logger = getLogger('sales-dashboard');
  const { startDate, endDate, granularity = 'monthly', noCache = false } = params;

  const cacheKey = `sales-dashboard:personalisation:${startDate}:${endDate}:${granularity}`;

  return withCache<PersonalisationResponse>(
    cacheKey,
    3600,
    async () => {
      const dateFormat = getDateFormat(granularity);

      const query = `
        SELECT
          ${dateFormat} AS period,
          CASE
            WHEN opa.orders_products_id IS NOT NULL THEN 'Personalised'
            ELSE 'Non-Personalised'
          END AS personalisation_status,
          COUNT(DISTINCT o.orders_id) AS total_orders,
          SUM(op.products_quantity) AS total_units,
          SUM(op.final_price * op.products_quantity) AS total_revenue
        FROM orders_products op
        JOIN orders o ON o.orders_id = op.orders_id
        LEFT JOIN (
          SELECT DISTINCT orders_products_id
          FROM orders_products_attributes
          WHERE products_options_id IN (2, 3, 4, 63, 64, 65)
        ) opa ON opa.orders_products_id = op.orders_products_id
        WHERE o.orders_status = 5
          AND o.date_purchased BETWEEN ? AND ?
          AND op.box1 NOT IN ('Rejected', 'Cancelled')
          AND op.box2 NOT IN ('Rejected', 'Cancelled')
          AND op.box3 NOT IN ('Rejected', 'Cancelled')
          AND op.return_chk != 'yes'
        GROUP BY period, personalisation_status
        ORDER BY period ASC, personalisation_status ASC
      `;

      logger.info({ startDate, endDate, granularity }, 'Querying personalisation sales data');

      const rows = await queryWithLog<RawRow>('personalisation', 'sales-data', query, [startDate, `${endDate} 23:59:59`]);

      if (!rows || rows.length === 0) {
        logger.info('No personalisation sales data found for the given date range');
        return emptyResponse();
      }

      // Accumulate totals per segment
      let persOrders = 0, persUnits = 0, persRevenue = 0;
      let nonPersOrders = 0, nonPersUnits = 0, nonPersRevenue = 0;

      // Group by period for time series
      const periodMap = new Map<string, {
        personalised: { unitsSold: number; revenue: number };
        nonPersonalised: { unitsSold: number; revenue: number };
      }>();

      for (const row of rows) {
        const orders = Number(row.total_orders) || 0;
        const units = Number(row.total_units) || 0;
        const revenue = Number(row.total_revenue) || 0;
        const isPers = row.personalisation_status === 'Personalised';

        if (isPers) {
          persOrders += orders;
          persUnits += units;
          persRevenue += revenue;
        } else {
          nonPersOrders += orders;
          nonPersUnits += units;
          nonPersRevenue += revenue;
        }

        // Time series pivot
        if (!periodMap.has(row.period)) {
          periodMap.set(row.period, {
            personalised: { unitsSold: 0, revenue: 0 },
            nonPersonalised: { unitsSold: 0, revenue: 0 },
          });
        }
        const entry = periodMap.get(row.period)!;
        if (isPers) {
          entry.personalised.unitsSold += units;
          entry.personalised.revenue += revenue;
        } else {
          entry.nonPersonalised.unitsSold += units;
          entry.nonPersonalised.revenue += revenue;
        }
      }

      const grandTotalRevenue = persRevenue + nonPersRevenue;

      // Compute averageOrderValue
      const persAov = persOrders > 0 ? persRevenue / persOrders : 0;
      const nonPersAov = nonPersOrders > 0 ? nonPersRevenue / nonPersOrders : 0;

      // Compute percentageOfTotal
      const persPercentage = grandTotalRevenue > 0 ? (persRevenue / grandTotalRevenue) * 100 : 0;
      const nonPersPercentage = grandTotalRevenue > 0 ? (nonPersRevenue / grandTotalRevenue) * 100 : 0;

      // Compute personalisation premium (avg price per unit difference)
      const persAvgPrice = persUnits > 0 ? persRevenue / persUnits : 0;
      const nonPersAvgPrice = nonPersUnits > 0 ? nonPersRevenue / nonPersUnits : 0;
      const personalisationPremium = persAvgPrice - nonPersAvgPrice;

      // Build time series
      const timeSeries: PersonalisationTimeSeriesEntry[] = [];
      for (const [period, data] of periodMap) {
        timeSeries.push({
          period,
          personalised: data.personalised,
          nonPersonalised: data.nonPersonalised,
        });
      }

      const result: PersonalisationResponse = {
        summary: {
          personalised: {
            totalOrders: persOrders,
            totalUnitsSold: persUnits,
            totalRevenue: Math.round(persRevenue * 100) / 100,
            averageOrderValue: Math.round(persAov * 100) / 100,
            percentageOfTotal: Math.round(persPercentage * 100) / 100,
          },
          nonPersonalised: {
            totalOrders: nonPersOrders,
            totalUnitsSold: nonPersUnits,
            totalRevenue: Math.round(nonPersRevenue * 100) / 100,
            averageOrderValue: Math.round(nonPersAov * 100) / 100,
            percentageOfTotal: Math.round(nonPersPercentage * 100) / 100,
          },
        },
        personalisationPremium: Math.round(personalisationPremium * 100) / 100,
        timeSeries,
      };

      logger.info(
        {
          persOrders,
          nonPersOrders,
          persRevenue: result.summary.personalised.totalRevenue,
          nonPersRevenue: result.summary.nonPersonalised.totalRevenue,
          premium: result.personalisationPremium,
        },
        'Personalisation sales data computed'
      );

      return result;
    },
    noCache,
  );
}
