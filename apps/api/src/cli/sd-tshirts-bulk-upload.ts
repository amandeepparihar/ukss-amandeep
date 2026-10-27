#!/usr/bin/env node

import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { runDailyBulkUpload } from '../modules/sd-tshirts/sd-tshirts.cron';

const program = new Command();

program
  .name('sd-tshirts-bulk-upload')
  .description('Daily bulk upload of approved t-shirts to Seller Dynamics')
  .version('1.0.0')
  .action(async () => {
    console.log('\nRunning Seller Dynamics t-shirts bulk upload...\n');

    try {
      await runDailyBulkUpload();
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
