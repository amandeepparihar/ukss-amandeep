/**
 * Fruugo SKU Sync
 *
 * Fetches Fruugo SKU IDs from their Listings API and updates local database.
 * This maps merchant SKUs to Fruugo's internal SKU IDs.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../../lib/prisma';
import { createLogger, type Logger } from '../../../../lib/logger';
import { HttpClient, xmlUtils } from '../../utils';
import type { FruugoConfig } from './fruugo.config';
import type {
  FruugoSkuMapping,
  FruugoListingsResponse,
  FruugoListingsSku,
  FruugoSkuSyncResult,
  FruugoSkuSyncOptions,
} from './fruugo.types';

/**
 * Fruugo SKU sync service.
 * Fetches SKU mappings from Fruugo and updates local database.
 */
export class FruugoSkuSync {
  private readonly config: FruugoConfig;
  private readonly httpClient: HttpClient;
  private readonly logger: Logger;

  constructor(config: FruugoConfig, httpClient: HttpClient, logger?: Logger) {
    this.config = config;
    this.httpClient = httpClient;
    this.logger = logger ?? createLogger('fruugo-sku-sync');
  }

  /**
   * Sync SKU IDs from Fruugo.
   */
  async sync(options?: FruugoSkuSyncOptions): Promise<FruugoSkuSyncResult> {
    const startTime = Date.now();

    this.logger.info(
      { pageFrom: options?.pageFrom, pageTo: options?.pageTo, dryRun: options?.dryRun },
      'Starting Fruugo SKU sync'
    );

    try {
      // 1. Fetch first page to get total pages
      const firstPageXml = await this.fetchPage(1);
      const totalPages = this.getTotalPages(firstPageXml);

      const pageFrom = options?.pageFrom ?? 1;
      const pageTo = options?.pageTo ?? totalPages;

      this.logger.info(
        { totalPages, pageFrom, pageTo },
        'Fetching SKU listings from Fruugo'
      );

      // 2. Fetch all pages
      const allMappings: FruugoSkuMapping[] = [];

      // Parse first page
      if (pageFrom === 1) {
        allMappings.push(...this.parseMappings(firstPageXml));
      }

      // Fetch remaining pages in parallel batches
      const pagesToFetch: number[] = [];
      for (let page = Math.max(pageFrom, 2); page <= pageTo; page++) {
        pagesToFetch.push(page);
      }

      const pageBatches = this.chunk(pagesToFetch, this.config.parallelPages);

      for (const batch of pageBatches) {
        const results = await Promise.all(
          batch.map((page) => this.fetchPage(page).catch((err) => {
            this.logger.error({ page, error: err.message }, 'Failed to fetch page');
            return null;
          }))
        );

        for (const xml of results) {
          if (xml) {
            allMappings.push(...this.parseMappings(xml));
          }
        }

        this.logger.debug(
          { pagesProcessed: batch, mappingsFound: allMappings.length },
          'Processed page batch'
        );
      }

      this.logger.info(
        { totalMappings: allMappings.length },
        'All SKU mappings fetched'
      );

      if (options?.dryRun) {
        this.logger.info('Dry run - skipping database update');
        return {
          success: true,
          pagesFetched: pageTo - pageFrom + 1,
          totalMappings: allMappings.length,
          recordsUpdated: 0,
          recordsFailed: 0,
          duration: Date.now() - startTime,
        };
      }

      // 3. Update database
      const { updated, failed } = await this.updateDatabase(allMappings);

      const duration = Date.now() - startTime;

      this.logger.info(
        { recordsUpdated: updated, recordsFailed: failed, duration },
        'Fruugo SKU sync completed'
      );

      return {
        success: failed === 0,
        pagesFetched: pageTo - pageFrom + 1,
        totalMappings: allMappings.length,
        recordsUpdated: updated,
        recordsFailed: failed,
        duration,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, stack: err.stack }, 'SKU sync failed');

      return {
        success: false,
        pagesFetched: 0,
        totalMappings: 0,
        recordsUpdated: 0,
        recordsFailed: 0,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Fetch a single page from Fruugo listings API.
   */
  private async fetchPage(pageNumber: number): Promise<string> {
    const url = `${this.config.listingsApiUrl}${pageNumber}`;

    this.logger.debug({ page: pageNumber, url }, 'Fetching page');

    const response = await this.httpClient.get<string>(url);

    if (response.status !== 200) {
      throw new Error(`Fruugo API returned status ${response.status} for page ${pageNumber}`);
    }

    return response.data;
  }

  /**
   * Get total pages from XML response.
   */
  getTotalPages(xmlContent: string): number {
    try {
      const parsed = xmlUtils.parse<any>(xmlContent, {
        attributeNamePrefix: '@',
        ignoreAttributes: false,
      });

      // Fruugo response structure: <skus numberOfPages="242.0" ...>
      const numberOfPages = parsed.skus?.['@numberOfPages'];

      if (!numberOfPages) {
        this.logger.error(
          { parsedKeys: Object.keys(parsed), skusKeys: parsed.skus ? Object.keys(parsed.skus) : 'no skus' },
          'numberOfPages attribute not found'
        );
        throw new Error('numberOfPages attribute not found in response');
      }

      // numberOfPages might be a float string like "242.0", parse as int
      return Math.ceil(parseFloat(numberOfPages));
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message }, 'Failed to parse total pages');
      throw new Error(`Failed to parse total pages: ${err.message}`);
    }
  }

