#!/usr/bin/env node
/**
 * CLI script to update Fruugo orders statuses
 *
 * Usage:
 *   pnpm update-fruugo-orders-status --help
 */
import { Command } from 'commander';
import { prisma } from '../lib/prisma';
import { updateFruugoOrderStatusesToFruugo } from '../modules/fruugo/fruugo-status-update-service';

const program = new Command();

program
    .name('update-fruugo-orders-status')
    .description('Update orders statuses to Fruugo')
    .version('1.0.0')
    .action(async () => {

        // Validate fetchType
        console.log(`\nUpdating Fruugo orders statuses...`);

        try {

            const result = await updateFruugoOrderStatusesToFruugo();

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
