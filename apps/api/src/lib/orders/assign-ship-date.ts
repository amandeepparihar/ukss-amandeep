/**
 * Assign Ship Date — Warehouse SLA Calculator
 *
 * Ported from PHP: app/vendors/assign_ship_date.php
 *
 * Calculates and writes a `ship_by_date` to the `orders` table based on:
 * 1. Whether the order is a printing/personalized order
 * 2. Current time in Europe/London (before or after cutoff)
 * 3. Current day of week in Europe/London (weekday vs weekend)
 *
 * Standard orders: same-day before cutoff (2 PM, 11 AM Monday), next business day after.
 * Printing orders: MAX_PRINTING_DAYS + weekend buffer.
 *
 * All time calculations use Europe/London timezone to match the PHP server behavior.
 *
 * Called by processMarketplaceOrdersToUKSS() after the order transaction completes.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { createLogger, type Logger } from '../logger';
import { detectPrintingOptions } from '../../modules/orders/processing/processing.stock';

const defaultLogger = createLogger('assign-ship-date');

const LONDON_TZ = 'Europe/London';

/** World Cup parent category ID (PHP: zen_get_categories('', '2214')) */
const WORLD_CUP_PARENT_CATEGORY_ID = 2214;

/** Printing flag values */
export const PRINTING_FLAG = {
  STANDARD: 0,
  PRINTING: 1,
  ZERO_STOCK: 2,
} as const;

const DEFAULT_MAX_PRINTING_DAYS = 3;

/**
 * London-local time components — timezone-safe, testable without Date objects.
 * All fields represent Europe/London local time.
 */
export interface LondonTime {
  /** 3-letter English day: Mon, Tue, Wed, Thu, Fri, Sat, Sun */
  day: string;
  /** 24-hour format HH:MM:SS */
  time: string;
  /** YYYY-MM-DD in London local time */
  date: string;
}

/**
 * Extract London-local time components from a Date using Intl API.
 * Handles BST/GMT transitions correctly.
 */
export function getLondonTime(now: Date): LondonTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find(p => p.type === type)?.value || '';

  const day = get('weekday');   // Mon, Tue, ...
  const year = get('year');
  const month = get('month');
  const dayNum = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');

  return {
    day,
    time: `${hour}:${minute}:${second}`,
    date: `${year}-${month}-${dayNum}`,
  };
}

/**
 * Calculate the ship-by date string based on printing status, London day/time.
 *
 * Pure function — no DB access, no Date objects. Returns a MySQL datetime string
 * in London local time, or null if printingFlag=2.
 *
 * @param printingFlag - 0=standard, 1=printing, 2=zero stock (returns null)
 * @param london - Current London-local time components
 * @param maxPrintingDays - Extra days for printing orders (from configuration table)
 * @returns Ship-by date as 'YYYY-MM-DD 23:59:59' in London time, or null
 */
export function calculateShipByDate(
  printingFlag: number,
  london: LondonTime,
  maxPrintingDays: number
): string | null {
  if (printingFlag === PRINTING_FLAG.ZERO_STOCK) {
    return null;
  }

  const CUTOFF_TIME = '14:00:00';
  const MONDAY_CUTOFF_TIME = '11:00:00';

  let daysToAdd: number;

  if (printingFlag === PRINTING_FLAG.STANDARD) {
    daysToAdd = calculateStandardDays(london.day, london.time, CUTOFF_TIME, MONDAY_CUTOFF_TIME);
  } else {
    daysToAdd = calculatePrintingDays(london.day, london.time, CUTOFF_TIME, MONDAY_CUTOFF_TIME, maxPrintingDays);
  }

  return addDaysToDate(london.date, daysToAdd);
}

function calculateStandardDays(
  day: string, currentTime: string, cutoff: string, mondayCutoff: string
): number {
  if (day === 'Mon') {
    return currentTime <= mondayCutoff ? 0 : 1;
  }

  if (currentTime <= cutoff) {
    if (day !== 'Sat' && day !== 'Sun') return 0;
    if (day === 'Sat') return 2;
    return 1; // Sun
  }

  // After cutoff
  if (day !== 'Sat' && day !== 'Sun') {
    return day === 'Fri' ? 3 : 1;
  }
  if (day === 'Sat') return 2;
  return 1; // Sun
}

