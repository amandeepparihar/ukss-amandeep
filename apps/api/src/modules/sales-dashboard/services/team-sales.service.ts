/**
 * Team Sales Service
 *
 * Aggregates sales data by team (football club/brand) with time series,
 * supporting league/continent filtering and topN selection.
 */

import { getLogger } from '../../../lib/logger-context';
import { withCache } from '../lib/cache';
import { queryWithLog } from '../lib/query-logger';
import type { TeamSalesQuery } from '../sales-dashboard.schema';

// ─── Types ────────────────────────────────────────────────────────────

interface TeamSalesSummary {
  teamId: number;
  teamName: string;
  totalUnitsSold: number;
  totalRevenue: number;
}

interface TeamSalesTimeSeriesEntry {
  period: string;
  teams: Array<{
    teamId: number;
    teamName: string;
    unitsSold: number;
    revenue: number;
  }>;
}

interface TeamSalesResult {
  summary: TeamSalesSummary[];
  timeSeries: TeamSalesTimeSeriesEntry[];
  filters: {
    availableLeagues: string[];
    availableContinents: string[];
  };
}

interface RawTeamSalesRow {
  period: string;
  team_id: number;
  team_name: string;
  units_sold: bigint | number;
  revenue: number | string;
}

interface RawLeagueRow {
  np_league: string;
}

interface RawContinentRow {
  np_continent: string;
}

// ─── Cache keys & TTLs ───────────────────────────────────────────────

const CACHE_TTL = 3600; // 1 hour
const FILTER_CACHE_TTL = 86400; // 24 hours

function buildCacheKey(params: TeamSalesQuery): string {
  const parts = [
    'sales-dashboard:team-sales',
    params.startDate,
    params.endDate,
    params.granularity,
    `top${params.topN}`,
  ];
  if (params.league) parts.push(`league:${params.league}`);
  if (params.continent) parts.push(`continent:${params.continent}`);
  return parts.join(':');
}

// ─── Date format expression for granularity ─────────────────────────

