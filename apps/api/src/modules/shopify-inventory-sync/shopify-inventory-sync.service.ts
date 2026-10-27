/**
 * Shopify Inventory Sync service.
 * Provides methods for comparing Shopify inventory export files
 * against the database and applying corrections.
 */
import path from 'path';
import fs from 'fs/promises';
import XLSX from 'xlsx';
import { prisma } from '../../lib/prisma';
import type { StoreInfo, CompareResult, MismatchRow, ApplyUpdatesResult } from './shopify-inventory-sync.schema';

// ============ Internal Types ============

interface StoreRow {
  store_id: number;
  store_name: string;
}

interface DbVariantRow {
  sp_product_id: number;
  spv_variation_id: number;
  spv_inventory_quantity: number;
}

interface ExportFileInfo {
  filePath: string;
  fileName: string;
  fileModified: Date;
}

export interface ExcelRow {
  productId: number;
  variantId: number;
  qty: number;
}

// ============ Constants ============

// Docker WORKDIR is /app (monorepo root), so process.cwd() = /app
// Volume mount maps host exports/ to /app/exports/ inside the container
const EXPORTS_DIR = path.join(process.cwd(), 'exports', 'shopify-inventory-sync');
const COMPARE_CHUNK_SIZE = 5000;
const UPDATE_CHUNK_SIZE = 500;
const MAX_EXCEL_ROWS = 100_000;

// ============ Service ============

export class ShopifyInventorySyncService {
  /**
   * Get all stores that have Shopify products, along with export file status.
   */
  async getStores(): Promise<StoreInfo[]> {
    // Raw SQL: Legacy tables not in Prisma schema
    const stores = await prisma.$queryRaw<StoreRow[]>`
      SELECT DISTINCT sm.store_id, sm.store_name
      FROM store_management sm
      INNER JOIN shopify_products sp ON sp.sm_store_id = sm.store_id
      ORDER BY sm.store_name
    `;

    const results: StoreInfo[] = [];

    for (const store of stores) {
      const storeId = Number(store.store_id);
      const dirPath = path.join(EXPORTS_DIR, String(storeId));
      let hasExportFile = false;
      let fileName: string | undefined;
      let fileModified: string | undefined;

      try {
        const entries = await fs.readdir(dirPath);
        const xlsxFiles = entries.filter((f) => f.endsWith('.xlsx'));

        if (xlsxFiles.length > 0) {
          // Find the most recent file by mtime
          let latestFile: string | null = null;
          let latestMtime = 0;

          for (const file of xlsxFiles) {
            const stat = await fs.stat(path.join(dirPath, file));
            if (stat.mtimeMs > latestMtime) {
              latestMtime = stat.mtimeMs;
              latestFile = file;
            }
          }

          if (latestFile) {
            hasExportFile = true;
            fileName = latestFile;
            fileModified = new Date(latestMtime).toISOString();
          }
        }
      } catch (err) {
        // Directory doesn't exist or isn't readable — no export file for this store
      }

      results.push({
        storeId,
        storeName: store.store_name,
        hasExportFile,
        fileName,
        fileModified,
      });
    }

    return results;
  }

  /**
   * Get a single store's name by ID, or null if not found.
   */
  async getStoreName(storeId: number): Promise<string | null> {
    const rows = await prisma.$queryRaw<StoreRow[]>`
      SELECT sm.store_id, sm.store_name
      FROM store_management sm
      INNER JOIN shopify_products sp ON sp.sm_store_id = sm.store_id
      WHERE sm.store_id = ${storeId}
      LIMIT 1
    `;
    return rows.length > 0 ? rows[0].store_name : null;
  }

