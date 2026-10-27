/**
 * Sportdeal Feed Generator
 *
 * Generates XML product feed for Sportdeal marketplace.
 * Sportdeal pulls the feed from the configured directory.
 *
 * Uses streaming for large datasets to avoid memory issues.
 */

import path from 'node:path';
import { prisma } from '../../../../lib/prisma';
import { config as appConfig } from '../../../../config';
import { createLogger, type Logger } from '../../../../lib/logger';
import { xmlUtils, fileUtils, StreamingFileWriter } from '../../utils';
import type { SportdealConfig } from './sportdeal.config';
import type {
  SportdealProductRow,
  SportdealXmlProduct,
  SportdealFeedResult,
  SportdealFeedOptions,
} from './sportdeal.types';

/**
 * Sportdeal product feed generator.
 * Queries products from SMS database and generates XML feed file.
 */
export class SportdealFeedGenerator {
  private readonly config: SportdealConfig;
  private readonly logger: Logger;

  constructor(config: SportdealConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger ?? createLogger('sportdeal-feed-generator');
  }

  /**
   * Generate Sportdeal product feed using streaming.
   * Processes products in chunks to avoid memory issues with large datasets.
   */
  async generate(options?: SportdealFeedOptions): Promise<SportdealFeedResult> {
    const startTime = Date.now();
    const chunkSize = options?.chunkSize || appConfig.FEED_CHUNK_SIZE;

    this.logger.info(
      { dryRun: options?.dryRun, chunkSize },
      'Starting Sportdeal product feed generation (streaming)'
    );

    let writer: StreamingFileWriter | null = null;

    try {
      // 1. Get total count for progress tracking
      const totalCount = await this.getTotalCount();
      this.logger.info({ totalCount }, 'Total products to process');

      if (totalCount === 0) {
        this.logger.warn('No products found for Sportdeal feed');
        return {
          success: true,
          itemCount: 0,
          duration: Date.now() - startTime,
        };
      }

      // If dry run, just count and return
      if (options?.dryRun) {
        const effectiveCount = options?.limit ? Math.min(options.limit, totalCount) : totalCount;
        this.logger.info({ rowCount: effectiveCount }, 'Dry run - skipping file write');
        return {
          success: true,
          itemCount: effectiveCount,
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
      const finalPath = path.join(this.config.feedDirectory, this.config.productFeedFileName);
      const tempPath = this.config.tempDirectory
        ? path.join(this.config.tempDirectory, `${this.config.productFeedFileName}.${Date.now()}.tmp`)
        : `${finalPath}.tmp`;

      writer = await fileUtils.createStreamingWriter(tempPath);

      // 5. Write XML header
      await writer.write('<?xml version="1.0" encoding="UTF-8" ?>\n');
      await writer.write('<root>\n');

      // 6. Process products in chunks
      let processedCount = 0;
      let offset = 0;
      const maxItems = options?.limit || totalCount;

      while (processedCount < maxItems) {
        const remainingItems = maxItems - processedCount;
        const currentChunkSize = Math.min(chunkSize, remainingItems);

        const products = await this.queryProductsChunk(offset, currentChunkSize);

        if (products.length === 0) {
          break; // No more products
        }

        // Transform and write each product
        for (const product of products) {
          const xmlProduct = this.transformProduct(product);
          await writer.write(this.formatProductXml(xmlProduct));
        }

        processedCount += products.length;
        offset += products.length;

        // Log progress every 10 chunks
        if ((offset / chunkSize) % 10 === 0 || processedCount >= maxItems) {
          this.logger.info(
            { processed: processedCount, total: maxItems, percent: Math.round((processedCount / maxItems) * 100) },
            'Feed generation progress'
          );
        }
      }

      // 7. Write XML footer
      await writer.write('</root>\n');

      // 8. Finalize (move temp to final)
      await writer.finalize(finalPath, false); // Already archived above

      const duration = Date.now() - startTime;
      this.logger.info(
        { filePath: finalPath, itemCount: processedCount, duration, bytes: writer.getBytesWritten() },
        'Feed generation completed'
      );

      return {
        success: true,
        filePath: finalPath,
        itemCount: processedCount,
        duration,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, stack: err.stack }, 'Feed generation failed');

      // Clean up partial file
      if (writer) {
        await writer.abort();
      }

      return {
        success: false,
        itemCount: 0,
        duration: Date.now() - startTime,
        error: err.message,
      };
    }
  }

  /**
   * Format a single product as XML string.
   */
  private formatProductXml(product: SportdealXmlProduct): string {
    return `  <product>
    <sku>${product.sku}</sku>
    <barcode>${product.barcode}</barcode>
    <name>${product.name}</name>
    <description>${product.description}</description>
    <brand>${product.brand}</brand>
    <price>${product.price}</price>
    <special_price>${product.special_price}</special_price>
    <quantity>${product.quantity}</quantity>
    <size>${product.size}</size>
    <color>${product.color}</color>
    <gender>${product.gender}</gender>
    <season>${product.season}</season>
    <image>${product.image}</image>
    <category>${product.category}</category>
  </product>\n`;
  }

  /**
   * Get total count of products for feed.
   */
  private async getTotalCount(): Promise<number> {
    const storeId = this.config.storeId;
    const marketplaceName = 'sportdeal';

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
  private async queryProductsChunk(offset: number, limit: number): Promise<SportdealProductRow[]> {
    const storeId = this.config.storeId;
    const marketplaceName = 'sportdeal';

    const products = await prisma.$queryRaw<SportdealProductRow[]>`
      SELECT
        ml.ukssSku as npv_products_sku,
        npv.npv_products_barcodes,
        npv.npv_products_name,
        ml.ukssQuantity as npv_quantities,
        npv.sportdeal_quantity,
        np.products_id,
        np.manufacturers_name,
        np.products_image,
        np.products_description,
        np.np_color,
        np.np_gender,
        np.np_season,
        ml.ukssPrice as products_price,
        np.specials_price,
        pov.products_options_values_name,
        pov.shortname
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
   * Transform database row to Sportdeal XML format.
   */
  private transformProduct(row: SportdealProductRow): SportdealXmlProduct {
    const price = Number(row.products_price);
    const specialPrice = row.specials_price ? Number(row.specials_price) : null;

    return {
      sku: row.npv_products_sku,
      barcode: row.npv_products_barcodes || '',
      name: this.cleanText(row.npv_products_name),
      description: this.cleanDescription(row.products_description),
      brand: row.manufacturers_name || 'no brand',
      price: String(price),
      special_price: specialPrice ? String(specialPrice) : '',
      quantity: row.npv_quantities,
      size: this.formatSize(row),
      color: row.np_color || 'N/A',
      gender: row.np_gender || '',
      season: row.np_season || '',
      image: this.formatImageUrl(row.products_image),
      category: row.categories_name || 'Football',
    };
  }

  /**
   * Clean text - remove problematic characters for XML.
   */
  private cleanText(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .trim();
  }

  /**
   * Clean product description.
   * - Strip HTML tags
   * - Remove special characters
   * - Normalize whitespace
   * - Escape XML entities
   */
  private cleanDescription(desc: string | null): string {
    if (!desc) return '';

    return desc
      // Strip HTML tags
      .replace(/<[^>]*>/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
      // Escape XML entities
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
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
   * Format size for XML.
   * - Max 50 characters
   * - Use shortname if original is too long
   */
  private formatSize(row: SportdealProductRow): string {
    let size = row.products_options_values_name || '';

    // Use shortname if original is too long
    if (size.length > 50 && row.shortname) {
      size = row.shortname;
    }

    // Truncate if still too long
    if (size.length > 50) {
      size = size.substring(0, 50);
    }

    return this.cleanText(size);
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
    const currentFile = path.join(this.config.feedDirectory, this.config.productFeedFileName);

    if (await fileUtils.exists(currentFile)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const baseName = this.config.productFeedFileName.replace('.xml', '');
      const archiveName = `${baseName}_${timestamp}.xml`;
      const archiveDir = this.config.archiveDirectory || path.join(this.config.feedDirectory, 'Archive');
      const archivePath = path.join(archiveDir, archiveName);

      await fileUtils.ensureDir(archiveDir);
      await fileUtils.moveFile(currentFile, archivePath);

      this.logger.debug({ from: currentFile, to: archivePath }, 'Archived existing feed');
    }
  }
}

/**
 * Create a Sportdeal feed generator instance.
 */
export function createSportdealFeedGenerator(config: SportdealConfig, logger?: Logger): SportdealFeedGenerator {
  return new SportdealFeedGenerator(config, logger);
}
