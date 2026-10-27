/**
 * eBay Reconciliation Dashboard — shared API contract types.
 * Spec: docs/superpowers/specs/2026-07-17-ebay-reconciliation-dashboard-design.md
 */

export const EBAY_RECON_CATEGORIES = [
  'unmanaged',
  'status_mismatch',
  'managed_ghost',
  'unmatched_sku',
  'oversell_suspect',
  'qty_mismatch',
  'price_mismatch',
  'managed_ok',
] as const;

export type EbayReconCategory = (typeof EBAY_RECON_CATEGORIES)[number];

export interface EbayReconRunSummary {
  runId: number;
  status: 'running' | 'completed' | 'failed';
  triggerSource: 'cron' | 'manual';
  triggeredBy: string | null;
  startedAt: string;            // ISO
  finishedAt: string | null;    // ISO
  pagesFetched: number;
  listingsFetched: number;      // distinct ItemIDs on eBay
  variationsFetched: number;    // snapshot SKU-level rows
  errorMessage: string | null;
  categoryCounts: Partial<Record<EbayReconCategory, number>>;
  browseChecked: number;
  browseUnchecked: number;      // suspects beyond the per-run Browse cap
  oosControlAssumed: boolean;   // ghost classification soundness assumption
}

export interface EbayReconSummaryResponse {
  latestRun: EbayReconRunSummary | null;   // latest COMPLETED run
  runningRun: EbayReconRunSummary | null;  // in-flight run, if any
  previousRuns: EbayReconRunSummary[];     // most recent first, excludes latestRun
}

export interface EbayReconItem {
  id: number;
  runId: number;
  itemId: string;
  sku: string | null;
  category: EbayReconCategory;
  dbListingStatus: string | null;
  dbLastSyncedQty: number | null;
  dbLastSyncedPrice: number | null;
  dbErrorCode: string | null;
  ebayQtyAvailable: number | null;
  ebayPrice: number | null;
  ebayTitle: string | null;
  browseChecked: boolean;
  browseStatus: string | null;   // IN_STOCK / OUT_OF_STOCK / LIMITED_STOCK
  browseQty: number | null;
  actionTaken: string | null;
  actionAt: string | null;       // ISO
  actionBy: string | null;
}

export interface EbayReconItemsResponse {
  runId: number;
  rows: EbayReconItem[];
  total: number;
  page: number;
  totalPages: number;
}

export type EbayReconActionName = 'reactivate' | 'relist' | 'mark_gone' | 'verify_oversell';

export interface EbayReconActionOutcome {
  itemId: string;
  action: string;    // e.g. 'reactivate', 'relist', 'not-active:ended', 'marked-gone', 'IN_STOCK'
  rows?: number;     // marketplace_listings rows affected
  newItemId?: string;
  detail?: string;
}

export interface EbayReconActionResponse {
  action: EbayReconActionName;
  dryRun: boolean;
  requested: number;
  outcomes: EbayReconActionOutcome[];
}
