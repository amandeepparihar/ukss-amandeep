/**
 * Console Report
 *
 * Color-coded terminal output for the reconciliation report.
 */

import type {
  ReconciliationReport,
  MarketplaceReconciliationResult,
} from '../reconciliation.types';

// ANSI color codes
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const CHECK = `${GREEN}\u2713${RESET}`;
const CROSS = `${RED}\u2717${RESET}`;
const WARN = `${YELLOW}!${RESET}`;

export function printConsoleReport(report: ReconciliationReport, verbose: boolean): void {
  const divider = '='.repeat(60);
  const subDivider = '-'.repeat(60);

  console.log('');
  console.log(`${BOLD}${divider}${RESET}`);
  console.log(`${BOLD}  ORDER RECONCILIATION REPORT${RESET}`);
  console.log(`  Run: ${report.runDate.toISOString()} | Window: Last ${report.windowHours} hours`);
  console.log(`${BOLD}${divider}${RESET}`);

  for (const result of report.results) {
    console.log('');
    printMarketplaceResult(result, verbose, subDivider);
  }

  // Summary
  const s = report.summary;
  console.log('');
  console.log(`${BOLD}${divider}${RESET}`);
  const summaryColor = s.hasIssues ? RED : GREEN;
  console.log(
    `${BOLD}  SUMMARY: ` +
    `${summaryColor}${s.totalMissing} missing${RESET}${BOLD} | ` +
    `${summaryColor}${s.totalProductMismatches} product mismatches${RESET}${BOLD} | ` +
    `${summaryColor}${s.totalStuck} stuck${RESET}${BOLD} | ` +
    `${summaryColor}${s.totalUnconverted} unconverted${RESET}`
  );
  console.log(`${BOLD}${divider}${RESET}`);
  console.log('');
}

function printMarketplaceResult(
  result: MarketplaceReconciliationResult,
  verbose: boolean,
  subDivider: string
): void {
  const storeInfo = result.storeCount > 1 ? ` (${result.storeCount} stores)` : '';
  console.log(`${BOLD}${result.marketplace}${storeInfo}${RESET}`);
  console.log(subDivider);

  // API Error
  if (result.apiError) {
    console.log(`  ${CROSS} API Error: ${RED}${result.apiError}${RESET} ${DIM}(DB checks still ran)${RESET}`);
  }

  // Check 1: Missing Orders
  if (result.missingOrders) {
    const mo = result.missingOrders;
    console.log(`  API Orders: ${mo.apiOrderCount}  |  DB Orders: ${mo.dbOrderCount}`);

    if (mo.missingOrders.length > 0) {
      console.log(`  ${CROSS} Missing Orders: ${RED}${mo.missingOrders.length}${RESET}`);
      if (verbose) {
        for (const o of mo.missingOrders) {
          console.log(`    - #${o.orderId} (${o.storeName}, ${o.orderDate.toISOString()})`);
        }
      }
    } else {
      console.log(`  ${CHECK} Missing Orders: 0`);
    }
  }

  // Check 2: Product Count Mismatches
  if (result.missingProducts) {
    const mp = result.missingProducts;
    if (mp.mismatches.length > 0) {
      console.log(`  ${CROSS} Product Mismatches: ${RED}${mp.mismatches.length}${RESET}`);
      if (verbose) {
        for (const m of mp.mismatches) {
          console.log(`    - #${m.orderId} (${m.storeName}): API=${m.apiQuantity}, DB=${m.dbQuantity}`);
        }
      }
    } else {
      console.log(`  ${CHECK} Product Counts: All match`);
    }
  }

  // Check 3: Stuck Statuses
  const ss = result.statusSync;
  if (ss.stuckStatuses.length > 0) {
    console.log(`  ${WARN} Stuck Statuses: ${YELLOW}${ss.stuckStatuses.length}${RESET} (waiting > threshold)`);
    if (verbose) {
      for (const s of ss.stuckStatuses) {
        console.log(`    - #${s.orderId} (${s.storeName}): ${s.statusToUpdate}, waiting ${s.waitingSinceHours}h`);
      }
    }
  } else {
    console.log(`  ${CHECK} Stuck Statuses: 0`);
  }

  // Check 4: Unconverted Orders
  const uo = result.unconvertedOrders;
  if (uo.unconvertedOrders.length > 0) {
    console.log(`  ${WARN} Unconverted: ${YELLOW}${uo.unconvertedOrders.length}${RESET} (older than threshold)`);
    if (verbose) {
      for (const o of uo.unconvertedOrders) {
        console.log(`    - #${o.orderId} (${o.storeName}): ${o.ageHours}h old`);
      }
    }
  } else {
    console.log(`  ${CHECK} Unconverted: 0`);
  }
}
