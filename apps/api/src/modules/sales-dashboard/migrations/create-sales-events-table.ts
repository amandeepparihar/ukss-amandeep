/**
 * Migration: Create jsa_sales_events table
 *
 * Run: npx tsx apps/api/src/modules/sales-dashboard/migrations/create-sales-events-table.ts
 */
import { prisma } from '../../../lib/prisma';

async function main() {
  console.log('[migration] Creating jsa_sales_events table...');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS jsa_sales_events (
      event_id          INT AUTO_INCREMENT PRIMARY KEY,
      event_name        VARCHAR(255) NOT NULL,
      event_category    ENUM('global', 'continental', 'domestic', 'commercial') NOT NULL,
      event_type        ENUM('recurring_annual', 'recurring_biennial', 'recurring_quadrennial', 'one_off') NOT NULL,
      region            VARCHAR(100) NOT NULL DEFAULT 'Global',
      buying_window_start DATE NOT NULL,
      buying_window_end   DATE NOT NULL,
      event_start_date    DATE NOT NULL,
      event_end_date      DATE NOT NULL,
      year              INT NOT NULL,
      is_active         BOOLEAN NOT NULL DEFAULT TRUE,
      notes             TEXT,
      created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      INDEX idx_category (event_category),
      INDEX idx_dates (buying_window_start, buying_window_end),
      INDEX idx_year (year),
      INDEX idx_active (is_active)
    )
  `);

  console.log('[migration] jsa_sales_events table created successfully.');
}

main()
  .catch((err) => {
    console.error('[migration] Failed to create jsa_sales_events table:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