  /**
   * Get the most recent export file for a given store.
   * Throws if storeId is not numeric or no files are found.
   */
  async getExportFile(storeId: number): Promise<ExportFileInfo> {
    if (!Number.isFinite(storeId) || storeId <= 0) {
      throw new Error('Invalid storeId: must be a positive number');
    }

    const dirPath = path.join(EXPORTS_DIR, String(storeId));

    let entries: string[];
    try {
      entries = await fs.readdir(dirPath);
    } catch {
      throw new Error(`No export directory found for store ${storeId}`);
    }

    const xlsxFiles = entries.filter((f) => f.endsWith('.xlsx'));

    if (xlsxFiles.length === 0) {
      throw new Error(`No .xlsx export files found for store ${storeId}`);
    }

    // Stat each file and sort by mtime descending
    const fileStats = await Promise.all(
      xlsxFiles.map(async (file) => {
        const filePath = path.join(dirPath, file);
        const stat = await fs.stat(filePath);
        return { filePath, fileName: file, fileModified: stat.mtime };
      }),
    );

    fileStats.sort((a, b) => b.fileModified.getTime() - a.fileModified.getTime());

    return fileStats[0];
  }

  /**
   * Save an uploaded file to the store's export directory.
   */
  async saveUploadedFile(storeId: number, buffer: Buffer, originalFilename: string): Promise<string> {
    const dirPath = path.join(EXPORTS_DIR, String(storeId));
    await fs.mkdir(dirPath, { recursive: true });
    const safeName = path.basename(originalFilename);
    const filePath = path.join(dirPath, safeName);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  /**
   * Parse a Matrixify Excel export file from disk.
   */
  parseExcel(filePath: string): { rows: ExcelRow[]; skipped: number } {
    const workbook = XLSX.readFile(filePath);
    return this.extractRows(workbook);
  }

  /**
   * Parse a Matrixify Excel export from a Buffer (for uploaded files).
   */
  parseExcelFromBuffer(buffer: Buffer): { rows: ExcelRow[]; skipped: number } {
    const workbook = XLSX.read(buffer);
    return this.extractRows(workbook);
  }

  private extractRows(workbook: XLSX.WorkBook): { rows: ExcelRow[]; skipped: number } {
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { rows: [], skipped: 0 };
    }

    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    if (rawRows.length > MAX_EXCEL_ROWS) {
      throw new Error(
        `Excel file contains ${rawRows.length.toLocaleString()} rows, exceeding the limit of ${MAX_EXCEL_ROWS.toLocaleString()}`,
      );
    }

    let skipped = 0;
    const variantMap = new Map<number, ExcelRow>();

    for (const raw of rawRows) {
      const productId = Number(raw['ID']);
      const variantId = Number(raw['Variant ID']);
      const qty = Number(raw['Variant Inventory Qty']);

      if (!Number.isFinite(productId) || !Number.isFinite(variantId) || !Number.isFinite(qty)) {
        skipped++;
        continue;
      }

      // Last occurrence wins for duplicate Variant IDs
      variantMap.set(variantId, { productId, variantId, qty });
    }

    return { rows: Array.from(variantMap.values()), skipped };
  }

