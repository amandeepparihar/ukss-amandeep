/**
 * @taskId #165096
 * Debenhams Delta Products Upload & Offers Creation service.
 * Standalone module — separate from modules/debenhams/ (order integration).
 */
import path from 'path';
import fs from 'fs/promises';
import { Readable } from 'stream';
import { parse } from 'csv-parse';
import { prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import { applyPriceAdjustment } from '../../lib/marketplaces/common/price-utils';
import { createMiraklClient } from '../../lib/marketplaces/mirakl/client';
import type { UploadResult, SkippedRow, OfferError } from './debenhams-inventory-upload.schema';

// ============ Constants ============

const DEBENHAMS_STORE_ID = 150;
const CHUNK_SIZE = 10_000;
const MAX_ITEMS_IN_RESPONSE = 1000;

const CUSTOMISATION_GROUP_MAP: Record<string, number> = {
  CSM_3: 10,
  CSM_15: 19,
};
const DEFAULT_PRICE_ADJUSTMENT = 5;

// ============ Internal Types ============

interface ParsedRow {
  rowNumber: number;
  sku: string;
  ean: string;
  customisationGroup: string;
  productsId: number;
  priceAdjustment: number;
}

interface EnrichedRow extends ParsedRow {
  lastSyncedQuantity: number;
  lastSyncedPrice: number;
}

// ============ Service ============

export class DebenhamsInventoryUploadService {
  /**
   * @taskId #165096
   * Stream-parse CSV using csv-parse.
   * sku required, ean and customisationgroup optional.
   */
  async parseCsv(buffer: Buffer): Promise<{
    validRows: ParsedRow[];
    skippedRows: SkippedRow[];
  }> {
    return new Promise((resolve, reject) => {
      const validRows: ParsedRow[] = [];
      const skippedRows: SkippedRow[] = [];
      let rowNumber = 0;
      let headersValidated = false;

      const parser = parse({ columns: true, skip_empty_lines: true, trim: true });

      parser.on('readable', () => {
        let record: Record<string, string>;
        while ((record = parser.read()) !== null) {
          rowNumber++;

          if (!headersValidated) {
            const keys = Object.keys(record).map(k => k.toLowerCase());
            const missing = ['sku', 'ean', 'customisationgroup'].filter(h => !keys.includes(h));
            if (missing.length > 0) {
              parser.destroy();
              return reject(new Error(`Missing required headers: ${missing.join(', ')}. Found: ${Object.keys(record).join(', ')}`));
            }
            headersValidated = true;
          }

          const sku = record['sku']?.trim() ?? '';
          const ean = record['ean']?.trim() ?? '';
          const customisationGroup = record['customisationgroup']?.trim() ?? '';

          if (!sku) {
            skippedRows.push({ row: rowNumber, sku: '', reason: 'missing sku' });
            continue;
          }

          const productsId = this.extractProductsId(sku);
          if (productsId === null) {
            skippedRows.push({ row: rowNumber, sku, reason: 'invalid SKU format' });
            continue;
          }

          validRows.push({
            rowNumber,
            sku,
            ean,
            customisationGroup,
            productsId,
            priceAdjustment: CUSTOMISATION_GROUP_MAP[customisationGroup] ?? DEFAULT_PRICE_ADJUSTMENT,
          });
        }
      });

      parser.on('error', reject);
      parser.on('end', () => resolve({ validRows, skippedRows }));
      Readable.from(buffer).pipe(parser);
    });
  }

  private extractProductsId(sku: string): number | null {
    const parts = sku.split('-');
    if (parts.length < 2) return null;
    const id = parseInt(parts[1], 10);
    return isNaN(id) ? null : id;
  }

  private async cleanupOldFiles(): Promise<void> {
    const dir = path.join(process.cwd(), 'temp', 'debenhams');
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    try {
      for (const file of await fs.readdir(dir).catch(() => [])) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath).catch(() => null);
        if (stat && !stat.isDirectory() && now - stat.mtimeMs > maxAge) {
          await fs.unlink(filePath).catch(() => {});
        }
      }
    } catch { /* non-fatal */ }
  }

  /**
   * @taskId #165096
   * For each 10K chunk:
   *   1. One JOIN query: NPV + NP + LEFT JOIN marketplace_listings
   *      → existence + quantity + price + duplicate detection in one round-trip
   *   2. createMany for valid rows
   *
   * 10K chunk size keeps well under MySQL's 65,535 bind param limit.
   * Each INSERT packet ≈ 2MB — safe with default max_allowed_packet.
   */
  private async validateEnrichAndInsert(rows: ParsedRow[]): Promise<{
    insertedRows: EnrichedRow[];
    notFoundRows: SkippedRow[];
    duplicateRows: SkippedRow[];
    failedInserts: number;
  }> {
    const insertedRows: EnrichedRow[] = [];
    const notFoundRows: SkippedRow[] = [];
    const duplicateRows: SkippedRow[] = [];
    let failedInserts = 0;
    const now = new Date();
    const logger = getLogger('debenhams-inventory-upload');

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const skus = chunk.map(r => r.sku);

      // Build IN clause placeholders without string-interpolating values.
      // Prisma.join() from @prisma/client (PostgreSQL) collapses to a single ?
      // when used with the MySQL client — each SKU must be its own bound param.
      const placeholders = skus.map(() => '?').join(', ');
      const results = await prisma.$queryRawUnsafe<Array<{
        npv_products_sku: string;
        quantity: number;
        current_price: number;
        is_duplicate: number;
      }>>(
        `SELECT
          npv.npv_products_sku,
          npv.npv_quantities AS quantity,
          (CASE WHEN np.specials_status = 'Special' AND np.specials_price > 0
                THEN np.specials_price ELSE np.products_price END) AS current_price,
          (CASE WHEN ml.products_sku IS NOT NULL THEN 1 ELSE 0 END) AS is_duplicate
        FROM new_products_variations npv
        INNER JOIN new_products np ON npv.npv_products_id = np.products_id
        LEFT JOIN marketplace_listings ml
          ON ml.products_sku = npv.npv_products_sku
         AND ml.store_id = ?
        WHERE npv.npv_products_sku IN (${placeholders})`,
        DEBENHAMS_STORE_ID, ...skus,
      );

      const dataMap = new Map(results.map(r => [r.npv_products_sku, r]));
      const toInsert: EnrichedRow[] = [];

      for (const row of chunk) {
        const data = dataMap.get(row.sku);
        if (!data) {
          notFoundRows.push({ row: row.rowNumber, sku: row.sku, reason: 'sku not found in NPV' });
          continue;
        }
        if (Number(data.is_duplicate) === 1) {
          duplicateRows.push({ row: row.rowNumber, sku: row.sku, reason: 'already exists for store 150' });
          continue;
        }
        toInsert.push({ ...row, lastSyncedQuantity: Number(data.quantity), lastSyncedPrice: Number(data.current_price) });
      }

      if (toInsert.length > 0) {
        try {
          await prisma.marketplaceListing.createMany({
            data: toInsert.map(row => ({
              productsId: row.productsId,
              storeId: DEBENHAMS_STORE_ID,
              marketplaceProductsId: null,
              productsSku: row.sku,
              ean: row.ean || null,
              marketplaceItemIdentifier: row.sku,
              marketplaceListingStatus: 'confirmed',
              lastSyncedQuantity: row.lastSyncedQuantity,
              lastSyncedPrice: row.lastSyncedPrice,
              lastSyncedSpecialPrice: null,
              lastSyncedPriceCurrency: 'GBP',
              priceAdjustment: row.priceAdjustment,
              lastSyncStatus: 'success',
              lastSyncedAt: now,
              createdAt: now,
              updatedAt: now,
              retryCount: 0,
              apiLastErrorCode: null,
              apiLastErrorMessage: null,
            })),
            skipDuplicates: true,
          });
          insertedRows.push(...toInsert);
        } catch (err) {
          logger.error({ chunkStart: i, err }, 'Insert chunk failed');
          failedInserts += toInsert.length;
        }
      }
    }

    return { insertedRows, notFoundRows, duplicateRows, failedInserts };
  }

  /**
   * @taskId #165096
   * Generate semicolon-delimited Mirakl offers CSV from inserted rows.
   */
  private generateOffersCsv(rows: EnrichedRow[]): string {
    const header = '"sku";"product-id";"product-id-type";"price";"quantity";"state";"update-delete"';
    const lines = rows.map(row => {
      const priceResult = applyPriceAdjustment(row.lastSyncedPrice ?? 0, row.priceAdjustment);
      const price = priceResult.isValid ? priceResult.adjustedPrice : (row.lastSyncedPrice ?? 0);
      return `"${row.ean}";"${row.ean}";"EAN";"${price}";"${row.lastSyncedQuantity ?? 0}";"11";"update"`;
    });
    return [header, ...lines].join('\n');
  }

  /**
   * @taskId #165096
   * Save generated CSV to temp/debenhams/ with timestamp filename.
   */
  private async saveCsvFile(csvContent: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const filename = `debenhams_offers_${timestamp}.csv`;
    const dir = path.join(process.cwd(), 'temp', 'debenhams');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), csvContent, 'utf-8');
    return filename;
  }

  /**
   * @taskId #165096
   * Upload via OF01, poll OF02, parse OF03 if errors.
   * Returns partial result on any failure — DB inserts are never rolled back.
   */
  private async uploadToMirakl(csvContent: string, filename: string): Promise<{
    importId: number | null;
    offersCreated: number;
    offersFailed: number;
    offerErrors: OfferError[];
  }> {
    const logger = getLogger('debenhams-inventory-upload');

    const miraklClient = createMiraklClient('debenhams');

    const uploadResult = await miraklClient.importOffersFile(
      DEBENHAMS_STORE_ID, Buffer.from(csvContent, 'utf-8'), filename, 'NORMAL',
    );

    if (!uploadResult.success || !uploadResult.importId) {
      logger.error({ uploadResult }, 'OF01 upload failed');
      return { importId: null, offersCreated: 0, offersFailed: 0, offerErrors: [] };
    }

    const importId = uploadResult.importId;
    const finalStatus = await miraklClient.waitForImportCompletion(DEBENHAMS_STORE_ID, importId, 12, 5000);
    if (!finalStatus) {
      logger.warn({ importId }, 'OF02 polling timed out');
      return { importId, offersCreated: 0, offersFailed: 0, offerErrors: [] };
    }

    const offerErrors: OfferError[] = [];
    if (finalStatus.lines_in_error > 0 && finalStatus.has_error_report) {
      const errorResult = await miraklClient.getErrorReport(DEBENHAMS_STORE_ID, importId);
      if (errorResult.success && errorResult.errorReport) {
        for (const line of errorResult.errorReport.split('\n').slice(1)) {
          if (!line.trim()) continue;
          const cols = line.split(';').map(c => c.replace(/^"|"$/g, ''));
          if (cols.length >= 2 && cols[cols.length - 1]?.trim()) {
            offerErrors.push({ ean: cols[0] ?? '', sku: cols[0] ?? '', error: cols[cols.length - 1] ?? '' });
          }
        }
      }
    }

    return {
      importId,
      offersCreated: finalStatus.lines_in_success,
      offersFailed: finalStatus.lines_in_error,
      offerErrors,
    };
  }

  /**
   * @taskId #165096
   * Synchronous pipeline — called directly from the route handler.
   * Writes one row to debenhams_import_logs on completion or failure.
   */
  async processUpload(buffer: Buffer, originalFilename: string): Promise<UploadResult> {
    const startTime = Date.now();
    const logger = getLogger('debenhams-inventory-upload');
    logger.info({ originalFilename }, 'Upload started');

    await this.cleanupOldFiles();

    // 1. Parse
    const { validRows, skippedRows: parseSkipped } = await this.parseCsv(buffer);
    logger.info({ valid: validRows.length, skipped: parseSkipped.length }, 'CSV parsed');

    // 2. Validate + enrich + insert
    const { insertedRows, notFoundRows, duplicateRows, failedInserts } =
      await this.validateEnrichAndInsert(validRows);
    logger.info({ inserted: insertedRows.length, notFound: notFoundRows.length, dupes: duplicateRows.length }, 'Insert done');

    // 3. Generate + save CSV
    const csvContent = this.generateOffersCsv(insertedRows);
    const csvFilename = await this.saveCsvFile(csvContent);

    // 4. Upload to Mirakl (failure here does not discard DB results)
    let importId: number | null = null;
    let offersCreated = 0;
    let offersFailed = 0;
    let offerErrors: OfferError[] = [];

    try {
      const m = await this.uploadToMirakl(csvContent, csvFilename);
      importId = m.importId;
      offersCreated = m.offersCreated;
      offersFailed = m.offersFailed;
      offerErrors = m.offerErrors;
    } catch (err) {
      logger.error({ err }, 'Mirakl upload failed — DB inserts preserved');
    }

    const allSkipped = [...parseSkipped, ...notFoundRows, ...duplicateRows];
    const totalRows = validRows.length + parseSkipped.length;

    // 5. Write import log (non-fatal)
    await prisma.debenhamsImportLog.create({
      data: {
        filename: originalFilename,
        csvFilename,
        status: 'complete',
        totalRows,
        inserted: insertedRows.length,
        skippedInvalid: parseSkipped.length,
        skippedNotInNpv: notFoundRows.length,
        skippedDuplicates: duplicateRows.length,
        failedInserts,
        offersCreated,
        offersFailed,
      },
    }).catch(err => logger.error({ err }, 'Failed to write import log'));

    logger.info({ totalRows, inserted: insertedRows.length, processingTimeMs: Date.now() - startTime }, 'Upload complete');

    return {
      summary: {
        totalRows,
        inserted: insertedRows.length,
        skippedInvalid: parseSkipped.length,
        skippedNotInNpv: notFoundRows.length,
        skippedDuplicates: duplicateRows.length,
        failedInserts,
        offersCreated,
        offersFailed,
        processingTimeMs: Date.now() - startTime,
      },
      skippedRows: allSkipped.slice(0, MAX_ITEMS_IN_RESPONSE),
      offerErrors: offerErrors.slice(0, MAX_ITEMS_IN_RESPONSE),
      miraklImportIds: importId ? [importId] : [],
      downloadUrl: `/api/debenhams-inventory-upload/download/${csvFilename}`,
    };
  }
}
