/**
 * Reconciliation Export
 *
 * Generates CSV and multi-sheet XLSX exports from reconciliation reports.
 * Uses the shared ExportService for CSV and multi-sheet XLSX generation.
 */

import { exportService } from '../exports/export.service';
import type { ExportColumn, ExportSheet } from '../exports/export.service';
import type { ReconciliationReport, MarketplaceReconciliationResult } from './reconciliation.types';

/** Flat columns used for CSV export (all marketplaces in one table) */
const CSV_COLUMNS: ExportColumn[] = [
  { key: 'Marketplace', header: 'Marketplace', width: 15 },
  { key: 'CheckType', header: 'Check Type', width: 20 },
  { key: 'OrderId', header: 'Order ID', width: 20 },
  { key: 'UkssOrderId', header: 'UKSS Order ID', width: 20 },
  { key: 'StoreName', header: 'Store Name', width: 25 },
  { key: 'Details', header: 'Details', width: 40 },
  { key: 'MarketplaceUrl', header: 'Marketplace URL', width: 50 },
];

function flattenResults(report: ReconciliationReport): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const result of report.results) {
    const mp = result.marketplace;

    if (result.missingOrders) {
      for (const o of result.missingOrders.missingOrders) {
        rows.push({
          Marketplace: mp,
          CheckType: 'Missing Order',
          OrderId: o.orderId,
          UkssOrderId: '',
          StoreName: o.storeName,
          Details: `Order Date: ${new Date(o.orderDate).toISOString()}`,
          MarketplaceUrl: o.marketplaceUrl ?? '',
        });
      }
    }

    if (result.missingProducts) {
      for (const m of result.missingProducts.mismatches) {
        rows.push({
          Marketplace: mp,
          CheckType: 'Product Mismatch',
          OrderId: m.orderId,
          UkssOrderId: m.ukssOrderId ?? '',
          StoreName: m.storeName,
          Details: `API Qty: ${m.apiQuantity}, DB Qty: ${m.dbQuantity}`,
          MarketplaceUrl: m.marketplaceUrl ?? '',
        });
      }
    }

    for (const s of result.statusSync.stuckStatuses) {
      rows.push({
        Marketplace: mp,
        CheckType: 'Stuck Status',
        OrderId: s.orderId,
        UkssOrderId: s.ukssOrderId ?? '',
        StoreName: s.storeName,
        Details: `Status: ${s.statusToUpdate}, Waiting: ${s.waitingSinceHours.toFixed(1)}h`,
        MarketplaceUrl: s.marketplaceUrl ?? '',
      });
    }

    for (const u of result.unconvertedOrders.unconvertedOrders) {
      rows.push({
        Marketplace: mp,
        CheckType: 'Unconverted Order',
        OrderId: u.orderId,
        UkssOrderId: 'Not converted',
        StoreName: u.storeName,
        Details: `Age: ${u.ageHours.toFixed(1)}h, Date: ${new Date(u.orderDate).toISOString()}`,
        MarketplaceUrl: u.marketplaceUrl ?? '',
      });
    }
  }

  return rows;
}

/**
 * Export reconciliation report as CSV using ExportService.
 */
export function exportReconciliationCsv(report: ReconciliationReport): Buffer {
  const rows = flattenResults(report);

  // Add summary rows at the top
  const { summary } = report;
  const summaryRows: Record<string, unknown>[] = [
    { Marketplace: '--- SUMMARY ---', CheckType: '', OrderId: '', UkssOrderId: '', StoreName: '', Details: '', MarketplaceUrl: '' },
    { Marketplace: 'Total Missing Orders', CheckType: String(summary.totalMissing), OrderId: '', UkssOrderId: '', StoreName: '', Details: '', MarketplaceUrl: '' },
    { Marketplace: 'Total Product Mismatches', CheckType: String(summary.totalProductMismatches), OrderId: '', UkssOrderId: '', StoreName: '', Details: '', MarketplaceUrl: '' },
    { Marketplace: 'Total Stuck Statuses', CheckType: String(summary.totalStuck), OrderId: '', UkssOrderId: '', StoreName: '', Details: '', MarketplaceUrl: '' },
    { Marketplace: 'Total Unconverted', CheckType: String(summary.totalUnconverted), OrderId: '', UkssOrderId: '', StoreName: '', Details: '', MarketplaceUrl: '' },
    { Marketplace: '', CheckType: '', OrderId: '', UkssOrderId: '', StoreName: '', Details: '', MarketplaceUrl: '' },
  ];

  return exportService.exportToCsv({
    filename: 'reconciliation',
    columns: CSV_COLUMNS,
    data: [...summaryRows, ...rows],
  });
}

