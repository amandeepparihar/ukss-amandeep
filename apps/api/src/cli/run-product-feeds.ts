#!/usr/bin/env node
/**
 * Product Feeds Cron CLI Script
 *
 * Generates all product feeds, compresses, uploads to Google Merchant
 * Center + Microsoft Advertising, and emails the summary report.
 *
 * Usage:
 *   node dist/cli/run-product-feeds.js
 *   docker exec admin-api node --max-old-space-size=4096 /app/dist/cli/run-product-feeds.js
 *
 * Env-var overrides for testing / ad-hoc runs (cron can't pass CLI flags):
 *   FEED_LIMIT=100           -> only process first N rows
 *   FEED_SKIP_UPLOAD=1       -> skip SFTP upload
 *   FEED_SKIP_COMPRESS=1     -> skip gzip pass
 *   FEED_SKIP_IMAGE_COLOR=1  -> skip CDN image fetch for colour detection
 *   FEED_DRY_RUN=1           -> build products in memory, write nothing
 *   FEED_COUNTRY=UK          -> single-country run
 *   FEED_TYPE=all            -> single feed-type run (all|facebook|shoptimized)
 *   FEED_CHUNK_SIZE=10000    -> product-rows fetched per DB round-trip
 * Abhinav Gautam
 *
 * Exit code 0 on success (no errors in report), 1 otherwise.
 */

import 'dotenv/config';
import {
  generateAllFeeds,
} from '../modules/product-feeds/feed-orchestrator';
import type {
  CountryCode,
  FeedGenerationOptions,
  FeedType,
} from '../modules/product-feeds/product-feeds.types';
import { prisma } from '../lib/prisma';

function parseBool(v: string | undefined): boolean | undefined {
  if (v == null) return undefined;
  return v === '1' || v.toLowerCase() === 'true';
}

function parseInt_(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function optionsFromEnv(): FeedGenerationOptions {
  const options: FeedGenerationOptions = {};
  const limit = parseInt_(process.env.FEED_LIMIT);
  if (limit !== undefined) options.limit = limit;
  const chunkSize = parseInt_(process.env.FEED_CHUNK_SIZE);
  if (chunkSize !== undefined) options.chunkSize = chunkSize;
  const skipUpload = parseBool(process.env.FEED_SKIP_UPLOAD);
  if (skipUpload !== undefined) options.skipUpload = skipUpload;
  const skipCompress = parseBool(process.env.FEED_SKIP_COMPRESS);
  if (skipCompress !== undefined) options.skipCompress = skipCompress;
  const skipImageColor = parseBool(process.env.FEED_SKIP_IMAGE_COLOR);
  if (skipImageColor !== undefined) options.skipImageColor = skipImageColor;
  const dryRun = parseBool(process.env.FEED_DRY_RUN);
  if (dryRun !== undefined) options.dryRun = dryRun;
  if (process.env.FEED_COUNTRY) options.country = process.env.FEED_COUNTRY as CountryCode;
  if (process.env.FEED_TYPE) options.type = process.env.FEED_TYPE as FeedType;
  return options;
}

async function main(): Promise<void> {
  console.log('Product Feeds Cron');
  console.log('='.repeat(50));

  const options = optionsFromEnv();
  if (Object.keys(options).length > 0) {
    console.log('Options from env:', JSON.stringify(options));
  }

  try {
    const result = await generateAllFeeds(options);

    console.log('');
    console.log('='.repeat(50));
    console.log('Summary:');
    console.log(`  Started:            ${result.startedAt}`);
    console.log(`  Completed:          ${result.completedAt}`);
    console.log(`  Duration:           ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log(`  Products processed: ${result.productsProcessed}`);
    console.log(`  Feeds generated:    ${result.feedsGenerated.length}`);
    for (const upload of result.uploads) {
      console.log(
        `  Upload (${upload.target}): ${upload.filesUploaded} ok, ${upload.filesFailed} failed`,
      );
    }
    if (result.errors.length > 0) {
      console.log(`  Errors:             ${result.errors.length}`);
      for (const err of result.errors) {
        console.log(`    - ${err}`);
      }
    }
    console.log('');

    process.exit(result.errors.length === 0 ? 0 : 1);
  } catch (error) {
    console.error('');
    console.error('PRODUCT FEEDS CRON FAILED');
    console.error('='.repeat(50));
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      if (error.stack) {
        console.error('');
        console.error('Stack trace:');
        console.error(error.stack);
      }
    } else {
      console.error('Unknown error:', error);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

main();
