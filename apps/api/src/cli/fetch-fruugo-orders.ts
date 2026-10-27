#!/usr/bin/env node
/**
 * CLI script to fetch Fruugo orders
 *
 * Usage:
 *   pnpm fetch-fruugo-orders --lastSevenDays true
 *   pnpm fetch-fruugo-orders --staticFromTime <unixSeconds> --staticEndTime <unixSeconds>
 *   pnpm fetch-fruugo-orders --help
 */
import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { getFruugoOrders } from '../modules/fruugo/fruugo-order-service';

const program = new Command();

program
    .name('fetch-fruugo-orders')
    .description('Fetch orders from Fruugo and process them')
    .version('1.0.0')
    .option('-l, --lastSevenDays <string>', 'Fetch last 7 days of orders', 'false')
    .option('--staticFromTime <string>', 'Explicit window start (Unix seconds, UTC). Pass with --staticEndTime for a one-off date-range fetch. Ignored when --lastSevenDays is true.')
    .option('--staticEndTime <string>', 'Explicit window end (Unix seconds, UTC). Pass together with --staticFromTime.')
    .action(async (options) => {
        const { lastSevenDays } = options;

        // Validate fetchType
        console.log(`\nFetching Fruugo orders...`);
        console.log(`  Last 7 Days: ${lastSevenDays}`);

        try {

            // Explicit window from the CLI is used as-is when --lastSevenDays is not 'true'.
            // getFruugoOrders validates the pair (both required, both in the past, from < end);
            // passing neither falls back to the default DB-anchored window.
            let staticFromTime: string | undefined = options.staticFromTime;
            let staticEndTime: string | undefined = options.staticEndTime;

            if (lastSevenDays === 'true') {
                const pastDate = new Date();
                pastDate.setDate(pastDate.getDate() - 7);
                // Convert to Unix timestamp (seconds since epoch) as expected by getFruugoOrders
                staticFromTime = Math.floor(pastDate.getTime() / 1000).toString();
                staticEndTime = Math.floor(Date.now() / 1000).toString();
            }

            console.log(`  Window: from=${staticFromTime ?? '(auto)'} to=${staticEndTime ?? '(auto)'}`);

            const result = await getFruugoOrders(staticFromTime, staticEndTime);

            if (result.success) {
                console.log('Success!');
                console.log(`  Message: ${result.message}`);
                process.exit(0);
            } else {
                console.error('Failed!');
                console.error(`  Error: ${result.message}`);
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
