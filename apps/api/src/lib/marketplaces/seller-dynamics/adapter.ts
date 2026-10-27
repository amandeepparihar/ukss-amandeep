/**
 * Seller Dynamics Marketplace Adapter
 *
 * @taskId #165838 (parent #165486)
 *
 * Bulk-upload-and-poll sync (Mirakl-style) over SOAP/XML.
 * Flow per batch:
 *   1. POST BulkUploadStock with CSV body  → fileName
 *   2. Poll BulkUploadCheckWithErrors(fileName) every POLL_DELAY seconds
 *      (up to POLL_MAX_ATTEMPTS) until completed=true or attempts exhausted
 *   3. Map results to DB via shared markSyncSuccessBatch / markSyncFailureBatch
 *
 * SD guidance (Gary, 2026-05-25): shared queue processes ~3-4 min per entry.
 * Recommended: poll every 4 min, submit batches every 20 min.
 * Rate limits (per SOAP method): ≤25 calls / 5 min, ≥10s between calls.
 *
 * Failure attribution strategy (Option A, agreed with stakeholders 2026-05-19):
 *   - errorCount = 0                            → mark all rows in batch as success
 *   - errorCount > 0 AND <errors> populated     → attribute by lineNumber
 *   - errorCount > 0 AND <errors> EMPTY         → DO NOT touch DB (no success, no failure).
 *     Push to errors[] so shared email-alert path fires. Items stay in
 *     needs-sync state for next cron tick; retry_count is intentionally
 *     NOT incremented to avoid silently aging out good rows mixed in with bad.
 *     Mirrors the Mirakl adapter's `errorReportUnavailable` branch.
 *
 * Why Option A is safe (verified against sandbox 2026-05-19):
 *   In a mixed-validity batch, SD applies good rows independently. So if we
 *   leave the DB untouched on unattributed-failure, the good rows on SD are
 *   already correct; the next sync will detect "drift" between our DB and
 *   SD-reported state (current_* still != last_synced_*) and idempotently
 *   re-send the same values. No oversells, no price discrepancy. The bad row
 *   stays in needs-sync until it's manually fixed.
 */

import { nanoid } from 'nanoid';
import { MarketplaceAdapter, type MarketplaceSyncResult } from '../common/base-adapter';
import type { ListingNeedingSync } from '../common/types';
import { applyPriceAdjustment } from '../common/price-utils';
import * as db from '../../../modules/marketplace-sync/marketplace-sync.db';
import { getLogger } from '../../logger-context';
import { config } from '../../../config';
import {
  createSellerDynamicsClient,
  type SellerDynamicsStockRow,
  type SellerDynamicsClient,
} from './client';

/**
 * Hard floor on the final selling price we'll ever send to SD. Above and beyond
 * applyPriceAdjustment's minPrice=0.01 guard — this catches catastrophic
 * decimal/unit errors (e.g. £600 product sent as £6.00) before they reach
 * Amazon. Set well above any legitimate UKSS price.
 */
const SD_PRICE_FLOOR_GBP = 1.0;

interface BatchRowContext {
  listingId: number;
  sku: string;
  basePrice: number;       // pre-adjustment GBP — what we store as last_synced_price
  finalPrice: number;      // sent to SD
  quantity: number;
  isSpecialPrice: boolean;
}

export class SellerDynamicsAdapter extends MarketplaceAdapter {
  getMarketplaceName(): string {
    return 'Seller Dynamics';
  }

  async syncListings(listings: ListingNeedingSync[]): Promise<MarketplaceSyncResult> {
    const { storeId, batchSize } = this.config;
    const logger = getLogger();
    const correlationId = `SD_SYNC_${storeId}_${Date.now()}_${nanoid(8)}`;

    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    let client: SellerDynamicsClient;
    try {
      client = createSellerDynamicsClient();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { correlationId, storeId, error: message },
        'Seller Dynamics client initialization failed (likely missing encryptedLogin/retailerId)',
      );
      // Without a client we can't mark per-row failures meaningfully; surface to ops via errors[].
      errors.push(`Seller Dynamics client init failed: ${message}`);
      return { successCount: 0, failureCount: 0, errors };
    }

