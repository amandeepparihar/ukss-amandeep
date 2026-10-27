/**
 * Order Reconciliation Orchestrator
 *
 * Runs all 4 reconciliation checks across all (or selected) marketplaces.
 * Each marketplace is isolated - if one API is down, others still get checked.
 */

import { nanoid } from 'nanoid';
import { createLogger } from '../../lib/logger';
import type { ReconciliationAdapter } from './adapters/adapter.interface';
import { ShopifyAdapter } from './adapters/shopify.adapter';
import { ToffsAdapter } from './adapters/toffs.adapter';
import { FruugoAdapter } from './adapters/fruugo.adapter';
import { DebenhamsAdapter } from './adapters/debenhams.adapter';
import { checkMissingOrders } from './checks/missing-orders.check';
import { checkMissingProducts } from './checks/missing-products.check';
import { checkStatusSync } from './checks/status-sync.check';
import { checkUnconvertedOrders } from './checks/unconverted-orders.check';
import { ReconciliationLogCollector } from './reconciliation.log-collector';
import type {
  MarketplaceName,
  ReconcileOptions,
  ReconciliationReport,
  MarketplaceReconciliationResult,
  ReconciliationSummary,
} from './reconciliation.types';

const logger = createLogger('reconciliation');

function createAdapter(name: MarketplaceName, storeIds?: number[]): ReconciliationAdapter {
  switch (name) {
    case 'shopify':
      return new ShopifyAdapter(storeIds);
    case 'toffs':
      return new ToffsAdapter();
    case 'fruugo':
      return new FruugoAdapter();
    case 'debenhams':
      return new DebenhamsAdapter();
  }
}

export interface ReconciliationRunResult {
  report: ReconciliationReport;
  runId: string;
}

export async function runReconciliation(options: ReconcileOptions): Promise<ReconciliationRunResult> {
  const now = new Date();
  const fromDate = new Date(now.getTime() - options.hours * 60 * 60 * 1000);
  const runId = nanoid(10);
  const collector = new ReconciliationLogCollector(runId);

  logger.info(
    { marketplace: options.marketplace, hours: options.hours, from: fromDate.toISOString(), to: now.toISOString(), runId },
    'Starting order reconciliation'
  );

  collector.log({
    level: 'info',
    marketplace: 'ALL',
    phase: 'summary',
    message: `Starting reconciliation (marketplace: ${options.marketplace}, lookback: ${options.hours}h)`,
  });

  // Determine which marketplaces to check
  const marketplaceNames: MarketplaceName[] =
    options.marketplace === 'all'
      ? (['shopify', 'toffs', 'fruugo', 'debenhams'] as MarketplaceName[])
      : [options.marketplace];

  const startTime = Date.now();

  // Run each marketplace in parallel
  const settledResults = await Promise.allSettled(
    marketplaceNames.map(name =>
      reconcileMarketplace(name, fromDate, now, options, collector)
    )
  );

  // Collect results
  const results: MarketplaceReconciliationResult[] = settledResults.map((settled, i) => {
    if (settled.status === 'fulfilled') {
      return settled.value;
    }
    // If the entire marketplace reconciliation crashed
    const mpName = marketplaceNames[i].toUpperCase();
    const error = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
    logger.error({ marketplace: mpName, error }, 'Marketplace reconciliation failed entirely');

    collector.log({
      level: 'error',
      marketplace: mpName,
      phase: 'summary',
      message: `Marketplace reconciliation failed entirely`,
      details: { errorMessage: error },
    });

    return {
      marketplace: mpName,
      storeCount: 0,
      apiError: `Fatal: ${error}`,
      statusSync: { stuckStatuses: [] },
      unconvertedOrders: { unconvertedOrders: [] },
    };
  });

  // Compute summary
  const summary = computeSummary(results);
  const totalDurationMs = Date.now() - startTime;

  const report: ReconciliationReport = {
    runDate: now,
    windowHours: options.hours,
    stuckThresholdHours: options.stuckThreshold,
    unconvertedThresholdHours: options.unconvertedThreshold,
    results,
    summary,
  };

  const totalIssues = summary.totalMissing + summary.totalProductMismatches + summary.totalStuck + summary.totalUnconverted;

  collector.log({
    level: 'info',
    marketplace: 'ALL',
    phase: 'summary',
    message: `Reconciliation completed in ${(totalDurationMs / 1000).toFixed(1)}s — ${totalIssues} issue(s) found`,
    details: { durationMs: totalDurationMs, recordCount: totalIssues },
  });

  // Final flush
  await collector.flush();

  logger.info(
    { ...summary, runId, durationMs: totalDurationMs },
    'Reconciliation completed'
  );

  return { report, runId };
}