function calculatePrintingDays(
  day: string, currentTime: string, cutoff: string, mondayCutoff: string,
  plusDays: number
): number {
  if (day === 'Mon') {
    return currentTime <= mondayCutoff ? plusDays : plusDays + 1;
  }

  if (currentTime <= cutoff) {
    if (day !== 'Sat' && day !== 'Sun') {
      if (day === 'Tue') {
        return plusDays > 3 ? plusDays + 2 : plusDays;
      }
      return plusDays + 2;
    }
    if (day === 'Sat') return plusDays + 2;
    return plusDays + 1; // Sun
  }

  // After cutoff
  if (day !== 'Sat' && day !== 'Sun') {
    if (day === 'Tue') {
      return plusDays === 3 ? plusDays + 3 : plusDays + 2;
    }
    return plusDays + 3;
  }
  if (day === 'Sat') return plusDays + 2;
  return plusDays + 1; // Sun
}

/**
 * Add N days to a YYYY-MM-DD date string and return 'YYYY-MM-DD 23:59:59'.
 * Uses pure arithmetic on date parts — no Date object, no DST issues.
 */
function addDaysToDate(dateStr: string, daysToAdd: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Use UTC to avoid any DST shifting when doing date arithmetic
  const d = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd} 23:59:59`;
}

/**
 * Read MAX_PRINTING_DAYS from the configuration table.
 * Logs an error (not just warn) if DB read fails — prevents silent fallback to default.
 */
async function getMaxPrintingDays(logger: Logger): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<Array<{ configuration_value: string }>>(
      Prisma.sql`SELECT configuration_value FROM configuration WHERE configuration_key = 'MAX_PRINTING_DAYS' LIMIT 1`
    );
    if (rows.length > 0 && rows[0].configuration_value) {
      const value = parseInt(rows[0].configuration_value, 10);
      if (!isNaN(value) && value > 0) {
        return value;
      }
      logger.error({ rawValue: rows[0].configuration_value }, 'MAX_PRINTING_DAYS has invalid value in configuration table, using default');
    } else {
      logger.error('MAX_PRINTING_DAYS not found in configuration table, using default');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to read MAX_PRINTING_DAYS from configuration table, using default');
  }
  return DEFAULT_MAX_PRINTING_DAYS;
}

/**
 * Detect whether an order is a printing order by checking all its products.
 *
 * Ported from PHP: assign_ship_date.php → check_printing_orders() and
 * orders_from_marketplace_to_ukss_controller.php (product name check).
 *
 * Per-product checks (matching PHP order):
 * 1. Barcode exists and has stock (zero stock → flag=2 for THIS product, not entire order)
 * 2. Product name for "(Name Number)" pattern
 * 3. orders_products_attributes for printing option IDs (3, 4, 63, 64, 65)
 * 4. Toffs product flag
 * 5. World Cup category (2214 and descendants)
 *
 * Escalation: once flag=1 (printing), it stays 1. Flag=2 only if ALL products have zero stock.
 *
 * @returns 0=standard, 1=printing, 2=zero stock
 */
export async function detectPrintingOrder(orderId: number, logger?: Logger): Promise<number> {
  const log = logger || defaultLogger;

  const products = await prisma.$queryRaw<Array<{
    orders_products_id: number;
    products_id: number;
    products_name: string;
    product_barcode: string;
  }>>(
    Prisma.sql`
      SELECT orders_products_id, products_id, products_name, product_barcode
      FROM orders_products
      WHERE orders_id = ${orderId}
    `
  );

  // Track per-product: if ANY product is printing → order is printing.
  // Only if ALL products are zero-stock → order is zero-stock.
  let hasPrinting = false;
  let allZeroStock = true;

  // Pre-fetch World Cup category IDs (category 2214 + all descendants)
  const worldCupCategories = await getWorldCupCategoryIds(log);

  for (const product of products) {
    // Per-product flag starts at STANDARD
    let productFlag = PRINTING_FLAG.STANDARD;

    // Check barcode exists — empty barcode = zero stock for this product
    if (!product.product_barcode || product.product_barcode === '') {
      // This product is zero stock, but continue checking others
      continue; // allZeroStock remains true unless another product passes
    }

    // Check stock for this barcode
    const stockRows = await prisma.$queryRaw<Array<{ quantity: number }>>(
      Prisma.sql`SELECT COALESCE(SUM(quantity), 0) AS quantity FROM product_quantities WHERE barcode = ${product.product_barcode}`
    );
    if (Number(stockRows[0]?.quantity ?? 0) === 0) {
      // This product is zero stock, continue checking others
      continue;
    }

    // Product has stock — it's not zero-stock
    allZeroStock = false;

    // Check product name for "(Name Number)" pattern
    if (productFlag === PRINTING_FLAG.STANDARD) {
      const name = product.products_name || '';
      const startBracket = name.lastIndexOf('(');
      const endBracket = name.lastIndexOf(')');
      if (startBracket > 0 && endBracket > startBracket) {
        const inner = name.substring(startBracket + 1, endBracket).trim();
        const parts = inner.split(' ');
        if (parts.length >= 2) {
          const lastPart = parts[parts.length - 1];
          if (!isNaN(Number(lastPart)) && lastPart !== '') {
            productFlag = PRINTING_FLAG.PRINTING;
          }
        }
      }
    }

    // Check printing options in attributes (reuse existing function)
    if (productFlag === PRINTING_FLAG.STANDARD) {
      const hasPrintingOptions = await detectPrintingOptions(product.orders_products_id);
      if (hasPrintingOptions) {
        productFlag = PRINTING_FLAG.PRINTING;
      }
    }

    // Check Toffs product
    if (productFlag === PRINTING_FLAG.STANDARD) {
      const toffsRows = await prisma.$queryRaw<Array<{ toffs: string }>>(
        Prisma.sql`SELECT toffs FROM products WHERE products_id = ${product.products_id} LIMIT 1`
      );
      if (toffsRows.length > 0 && toffsRows[0].toffs && toffsRows[0].toffs !== '' && toffsRows[0].toffs !== '0') {
        productFlag = PRINTING_FLAG.PRINTING;
      }
    }

    // Check World Cup category
    if (productFlag === PRINTING_FLAG.STANDARD && worldCupCategories.size > 0) {
      const catRows = await prisma.$queryRaw<Array<{ categories_id: number }>>(
        Prisma.sql`SELECT categories_id FROM products_to_categories WHERE products_id = ${product.products_id}`
      );
      for (const row of catRows) {
        if (worldCupCategories.has(row.categories_id)) {
          productFlag = PRINTING_FLAG.PRINTING;
          break;
        }
      }
    }

    if (productFlag === PRINTING_FLAG.PRINTING) {
      hasPrinting = true;
    }
  }

  let result: number;
  if (hasPrinting) {
    result = PRINTING_FLAG.PRINTING;
  } else if (allZeroStock && products.length > 0) {
    result = PRINTING_FLAG.ZERO_STOCK;
  } else {
    result = PRINTING_FLAG.STANDARD;
  }

  log.debug({ orderId, printingFlag: result }, 'Detected printing flag for order');
  return result;
}

/**
 * Get World Cup category ID (2214) and all its descendant category IDs.
 * Uses a recursive CTE to find all children.
 */
async function getWorldCupCategoryIds(logger: Logger): Promise<Set<number>> {
  try {
    const rows = await prisma.$queryRaw<Array<{ categories_id: number }>>(
      Prisma.sql`
        WITH RECURSIVE cat_tree AS (
          SELECT categories_id FROM categories WHERE categories_id = ${WORLD_CUP_PARENT_CATEGORY_ID}
          UNION ALL
          SELECT c.categories_id FROM categories c
          INNER JOIN cat_tree ct ON c.parent_id = ct.categories_id
        )
        SELECT categories_id FROM cat_tree
      `
    );
    return new Set(rows.map(r => r.categories_id));
  } catch (error) {
    logger.warn({ error }, 'Failed to fetch World Cup category tree, skipping category check');
    return new Set();
  }
}

/**
 * Calculate and write ship_by_date to the orders table.
 *
 * @param orderId - UKSS order ID
 * @param printingFlag - 0=standard, 1=printing, 2=zero stock (skip)
 */
export async function assignShipDate(orderId: number, printingFlag: number, logger?: Logger): Promise<void> {
  const log = logger || defaultLogger;

  if (printingFlag === PRINTING_FLAG.ZERO_STOCK) {
    log.debug({ orderId }, 'Zero stock flag — skipping ship date assignment');
    return;
  }

  const maxPrintingDays = await getMaxPrintingDays(log);
  const london = getLondonTime(new Date());
  const shipByDateStr = calculateShipByDate(printingFlag, london, maxPrintingDays);

  if (!shipByDateStr) {
    log.debug({ orderId }, 'No ship date calculated');
    return;
  }

  await prisma.$executeRaw(
    Prisma.sql`UPDATE orders SET ship_by_date = ${shipByDateStr} WHERE orders_id = ${orderId}`
  );

  log.info({ orderId, shipByDate: shipByDateStr, printingFlag }, 'Ship date assigned');
}
