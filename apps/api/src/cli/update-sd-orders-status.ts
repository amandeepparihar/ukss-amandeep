#!/usr/bin/env node

import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { updateSdOrderStatuses } from '../modules/seller-dynamics/sd-status-update.service';

const program = new Command();

program
  .name('update-sd-orders-status')
  .description('Push pending order statuses (Shipped) to Seller Dynamics, email Simon for cancel/reject')
  .version('1.0.0')
  .action(async () => {
    console.log('\nUpdating order statuses to Seller Dynamics...\n');

    try {
      const result = await updateSdOrderStatuses();

      if (result.success) {
        console.log('Success!');
        console.log(`  Processed: ${result.processed}`);
        console.log(`  Succeeded: ${result.succeeded}`);
        console.log(`  Failed: ${result.failed}`);
        process.exit(0);
      } else {
        console.error('Failed!');
        console.error(`  Error: ${result.error}`);
        console.error(`  Processed: ${result.processed}`);
        console.error(`  Succeeded: ${result.succeeded}`);
        console.error(`  Failed: ${result.failed}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse();
