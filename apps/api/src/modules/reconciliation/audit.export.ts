/**
 * Audit Export
 *
 * Generates CSV and multi-sheet XLSX exports from order audit reports.
 * Uses the shared ExportService for CSV and multi-sheet XLSX generation.
 */

import { exportService } from '../exports/export.service';
import type { ExportColumn, ExportSheet } from '../exports/export.service';
import type { AuditReport, AuditOrderRecord } from './audit.types';

/** Columns for the order-level summary (CSV and XLSX Sheet 1) */
const ORDER_COLUMNS: ExportColumn[] = [
  { key: 'OrderId', header: 'Marketplace Order ID', width: 20 },
  { key: 'OrderDate', header: 'Order Date', width: 20 },
  { key: 'MpStatus', header: 'MP Status', width: 15 },
  { key: 'CustomerName', header: 'Customer Name', width: 25 },
  { key: 'CustomerEmail', header: 'Customer Email', width: 30 },
  { key: 'ShippingAddress', header: 'Shipping Address', width: 40 },
  { key: 'ProductCount', header: 'Products', width: 10 },
  { key: 'MoFound', header: 'MO Found', width: 10 },
  { key: 'MoStatus', header: 'MO Status', width: 15 },
  { key: 'MoCustomer', header: 'MO Customer', width: 25 },
  { key: 'UkssOrderId', header: 'UKSS Order ID', width: 15 },
  { key: 'UkssStatus', header: 'UKSS Status', width: 12 },
  { key: 'UkssCustomer', header: 'UKSS Customer', width: 25 },
  { key: 'UkssTotal', header: 'UKSS Total', width: 12 },
  { key: 'Issues', header: 'Issues', width: 30 },
];

/** Columns for the product details (XLSX Sheet 2) */
const PRODUCT_COLUMNS: ExportColumn[] = [
  { key: 'OrderId', header: 'Marketplace Order ID', width: 20 },
  { key: 'Source', header: 'Source', width: 15 },
  { key: 'SKU', header: 'SKU', width: 20 },
  { key: 'ProductName', header: 'Product Name', width: 40 },
  { key: 'Quantity', header: 'Quantity', width: 10 },
  { key: 'Price', header: 'Price', width: 12 },
  { key: 'UkssSku', header: 'UKSS SKU', width: 20 },
  { key: 'UkssModel', header: 'UKSS Model', width: 20 },
];

/**
 * Build a flat order-level row from an AuditOrderRecord.
 */
function buildOrderRow(record: AuditOrderRecord): Record<string, unknown> {
  const { marketplace, mo, ukssOrder, flags } = record;

  const shippingParts = [
    marketplace.shippingAddress.line1,
    marketplace.shippingAddress.city,
    marketplace.shippingAddress.postcode,
    marketplace.shippingAddress.country,
  ].filter(Boolean);

  const issues: string[] = [];
  if (flags.missingFromMo) issues.push('Missing from MO');
  if (flags.unconverted) issues.push('Unconverted');
  if (flags.productCountMismatch) issues.push('Product mismatch');

  let ukssOrderIdDisplay = '';
  if (ukssOrder.found && ukssOrder.ordersId) {
    ukssOrderIdDisplay = String(ukssOrder.ordersId);
  } else if (mo.found && !ukssOrder.found) {
    ukssOrderIdDisplay = 'Unconverted';
  }

  return {
    OrderId: marketplace.orderId,
    OrderDate: marketplace.orderDate instanceof Date
      ? marketplace.orderDate.toISOString().split('T')[0]
      : String(marketplace.orderDate),
    MpStatus: marketplace.status,
    CustomerName: marketplace.customerName,
    CustomerEmail: marketplace.customerEmail,
    ShippingAddress: shippingParts.join(', '),
    ProductCount: marketplace.lineItems.length,
    MoFound: mo.found ? 'Yes' : 'No',
    MoStatus: mo.moOrderStatus ?? '',
    MoCustomer: mo.moCustomerName ?? '',
    UkssOrderId: ukssOrderIdDisplay,
    UkssStatus: ukssOrder.ordersStatus != null ? String(ukssOrder.ordersStatus) : '',
    UkssCustomer: ukssOrder.customersName ?? '',
    UkssTotal: ukssOrder.orderTotal != null ? ukssOrder.orderTotal : '',
    Issues: issues.join(', '),
  };
}

