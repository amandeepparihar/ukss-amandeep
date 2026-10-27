import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { exportReconciliationCsv, exportReconciliationXlsx } from './reconciliation.export';
import type { ReconciliationReport } from './reconciliation.types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockReport: ReconciliationReport = {
  runDate: new Date('2026-02-28T12:00:00Z'),
  windowHours: 24,
  stuckThresholdHours: 6,
  unconvertedThresholdHours: 2,
  results: [
    {
      marketplace: 'SHOPIFY',
      storeCount: 3,
      missingOrders: {
        apiOrderCount: 100,
        dbOrderCount: 99,
        missingOrders: [
          {
            orderId: 'SHOP-001',
            storeName: 'TestStore',
            orderDate: new Date('2026-02-27T10:00:00Z'),
            marketplaceUrl: 'https://teststoreexample.myshopify.com/admin/orders/SHOP-001',
          },
        ],
      },
      missingProducts: {
        mismatches: [
          {
            orderId: 'SHOP-002',
            storeName: 'TestStore',
            apiQuantity: 3,
            dbQuantity: 2,
            ukssOrderId: 'UKSS-100',
            marketplaceUrl: 'https://teststoreexample.myshopify.com/admin/orders/SHOP-002',
          },
        ],
      },
      statusSync: {
        stuckStatuses: [
          {
            mopId: 'MOP-001',
            orderId: 'SHOP-003',
            storeName: 'TestStore',
            statusToUpdate: 'shipped',
            waitingSinceHours: 8.5,
            ukssOrderId: 'UKSS-101',
            marketplaceUrl: 'https://teststoreexample.myshopify.com/admin/orders/SHOP-003',
          },
        ],
      },
      unconvertedOrders: {
        unconvertedOrders: [
          {
            moId: 'MO-001',
            orderId: 'SHOP-004',
            storeName: 'TestStore',
            orderDate: new Date('2026-02-28T08:00:00Z'),
            ageHours: 4.5,
            marketplaceUrl: 'https://teststoreexample.myshopify.com/admin/orders/SHOP-004',
          },
        ],
      },
    },
  ],
  summary: {
    totalMissing: 1,
    totalProductMismatches: 1,
    totalStuck: 1,
    totalUnconverted: 1,
    hasIssues: true,
  },
};

/** Report with no issues at all */
const emptyReport: ReconciliationReport = {
  runDate: new Date('2026-02-28T12:00:00Z'),
  windowHours: 24,
  stuckThresholdHours: 6,
  unconvertedThresholdHours: 2,
  results: [
    {
      marketplace: 'SHOPIFY',
      storeCount: 1,
      statusSync: { stuckStatuses: [] },
      unconvertedOrders: { unconvertedOrders: [] },
    },
  ],
  summary: {
    totalMissing: 0,
    totalProductMismatches: 0,
    totalStuck: 0,
    totalUnconverted: 0,
    hasIssues: false,
  },
};

// ---------------------------------------------------------------------------
// CSV Tests
// ---------------------------------------------------------------------------

