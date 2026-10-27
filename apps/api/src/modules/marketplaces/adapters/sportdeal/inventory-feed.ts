/**
 * Sportdeal Inventory Feed Generator
 *
 * Generates XML inventory feed for Sportdeal marketplace.
 * Supports delta feed (only changed items) and full feed.
 *
 * Uses streaming for large datasets to avoid memory issues.
 */

import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../lib/prisma';
import { config as appConfig } from '../../../../config';
// Note: Prisma import kept for Prisma.join used in updateSyncedQuantities
import { createLogger, type Logger } from '../../../../lib/logger';
import { fileUtils, StreamingFileWriter } from '../../utils';
import type { SportdealConfig } from './sportdeal.config';
import type {
  SportdealInventoryItem,
  SportdealXmlInventoryItem,
  SportdealInventoryFeedResult,
  SportdealInventoryFeedOptions,
} from './sportdeal.types';

/**
 * Sportdeal inventory feed generator.
 * Generates XML feed with inventory and price data.
 */
export class SportdealInventoryFeedGenerator {
  private readonly config: SportdealConfig;
  private readonly logger: Logger;

  constructor(config: SportdealConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger ?? createLogger('sportdeal-inventory-feed');
  }

  /**
   * Generate Sportdeal inventory feed.
   * By default, generates delta feed (only changed items).
   * Full feeds use streaming for large datasets.
   */
  async generate(options?: SportdealInventoryFeedOptions): Promise<SportdealInventoryFeedResult> {
    const startTime = Date.now();

    this.logger.info({
      dryRun: options?.dryRun,
      full: options?.full
    }, 'Starting Sportdeal inventory feed generation');

    // For full feeds with large datasets, use streaming
    if (options?.full) {
      return this.generateStreamingFullFeed(options);
    }

    // For delta feeds (changed items only), use in-memory approach (typically small)
    return this.generateDeltaFeed(options);
  }

