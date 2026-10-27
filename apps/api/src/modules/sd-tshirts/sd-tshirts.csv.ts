/**
 * BulkUploadStock CSV construction for the SD T-Shirts module.
 *
 * @taskId #166531
 *
 * Split out of sd-tshirts.cron.ts so it can be unit-tested: the cron imports prisma and the
 * logger, which pull in config/index.ts, and that calls process.exit(1) unless the full
 * environment is present. The `Flag` column is a contract with Seller Dynamics, so it needs
 * cover that does not involve POSTing to the live SD API.
 *
 * Pure functions only — no DB, no config, no network.
 */
import { sdListingFlag } from '../../lib/marketplaces/seller-dynamics/sd-flags';
// Type-only: erased at compile time, so importing this does not load the service (and with it
// prisma) at runtime.
import type { getPendingListings } from './sd-tshirts.service';

export type PendingListing = Awaited<ReturnType<typeof getPendingListings>>[number];

// wraps value in quotes if it contains comma, newline or quote
export function escapeCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * 30-column positional upload — the header order below is what SD parses against, so columns
 * must not be reordered or dropped.
 */
export function buildCsvString(listings: PendingListing[]): string {
  const header = [
    'ItemTitle',
    'EANBarCode',
    'ItemTextDescription',
    'PackSize',
    'ReOrderLevel',
    'ReorderAtOutOfStock',
    'IsKit',
    'Flag',
    'Managed',
    'ActivePricingProfile',
    'ActiveTaxProfile',
    'SKU',
    'ParentSKU',
    'Condition',
    'StockLevel',
    'CostPrice',
    'DepthMM',
    'HeightMM',
    'WidthMM',
    'WeightGrams',
    'GoodID',
    'ListingCategory1',
    'ListingCategory2',
    'Brand',
    'ListingTitle',
    'ListingDescription',
    'Image1',
    'Image2',
    'Image3',
    'Image4',
  ].join(',');

  const rows = listings.map((l) =>
    [
      escapeCsvValue(l.itemTitle),
      escapeCsvValue(l.eanBarCode),
      '',
      '0',
      '0',
      'FALSE',
      'FALSE',
      // Flag — UKSS-CUST when the product is marked customisable (Is_Your_Name = 'Yes'),
      // else UKSS-POD. Resolved per row, so one upload can carry both.
      // Plain 'UKSS' belongs to items listed outside this module and is never sent here.
      sdListingFlag(l.isCustomisable),
      'True',
      'AmazonPOD',
      'Default',
      escapeCsvValue(l.productsSku),
      escapeCsvValue(l.parentSku),
      '1',
      escapeCsvValue(l.stockLevel),
      escapeCsvValue(l.costPrice),
      '',
      '',
      '',
      escapeCsvValue(l.weightGrams),
      '',
      '',
      '',
      escapeCsvValue(l.brand),
      escapeCsvValue(l.productsName),
      escapeCsvValue(l.listingDescription),
      escapeCsvValue(l.image1),
      escapeCsvValue(l.image2),
      escapeCsvValue(l.image3),
      escapeCsvValue(l.image4),
    ].join(',')
  );

  return [header, ...rows].join('\n');
}