describe('exportReconciliationCsv', () => {
  it('returns a Buffer', () => {
    const result = exportReconciliationCsv(mockReport);
    expect(result).toBeInstanceOf(Buffer);
  });

  it('CSV content contains summary rows', () => {
    const csv = exportReconciliationCsv(mockReport).toString('utf-8');
    expect(csv).toContain('--- SUMMARY ---');
    expect(csv).toContain('Total Missing Orders');
    expect(csv).toContain('Total Product Mismatches');
    expect(csv).toContain('Total Stuck Statuses');
    expect(csv).toContain('Total Unconverted');
  });

  it('CSV content contains data rows for each check type', () => {
    const csv = exportReconciliationCsv(mockReport).toString('utf-8');
    expect(csv).toContain('Missing Order');
    expect(csv).toContain('Product Mismatch');
    expect(csv).toContain('Stuck Status');
    expect(csv).toContain('Unconverted Order');
  });

  it('CSV contains correct marketplace name', () => {
    const csv = exportReconciliationCsv(mockReport).toString('utf-8');
    expect(csv).toContain('SHOPIFY');
  });

  it('marketplace URLs are included in output', () => {
    const csv = exportReconciliationCsv(mockReport).toString('utf-8');
    expect(csv).toContain('https://teststoreexample.myshopify.com/admin/orders/SHOP-001');
    expect(csv).toContain('https://teststoreexample.myshopify.com/admin/orders/SHOP-002');
    expect(csv).toContain('https://teststoreexample.myshopify.com/admin/orders/SHOP-003');
    expect(csv).toContain('https://teststoreexample.myshopify.com/admin/orders/SHOP-004');
  });

  it('UKSS Order ID is included for product mismatches', () => {
    const csv = exportReconciliationCsv(mockReport).toString('utf-8');
    expect(csv).toContain('UKSS-100');
  });

  it('"Not converted" text appears for unconverted orders', () => {
    const csv = exportReconciliationCsv(mockReport).toString('utf-8');
    expect(csv).toContain('Not converted');
  });

  it('empty report returns Buffer with only summary rows (no data rows)', () => {
    const result = exportReconciliationCsv(emptyReport);
    expect(result).toBeInstanceOf(Buffer);

    const csv = result.toString('utf-8');
    // Summary should be present
    expect(csv).toContain('--- SUMMARY ---');
    expect(csv).toContain('Total Missing Orders');

    // Parse rows and check the Check Type column for data-level check types.
    // Summary rows use "Total Missing Orders" etc in the Marketplace column,
    // while actual data rows use "Missing Order" (without "Total") in Check Type.
    const lines = csv.trim().split('\n');
    // Skip header (line 0) and extract Check Type column values
    const dataCheckTypes = lines.slice(1).map((line) => {
      // PapaParse wraps values in quotes; extract the Check Type column (index 1)
      const match = line.match(/^"[^"]*","([^"]*)"/);
      return match ? match[1] : '';
    });
    // None of the check type column values should be actual data row types
    expect(dataCheckTypes).not.toContain('Missing Order');
    expect(dataCheckTypes).not.toContain('Product Mismatch');
    expect(dataCheckTypes).not.toContain('Stuck Status');
    expect(dataCheckTypes).not.toContain('Unconverted Order');
  });

  it('CSV header row includes all column headers', () => {
    const csv = exportReconciliationCsv(mockReport).toString('utf-8');
    const firstLine = csv.split('\n')[0];
    expect(firstLine).toContain('Marketplace');
    expect(firstLine).toContain('Check Type');
    expect(firstLine).toContain('Order ID');
    expect(firstLine).toContain('UKSS Order ID');
    expect(firstLine).toContain('Store Name');
    expect(firstLine).toContain('Details');
    expect(firstLine).toContain('Marketplace URL');
  });

  it('details column contains computed values for each check type', () => {
    const csv = exportReconciliationCsv(mockReport).toString('utf-8');
    // Missing order detail: order date ISO
    expect(csv).toContain('Order Date: 2026-02-27T10:00:00.000Z');
    // Product mismatch detail: API vs DB qty
    expect(csv).toContain('API Qty: 3');
    expect(csv).toContain('DB Qty: 2');
    // Stuck status detail: status + hours
    expect(csv).toContain('Status: shipped');
    expect(csv).toContain('Waiting: 8.5h');
    // Unconverted order detail: age + date
    expect(csv).toContain('Age: 4.5h');
    expect(csv).toContain('Date: 2026-02-28T08:00:00.000Z');
  });

  it('UKSS Order ID for stuck statuses is populated', () => {
    const csv = exportReconciliationCsv(mockReport).toString('utf-8');
    expect(csv).toContain('UKSS-101');
  });
});

// ---------------------------------------------------------------------------
// XLSX Tests
// ---------------------------------------------------------------------------

describe('exportReconciliationXlsx', () => {
  it('returns a Buffer', () => {
    const result = exportReconciliationXlsx(mockReport);
    expect(result).toBeInstanceOf(Buffer);
  });

  it('buffer is valid XLSX (can be parsed)', () => {
    const result = exportReconciliationXlsx(mockReport);
    const workbook = XLSX.read(result, { type: 'buffer' });
    expect(workbook.SheetNames).toBeDefined();
    expect(workbook.SheetNames.length).toBeGreaterThan(0);
  });

  it('contains a "Summary" sheet', () => {
    const result = exportReconciliationXlsx(mockReport);
    const workbook = XLSX.read(result, { type: 'buffer' });
    expect(workbook.SheetNames).toContain('Summary');
  });

  it('contains a marketplace-specific sheet ("SHOPIFY")', () => {
    const result = exportReconciliationXlsx(mockReport);
    const workbook = XLSX.read(result, { type: 'buffer' });
    expect(workbook.SheetNames).toContain('SHOPIFY');
  });

  it('summary sheet contains marketplace totals', () => {
    const result = exportReconciliationXlsx(mockReport);
    const workbook = XLSX.read(result, { type: 'buffer' });
    const summarySheet = workbook.Sheets['Summary'];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(summarySheet, { header: 1 }) as unknown[][];

    // Flatten all cell values to strings for flexible searching
    const allValues = rows.flat().map(String);

    // Should contain SHOPIFY marketplace name
    expect(allValues.some((v) => v.includes('SHOPIFY'))).toBe(true);
    // Should contain TOTAL row
    expect(allValues.some((v) => v === 'TOTAL')).toBe(true);
  });

  it('summary sheet header row contains expected columns', () => {
    const result = exportReconciliationXlsx(mockReport);
    const workbook = XLSX.read(result, { type: 'buffer' });
    const summarySheet = workbook.Sheets['Summary'];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(summarySheet, { header: 1 }) as unknown[][];

    // First row should be headers
    const headerRow = rows[0].map(String);
    expect(headerRow).toContain('Marketplace');
    expect(headerRow).toContain('Missing Orders');
    expect(headerRow).toContain('Product Mismatches');
    expect(headerRow).toContain('Stuck Statuses');
    expect(headerRow).toContain('Unconverted Orders');
    expect(headerRow).toContain('Total');
  });

  it('marketplace sheet contains section headers', () => {
    const result = exportReconciliationXlsx(mockReport);
    const workbook = XLSX.read(result, { type: 'buffer' });
    const shopifySheet = workbook.Sheets['SHOPIFY'];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(shopifySheet, { header: 1 }) as unknown[][];

    const allValues = rows.flat().map(String);
    expect(allValues).toContain('MISSING ORDERS');
    expect(allValues).toContain('PRODUCT MISMATCHES');
    expect(allValues).toContain('STUCK STATUSES');
    expect(allValues).toContain('UNCONVERTED ORDERS');
  });

  it('marketplace sheet contains order IDs from the report', () => {
    const result = exportReconciliationXlsx(mockReport);
    const workbook = XLSX.read(result, { type: 'buffer' });
    const shopifySheet = workbook.Sheets['SHOPIFY'];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(shopifySheet, { header: 1 }) as unknown[][];

    const allValues = rows.flat().map(String);
    expect(allValues).toContain('SHOP-001');
    expect(allValues).toContain('SHOP-002');
    expect(allValues).toContain('SHOP-003');
    expect(allValues).toContain('SHOP-004');
  });

  it('empty report produces valid XLSX with "None found" placeholders', () => {
    const result = exportReconciliationXlsx(emptyReport);
    expect(result).toBeInstanceOf(Buffer);

    const workbook = XLSX.read(result, { type: 'buffer' });
    expect(workbook.SheetNames).toContain('Summary');
    expect(workbook.SheetNames).toContain('SHOPIFY');

    const shopifySheet = workbook.Sheets['SHOPIFY'];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(shopifySheet, { header: 1 }) as unknown[][];
    const allValues = rows.flat().map(String);
    expect(allValues.filter((v) => v === 'None found').length).toBeGreaterThanOrEqual(1);
  });

  it('summary sheet TOTAL row contains correct aggregate counts', () => {
    const result = exportReconciliationXlsx(mockReport);
    const workbook = XLSX.read(result, { type: 'buffer' });
    const summarySheet = workbook.Sheets['Summary'];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(summarySheet, { header: 1 }) as unknown[][];

    // Find the TOTAL row
    const totalRow = rows.find((row) => row[0] === 'TOTAL');
    expect(totalRow).toBeDefined();

    // Columns: Marketplace, MissingOrders, ProductMismatches, StuckStatuses, UnconvertedOrders, Total
    // The ExportService formatValue converts numbers to strings, so XLSX cells are strings
    expect(Number(totalRow![1])).toBe(1); // Missing Orders
    expect(Number(totalRow![2])).toBe(1); // Product Mismatches
    expect(Number(totalRow![3])).toBe(1); // Stuck Statuses
    expect(Number(totalRow![4])).toBe(1); // Unconverted Orders
    expect(Number(totalRow![5])).toBe(4); // Total
  });
});