/** Build per-marketplace sheet data for XLSX */
function buildMarketplaceSheet(result: MarketplaceReconciliationResult): ExportSheet {
  const columns: ExportColumn[] = [
    { key: 'Section', header: 'Section', width: 20 },
    { key: 'OrderId', header: 'Order ID', width: 20 },
    { key: 'UkssOrderId', header: 'UKSS Order ID', width: 20 },
    { key: 'StoreName', header: 'Store Name', width: 25 },
    { key: 'Detail1', header: 'Detail 1', width: 20 },
    { key: 'Detail2', header: 'Detail 2', width: 15 },
    { key: 'MarketplaceUrl', header: 'Marketplace URL', width: 50 },
  ];

  const data: Record<string, unknown>[] = [];

  // Missing Orders section
  data.push({ Section: 'MISSING ORDERS', OrderId: '', UkssOrderId: '', StoreName: '', Detail1: '', Detail2: '', MarketplaceUrl: '' });
  if (result.missingOrders && result.missingOrders.missingOrders.length > 0) {
    for (const o of result.missingOrders.missingOrders) {
      data.push({
        Section: '',
        OrderId: o.orderId,
        UkssOrderId: '',
        StoreName: o.storeName,
        Detail1: new Date(o.orderDate).toISOString().split('T')[0],
        Detail2: '',
        MarketplaceUrl: o.marketplaceUrl ?? '',
      });
    }
  } else {
    data.push({ Section: '', OrderId: 'None found', UkssOrderId: '', StoreName: '', Detail1: '', Detail2: '', MarketplaceUrl: '' });
  }
  data.push({ Section: '', OrderId: '', UkssOrderId: '', StoreName: '', Detail1: '', Detail2: '', MarketplaceUrl: '' });

  // Product Mismatches section
  data.push({ Section: 'PRODUCT MISMATCHES', OrderId: '', UkssOrderId: '', StoreName: '', Detail1: '', Detail2: '', MarketplaceUrl: '' });
  if (result.missingProducts && result.missingProducts.mismatches.length > 0) {
    for (const m of result.missingProducts.mismatches) {
      data.push({
        Section: '',
        OrderId: m.orderId,
        UkssOrderId: m.ukssOrderId ?? '',
        StoreName: m.storeName,
        Detail1: m.apiQuantity,
        Detail2: m.dbQuantity,
        MarketplaceUrl: m.marketplaceUrl ?? '',
      });
    }
  } else {
    data.push({ Section: '', OrderId: 'None found', UkssOrderId: '', StoreName: '', Detail1: '', Detail2: '', MarketplaceUrl: '' });
  }
  data.push({ Section: '', OrderId: '', UkssOrderId: '', StoreName: '', Detail1: '', Detail2: '', MarketplaceUrl: '' });

  // Stuck Statuses section
  data.push({ Section: 'STUCK STATUSES', OrderId: '', UkssOrderId: '', StoreName: '', Detail1: '', Detail2: '', MarketplaceUrl: '' });
  if (result.statusSync.stuckStatuses.length > 0) {
    for (const s of result.statusSync.stuckStatuses) {
      data.push({
        Section: '',
        OrderId: s.orderId,
        UkssOrderId: s.ukssOrderId ?? '',
        StoreName: s.storeName,
        Detail1: s.statusToUpdate,
        Detail2: Number(s.waitingSinceHours.toFixed(1)),
        MarketplaceUrl: s.marketplaceUrl ?? '',
      });
    }
  } else {
    data.push({ Section: '', OrderId: 'None found', UkssOrderId: '', StoreName: '', Detail1: '', Detail2: '', MarketplaceUrl: '' });
  }
  data.push({ Section: '', OrderId: '', UkssOrderId: '', StoreName: '', Detail1: '', Detail2: '', MarketplaceUrl: '' });

  // Unconverted Orders section
  data.push({ Section: 'UNCONVERTED ORDERS', OrderId: '', UkssOrderId: '', StoreName: '', Detail1: '', Detail2: '', MarketplaceUrl: '' });
  if (result.unconvertedOrders.unconvertedOrders.length > 0) {
    for (const u of result.unconvertedOrders.unconvertedOrders) {
      data.push({
        Section: '',
        OrderId: u.orderId,
        UkssOrderId: 'Not converted',
        StoreName: u.storeName,
        Detail1: new Date(u.orderDate).toISOString().split('T')[0],
        Detail2: Number(u.ageHours.toFixed(1)),
        MarketplaceUrl: u.marketplaceUrl ?? '',
      });
    }
  } else {
    data.push({ Section: '', OrderId: 'None found', UkssOrderId: '', StoreName: '', Detail1: '', Detail2: '', MarketplaceUrl: '' });
  }

  return { name: result.marketplace, columns, data };
}