  /**
   * Compare Excel rows against the DB for a given store.
   * Returns only mismatches and not-found variants.
   */
  async compareWithDb(
    storeId: number,
    storeName: string,
    fileName: string,
    excelRows: ExcelRow[],
    skipped: number,
  ): Promise<CompareResult> {
    const startTime = Date.now();

    if (excelRows.length === 0) {
      return {
        storeId,
        storeName,
        fileName,
        totalExcelRows: 0,
        matched: 0,
        skipped,
        mismatches: [],
        notFound: [],
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Fetch all matching variants from DB in chunks
    const dbMap = new Map<number, { productId: number; dbQty: number }>();

    for (let i = 0; i < excelRows.length; i += COMPARE_CHUNK_SIZE) {
      const chunk = excelRows.slice(i, i + COMPARE_CHUNK_SIZE);
      const variantIds = chunk.map((r) => r.variantId);
      const placeholders = variantIds.map(() => '?').join(', ');

      const rows = await prisma.$queryRawUnsafe<DbVariantRow[]>(
        `SELECT sp.sp_product_id, spv.spv_variation_id, spv.spv_inventory_quantity
         FROM shopify_products sp
         INNER JOIN shopify_products_variations spv ON spv.sp_id = sp.sp_id
         WHERE sp.sm_store_id = ?
           AND spv.spv_variation_id IN (${placeholders})`,
        storeId,
        ...variantIds,
      );

      for (const row of rows) {
        dbMap.set(Number(row.spv_variation_id), {
          productId: Number(row.sp_product_id),
          dbQty: Number(row.spv_inventory_quantity),
        });
      }
    }

    // Compare
    const mismatches: MismatchRow[] = [];
    const notFound: Array<{ productId: number; variantId: number }> = [];
    let matched = 0;

    for (const excelRow of excelRows) {
      const dbEntry = dbMap.get(excelRow.variantId);

      if (!dbEntry) {
        notFound.push({ productId: excelRow.productId, variantId: excelRow.variantId });
        continue;
      }

      if (excelRow.qty !== dbEntry.dbQty) {
        mismatches.push({
          productId: excelRow.productId,
          variantId: excelRow.variantId,
          excelQty: excelRow.qty,
          dbQty: dbEntry.dbQty,
          diff: excelRow.qty - dbEntry.dbQty,
        });
      } else {
        matched++;
      }
    }

    return {
      storeId,
      storeName,
      fileName,
      totalExcelRows: excelRows.length + skipped,
      matched,
      skipped,
      mismatches,
      notFound,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Verify that all variant IDs belong to the specified store.
   * Throws if any variants don't belong to the store.
   */
  async validateVariantOwnership(storeId: number, variantIds: number[]): Promise<void> {
    if (variantIds.length === 0) return;

    const placeholders = variantIds.map(() => '?').join(', ');
    const ownedRows = await prisma.$queryRawUnsafe<Array<{ spv_variation_id: number }>>(
      `SELECT spv.spv_variation_id
       FROM shopify_products_variations spv
       INNER JOIN shopify_products sp ON spv.sp_id = sp.sp_id
       WHERE sp.sm_store_id = ?
         AND spv.spv_variation_id IN (${placeholders})`,
      storeId,
      ...variantIds,
    );

    const ownedSet = new Set(ownedRows.map((r) => Number(r.spv_variation_id)));
    const unauthorized = variantIds.filter((id) => !ownedSet.has(id));

    if (unauthorized.length > 0) {
      throw new Error(
        `${unauthorized.length} variant(s) do not belong to store ${storeId}: ${unauthorized.slice(0, 5).join(', ')}${unauthorized.length > 5 ? '...' : ''}`,
      );
    }
  }

  /**
   * Bulk-update spv_inventory_quantity for the given variants.
   * Processes in chunks of 500 using CASE WHEN for efficiency.
   */
  async applyUpdates(
    storeId: number,
    updates: Array<{ variantId: number; newQty: number }>,
  ): Promise<ApplyUpdatesResult> {
    const startTime = Date.now();

    // Verify all variants belong to the specified store
    const variantIds = updates.map((u) => u.variantId);
    await this.validateVariantOwnership(storeId, variantIds);

    // Build all chunk queries upfront
    const queries: Array<{ sql: string; params: number[] }> = [];
    for (let i = 0; i < updates.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = updates.slice(i, i + UPDATE_CHUNK_SIZE);

      // Build CASE WHEN clause and IN list
      const caseClauses = chunk.map(() => 'WHEN spv_variation_id = ? THEN ?').join(' ');
      const inPlaceholders = chunk.map(() => '?').join(', ');

      // Params: [case pairs..., in list...]
      const caseParams: number[] = [];
      for (const u of chunk) {
        caseParams.push(u.variantId, u.newQty);
      }
      const inParams = chunk.map((u) => u.variantId);

      const sql = `UPDATE shopify_products_variations
        SET spv_inventory_quantity = CASE ${caseClauses} ELSE spv_inventory_quantity END
        WHERE spv_variation_id IN (${inPlaceholders})`;

      queries.push({ sql, params: [...caseParams, ...inParams] });
    }

    // Execute all chunks within a single transaction to prevent partial updates
    try {
      await prisma.$transaction(async (tx) => {
        for (const { sql, params } of queries) {
          await tx.$executeRawUnsafe(sql, ...params);
        }
      });

      return {
        updated: updates.length,
        failed: 0,
        errors: [],
        processingTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        updated: 0,
        failed: updates.length,
        errors: updates.map((u) => ({ variantId: u.variantId, error: message })),
        processingTimeMs: Date.now() - startTime,
      };
    }
  }
}