/**
 * Build product-level rows for all sources of an AuditOrderRecord.
 */
function buildProductRows(record: AuditOrderRecord): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const orderId = record.marketplace.orderId;

  // Marketplace line items
  for (const item of record.marketplace.lineItems) {
    rows.push({
      OrderId: orderId,
      Source: 'Marketplace',
      SKU: item.sku,
      ProductName: item.productName,
      Quantity: item.quantity,
      Price: item.price,
      UkssSku: '',
      UkssModel: '',
    });
  }

  // MO/MOP products
  for (const p of record.mop.products) {
    rows.push({
      OrderId: orderId,
      Source: 'MO/MOP',
      SKU: p.mopProductSku,
      ProductName: p.mopProductName,
      Quantity: p.mopProductQuantity,
      Price: p.mopProductPrice,
      UkssSku: p.mopUkssProductSku,
      UkssModel: '',
    });
  }

  // UKSS products
  for (const p of record.ukssProducts.products) {
    rows.push({
      OrderId: orderId,
      Source: 'UKSS',
      SKU: p.productsModel,
      ProductName: p.productsName,
      Quantity: p.productsQuantity,
      Price: p.finalPrice,
      UkssSku: '',
      UkssModel: p.productsModel,
    });
  }

  return rows;
}

/**
 * Build an empty summary row with only the label and optional value filled in.
 */
function summaryRow(label: string, value: string = ''): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const col of ORDER_COLUMNS) {
    row[col.key] = '';
  }
  row['OrderId'] = label;
  row['OrderDate'] = value;
  return row;
}

/**
 * Export audit report as CSV.
 * One row per marketplace order with summary columns.
 */
export function exportAuditCsv(report: AuditReport): Buffer {
  const rows = report.orders.map(buildOrderRow);

  // Add summary rows at the top
  const { summary } = report;
  const summaryRows: Record<string, unknown>[] = [
    summaryRow(`--- AUDIT SUMMARY: ${report.marketplace} ---`),
    summaryRow(`Date Range: ${formatDate(report.fromDate)} to ${formatDate(report.toDate)}`),
    summaryRow('Total from API', String(summary.totalFromApi)),
    summaryRow('Found in MO', String(summary.foundInMo)),
    summaryRow('Converted to UKSS', String(summary.convertedToUkss)),
    summaryRow('Missing from MO', String(summary.missingFromMo)),
    summaryRow('Unconverted', String(summary.unconverted)),
    summaryRow('Product Mismatches', String(summary.productMismatches)),
    summaryRow(''),
  ];

  return exportService.exportToCsv({
    filename: 'audit',
    columns: ORDER_COLUMNS,
    data: [...summaryRows, ...rows],
  });
}

/**
 * Export audit report as multi-sheet XLSX.
 * Sheet 1: Orders Summary (one row per order)
 * Sheet 2: Product Details (one row per product across all sources)
 */
export function exportAuditXlsx(report: AuditReport): Buffer {
  const orderRows = report.orders.map(buildOrderRow);

  const productRows: Record<string, unknown>[] = [];
  for (const order of report.orders) {
    productRows.push(...buildProductRows(order));
  }

  const sheets: ExportSheet[] = [
    { name: 'Orders Summary', columns: ORDER_COLUMNS, data: orderRows },
    { name: 'Product Details', columns: PRODUCT_COLUMNS, data: productRows },
  ];

  return exportService.exportToExcelMultiSheet({
    filename: 'audit',
    sheets,
  });
}

/** Format a Date to YYYY-MM-DD string */
function formatDate(date: Date): string {
  return date instanceof Date
    ? date.toISOString().split('T')[0]
    : String(date);
}