/**
 * Export reconciliation report as multi-sheet XLSX using ExportService.
 * Sheet 1: Summary, then one sheet per marketplace.
 */
export function exportReconciliationXlsx(report: ReconciliationReport): Buffer {
  const summaryColumns: ExportColumn[] = [
    { key: 'Marketplace', header: 'Marketplace', width: 20 },
    { key: 'MissingOrders', header: 'Missing Orders', width: 15 },
    { key: 'ProductMismatches', header: 'Product Mismatches', width: 18 },
    { key: 'StuckStatuses', header: 'Stuck Statuses', width: 15 },
    { key: 'UnconvertedOrders', header: 'Unconverted Orders', width: 18 },
    { key: 'Total', header: 'Total', width: 10 },
  ];

  const summaryData: Record<string, unknown>[] = [
    { Marketplace: `Run Date: ${new Date(report.runDate).toISOString()}`, MissingOrders: '', ProductMismatches: '', StuckStatuses: '', UnconvertedOrders: '', Total: '' },
    { Marketplace: `Window: ${report.windowHours}h`, MissingOrders: '', ProductMismatches: '', StuckStatuses: '', UnconvertedOrders: '', Total: '' },
    { Marketplace: '', MissingOrders: '', ProductMismatches: '', StuckStatuses: '', UnconvertedOrders: '', Total: '' },
  ];

  for (const result of report.results) {
    const missing = result.missingOrders?.missingOrders.length ?? 0;
    const mismatches = result.missingProducts?.mismatches.length ?? 0;
    const stuck = result.statusSync.stuckStatuses.length;
    const unconverted = result.unconvertedOrders.unconvertedOrders.length;

    summaryData.push({
      Marketplace: result.marketplace,
      MissingOrders: missing,
      ProductMismatches: mismatches,
      StuckStatuses: stuck,
      UnconvertedOrders: unconverted,
      Total: missing + mismatches + stuck + unconverted,
    });
  }

  const { summary } = report;
  summaryData.push({
    Marketplace: 'TOTAL',
    MissingOrders: summary.totalMissing,
    ProductMismatches: summary.totalProductMismatches,
    StuckStatuses: summary.totalStuck,
    UnconvertedOrders: summary.totalUnconverted,
    Total: summary.totalMissing + summary.totalProductMismatches + summary.totalStuck + summary.totalUnconverted,
  });

  // Build sheets array: Summary + per-marketplace
  const sheets: ExportSheet[] = [
    { name: 'Summary', columns: summaryColumns, data: summaryData },
    ...report.results.map(buildMarketplaceSheet),
  ];

  return exportService.exportToExcelMultiSheet({
    filename: 'reconciliation',
    sheets,
  });
}
