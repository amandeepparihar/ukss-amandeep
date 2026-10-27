/**
 * SportDeal Feed Client
 * 
 * Handles XML inventory feed generation for SportDeal marketplace
 * 
 * @taskId #164914
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { getLogger } from '../../logger-context';
import type { ListingNeedingSync } from '../common/types';
import type { 
  SportdealInventoryItem, 
  SportdealFeedOptions, 
  SportdealFeedResult 
} from './types';
import { config } from '../../../config';

/**
 * SportDeal feed client
 * Generates XML inventory feeds with delta sync support
 */
export class SportdealClient {
  private readonly feedDir: string;
  private readonly feedFileName: string = 'sportdeal_inventory.xml';

  constructor() {
    // Feed directory from environment or default
    this.feedDir = config.SPORTDEAL_FEED_DIR || path.join(process.cwd(), 'feed', 'sportdeal_feed', 'inventory');
    
    getLogger().info(
      { feedDir: this.feedDir },
      'SportDeal client initialized'
    );
  }

  /**
   * Generate XML inventory feed from listings
   * 
   * @taskId #164914
   * @param listings - Listings to include in feed
   * @param options - Feed generation options
   */
  async generateInventoryFeed(
    listings: ListingNeedingSync[],
    options?: SportdealFeedOptions
  ): Promise<SportdealFeedResult> {
    const startTime = Date.now();
    const logger = getLogger();

    try {
      logger.info({ listingCount: listings.length }, 'Starting SportDeal inventory feed generation');

      // Transform listings to XML items
      const items = listings.map(listing => this.transformListing(listing));

      // Ensure feed directory exists
      await this.ensureDirectory();

      // Generate XML content
      const xmlContent = this.generateXmlContent(items);

      // Write feed file atomically (temp file -> move)
      const outputPath = options?.outputPath || path.join(this.feedDir, this.feedFileName);
      const tempPath = `${outputPath}.tmp`;

      // Write to temp file first (safe - doesn't affect existing feed)
      await fs.writeFile(tempPath, xmlContent, 'utf-8');

      // Archive existing feed ONLY after new feed is successfully written to temp
      // This ensures old feed remains available if write fails
      if (options?.archive !== false) {
        await this.archiveExistingFeed();
      }

      // Atomic rename: replaces old feed with new one
      await fs.rename(tempPath, outputPath);

      const duration = Date.now() - startTime;
      logger.info(
        { filePath: outputPath, itemCount: items.length, duration },
        'SportDeal inventory feed generated successfully'
      );

      return {
        success: true,
        filePath: outputPath,
        itemCount: items.length,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error(
        { error: errorMessage, duration },
        'SportDeal inventory feed generation failed'
      );

      return {
        success: false,
        itemCount: 0,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Transform listing to SportDeal XML item
   * 
   * @taskId #164914
   * Business logic:
   * - Use current_price (which is already special_price if active, otherwise regular price)
   * - Use normalized_quantity (respects quantity cap configuration)
   * - Use GTIN from listing data (priority: gtin > ean > upc)
   */
  private transformListing(listing: ListingNeedingSync): SportdealInventoryItem {
    // Get barcode/GTIN (priority order: gtin > ean > upc)
    const gtin = listing.gtin || listing.ean || listing.upc || '';

    return {
      id: listing.products_sku,
      price: String(listing.current_price),
      gtin,
      qty: listing.normalized_quantity,
    };
  }

  /**
   * Generate XML content from items
   * 
   * @taskId #164914
   * Format matches requirement:
   * <root>
   *   <item>
   *     <id>SKU123</id>
   *     <price>19.99</price>
   *     <gtin>1234567890123</gtin>
   *     <qty>50</qty>
   *   </item>
   * </root>
   */
  private generateXmlContent(items: SportdealInventoryItem[]): string {
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<root>',
    ];

    for (const item of items) {
      lines.push('  <item>');
      lines.push(`    <id>${this.escapeXml(item.id)}</id>`);
      lines.push(`    <price>${item.price}</price>`);
      lines.push(`    <gtin>${this.escapeXml(item.gtin)}</gtin>`);
      lines.push(`    <qty>${item.qty}</qty>`);
      lines.push('  </item>');
    }

    lines.push('</root>');
    
    return lines.join('\n');
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Ensure feed directory and archive directory exist
   */
  private async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.feedDir, { recursive: true });
    await fs.mkdir(path.join(this.feedDir, 'Archive'), { recursive: true });
  }

  /**
   * Archive existing feed file with timestamp
   * 
   * @taskId #164914
   */
  private async archiveExistingFeed(): Promise<void> {
    const logger = getLogger();
    const currentFile = path.join(this.feedDir, this.feedFileName);

    try {
      // Check if file exists
      await fs.access(currentFile);

      // Generate archive filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const baseName = this.feedFileName.replace('.xml', '');
      const archiveName = `${baseName}_${timestamp}.xml`;
      const archivePath = path.join(this.feedDir, 'Archive', archiveName);

      // Move file to archive
      await fs.rename(currentFile, archivePath);

      logger.debug({ from: currentFile, to: archivePath }, 'Archived existing feed file');
    } catch (error) {
      // File doesn't exist or can't be accessed - that's fine
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug('No existing feed file to archive');
      } else {
        logger.warn({ error }, 'Failed to archive existing feed file');
      }
    }
  }

  /**
   * Get feed directory path
   */
  getFeedDirectory(): string {
    return this.feedDir;
  }

  /**
   * Get full path to current feed file
   */
  getFeedFilePath(): string {
    return path.join(this.feedDir, this.feedFileName);
  }
}