  /**
   * Parse SKU mappings from XML response.
   */
  parseMappings(xmlContent: string): FruugoSkuMapping[] {
    try {
      const parsed = xmlUtils.parse<any>(xmlContent, {
        attributeNamePrefix: '@',
        ignoreAttributes: false,
      });

      // Fruugo response structure: <skus><sku ...>...</sku></skus>
      if (!parsed.skus?.sku) {
        return [];
      }

      // Handle single or multiple SKU elements
      const skus: FruugoListingsSku[] = Array.isArray(parsed.skus.sku)
        ? parsed.skus.sku
        : [parsed.skus.sku];

      return skus
        .filter((sku) => sku['@fruugoSkuId'] && sku['@merchantSkuId'])
        .map((sku) => ({
          fruugoSkuId: sku['@fruugoSkuId'],
          merchantSkuId: sku['@merchantSkuId'],
          quantity: parseInt(sku.itemsInStock || '0', 10),
        }));
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message }, 'Failed to parse SKU mappings');
      return [];
    }
  }

  /**
   * Update database with SKU mappings.
   */
  private async updateDatabase(
    mappings: FruugoSkuMapping[]
  ): Promise<{ updated: number; failed: number }> {
    if (mappings.length === 0) {
      return { updated: 0, failed: 0 };
    }

    const chunks = this.chunk(mappings, this.config.skuSyncBatchSize);
    let totalUpdated = 0;
    let totalFailed = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      try {
        const updated = await this.executeBatchUpdate(chunk);
        totalUpdated += updated;

        this.logger.debug(
          { chunkIndex: i + 1, totalChunks: chunks.length, updated },
          'Processed database update chunk'
        );
      } catch (error) {
        const err = error as Error;
        totalFailed += chunk.length;

        this.logger.error(
          { chunkIndex: i + 1, error: err.message },
          'Database update chunk failed'
        );
      }
    }

    return { updated: totalUpdated, failed: totalFailed };
  }

  /**
   * Execute batch update to jsa_marketplacelisting table.
   * Updates externalSkuId with Fruugo's SKU ID.
   */
  private async executeBatchUpdate(mappings: FruugoSkuMapping[]): Promise<number> {
    if (mappings.length === 0) return 0;

    const merchantSkus = mappings.map((m) => m.merchantSkuId);

    // Build the CASE expression for externalSkuId
    let caseStatement = 'CASE ukssSku';
    for (const mapping of mappings) {
      // Escape single quotes in SKU values
      const escapedSku = mapping.merchantSkuId.replace(/'/g, "''");
      const escapedFruugoId = mapping.fruugoSkuId.replace(/'/g, "''");
      caseStatement += ` WHEN '${escapedSku}' THEN '${escapedFruugoId}'`;
    }
    caseStatement += ' ELSE externalSkuId END';

    // Build IN clause for merchant SKUs
    const inClause = merchantSkus
      .map((sku) => `'${sku.replace(/'/g, "''")}'`)
      .join(', ');

    // Execute raw SQL update on jsa_marketplacelisting
    const query = `
      UPDATE jsa_marketplacelisting
      SET
        externalSkuId = ${caseStatement},
        lastSyncedAt = NOW()
      WHERE marketplaceName = 'fruugo'
        AND ukssSku IN (${inClause})
    `;

    const result = await prisma.$executeRawUnsafe(query);
    return Number(result);
  }

  /**
   * Split array into chunks.
   */
  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}

/**
 * Create Fruugo SKU sync instance.
 */
export function createFruugoSkuSync(
  config: FruugoConfig,
  httpClient: HttpClient,
  logger?: Logger
): FruugoSkuSync {
  return new FruugoSkuSync(config, httpClient, logger);
}