function getDateFormatExpression(granularity: string): string {
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

// ─── Main service function ──────────────────────────────────────────

export async function getTeamSales(params: TeamSalesQuery): Promise<TeamSalesResult> {
  const logger = getLogger();
  const cacheKey = buildCacheKey(params);

  return withCache<TeamSalesResult>(
    cacheKey,
    CACHE_TTL,
    async () => {
      logger.info({ params }, 'Fetching team sales data from database');

      const dateFormat = getDateFormatExpression(params.granularity);

      // Build WHERE clause conditions
      const conditions: string[] = [
        `o.orders_status = 5`,
        `op.box1 NOT IN ('Rejected', 'Cancelled')`,
        `op.box2 NOT IN ('Rejected', 'Cancelled')`,
        `op.box3 NOT IN ('Rejected', 'Cancelled')`,
        `(op.return_chk IS NULL OR op.return_chk != 'yes')`,
        `np.np_team_id IS NOT NULL`,
        `np.np_team_id != 0`,
        `o.date_purchased >= ?`,
        `o.date_purchased < DATE_ADD(?, INTERVAL 1 DAY)`,
      ];

      const queryParams: (string | number)[] = [params.startDate, params.endDate];

      if (params.league) {
        conditions.push(`np.np_league = ?`);
        queryParams.push(params.league);
      }

      if (params.continent) {
        conditions.push(`np.np_continent = ?`);
        queryParams.push(params.continent);
      }

      const whereClause = conditions.join(' AND ');

      const sql = `
        SELECT
          ${dateFormat} AS period,
          np.np_team_id AS team_id,
          COALESCE(NULLIF(np.np_team, ''), 'Unknown') AS team_name,
          COUNT(DISTINCT op.orders_products_id) AS units_sold,
          SUM(op.final_price * op.products_quantity) AS revenue
        FROM orders o
        INNER JOIN orders_products op ON o.orders_id = op.orders_id
        INNER JOIN new_products np ON np.products_id = op.products_id
        WHERE ${whereClause}
        GROUP BY period, np.np_team_id, team_name
        ORDER BY period ASC, revenue DESC
      `;

      const rows = await queryWithLog<RawTeamSalesRow>('team-sales', 'time-series', sql, queryParams);

      logger.info({ rowCount: rows.length }, 'Team sales raw query returned');

      // Post-process: compute per-team totals for summary
      const teamTotals = new Map<number, { teamName: string; unitsSold: number; revenue: number }>();

      for (const row of rows) {
        const teamId = Number(row.team_id);
        const unitsSold = Number(row.units_sold);
        const revenue = Number(row.revenue) || 0;

        const existing = teamTotals.get(teamId);
        if (existing) {
          existing.unitsSold += unitsSold;
          existing.revenue += revenue;
        } else {
          teamTotals.set(teamId, {
            teamName: row.team_name,
            unitsSold,
            revenue,
          });
        }
      }

      // Sort by revenue DESC, take topN
      const sortedTeams = Array.from(teamTotals.entries())
        .sort(([, a], [, b]) => b.revenue - a.revenue)
        .slice(0, params.topN);

      const topTeamIds = new Set(sortedTeams.map(([id]) => id));

      const summary: TeamSalesSummary[] = sortedTeams.map(([teamId, data]) => ({
        teamId,
        teamName: data.teamName,
        totalUnitsSold: data.unitsSold,
        totalRevenue: Math.round(data.revenue * 100) / 100,
      }));

      // Build time series with only topN teams
      const periodMap = new Map<string, Map<number, { teamName: string; unitsSold: number; revenue: number }>>();

      for (const row of rows) {
        const teamId = Number(row.team_id);
        if (!topTeamIds.has(teamId)) continue;

        const period = row.period;
        if (!periodMap.has(period)) {
          periodMap.set(period, new Map());
        }

        const teamMap = periodMap.get(period)!;
        teamMap.set(teamId, {
          teamName: row.team_name,
          unitsSold: Number(row.units_sold),
          revenue: Math.round((Number(row.revenue) || 0) * 100) / 100,
        });
      }

      const timeSeries: TeamSalesTimeSeriesEntry[] = Array.from(periodMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, teamMap]) => ({
          period,
          teams: sortedTeams.map(([teamId, totals]) => {
            const data = teamMap.get(teamId);
            return {
              teamId,
              teamName: totals.teamName,
              unitsSold: data?.unitsSold ?? 0,
              revenue: data?.revenue ?? 0,
            };
          }),
        }));

      // Fetch filter options in parallel
      const [availableLeagues, availableContinents] = await Promise.all([
        getLeagues(),
        getContinents(),
      ]);

      return {
        summary,
        timeSeries,
        filters: {
          availableLeagues,
          availableContinents,
        },
      };
    },
    params.noCache,
  );
}

// ─── Filter data functions ──────────────────────────────────────────

export async function getLeagues(): Promise<string[]> {
  return withCache<string[]>(
    'sales-dashboard:team-sales:leagues',
    FILTER_CACHE_TTL,
    async () => {
      const logger = getLogger();
      logger.info('Fetching available leagues from database');

      const rows = await queryWithLog<RawLeagueRow>('team-sales', 'leagues-filter', 'SELECT DISTINCT np_league FROM new_products WHERE np_league IS NOT NULL AND np_league != \'\' ORDER BY np_league ASC');

      return rows.map((r) => r.np_league);
    },
  );
}

export async function getContinents(): Promise<string[]> {
  return withCache<string[]>(
    'sales-dashboard:team-sales:continents',
    FILTER_CACHE_TTL,
    async () => {
      const logger = getLogger();
      logger.info('Fetching available continents from database');

      const rows = await queryWithLog<RawContinentRow>('team-sales', 'continents-filter', 'SELECT DISTINCT np_continent FROM new_products WHERE np_continent IS NOT NULL AND np_continent != \'\' ORDER BY np_continent ASC');

      return rows.map((r) => r.np_continent);
    },
  );
}
