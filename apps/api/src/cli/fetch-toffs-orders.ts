/**
 * CLI script to fetch TOFFS orders
 *
 * Usage:
 *   pnpm fetch-toffs-orders --orderId 1234567890
 *   pnpm fetch-toffs-orders --help
 */

import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { getToffsOrders } from '../modules/toffs/toffs-orders.service';

const program = new Command();

program
    .name('fetch-toffs-orders')
    .description('Fetch orders from TOFFS (Magento2) and save in Marketplace orders and marketplace order products tables')
    .version('1.0.0')
    .option('-o, --orderId <id>', 'Order ID to fetch from TOFFS (Magento2)', parseInt)
    .action(async (options) => {
        const { orderId } = options;

        // validate orderId if present - check it is a valid string
        if (orderId && typeof orderId !== 'string') {
            console.error('Error: orderId must be a string');
            process.exit(1);
        }

        console.log(`\nFetching TOFFS orders...`);
        console.log(`  Order ID: ${orderId}`);

        try {
            const result = await getToffsOrders(orderId || '');

            if (result.success) {
                console.log('Success!');
                console.log(`  Orders fetched: ${result.data.length}`);
                process.exit(0);
            } else {
                console.error('Failed!');
                console.error(`  Error: ${result.error}`);
                process.exit(1);
            }
        } catch (error) {
            console.error('Unexpected error:', error);
            process.exit(1);
        }
        finally {
            await prisma.$disconnect();
        }
    });

program.parse();