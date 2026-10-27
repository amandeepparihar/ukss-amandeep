/**
 * Structured `$executeRaw` wrapper for the products module.
 *
 * Every raw INSERT / UPDATE that mutates legacy SMS tables was historically
 * surrounded by an ad-hoc try / catch / log / rethrow block — the same shape
 * each time, just with a different table name and column dump. This helper
 * centralises that shape so:
 *
 *   - new call sites don't omit the column dump (the field that turned out to
 *     be most valuable when chasing column-count-mismatch failures);
 *   - the success-path SQL echo stays at `debug` (silent in production by
 *     default) while the failure-path echo stays at `error`;
 *   - the error is rethrown unchanged so transactions still roll back.
 *
 * Use inside any product-module raw write where you want the post-mortem.
 */
import type { Prisma } from '@prisma/client';
import type { TxClient } from './products.types';
import type { Logger } from '../../lib/logger';

export interface RawWriteContext {
  /** Table being written to — surfaced in both the debug echo and the error. */
  table: string;
  /** Defaults to `'INSERT'` since that's the dominant case. */
  operation?: 'INSERT' | 'UPDATE';
  /**
   * Caller-supplied column-value map. Mirrors what we used to dump by hand on
   * failure; it shows up in the error log so on-call can reconstruct the
   * intended row from a Loki / CloudWatch entry alone.
   */
  values?: Record<string, unknown>;
  /** Any extra fields to merge into the log lines (e.g. productListsId). */
  extra?: Record<string, unknown>;
}

/**
 * Run `tx.$executeRaw(sql)` with debug-level pre-flight logging and a
 * structured error log. Throws the original error after logging so callers can
 * keep relying on transaction rollback.
 */
export async function executeRawWithLogging(
  tx: TxClient,
  sql: Prisma.Sql,
  log: Logger,
  ctx: RawWriteContext,
): Promise<void> {
  const operation = ctx.operation ?? 'INSERT';

  log.debug(
    {
      table: ctx.table,
      operation,
      sqlText: sql.sql,
      sqlValues: sql.values,
      valuesCount: sql.values.length,
      ...(ctx.extra ?? {}),
    },
    `Generated ${operation} SQL query`,
  );

  try {
    await tx.$executeRaw(sql);
  } catch (error) {
    log.error(
      {
        table: ctx.table,
        operation,
        sqlText: sql.sql,
        sqlValues: sql.values,
        valuesCount: sql.values.length,
        ...(ctx.values ? { values: ctx.values } : {}),
        ...(ctx.extra ?? {}),
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      `FAILED: ${operation} ${ctx.table}`,
    );
    throw error;
  }
}
