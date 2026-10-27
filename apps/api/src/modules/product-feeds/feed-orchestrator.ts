/**
 * Product Feeds - Top-level Orchestrator
 *
 * `generateAllFeeds(options)` is the single entry point invoked by
 * both the CLI command and the cron runner. It performs the full
 * pipeline:
 *
 *   1. Load reference data in parallel (sales, weekend offers,
 *      currencies, shipping, additional data, team types)
 *   2. Query `product_variation_view` in chunks and pipe each chunk
 *      through the product builder, accumulating the full product
 *      array and the FIFA `productTeams` lookup
 *   3. For each (feedType × country), generate an XML file
 *   4. Apply FIFA filter + generate FIFA feeds for every country
 *   5. Generate the marketplace CSV (UK-only, GBP)
 *   6. Compress feeds: UK + US `_all` keep both `.xml` and `.xml.gz`;
 *      all others become `.xml.gz` only. Marketplace CSV -> `.gz` + delete.
 *   7. Upload to Google (all `_all.xml.gz` + FIFA) and Microsoft (UK + US `_all` only)
 *   8. Email the final `FeedRunReport`
 *
 * CLI options (`--dry-run`, `--skip-upload`, `--skip-compress`,
 * `--skip-image-color`, `--country`, `--type`, `--limit`,
 * `--chunk-size`) are honoured at the corresponding steps.
 *
 * PHP source: ukss-feed/build_data.php (the driver loop lines 1-449).
 */

import path from 'node:path';
import {
  loadActiveSales,
  loadWeekendOffers,
  loadCurrencyRates,
  loadShippingMethods,
  loadTeamTypes,
  loadPlayerOverrides,
  checkDeals,
} from './data/index.js';
import { buildProducts } from './product-builder.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import type { ProductVariationRow } from './product-feeds.types.js';
import { filterFifaWorldCupProducts } from './fifa-filter.js';
import {
  generateXmlFeed,
  generateMarketplaceCsv,
  compressFile,
  compressAndKeepOriginal,
  type XmlFeedOptions,
} from './generators/index.js';
import { uploadToGoogle, uploadToMicrosoft, sendFeedReport } from './upload/index.js';
import {
  COUNTRIES_LIST,
  EU_COUNTRIES,
  WEBSITE_ROOT,
} from './product-feeds.constants.js';
import { getProductFeedsConfig } from './product-feeds.config.js';
import { createLogger } from '../../lib/logger.js';
import { fileUtils } from '../marketplaces/utils/file.utils.js';
import type {
  ProcessedProduct,
  ProductTeamInfo,
  FeedFileResult,
  FeedGenerationOptions,
  FeedRunReport,
  UploadResult,
  CountryCode,
  FeedType,
  ShippingMethod,
} from './product-feeds.types.js';
import type { ShippingEntry } from './generators/xml-feed-generator.js';

const logger = createLogger('product-feeds-orchestrator');

const ALL_FEED_TYPES: readonly FeedType[] = ['all', 'facebook', 'shoptimized'];

/** Map a country code to its feed-file basename, e.g. UK -> "UK-United-Kingdom". */
function feedBasename(country: CountryCode): string {
  const info = COUNTRIES_LIST[country];
  return `${country}-${info.file}`;
}

/** Build the `ShippingEntry[]` slice for a given country feed. */
function buildShippingForCountry(
  country: CountryCode,
  shippingMap: Map<string, ShippingMethod[]>,
): ShippingEntry[] {
  if (country === 'UK') {
    return [{ countryCode: 'UK', methods: shippingMap.get('GB') ?? [] }];
  }
  if (country === 'EU') {
    return EU_COUNTRIES.map((c) => ({
      countryCode: c,
      methods: shippingMap.get(c) ?? [],
    }));
  }
  return [{ countryCode: country, methods: shippingMap.get(country) ?? [] }];
}

