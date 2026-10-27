#!/usr/bin/env node
/**
 * Stock2 CLI
 *
 * Command-line interface for Stock2 administrative tasks.
 *
 * Usage:
 *   pnpm cli <command> [options]
 *   pnpm cli fruugo generate-feed --dry-run
 *   pnpm cli fruugo sync-inventory --full
 */

// Load environment variables from project root BEFORE any other imports
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root (two levels up from apps/api/src)
const envPath = resolve(__dirname, '../../../.env');
const result = loadEnv({ path: envPath });

if (result.error) {
  console.error(`Failed to load .env from ${envPath}:`, result.error.message);
}

// Now dynamically import the rest to ensure env is loaded first
async function main() {
  const { Command } = await import('commander');
  const { registerDailyDealsCommands } = await import('./modules/daily-deals/cli/daily-deals.commands.js');
  const { registerFruugoCommands, registerSportdealCommands, registerDebenhamsCommands, registerAllegroCommands, registerEbayCommands, registerSellerDynamicsCommands } = await import('./modules/marketplaces/cli/index.js');
  const { registerProductFeedsCommands } = await import('./modules/product-feeds/cli/product-feeds.commands.js');

  const program = new Command();

  program
    .name('stock2')
    .description('Stock2 CLI - Administrative commands for Stock2')
    .version('1.0.0');

  // Register marketplace commands
  registerFruugoCommands(program);
  registerSportdealCommands(program);
  registerAllegroCommands(program);
  registerDebenhamsCommands(program);
  registerEbayCommands(program);
  registerSellerDynamicsCommands(program);

  // Register daily deals commands
  registerDailyDealsCommands(program);

  // Register product feeds commands
  registerProductFeedsCommands(program);

  // Parse and execute
  program.parse(process.argv);

  // Show help if no command specified
  if (!process.argv.slice(2).length) {
    program.outputHelp();
  }
}

main().catch((error) => {
  console.error('CLI Error:', error.message);
  process.exit(1);
});
