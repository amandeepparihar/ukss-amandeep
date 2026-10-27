/**
 * Fruugo Feed Generator
 *
 * Generates CSV product feed for Fruugo marketplace.
 * Fruugo pulls the feed via FTP from the configured directory.
 *
 * Uses streaming for large datasets to avoid memory issues.
 */

import path from 'node:path';
import { prisma } from '../../../../lib/prisma';
import { config as appConfig } from '../../../../config';
import { createLogger, type Logger } from '../../../../lib/logger';
import { csvUtils, fileUtils } from '../../utils';
import type { FruugoConfig } from './fruugo.config';
import type {
  FruugoProductRow,
  FruugoCsvRow,
  FruugoFeedResult,
  FruugoFeedOptions,
  FRUUGO_CSV_HEADERS,
} from './fruugo.types';

/**
 * Fruugo feed generator.
 * Queries products from SMS database and generates CSV feed file.
 */
export class FruugoFeedGenerator {
  private readonly config: FruugoConfig;
  private readonly logger: Logger;

  constructor(config: FruugoConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger ?? createLogger('fruugo-feed-generator');
  }

  /**
   * Generate Fruugo product feed using streaming.
   * Processes products in chunks to avoid memory issues with large datasets.
   */
  async generate(options?: FruugoFeedOptions): Promise<FruugoFeedResult> {
    const startTime = Date.now();
    const chunkSize = options?.chunkSize || appConfig.FEED_CHUNK_SIZE;

    this.logger.info(
      { dryRun: options?.dryRun, chunkSize },
      'Starting Fruugo feed generation (streaming)'
    );

    try {
      // 1. Get total count for progress tracking
      const totalCount = await this.getTotalCount();
      this.logger.info({ totalCount }, 'Total products to process');

      if (totalCount === 0) {
        this.logger.warn('No products found for Fruugo feed');
        return {
          success: true,
          itemCount: 0,
          duration: Date.now() - startTime,
        };
      }

      // Handle limit option
      const maxItems = options?.limit ? Math.min(options.limit, totalCount) : totalCount;

      if (options?.dryRun) {
        this.logger.info({ rowCount: maxItems }, 'Dry run - skipping file write');
        return {
          success: true,
          itemCount: maxItems,
          duration: Date.now() - startTime,
        };
      }

      // 2. Ensure directories exist
      await this.ensureDirectories();

      // 3. Archive existing feed
      if (!options?.skipArchive) {
        await this.archiveExistingFeed();
      }

      // 4. Write CSV file using streaming
      const filePath = path.join(this.config.feedDirectory, 'product_datafeed.csv');
      const tempPath = this.config.tempDirectory
        ? path.join(this.config.tempDirectory, `product_datafeed_${Date.now()}.csv`)
        : `${filePath}.tmp`;

      // Create generator function for streaming
      const self = this;
      async function* rowGenerator() {
        let offset = 0;
        let processedCount = 0;

        while (processedCount < maxItems) {
          const currentChunkSize = Math.min(chunkSize, maxItems - processedCount);
          const products = await self.queryProductsChunk(offset, currentChunkSize);

          if (products.length === 0) {
            break;
          }

          for (const product of products) {
            const row = self.transformProduct(product);
            yield self.csvRowToArray(row);
            processedCount++;
          }

          offset += products.length;

          // Log progress every 10 chunks
          if ((offset / chunkSize) % 10 === 0 || processedCount >= maxItems) {
            self.logger.info(
              { processed: processedCount, total: maxItems, percent: Math.round((processedCount / maxItems) * 100) },
              'Feed generation progress'
            );
          }
        }
      }

      // Get headers
      const headers = this.getCsvHeaders();

      // Write using streaming
      await fileUtils.ensureDir(path.dirname(tempPath));
      const rowCount = await csvUtils.writeFileStreaming(tempPath, headers, rowGenerator);

      // Move temp to final location
      await fileUtils.moveFile(tempPath, filePath);

      const duration = Date.now() - startTime;
      this.logger.info({ filePath, itemCount: rowCount, duration }, 'Feed generation completed');

      return {
        success: true,
        filePath,
        itemCount: rowCount,
        duration,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, stack: err.stack }, 'Feed generation failed');

      // Clean up temp file on error
      const tempPath = this.config.tempDirectory
        ? path.join(this.config.tempDirectory, `product_datafeed_${Date.now()}.csv`)
        : path.join(this.config.feedDirectory, 'product_datafeed.csv.tmp');
      await fileUtils.deleteFile(tempPath).catch(() => {});

      return {
        success: false,
        itemCount: 0,
        duration: Date.now() - startTime,
        error: err.message,
      };
    }
  }

  /**
   * Get CSV headers for Fruugo feed.
   */
  private getCsvHeaders(): string[] {
    return [
      'ProductId',
      'SkuId',
      'EAN',
      'ISBN',
      'Brand',
      'Manufacturer',
      'Category',
      'Imageurl1',
      'StockStatus',
      'StockQuantity',
      'RestockDate',
      'LeadTime',
      'PackageWeight',
      'Language',
      'Title',
      'Description',
      'AttributeColor',
      'AttributeSize',
      'Currency',
      'Country',
      'NormalPriceWithVAT',
      'VATRate',
    ];
  }

  /**
   * Convert CSV row object to array for streaming.
   */
  private csvRowToArray(row: FruugoCsvRow): unknown[] {
    return [
      row.ProductId,
      row.SkuId,
      row.EAN,
      row.ISBN,
      row.Brand,
      row.Manufacturer,
      row.Category,
      row.Imageurl1,
      row.StockStatus,
      row.StockQuantity,
      row.RestockDate,
      row.LeadTime,
      row.PackageWeight,
      row.Language,
      row.Title,
      row.Description,
      row.AttributeColor,
      row.AttributeSize,
      row.Currency,
      row.Country,
      row.NormalPriceWithVAT,
      row.VATRate,
    ];
  }

  /**
   * Get total count of products for feed.
   */
  private async getTotalCount(): Promise<number> {
    const storeId = this.config.storeId;
    const marketplaceName = 'fruugo';

    const result = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count
      FROM jsa_MarketplaceListing ml
      INNER JOIN new_products_variations npv
        ON npv.npv_products_sku = ml.ukssSku
      INNER JOIN new_products np
        ON np.products_id = npv.npv_products_id
      WHERE ml.storeId = ${storeId}
        AND ml.marketplaceName = ${marketplaceName}
        AND ml.isActive = 1
    `;

    return Number(result[0].count);
  }

  /**
   * Query a chunk of products for feed.
   */
  private async queryProductsChunk(offset: number, limit: number): Promise<FruugoProductRow[]> {
    const storeId = this.config.storeId;
    const marketplaceName = 'fruugo';

    const products = await prisma.$queryRaw<FruugoProductRow[]>`
      SELECT
        ml.ukssQuantity as fruugo_quantity,
        np.products_id,
        np.manufacturers_name,
        np.virtual_product_type_id,
        np.products_image,
        np.fruugo_category_path,
        ml.ukssSku as npv_products_sku,
        npv.npv_products_barcodes,
        npv.npv_products_name,
        np.products_description,
        np.np_color,
        np.np_sizeguide,
        pov.products_options_values_name,
        pov.shortname,
        ml.ukssPrice as products_price,
        np.specials_price,
        npv.npv_size_options_value_id
      FROM jsa_MarketplaceListing ml
      INNER JOIN new_products_variations npv
        ON npv.npv_products_sku = ml.ukssSku
      INNER JOIN new_products np
        ON np.products_id = npv.npv_products_id
      INNER JOIN products_options_values pov
        ON pov.products_options_values_id = npv.npv_size_options_value_id
      WHERE ml.storeId = ${storeId}
        AND ml.marketplaceName = ${marketplaceName}
        AND ml.isActive = 1
      ORDER BY np.products_id
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return products;
  }

  /**
   * Transform database row to Fruugo CSV format.
   */
  private transformProduct(row: FruugoProductRow): FruugoCsvRow {
    const price = row.specials_price ?? row.products_price;
    const priceNum = typeof price === 'object' ? Number(price) : price;

    return {
      ProductId: `p-${row.products_id}`,
      SkuId: row.npv_products_sku,
      EAN: row.npv_products_barcodes || '',
      ISBN: '',
      Brand: row.manufacturers_name || 'no brand',
      Manufacturer: '',
      Category: this.formatCategory(row.fruugo_category_path),
      Imageurl1: this.formatImageUrl(row.products_image),
      StockStatus: row.fruugo_quantity > 0 ? 'INSTOCK' : 'OUTOFSTOCK',
      StockQuantity: row.fruugo_quantity,
      RestockDate: '',
      LeadTime: this.calculateLeadTime(row),
      PackageWeight: '',
      Language: 'en',
      Title: this.cleanProductName(row.npv_products_name),
      Description: this.cleanDescription(row.products_description),
      AttributeColor: row.np_color || 'N/A',
      AttributeSize: this.formatSize(row),
      Currency: 'GBP',
      Country: '',
      NormalPriceWithVAT: priceNum.toFixed(2),
      VATRate: this.calculateVatRate(row),
    };
  }

  /**
   * Format category path for CSV (wrap in quotes).
   */
  private formatCategory(categoryPath: string | null): string {
    if (!categoryPath || categoryPath.trim() === '') {
      return '"N/A"';
    }
    // Already wrap in quotes for CSV
    return `"${categoryPath}"`;
  }

  /**
   * Format image URL with CDN base.
   */
  private formatImageUrl(image: string | null): string {
    if (!image) return '';
    // Remove leading slash if present
    const cleanImage = image.startsWith('/') ? image.slice(1) : image;
    return `${this.config.cdnUrl}/${cleanImage}`;
  }

  /**
   * Calculate lead time based on product type.
   * - Airo Sportswear: 10 days
   * - Virtual type 4: 3 days
   * - Virtual type 1: 4 days
   * - Default: 4 days
   */
  private calculateLeadTime(row: FruugoProductRow): number {
    // Airo Sportswear products take longer
    if (row.manufacturers_name?.toLowerCase().includes('airo')) {
      return 10;
    }

    // Virtual product types have different lead times
    if (row.virtual_product_type_id === 4) {
      return 3;
    }

    return 4;
  }

  /**
   * Calculate VAT rate.
   * Kids products have 0% VAT, standard is 20%.
   */
  private calculateVatRate(row: FruugoProductRow): number {
    if (
      row.np_sizeguide &&
      this.config.kidsSizeGuides.includes(row.np_sizeguide)
    ) {
      return 0;
    }
    return 20;
  }

  /**
   * Clean product name - remove quotes.
   */
  private cleanProductName(name: string): string {
    return name.replace(/"/g, '').trim();
  }

  /**
   * Clean product description.
   * - Strip HTML tags
   * - Remove special characters (except . , : ; ' ( ) & % # $ / -)
   * - Normalize whitespace
   */
  private cleanDescription(desc: string | null): string {
    if (!desc) return '';

    return desc
      // Strip HTML tags
      .replace(/<[^>]*>/g, '')
      // Remove slashes (per SMS implementation)
      .replace(/\//g, '')
      // Remove special chars except allowed ones
      .replace(/[^\w\s.,;:'()&%#$-]/g, '')
      // Normalize whitespace (multiple spaces to single)
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Format size for CSV.
   * - Max 30 characters
   * - Use shortname if original is too long
   * - Replace " with " inch"
   */
  private formatSize(row: FruugoProductRow): string {
    let size = row.products_options_values_name || '';

    // Use shortname if original is too long
    if (size.length > 30 && row.shortname) {
      size = row.shortname;
    }

    // Truncate if still too long
    if (size.length > 30) {
      size = size.substring(0, 30);
    }

    // Replace double quotes with " inch"
    size = size.replace(/"/g, ' inch');

    return size;
  }

  /**
   * Ensure all required directories exist.
   */
  private async ensureDirectories(): Promise<void> {
    await fileUtils.ensureDir(this.config.feedDirectory);
    if (this.config.tempDirectory) {
      await fileUtils.ensureDir(this.config.tempDirectory);
    }
    if (this.config.archiveDirectory) {
      await fileUtils.ensureDir(this.config.archiveDirectory);
    }
  }

  /**
   * Archive existing feed file if it exists.
   */
  private async archiveExistingFeed(): Promise<void> {
    const currentFile = path.join(this.config.feedDirectory, 'product_datafeed.csv');

    if (await fileUtils.exists(currentFile)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const archiveName = `product_datafeed_${timestamp}.csv`;
      const archiveDir = this.config.archiveDirectory || path.join(this.config.feedDirectory, 'archive');
      const archivePath = path.join(archiveDir, archiveName);

      await fileUtils.ensureDir(archiveDir);
      await fileUtils.moveFile(currentFile, archivePath);

      this.logger.debug({ from: currentFile, to: archivePath }, 'Archived existing feed');
    }
  }
}

/**
 * Create a Fruugo feed generator instance.
 */
export function createFruugoFeedGenerator(config: FruugoConfig, logger?: Logger): FruugoFeedGenerator {
  return new FruugoFeedGenerator(config, logger);
}