/**
 * Snapshot-consistent product load + build.
 *
 * Wraps every chunked SELECT in a single `$transaction` with
 * REPEATABLE READ isolation so all chunks read from one consistent
 * InnoDB snapshot — matching PHP's single PDO cursor semantics.
 *
 * Why we still chunk inside the transaction:
 *   - A single `SELECT * FROM product_variation_view` returns ~475k rows
 *     and trips Prisma's NAPI string-conversion limit ("Failed to
 *     convert rust String into napi string") because of the wide
 *     `description`/`additional_img` columns.
 *   - Chunking at 10k rows keeps each round-trip well under that limit
 *     while the surrounding transaction guarantees snapshot stability.
 *
 * Why this fixes the cross-run drift:
 *   - Without the transaction, each `prisma.$queryRawUnsafe` opens its
 *     own session. MySQL is free to pick a different optimiser plan
 *     each time, and the view's row population shifts as inventory
 *     changes, dropping ~593 rows per run in production.
 *   - Inside the transaction, MVCC pins the read view at the first
 *     statement. Subsequent chunks see the same snapshot, no plan
 *     drift, no inventory drift.
 *
 * REPEATABLE READ does NOT lock any tables — concurrent INSERT/UPDATE
 * on `new_products`, `new_products_variations`, etc. are unaffected.
 * The cost is undo-log retention for the transaction's duration
 * (~3-5 minutes in practice). Abhinav Gautam
 */
async function loadAndBuildProducts(
  options: FeedGenerationOptions,
  deps: Omit<Parameters<typeof buildProducts>[1], 'processedProducts'>,
): Promise<{
  products: ProcessedProduct[];
  productTeams: Map<string, ProductTeamInfo>;
  rowsProcessed: number;
}> {
  const CHUNK = 10_000;
  const cap = options.limit ?? Number.POSITIVE_INFINITY;

  const fetchStart = Date.now();
  const allRows = await prisma.$transaction(
    async (tx) => {
      const collected: ProductVariationRow[] = [];
      let offset = 0;
      while (collected.length < cap) {
        const safeLimit = Math.min(CHUNK, cap - collected.length);
        const batch = await tx.$queryRawUnsafe<ProductVariationRow[]>(
          `SELECT * FROM product_variation_view LIMIT ${Math.floor(safeLimit)} OFFSET ${Math.floor(offset)}`,
        );
        if (batch.length === 0) break;
        collected.push(...batch);
        offset += batch.length;
        if (batch.length < safeLimit) break;
      }
      return collected;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      // 30 minutes -- prod feed run takes ~5 min over LAN; generous slack
      // covers occasional DB stalls without rolling back the snapshot.
      timeout: 30 * 60_000,
      maxWait: 60_000,
    },
  );
  logger.info(
    { rowCount: allRows.length, fetchMs: Date.now() - fetchStart },
    'Product rows fetched (snapshot)',
  );

  const processedProducts = new Set<number>();
  const depsWithState = { ...deps, processedProducts };

  const buildStart = Date.now();
  const { products, productTeams } = await buildProducts(allRows, depsWithState);
  logger.info(
    { productCount: products.length, buildMs: Date.now() - buildStart },
    'Product build complete',
  );

  return { products, productTeams, rowsProcessed: allRows.length };
}

/** Compress a completed XML file per the PHP's UK/US-keep-original rule. */
async function compressFeed(
  filePath: string,
  keepOriginal: boolean,
): Promise<{ path: string; bytes: number }> {
  const gzPath = keepOriginal
    ? await compressAndKeepOriginal(filePath)
    : await compressFile(filePath);
  // Use fs.stat to get final size
  const { stat } = await import('node:fs/promises');
  const { size } = await stat(gzPath);
  return { path: gzPath, bytes: size };
}

/**
 * Generate a single XML file for one (country × feedType) pair.
 * Returns the un-compressed `FeedFileResult`; compression happens in
 * a later pass so it can be skipped via `--skip-compress`.
 */