    // ---- Pre-flight per-row validation & row construction --------------------
    const rowContexts: BatchRowContext[] = [];

    for (const listing of listings) {
      const sku = listing.products_sku || listing.marketplace_item_identifier;
      if (!sku) {
        logger.warn(
          { listingId: listing.marketplace_listings_id, correlationId },
          'Skipping listing: missing SKU',
        );
        await db.markSyncFailure(
          listing.marketplace_listings_id,
          'VALIDATION_MISSING_SKU',
          'SKU is required for Seller Dynamics sync',
          correlationId,
        );
        failureCount++;
        continue;
      }

      const priceResult = applyPriceAdjustment(listing.current_price, listing.price_adjustment);
      if (!priceResult.isValid) {
        logger.warn(
          {
            listingId: listing.marketplace_listings_id,
            sku,
            basePrice: priceResult.basePrice,
            priceAdjustment: priceResult.priceAdjustment,
            adjustedPrice: priceResult.adjustedPrice,
            error: priceResult.error,
            correlationId,
          },
          'Price adjustment invalid, skipping',
        );
        await db.markSyncFailure(
          listing.marketplace_listings_id,
          'VALIDATION_NEGATIVE_PRICE',
          priceResult.error ?? 'Price adjustment resulted in non-positive price',
          correlationId,
        );
        failureCount++;
        continue;
      }

      // Apply the SD marketplace markup to the price we actually send to SD.
      // Applied to the final (post price_adjustment) price only — basePrice stays the
      // un-marked-up current_price so last_synced_price (the drift baseline) is not
      // corrupted into a perpetual re-sync. Mirrors the SMS Walmart markup pattern.
      //
      // T-shirts (new_products.virtual_product_type_id = 4) take a lower markup via the
      // SD_MARKUP multiplier (default 1.15); everything else uses the standard percentage.
      // Number() guard: this column is returned unmapped from $queryRawUnsafe, so a strict
      // === 4 could miss a string/BigInt driver value.
      const isTshirt = Number(listing.virtual_product_type_id) === 4;
      const markupMultiplier = isTshirt
        ? config.SD_MARKUP
        : 1 + config.MARKETPLACE_SELLER_DYNAMICS_PRICE_MARKUP_PERCENTAGE / 100;
      // Round the marked-up price UP to the next whole £1. toFixed(2) first so float noise
      // (e.g. an exact £25.00 stored as 25.0000000001) doesn't ceil an extra £1. Rounding
      // touches only finalPrice — never basePrice/last_synced_price.
      const finalPrice = Math.ceil(Number((priceResult.adjustedPrice * markupMultiplier).toFixed(2)));
      if (finalPrice < SD_PRICE_FLOOR_GBP) {
        logger.error(
          {
            listingId: listing.marketplace_listings_id,
            sku,
            basePrice: priceResult.basePrice,
            finalPrice,
            correlationId,
          },
          'Refusing to send price below SD safety floor',
        );
        await db.markSyncFailure(
          listing.marketplace_listings_id,
          'SD_PRICE_FLOOR',
          `Final price £${finalPrice.toFixed(2)} below SD safety floor £${SD_PRICE_FLOOR_GBP.toFixed(2)}`,
          correlationId,
        );
        failureCount++;
        continue;
      }

      const quantity = Math.floor(listing.normalized_quantity);
      const isSpecialPrice =
        listing.specials_status === 'Special' && (listing.specials_price ?? 0) > 0;

      rowContexts.push({
        listingId: listing.marketplace_listings_id,
        sku,
        basePrice: priceResult.basePrice,
        finalPrice,
        quantity,
        isSpecialPrice,
      });
    }

