#!/usr/bin/env node

import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { runHourlySkuCheck } from '../modules/sd-tshirts/sd-tshirts.cron';

const program = new Command();

program
  .name('sd-tshirts-sku-check')
  .description('Hourly SKU check — updates confirmed t-shirt listings to active on Seller Dynamics')
  .version('1.0.0')
  .action(async () => {
    console.log('\nRunning Seller Dynamics t-shirts SKU check...\n');

    try {
      await runHourlySkuCheck();
      console.log('Success!');
      process.exit(0);
    } catch (error) {
      console.error('Unexpected error:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse();