  /**
   * Generate delta inventory feed (changed items only).
   * Uses in-memory approach since delta feeds are typically small.
   */
  private async generateDeltaFeed(options?: SportdealInventoryFeedOptions): Promise<SportdealInventoryFeedResult> {
    const startTime = Date.now();

    try {
      // 1. Query changed items
      const items = await this.queryChangedItems();

      this.logger.info({ itemCount: items.length }, 'Changed items queried from database');

      if (items.length === 0) {
        this.logger.info('No inventory changes to sync');
        return {
          success: true,
          itemCount: 0,
          changedItems: 0,
          duration: Date.now() - startTime,
        };
      }

      // 2. Transform to XML format
      const xmlItems = items.map((item) => this.transformItem(item));

      if (options?.dryRun) {
        this.logger.info({ itemCount: xmlItems.length }, 'Dry run - skipping file write');
        return {
          success: true,
          itemCount: xmlItems.length,
          changedItems: items.length,
          duration: Date.now() - startTime,
        };
      }

      // 3. Ensure directories exist
      await this.ensureDirectories();

      // 4. Archive existing feed
      if (!options?.skipArchive) {
        await this.archiveExistingFeed();
      }

      // 5. Write XML file
      const filePath = await this.writeFeed(xmlItems);

      // 6. Update lastSyncedQuantity to reflect synced state
      await this.updateSyncedQuantities(items);

      const duration = Date.now() - startTime;
      this.logger.info({ filePath, itemCount: xmlItems.length, duration }, 'Delta inventory feed generation completed');

      return {
        success: true,
        filePath,
        itemCount: xmlItems.length,
        changedItems: items.length,
        duration,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, stack: err.stack }, 'Delta inventory feed generation failed');

      return {
        success: false,
        itemCount: 0,
        changedItems: 0,
        duration: Date.now() - startTime,
        error: err.message,
      };
    }
  }

  /**
   * Generate full inventory feed using streaming.
   * Processes items in chunks to avoid memory issues with large datasets.
   */
  private async generateStreamingFullFeed(options?: SportdealInventoryFeedOptions): Promise<SportdealInventoryFeedResult> {
    const startTime = Date.now();
    const chunkSize = options?.chunkSize || appConfig.FEED_CHUNK_SIZE;

    this.logger.info({ chunkSize }, 'Starting streaming full inventory feed generation');

    let writer: StreamingFileWriter | null = null;
    const processedSkus: string[] = [];

    try {
      // 1. Get total count
      const totalCount = await this.getTotalCount();
      this.logger.info({ totalCount }, 'Total inventory items to process');

      if (totalCount === 0) {
        this.logger.info('No inventory items found');
        return {
          success: true,
          itemCount: 0,
          changedItems: 0,
          duration: Date.now() - startTime,
        };
      }

      if (options?.dryRun) {
        this.logger.info({ itemCount: totalCount }, 'Dry run - skipping file write');
        return {
          success: true,
          itemCount: totalCount,
          changedItems: totalCount,
          duration: Date.now() - startTime,
        };
      }

      // 2. Ensure directories exist
      await this.ensureDirectories();

      // 3. Archive existing feed
      if (!options?.skipArchive) {
        await this.archiveExistingFeed();
      }

      // 4. Setup streaming writer
      const inventoryDir = this.config.inventoryFeedDirectory ||
        path.join(this.config.feedDirectory, 'inventory');
      const finalPath = path.join(inventoryDir, this.config.inventoryFeedFileName);
      const tempPath = `${finalPath}.${Date.now()}.tmp`;

      writer = await fileUtils.createStreamingWriter(tempPath);

      // 5. Write XML header
      await writer.write('<?xml version="1.0" encoding="UTF-8" ?>\n');
      await writer.write('<root>\n');

      // 6. Process items in chunks
      let processedCount = 0;
      let offset = 0;

      while (processedCount < totalCount) {
        const items = await this.queryItemsChunk(offset, chunkSize);

        if (items.length === 0) {
          break;
        }

        // Transform and write each item
        for (const item of items) {
          const xmlItem = this.transformItem(item);
          await writer.write(this.formatInventoryItemXml(xmlItem));
          processedSkus.push(item.sku);
        }

        processedCount += items.length;
        offset += items.length;

        // Log progress every 10 chunks
        if ((offset / chunkSize) % 10 === 0 || processedCount >= totalCount) {
          this.logger.info(
            { processed: processedCount, total: totalCount, percent: Math.round((processedCount / totalCount) * 100) },
            'Inventory feed generation progress'
          );
        }
      }

      // 7. Write XML footer
      await writer.write('</root>\n');

      // 8. Finalize file
      await writer.finalize(finalPath, false);

      // 9. Update lastSyncedQuantity for all processed items
      await this.updateSyncedQuantitiesBySku(processedSkus);

      const duration = Date.now() - startTime;
      this.logger.info(
        { filePath: finalPath, itemCount: processedCount, duration, bytes: writer.getBytesWritten() },
        'Full inventory feed generation completed'
      );

      return {
        success: true,
        filePath: finalPath,
        itemCount: processedCount,
        changedItems: processedCount,
        duration,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, stack: err.stack }, 'Full inventory feed generation failed');

      // Clean up partial file
      if (writer) {
        await writer.abort();
      }

      return {
        success: false,
        itemCount: 0,
        changedItems: 0,
        duration: Date.now() - startTime,
        error: err.message,
      };
    }
  }

  /**
   * Format a single inventory item as XML string.
   */
  private formatInventoryItemXml(item: SportdealXmlInventoryItem): string {
    return `  <product>
    <sku>${item.sku}</sku>
    <barcode>${item.barcode}</barcode>
    <quantity>${item.quantity}</quantity>
    <price>${item.price}</price>
    <special_price>${item.special_price}</special_price>
  </product>\n`;
  }

  /**
   * Get total count of inventory items.
   */
  private async getTotalCount(): Promise<number> {
    const storeId = this.config.storeId;
    const marketplaceName = 'sportdeal';

    const result = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count
      FROM jsa_MarketplaceListing ml
      WHERE ml.storeId = ${storeId}
        AND ml.marketplaceName = ${marketplaceName}
        AND ml.isActive = 1
    `;

    return Number(result[0].count);
  }

  /**
   * Query a chunk of inventory items.
   */
  private async queryItemsChunk(offset: number, limit: number): Promise<SportdealInventoryItem[]> {
    const storeId = this.config.storeId;
    const marketplaceName = 'sportdeal';

    const items = await prisma.$queryRaw<SportdealInventoryItem[]>`
      SELECT
        ml.ukssSku as sku,
        npv.npv_products_barcodes as barcode,
        ml.ukssQuantity as quantity,
        COALESCE(ml.lastSyncedQuantity, 0) as lastSyncedQuantity,
        ml.ukssPrice as price,
        np.specials_price as specialPrice
      FROM jsa_MarketplaceListing ml
      INNER JOIN new_products_variations npv
        ON npv.npv_products_sku = ml.ukssSku
      INNER JOIN new_products np
        ON np.products_id = npv.npv_products_id
      WHERE ml.storeId = ${storeId}
        AND ml.marketplaceName = ${marketplaceName}
        AND ml.isActive = 1
      ORDER BY ml.id
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return items.map(item => ({
      ...item,
      price: Number(item.price),
      specialPrice: item.specialPrice ? Number(item.specialPrice) : null,
    }));
  }

  /**
   * Update lastSyncedQuantity for processed SKUs.
   */
  private async updateSyncedQuantitiesBySku(skus: string[]): Promise<void> {
    if (skus.length === 0) return;

    const storeId = this.config.storeId;
    const marketplaceName = 'sportdeal';

    // Update in batches
    const batchSize = 1000;
    for (let i = 0; i < skus.length; i += batchSize) {
      const batch = skus.slice(i, i + batchSize);

      await prisma.$executeRaw`
        UPDATE jsa_MarketplaceListing
        SET lastSyncedQuantity = ukssQuantity,
            lastSyncedAt = NOW(),
            lastSyncStatus = 'SYNCED'
        WHERE storeId = ${storeId}
          AND marketplaceName = ${marketplaceName}
          AND ukssSku IN (${Prisma.join(batch)})
      `;
    }

    this.logger.debug({ count: skus.length }, 'Updated lastSyncedQuantity for synced items');
  }

  /**
   * Query items with inventory changes (delta feed).
   * Uses jsa_MarketplaceListing as the source of truth.
   * Returns items where lastSyncedQuantity != ukssQuantity.
   */
  private async queryChangedItems(): Promise<SportdealInventoryItem[]> {
    const storeId = this.config.storeId;
    const marketplaceName = 'sportdeal';

    // Query from marketplace listings table (source of truth)
    const items = await prisma.$queryRaw<SportdealInventoryItem[]>`
      SELECT
        ml.ukssSku as sku,
        npv.npv_products_barcodes as barcode,
        ml.ukssQuantity as quantity,
        COALESCE(ml.lastSyncedQuantity, 0) as lastSyncedQuantity,
        ml.ukssPrice as price,
        np.specials_price as specialPrice
      FROM jsa_MarketplaceListing ml
      INNER JOIN new_products_variations npv
        ON npv.npv_products_sku = ml.ukssSku
      INNER JOIN new_products np
        ON np.products_id = npv.npv_products_id
      WHERE ml.storeId = ${storeId}
        AND ml.marketplaceName = ${marketplaceName}
        AND ml.isActive = 1
        AND (ml.lastSyncedQuantity IS NULL OR ml.lastSyncedQuantity != ml.ukssQuantity)
      ORDER BY np.products_id
    `;

    return items.map(item => ({
      ...item,
      price: Number(item.price),
      specialPrice: item.specialPrice ? Number(item.specialPrice) : null,
    }));
  }

  /**
   * Query all items for full inventory feed.
   * Uses jsa_MarketplaceListing as the source of truth.
   */
  private async queryAllItems(): Promise<SportdealInventoryItem[]> {
    const storeId = this.config.storeId;
    const marketplaceName = 'sportdeal';

    // Query from marketplace listings table (source of truth)
    const items = await prisma.$queryRaw<SportdealInventoryItem[]>`
      SELECT
        ml.ukssSku as sku,
        npv.npv_products_barcodes as barcode,
        ml.ukssQuantity as quantity,
        COALESCE(ml.lastSyncedQuantity, 0) as lastSyncedQuantity,
        ml.ukssPrice as price,
        np.specials_price as specialPrice
      FROM jsa_MarketplaceListing ml
      INNER JOIN new_products_variations npv
        ON npv.npv_products_sku = ml.ukssSku
      INNER JOIN new_products np
        ON np.products_id = npv.npv_products_id
      WHERE ml.storeId = ${storeId}
        AND ml.marketplaceName = ${marketplaceName}
        AND ml.isActive = 1
      ORDER BY np.products_id
    `;

    return items.map(item => ({
      ...item,
      price: Number(item.price),
      specialPrice: item.specialPrice ? Number(item.specialPrice) : null,
    }));
  }

  /**
   * Transform inventory item to XML format.
   */
  private transformItem(item: SportdealInventoryItem): SportdealXmlInventoryItem {
    return {
      sku: item.sku,
      barcode: item.barcode || '',
      quantity: item.quantity,
      price: String(item.price),
      special_price: item.specialPrice ? String(item.specialPrice) : '',
    };
  }

  /**
   * Update lastSyncedQuantity in marketplace listings table after feed generation.
   * This marks items as synced.
   */
  private async updateSyncedQuantities(items: SportdealInventoryItem[]): Promise<void> {
    if (items.length === 0) return;

    const storeId = this.config.storeId;
    const marketplaceName = 'sportdeal';
    const skus = items.map(item => item.sku);

    // Update in batches to avoid query size limits
    const batchSize = 1000;
    for (let i = 0; i < skus.length; i += batchSize) {
      const batch = skus.slice(i, i + batchSize);

      await prisma.$executeRaw`
        UPDATE jsa_MarketplaceListing
        SET lastSyncedQuantity = ukssQuantity,
            lastSyncedAt = NOW(),
            lastSyncStatus = 'SYNCED'
        WHERE storeId = ${storeId}
          AND marketplaceName = ${marketplaceName}
          AND ukssSku IN (${Prisma.join(batch)})
      `;
    }

    this.logger.debug({ count: items.length }, 'Updated lastSyncedQuantity for synced items');
  }

  /**
   * Ensure all required directories exist.
   */
  private async ensureDirectories(): Promise<void> {
    const inventoryDir = this.config.inventoryFeedDirectory ||
      path.join(this.config.feedDirectory, 'inventory');

    await fileUtils.ensureDir(inventoryDir);

    // Archive directory for inventory feeds
    const archiveDir = path.join(inventoryDir, 'Archive');
    await fileUtils.ensureDir(archiveDir);
  }

  /**
   * Archive existing inventory feed file if it exists.
   */
  private async archiveExistingFeed(): Promise<void> {
    const inventoryDir = this.config.inventoryFeedDirectory ||
      path.join(this.config.feedDirectory, 'inventory');
    const currentFile = path.join(inventoryDir, this.config.inventoryFeedFileName);

    if (await fileUtils.exists(currentFile)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const baseName = this.config.inventoryFeedFileName.replace('.xml', '');
      const archiveName = `${baseName}_${timestamp}.xml`;
      const archiveDir = path.join(inventoryDir, 'Archive');
      const archivePath = path.join(archiveDir, archiveName);

      await fileUtils.ensureDir(archiveDir);
      await fileUtils.moveFile(currentFile, archivePath);

      this.logger.debug({ from: currentFile, to: archivePath }, 'Archived existing inventory feed');
    }
  }

  /**
   * Write XML inventory feed file.
   */
  private async writeFeed(items: SportdealXmlInventoryItem[]): Promise<string> {
    const inventoryDir = this.config.inventoryFeedDirectory ||
      path.join(this.config.feedDirectory, 'inventory');
    const filePath = path.join(inventoryDir, this.config.inventoryFeedFileName);

    // Use temp file for atomic write
    const tempPath = `${filePath}.${Date.now()}.tmp`;

    // Build XML content
    const xmlLines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" ?>',
      '<root>',
    ];

    for (const item of items) {
      xmlLines.push('  <product>');
      xmlLines.push(`    <sku>${item.sku}</sku>`);
      xmlLines.push(`    <barcode>${item.barcode}</barcode>`);
      xmlLines.push(`    <quantity>${item.quantity}</quantity>`);
      xmlLines.push(`    <price>${item.price}</price>`);
      xmlLines.push(`    <special_price>${item.special_price}</special_price>`);
      xmlLines.push('  </product>');
    }

    xmlLines.push('</root>');

    const xmlContent = xmlLines.join('\n');

    // Ensure directory exists
    await fileUtils.ensureDir(path.dirname(tempPath));

    // Write to temp file
    await fileUtils.writeFile(tempPath, xmlContent);

    // Move to final location
    await fileUtils.moveFile(tempPath, filePath);

    this.logger.info({ filePath, itemCount: items.length }, 'Inventory feed file written');
    return filePath;
  }
}

/**
 * Create a Sportdeal inventory feed generator instance.
 */
export function createSportdealInventoryFeedGenerator(
  config: SportdealConfig,
  logger?: Logger
): SportdealInventoryFeedGenerator {
  return new SportdealInventoryFeedGenerator(config, logger);
}
