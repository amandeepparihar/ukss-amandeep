/**
 * Daily Deals Cron Service
 *
 * Shared business logic for the midnight cron job.
 * Called by both CLI command and POST /run-cron API endpoint.
 *
 * Steps:
 * 1. Deactivate expired DAILY deals
 * 2. Activate today's scheduled DAILY deals
 * 3. Rollover: fill remaining slots (up to 10) from previous day's deals by stock/discount priority
 * 4. Update category mappings (clean slate for DAILY_DEAL_CATEGORY_ID)
 */

import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { config } from '../../config';

const logger = createLogger('daily-deals-cron');

interface CountRow { total: string | number; }
interface DealRow {
  deal_id: number;
  target_id: number;
  discount_type: string;
  discount_value: number | string;
  total_stock: string | number;
}

function toNumber(val: string | number | bigint | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

export interface CronResult {
  date: string;
  deactivated: number;
  activated: number;
  rolledOver: number;
  totalActive: number;
  categoryMapped: number;
  updateBitReset: number;
  dryRun: boolean;
  log: string[];
}

export async function runDailyDealsCron(options: {
  date?: string;
  dryRun?: boolean;
} = {}): Promise<CronResult> {
  // Use Europe/London timezone (BST/GMT) to match server cron schedule,
  // since new Date().toISOString() returns UTC which is 1 hour behind BST
  const targetDate = options.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const dryRun = options.dryRun || false;
  const categoryId = config.DAILY_DEAL_CATEGORY_ID;

  const log: string[] = [];
  const addLog = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    log.push(line);
    logger.info(msg);
  };

  addLog(`Daily Deals Cron Started (date: ${targetDate}, dryRun: ${dryRun})`);
  addLog(`Timezone debug — UTC now: ${new Date().toISOString()}, London now: ${new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })} ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London' })}, targetDate picked: ${targetDate}`);

  if (!categoryId) {
    addLog('ERROR: DAILY_DEAL_CATEGORY_ID not configured. Aborting.');
    return { date: targetDate, deactivated: 0, activated: 0, rolledOver: 0, totalActive: 0, categoryMapped: 0, updateBitReset: 0, dryRun, log };
  }

  // Calculate yesterday
  const yesterday = new Date(targetDate + 'T12:00:00'); // noon to avoid DST edge cases
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  addLog(`Yesterday date: ${yesterdayStr} (for rollover candidates)`);

  // ---------- Step 1: Deactivate expired deals ----------
  // Count first, then update
  const deactivateCountRows = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT COUNT(*) AS total FROM deals_management
    WHERE deal_type = 'DAILY' AND end_date < ? AND is_active = 1
  `, targetDate);
  const deactivated = toNumber(deactivateCountRows[0]?.total);

  if (!dryRun && deactivated > 0) {
    await prisma.$queryRawUnsafe(`
      UPDATE deals_management
      SET is_active = 0, deal_status = 'PAST', updated_at = NOW()
      WHERE deal_type = 'DAILY'
        AND end_date < ?
        AND is_active = 1
    `, targetDate);
  }
  addLog(`Step 1: Deactivated ${deactivated} expired deals`);

  // ---------- Step 2: Activate today's scheduled deals ----------
  // Count first, then update
  const activateCountRows = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT COUNT(*) AS total FROM deals_management
    WHERE deal_type = 'DAILY' AND start_date <= ? AND end_date >= ? AND to_be_active = 1
  `, targetDate, targetDate);
  const activated = toNumber(activateCountRows[0]?.total);

  if (!dryRun && activated > 0) {
    await prisma.$queryRawUnsafe(`
      UPDATE deals_management
      SET is_active = 1, to_be_active = 0, deal_status = 'CURRENT', updated_at = NOW()
      WHERE deal_type = 'DAILY'
        AND start_date <= ?
        AND end_date >= ?
        AND to_be_active = 1
    `, targetDate, targetDate);
  }
  addLog(`Step 2: Activated ${activated} scheduled deals for ${targetDate}`);

  // ---------- Step 3: Count active & rollover if needed ----------
  const activeCountRows = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT COUNT(*) AS total FROM deals_management
    WHERE deal_type = 'DAILY' AND is_active = 1
      AND start_date <= ? AND end_date >= ?
  `, targetDate, targetDate);
  let activeCount = toNumber(activeCountRows[0]?.total);

  let rolledOver = 0;
  if (activeCount < 10) {
    const needed = 10 - activeCount;
    addLog(`Step 3: Need ${needed} more deals (${activeCount}/10 active). Checking rollover candidates from ${yesterdayStr}`);

    // Get previous day's deals sorted by stock (actual_sms_quantity) then discount
    // Sort by stock DESC, then actual discount amount DESC
    // PERCENT: actual_discount = products_price * discount_value / 100
    // FIXED: actual_discount = discount_value
    const candidates = await prisma.$queryRawUnsafe<DealRow[]>(`
      SELECT dm.deal_id, dm.target_id, dm.discount_type, dm.discount_value,
             COALESCE(np.actual_sms_quantity, 0) AS total_stock
      FROM deals_management dm
      LEFT JOIN new_products np ON dm.target_id = np.products_id
      WHERE dm.deal_type = 'DAILY'
        AND dm.end_date = ?
        AND dm.deal_status = 'PAST'
        AND dm.target_id NOT IN (
          SELECT target_id FROM deals_management
          WHERE deal_type = 'DAILY' AND is_active = 1
            AND start_date <= ? AND end_date >= ?
        )
      ORDER BY COALESCE(np.actual_sms_quantity, 0) DESC,
        CASE
          WHEN dm.discount_type = 'PERCENT' THEN COALESCE(np.products_price, 0) * dm.discount_value / 100
          ELSE dm.discount_value
        END DESC
      LIMIT ?
    `, yesterdayStr, targetDate, targetDate, needed);

    if (candidates.length === 0) {
      addLog(`Step 3: No rollover candidates found from ${yesterdayStr}`);
    } else {
      for (const deal of candidates) {
        if (!dryRun) {
          await prisma.$queryRawUnsafe(`
            UPDATE deals_management
            SET end_date = ?, is_active = 1, deal_status = 'CURRENT', updated_at = NOW()
            WHERE deal_id = ? AND deal_type = 'DAILY'
          `, targetDate, deal.deal_id);
        }
        addLog(`Step 3: Rolled over deal_id=${deal.deal_id} (product ${deal.target_id}, stock=${toNumber(deal.total_stock)}, discount=${deal.discount_type} ${toNumber(deal.discount_value)})`);
        rolledOver++;
      }
    }
    activeCount += rolledOver;
  } else {
    addLog(`Step 3: No rollover needed (${activeCount}/10 active)`);
  }

  // ---------- Step 4: Update category mappings (clean slate) ----------
  let categoryMapped = 0;
  let updateBitReset = 0;
  if (!dryRun) {
    // 4a. Capture products CURRENTLY in Daily Deals category (before DELETE)
    const oldCategoryProducts = await prisma.$queryRawUnsafe<{ products_id: number }[]>(`
      SELECT products_id FROM products_to_categories WHERE categories_id = ?
    `, categoryId);
    const oldProductIds = new Set(oldCategoryProducts.map(r => r.products_id));

    // 4b. Delete all products from Daily Deals category
    await prisma.$queryRawUnsafe(`
      DELETE FROM products_to_categories
      WHERE categories_id = ?
    `, categoryId);

    // 4c. Insert active deals into category
    await prisma.$queryRawUnsafe(`
      INSERT INTO products_to_categories (products_id, categories_id)
      SELECT DISTINCT target_id, ?
      FROM deals_management
      WHERE deal_type = 'DAILY'
        AND is_active = 1
        AND start_date <= ?
        AND end_date >= ?
      ON DUPLICATE KEY UPDATE products_id = products_id
    `, categoryId, targetDate, targetDate);

    // 4d. Capture products NOW in Daily Deals category (after INSERT)
    const newCategoryProducts = await prisma.$queryRawUnsafe<{ products_id: number }[]>(`
      SELECT products_id FROM products_to_categories WHERE categories_id = ?
    `, categoryId);
    const newProductIds = new Set(newCategoryProducts.map(r => r.products_id));

    // 4e. Union of old + new = all affected products
    const affectedProductIds = new Set([...oldProductIds, ...newProductIds]);

    // 4f. Set products_to_categories_update_bit = 0 so UKSS fill_products_to_categories_np_table job picks them up
    if (affectedProductIds.size > 0) {
      const idArray = Array.from(affectedProductIds);
      const placeholders = idArray.map(() => '?').join(',');
      await prisma.$queryRawUnsafe(`
        UPDATE new_products
        SET products_to_categories_update_bit = 0
        WHERE products_id IN (${placeholders})
      `, ...idArray);
      updateBitReset = idArray.length;
    }

    categoryMapped = newProductIds.size;
  } else {
    const mappedRows = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT COUNT(DISTINCT target_id) AS total FROM deals_management
      WHERE deal_type = 'DAILY' AND is_active = 1
        AND start_date <= ? AND end_date >= ?
    `, targetDate, targetDate);
    categoryMapped = toNumber(mappedRows[0]?.total);
  }
  addLog(`Step 4: Category mappings updated — ${categoryMapped} products in Daily Deals category (${categoryId})`);
  addLog(`Step 4: Reset products_to_categories_update_bit for ${updateBitReset} affected products`);

  addLog(`Daily Deals Cron Completed: deactivated=${deactivated}, activated=${activated}, rolledOver=${rolledOver}, totalActive=${activeCount}, categoryMapped=${categoryMapped}, updateBitReset=${updateBitReset}`);

  return {
    date: targetDate,
    deactivated,
    activated,
    rolledOver,
    totalActive: activeCount,
    categoryMapped,
    updateBitReset,
    dryRun,
    log,
  };
}
