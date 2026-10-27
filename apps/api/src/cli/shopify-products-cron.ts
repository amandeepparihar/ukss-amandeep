#!/usr/bin/env node
/**
 * CLI script for shopify products listing crons 
 *
 */
import 'dotenv/config';
import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { runWithExecution } from '../lib/logger-context';
import {
  stageNewProducts, stageNewSizes, refreshPrice, flagStockChange,
  updateTagsAndLabel, enforceInventoryPolicyChange, purgeAllRecords,
} from '../modules/shopify-products-listing/shopify-products-staging.service';

import {
  createProductsShopify, updateProductsDetailOnShopify, updatePriceOnShopify,
  updateInventoryOnShopify, updateProductMetafieldsOnShopify, syncSortOrderOnShopify,
} from '../modules/shopify-products-listing/shopify-products-push.service';


const program = new Command();
program.name('shopify-products-cron');

const run = async (fn: () => Promise<any>) => {
  try {
    await runWithExecution('shopify-products', fn);
  }
  catch (e) {
    console.error(e); process.exit(1);
  }
  finally {
    await prisma.$disconnect();
    process.exit(0);
  }
};

// add products to shopify tables
program.command('stage').requiredOption('--store <id>')
  .action((o) => run(() => stageNewProducts(Number(o.store))));

// add new products variants to shopify tables
program.command('stage-size').requiredOption('--store <id>')
  .action((o) => run(() => stageNewSizes(Number(o.store))));

// refresh products price in table
program.command('refresh-price').action(() => run(() => refreshPrice()));

// flag stock change in table 
program.command('flag-stock').action(() => run(() => flagStockChange()));

// update tags and label in table 
program.command('update-tags').requiredOption('--store <id>')
  .action((o) => run(() => updateTagsAndLabel(Number(o.store))));

// enforce policy and inventory based on dead variants
program.command('enforce-policy').requiredOption('--store <id>')
  .action((o) => run(() => enforceInventoryPolicyChange(Number(o.store))));

// purge old records from history tables 
program.command('purge-logs').action(() => run(() => purgeAllRecords()));

// create products on shopify 
program.command('create').requiredOption('--store <id>')
  .action((o) => run(() => createProductsShopify(Number(o.store))));

// push products details and new sizes on shopify 
program.command('push-detail').requiredOption('--store <id>').option('--all')
  .action((o) => run(() => updateProductsDetailOnShopify(Number(o.store), o.all ? 'all' : undefined)));

// push products price on shopify
program.command('push-price').requiredOption('--store <id>').option('--all')
  .action((o) => run(() => updatePriceOnShopify(Number(o.store), o.all ? 'all' : undefined)));

// push products inventory
program.command('push-inventory').requiredOption('--store <id>')
  .action((o) => run(() => updateInventoryOnShopify(Number(o.store))));

// push metafields on shopify 
program.command('push-metafields').requiredOption('--store <id>').option('--all')
  .action((o) => run(() => updateProductMetafieldsOnShopify(Number(o.store), o.all ? 'all' : undefined)));

// sync products orders inventory
program.command('sync-sort').requiredOption('--store <id>')
  .action((o) => run(() => syncSortOrderOnShopify(Number(o.store))));

program.parse();