async function generateOneXml(params: {
  products: ProcessedProduct[];
  outputDir: string;
  currencyRate: number;
  shippingMap: Map<string, ShippingMethod[]>;
  country: CountryCode;
  feedType: FeedType;
  suffix: 'all' | 'facebook' | 'shoptimized' | 'fifa-world-cup';
}): Promise<FeedFileResult> {
  const { products, outputDir, currencyRate, shippingMap, country, feedType, suffix } = params;
  const fileName = `${feedBasename(country)}_${suffix}.xml`;
  const filePath = path.join(outputDir, fileName);
  const shipping = buildShippingForCountry(country, shippingMap);

  const opts: XmlFeedOptions = {
    products,
    filePath,
    currencyRate,
    shipping,
    country,
    feedType,
  };

  return generateXmlFeed(opts);
}

/**
 * Main entry point.
 */
export async function generateAllFeeds(
  options: FeedGenerationOptions = {},
): Promise<FeedRunReport> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const errors: string[] = [];
  const feedsGenerated: FeedFileResult[] = [];
  const uploads: UploadResult[] = [];

  const config = getProductFeedsConfig();
  const outputDir = config.outputDir;

  logger.info(
    {
      dryRun: options.dryRun,
      skipUpload: options.skipUpload,
      skipCompress: options.skipCompress,
      country: options.country,
      type: options.type,
      limit: options.limit,
    },
    'Product feeds run starting',
  );

  await fileUtils.ensureDir(outputDir);

  // --- 1. Load reference data in parallel --------------------------
  logger.info('Loading reference data');
  const [
    activeSales,
    weekendOffers,
    currencyRates,
    shippingMethods,
    teamTypes,
    playerOverrides,
  ] = await Promise.all([
    loadActiveSales(),
    loadWeekendOffers(),
    loadCurrencyRates(),
    loadShippingMethods(),
    loadTeamTypes(),
    loadPlayerOverrides(),
  ]);

  // --- 2. Build products chunk-by-chunk ----------------------------
  logger.info('Building products');
  const { products, productTeams, rowsProcessed } = await loadAndBuildProducts(
    options,
    {
      activeSales,
      weekendOffers,
      dealCategoryIds: config.dealCategoryIds,
      checkDealsFn: checkDeals,
      teamTypes,
      playerOverrides,
      cdnUrl: config.cdnUrl,
      currentSeason: config.currentSeason,
      skipImageColor: Boolean(options.skipImageColor ?? config.skipImageColor),
      websiteRoot: WEBSITE_ROOT,
    },
  );

  logger.info(
    { rowsProcessed, productCount: products.length },
    'Product build complete',
  );

  if (options.dryRun) {
    logger.info('Dry run -- skipping feed file writes and uploads');
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      productsProcessed: products.length,
      feedsGenerated: [],
      uploads: [],
      dryRun: true,
      errors,
    };
  }

  // --- 3. Generate feeds per (feedType × country) -------------------
  const countries: CountryCode[] = options.country
    ? [options.country]
    : (Object.keys(COUNTRIES_LIST) as CountryCode[]);
  const feedTypes: FeedType[] = options.type
    ? [options.type]
    : [...ALL_FEED_TYPES];

  for (const feedType of feedTypes) {
    if (feedType === 'marketplace') continue; // handled separately below

    // Facebook + shoptimized feeds are UK-only in the PHP.
    const effectiveCountries = feedType === 'all' ? countries : countries.filter((c) => c === 'UK');

    for (const country of effectiveCountries) {
      try {
        const currencyRate =
          currencyRates.get(COUNTRIES_LIST[country].currency) ?? 1;
        const result = await generateOneXml({
          products,
          outputDir,
          currencyRate,
          shippingMap: shippingMethods,
          country,
          feedType,
          suffix: feedType,
        });
        feedsGenerated.push(result);
        logger.info(
          { file: result.file, items: result.itemCount, bytes: result.bytes },
          'XML feed written',
        );
      } catch (err) {
        const msg = `XML generation failed for ${country}/${feedType}: ${(err as Error).message}`;
        errors.push(msg);
        logger.error({ err, country, feedType }, msg);
      }
    }
  }

  // --- 4. FIFA World Cup feeds (one per country) -------------------
  try {
    const fifaProducts = filterFifaWorldCupProducts(
      products,
      productTeams,
      config.currentSeason,
    );
    logger.info({ count: fifaProducts.length }, 'FIFA-filtered product count');

    if (fifaProducts.length > 0) {
      for (const country of countries) {
        const currencyRate =
          currencyRates.get(COUNTRIES_LIST[country].currency) ?? 1;
        const result = await generateOneXml({
          products: fifaProducts,
          outputDir,
          currencyRate,
          shippingMap: shippingMethods,
          country,
          feedType: 'fifa-world-cup',
          suffix: 'fifa-world-cup',
        });
        feedsGenerated.push(result);
      }
    }
  } catch (err) {
    const msg = `FIFA feed generation failed: ${(err as Error).message}`;
    errors.push(msg);
    logger.error({ err }, msg);
  }

  // --- 5. Marketplace CSV (UK only, GBP) ---------------------------
  const marketplaceEnabled = !options.type || options.type === 'marketplace';
  if (marketplaceEnabled) {
    try {
      const csvResult = await generateMarketplaceCsv(products, outputDir);
      feedsGenerated.push(csvResult);
      logger.info({ file: csvResult.file, items: csvResult.itemCount }, 'Marketplace CSV written');
    } catch (err) {
      const msg = `Marketplace CSV failed: ${(err as Error).message}`;
      errors.push(msg);
      logger.error({ err }, msg);
    }
  }

  // --- 6. Compress -------------------------------------------------
  if (!options.skipCompress) {
    logger.info('Compressing feeds');
    const KEEP_ORIGINAL = new Set([
      'UK-United-Kingdom_all.xml',
      'US-United-States-of-America_all.xml',
    ]);
    for (const feed of feedsGenerated) {
      try {
        if (feed.file.endsWith('.csv')) {
          // Marketplace CSV -> .gz + delete original (matches marketplace.php).
          const { path: gzPath, bytes } = await compressFeed(feed.path, false);
          feed.compressed = true;
          feed.path = gzPath;
          feed.file = path.basename(gzPath);
          feed.bytes = bytes;
        } else if (feed.file.endsWith('.xml')) {
          const keepOriginal = KEEP_ORIGINAL.has(feed.file);
          const { path: gzPath, bytes } = await compressFeed(feed.path, keepOriginal);
          if (keepOriginal) {
            // record the gz copy as an additional feed entry for the report
            feedsGenerated.push({
              file: path.basename(gzPath),
              path: gzPath,
              bytes,
              itemCount: feed.itemCount,
              compressed: true,
            });
          } else {
            feed.compressed = true;
            feed.path = gzPath;
            feed.file = path.basename(gzPath);
            feed.bytes = bytes;
          }
        }
      } catch (err) {
        const msg = `Compression failed for ${feed.file}: ${(err as Error).message}`;
        errors.push(msg);
        logger.error({ err, file: feed.file }, msg);
      }
    }
  }

  // --- 7. Upload ---------------------------------------------------
  if (!options.skipUpload) {
    try {
      const google = await uploadToGoogle(outputDir, config.google);
      uploads.push(google);
    } catch (err) {
      errors.push(`Google upload failed: ${(err as Error).message}`);
    }
    try {
      const microsoft = await uploadToMicrosoft(outputDir, config.microsoft);
      uploads.push(microsoft);
    } catch (err) {
      errors.push(`Microsoft upload failed: ${(err as Error).message}`);
    }
  }

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  const report: FeedRunReport = {
    startedAt,
    completedAt,
    durationMs,
    productsProcessed: products.length,
    feedsGenerated,
    uploads,
    dryRun: false,
    errors,
  };

  // --- 8. Email ----------------------------------------------------
  try {
    await sendFeedReport(report, config.emailRecipients);
  } catch (err) {
    logger.error({ err }, 'Feed report email failed (non-fatal)');
  }

  logger.info(
    {
      durationMs,
      products: report.productsProcessed,
      feeds: report.feedsGenerated.length,
      uploads: report.uploads.length,
      errorCount: report.errors.length,
    },
    'Product feeds run complete',
  );

  return report;
}