    if (rowContexts.length === 0) {
      logger.info(
        { storeId, correlationId, totalListings: listings.length, validationFailures: failureCount },
        'No rows to sync to Seller Dynamics after validation',
      );
      return { successCount, failureCount, errors };
    }

    // ---- Split into batches of batchSize and process sequentially -----------
    const batches: BatchRowContext[][] = [];
    for (let i = 0; i < rowContexts.length; i += batchSize) {
      batches.push(rowContexts.slice(i, i + batchSize));
    }

    logger.info(
      { storeId, correlationId, totalRows: rowContexts.length, batchCount: batches.length, batchSize },
      'Starting Seller Dynamics sync',
    );

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchLabel = `${i + 1}/${batches.length}`;
      const importName = `JSA Sync ${new Date().toISOString()} store=${storeId} batch=${batchLabel}`;

      if (i > 0 && this.config.batchDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.batchDelay * 1000));
      }

      const batchResult = await this.processBatch(
        client,
        batch,
        importName,
        correlationId,
        storeId,
      );

      successCount += batchResult.successCount;
      failureCount += batchResult.failureCount;
      errors.push(...batchResult.errors);
    }

    logger.info(
      { storeId, correlationId, successCount, failureCount, errorMessages: errors.length },
      'Seller Dynamics sync completed',
    );

    return { successCount, failureCount, errors };
  }

  /**
   * Process a single batch: upload CSV, poll for completion, attribute results.
   */
  private async processBatch(
    client: SellerDynamicsClient,
    batch: BatchRowContext[],
    importName: string,
    correlationId: string,
    storeId: number,
  ): Promise<MarketplaceSyncResult> {
    const logger = getLogger();
    const errors: string[] = [];

    const rows: SellerDynamicsStockRow[] = batch.map((ctx) => ({
      sku: ctx.sku,
      fixedPrice: ctx.finalPrice,
      costPrice: ctx.finalPrice, // user decision 2026-05-19: send same value to both columns
      stockLevel: ctx.quantity,
    }));

    // --- Step 1: Submit upload ----------------------------------------------
    let uploadResponse;
    try {
      uploadResponse = await client.bulkUploadStock(rows, importName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ correlationId, storeId, error: message }, 'BulkUploadStock threw');
      await db.markSyncFailureBatch(
        batch.map((ctx) => ({
          listingId: ctx.listingId,
          errorCode: 'SYNC_EXCEPTION',
          errorMessage: message,
          correlationId,
        })),
      );
      errors.push(`BulkUploadStock exception: ${message}`);
      return { successCount: 0, failureCount: batch.length, errors };
    }

    if (!uploadResponse.success || !uploadResponse.fileName) {
      logger.error(
        { correlationId, storeId, uploadResponse },
        'BulkUploadStock returned failure',
      );
      await db.markSyncFailureBatch(
        batch.map((ctx) => ({
          listingId: ctx.listingId,
          errorCode: uploadResponse.errorCode ?? 'SD_UPLOAD_FAILED',
          errorMessage: uploadResponse.error ?? uploadResponse.response,
          correlationId,
        })),
      );
      errors.push(`BulkUploadStock failed: ${uploadResponse.error ?? uploadResponse.response}`);
      return { successCount: 0, failureCount: batch.length, errors };
    }

    // --- Step 2: Poll for completion ----------------------------------------
    const pollMaxAttempts = config.MARKETPLACE_SELLER_DYNAMICS_POLL_MAX_ATTEMPTS;
    const pollDelayMs = config.MARKETPLACE_SELLER_DYNAMICS_POLL_DELAY * 1000;
    const finalStatus = await client.waitForImportCompletion(uploadResponse.fileName, pollMaxAttempts, pollDelayMs);

    if (!finalStatus) {
      logger.warn(
        { correlationId, storeId, fileName: uploadResponse.fileName },
        'Poll timed out before completion — marking batch failed for retry',
      );
      await db.markSyncFailureBatch(
        batch.map((ctx) => ({
          listingId: ctx.listingId,
          errorCode: 'SD_POLL_TIMEOUT',
          errorMessage: `Import ${uploadResponse.fileName} not completed within poll window`,
          correlationId,
        })),
      );
      errors.push(
        `Seller Dynamics import ${uploadResponse.fileName} did not complete within poll window — items will retry next cycle`,
      );
      return { successCount: 0, failureCount: batch.length, errors };
    }

    // --- Step 3: Attribute results ------------------------------------------
    if (finalStatus.errorCount === 0) {
      // Happy path: all rows applied.
      const updated = await db.markSyncSuccessBatch(
        batch.map((ctx) => ({
          listingId: ctx.listingId,
          quantity: ctx.quantity,
          price: ctx.basePrice, // store ORIGINAL (pre-adjustment) price
          currency: 'GBP',
          isSpecialPrice: ctx.isSpecialPrice,
        })),
      );
      logger.info(
        { correlationId, storeId, fileName: uploadResponse.fileName, updated },
        'Batch fully successful',
      );
      return { successCount: updated, failureCount: 0, errors };
    }

    // errorCount > 0 — does SD give us per-row detail?
    if (finalStatus.errors.length > 0) {
      // CREATE-style attribution: lineNumber is 1-indexed, header is line 1,
      // data rows start at line 2. So listing index = lineNumber - 2.
      const failedIndices = new Set<number>();
      const failedDetails = new Map<number, string>();
      for (const err of finalStatus.errors) {
        const idx = err.lineNumber - 2;
        if (idx >= 0 && idx < batch.length) {
          failedIndices.add(idx);
          // Multiple errors can map to the same row; keep the first.
          if (!failedDetails.has(idx)) {
            failedDetails.set(idx, err.errorCode);
          }
        } else {
          logger.warn(
            { correlationId, storeId, lineNumber: err.lineNumber, batchSize: batch.length },
            'Error report referenced lineNumber outside batch range — ignoring',
          );
        }
      }

      const successes = batch
        .map((ctx, idx) => ({ ctx, idx }))
        .filter(({ idx }) => !failedIndices.has(idx))
        .map(({ ctx }) => ({
          listingId: ctx.listingId,
          quantity: ctx.quantity,
          price: ctx.basePrice,
          currency: 'GBP',
          isSpecialPrice: ctx.isSpecialPrice,
        }));

      const failures = batch
        .map((ctx, idx) => ({ ctx, idx }))
        .filter(({ idx }) => failedIndices.has(idx))
        .map(({ ctx, idx }) => ({
          listingId: ctx.listingId,
          errorCode: failedDetails.get(idx) ?? 'SD_ROW_ERROR',
          errorMessage: `Seller Dynamics rejected row: ${failedDetails.get(idx) ?? 'unknown'}`,
          correlationId,
        }));

      if (successes.length > 0) await db.markSyncSuccessBatch(successes);
      if (failures.length > 0) await db.markSyncFailureBatch(failures);

      errors.push(
        `Seller Dynamics batch completed with ${failures.length} attributed error(s)`,
      );

      logger.info(
        { correlationId, storeId, successes: successes.length, failures: failures.length },
        'Batch partial success (attributed)',
      );

      return {
        successCount: successes.length,
        failureCount: failures.length,
        errors,
      };
    }

    // errorCount > 0 BUT <errors> is empty (Option A — unattributed).
    // DO NOT touch DB. Items stay in needs-sync state for next cron tick.
    logger.error(
      {
        correlationId,
        storeId,
        fileName: uploadResponse.fileName,
        errorCount: finalStatus.errorCount,
        batchSize: batch.length,
      },
      'SD reported errors with no per-line attribution — leaving DB unchanged, alerting ops',
    );
    errors.push(
      `Seller Dynamics import ${uploadResponse.fileName} reported ${finalStatus.errorCount} ` +
        `unattributed error(s) in a batch of ${batch.length} — manual investigation required ` +
        `(items will be retried next cycle without incrementing retry_count)`,
    );
    return { successCount: 0, failureCount: 0, errors };
  }
}
