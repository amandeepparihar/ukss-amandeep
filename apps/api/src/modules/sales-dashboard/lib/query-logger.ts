import { prisma } from '../../../lib/prisma';
import { getLogger } from '../../../lib/logger-context';

/**
 * Execute a raw SQL query with structured logging.
 *
 * Logs the SQL text, bound parameters, timing, and row count so that
 * every query executed for a chart is easy to find in the logs.
 *
 * Filter logs by `chart` field to see all queries for a specific chart:
 *   e.g.  { "chart": "team-sales", "query": "SELECT ..." }
 *
 * @param chart   Identifier for the chart / endpoint (e.g. "team-sales")
 * @param label   Short description of the query (e.g. "summary" or "time-series")
 * @param sql     The raw SQL string
 * @param params  Bind parameters passed to $queryRawUnsafe
 */
export async function queryWithLog<T>(
  chart: string,
  label: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const logger = getLogger();

  logger.info(
    { chart, label, sql: sql.replace(/\s+/g, ' ').trim(), params },
    `[${chart}] Executing query: ${label}`,
  );

  const start = Date.now();
  const rows = await prisma.$queryRawUnsafe<T[]>(sql, ...params);
  const durationMs = Date.now() - start;

  logger.info(
    { chart, label, durationMs, rowCount: rows.length },
    `[${chart}] Query complete: ${label}`,
  );

  return rows;
}

/**
 * Execute a raw SQL command (INSERT/UPDATE/DELETE) with structured logging.
 * Returns the number of affected rows.
 */
export async function executeWithLog(
  chart: string,
  label: string,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const logger = getLogger();

  logger.info(
    { chart, label, sql: sql.replace(/\s+/g, ' ').trim(), params },
    `[${chart}] Executing command: ${label}`,
  );

  const start = Date.now();
  const affected = await prisma.$executeRawUnsafe(sql, ...params);
  const durationMs = Date.now() - start;

  logger.info(
    { chart, label, durationMs, affectedRows: affected },
    `[${chart}] Command complete: ${label}`,
  );

  return affected;
}