async function reconcileMarketplace(
  name: MarketplaceName,
  fromDate: Date,
  toDate: Date,
  options: ReconcileOptions,
  collector: ReconciliationLogCollector
): Promise<MarketplaceReconciliationResult> {
  const adapter = createAdapter(name, name === 'shopify' ? options.storeIds : undefined);
  const mpName = adapter.name;

  const result: MarketplaceReconciliationResult = {
    marketplace: mpName,
    storeCount: adapter.storeIds.length,
    statusSync: { stuckStatuses: [] },
    unconvertedOrders: { unconvertedOrders: [] },
  };

  // Resolve store names for the log message
  let storeLabel = `${adapter.storeIds.length} store(s)`;
  if (name === 'shopify') {
    try {
      const storeRows = await import('../../lib/prisma').then(m =>
        m.prisma.storeManagement.findMany({
          where: { storeId: { in: adapter.storeIds }, status: '1' },
          select: { storeName: true },
        })
      );
      if (storeRows.length > 0) {
        storeLabel = storeRows.map(s => s.storeName).join(', ');
      }
    } catch {
      // Non-fatal - use count-based label
    }
  }

  collector.log({
    level: 'info',
    marketplace: mpName,
    phase: 'api_fetch',
    message: `Starting reconciliation for ${mpName} — stores: ${storeLabel}`,
  });

  // Try to fetch API orders (non-fatal if this fails)
  let apiOrders;
  const fetchStart = Date.now();
  try {
    apiOrders = await adapter.fetchOrders(fromDate, toDate);
    const fetchDuration = Date.now() - fetchStart;

    collector.log({
      level: 'info',
      marketplace: mpName,
      phase: 'api_fetch',
      message: `API fetch complete — ${apiOrders.length} orders retrieved in ${(fetchDuration / 1000).toFixed(1)}s`,
      details: { durationMs: fetchDuration, orderCount: apiOrders.length, httpStatus: 200 },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const fetchDuration = Date.now() - fetchStart;
    result.apiError = msg;
    logger.warn({ marketplace: mpName, error: msg }, 'API fetch failed, running DB-only checks');

    collector.log({
      level: 'error',
      marketplace: mpName,
      phase: 'api_fetch',
      message: `API fetch failed — ${msg}`,
      details: { durationMs: fetchDuration, errorMessage: msg },
    });
  }

  // Check 1 & 2: Require API data
  if (apiOrders) {
    const checkStart1 = Date.now();
    result.missingOrders = await checkMissingOrders(apiOrders, adapter.storeIds, adapter);
    const missingCount = result.missingOrders.missingOrders.length;
    collector.log({
      level: missingCount > 0 ? 'warn' : 'info',
      marketplace: mpName,
      phase: 'check_missing_orders',
      message: missingCount > 0
        ? `Missing orders — ${missingCount} order(s) in API but not in DB`
        : `Missing orders — none found (API: ${result.missingOrders.apiOrderCount}, DB: ${result.missingOrders.dbOrderCount})`,
      details: { durationMs: Date.now() - checkStart1, recordCount: missingCount },
    });

    const checkStart2 = Date.now();
    result.missingProducts = await checkMissingProducts(apiOrders, adapter.storeIds, adapter);
    const mismatchCount = result.missingProducts.mismatches.length;
    collector.log({
      level: mismatchCount > 0 ? 'warn' : 'info',
      marketplace: mpName,
      phase: 'check_missing_products',
      message: mismatchCount > 0
        ? `Product mismatches — ${mismatchCount} order(s) with quantity differences`
        : `Product mismatches — none found`,
      details: { durationMs: Date.now() - checkStart2, recordCount: mismatchCount },
    });
  }

  // Check 3 & 4: DB-only, always run
  const checkStart3 = Date.now();
  result.statusSync = await checkStatusSync(adapter.storeIds, options.stuckThreshold, adapter);
  const stuckCount = result.statusSync.stuckStatuses.length;
  collector.log({
    level: stuckCount > 0 ? 'warn' : 'info',
    marketplace: mpName,
    phase: 'check_status_sync',
    message: stuckCount > 0
      ? `Stuck statuses — ${stuckCount} order(s) waiting >${options.stuckThreshold}h for status update`
      : `Stuck statuses — none found`,
    details: { durationMs: Date.now() - checkStart3, recordCount: stuckCount },
  });

  const checkStart4 = Date.now();
  result.unconvertedOrders = await checkUnconvertedOrders(adapter.storeIds, options.unconvertedThreshold, fromDate, adapter);
  const unconvertedCount = result.unconvertedOrders.unconvertedOrders.length;
  collector.log({
    level: unconvertedCount > 0 ? 'warn' : 'info',
    marketplace: mpName,
    phase: 'check_unconverted',
    message: unconvertedCount > 0
      ? `Unconverted orders — ${unconvertedCount} order(s) not converted after >${options.unconvertedThreshold}h`
      : `Unconverted orders — none found`,
    details: { durationMs: Date.now() - checkStart4, recordCount: unconvertedCount },
  });

  // Flush logs after each marketplace completes
  await collector.flush();

  return result;
}

function computeSummary(results: MarketplaceReconciliationResult[]): ReconciliationSummary {
  let totalMissing = 0;
  let totalProductMismatches = 0;
  let totalStuck = 0;
  let totalUnconverted = 0;

  for (const r of results) {
    totalMissing += r.missingOrders?.missingOrders.length ?? 0;
    totalProductMismatches += r.missingProducts?.mismatches.length ?? 0;
    totalStuck += r.statusSync.stuckStatuses.length;
    totalUnconverted += r.unconvertedOrders.unconvertedOrders.length;
  }

  return {
    totalMissing,
    totalProductMismatches,
    totalStuck,
    totalUnconverted,
    hasIssues: totalMissing + totalProductMismatches + totalStuck + totalUnconverted > 0,
  };
}
