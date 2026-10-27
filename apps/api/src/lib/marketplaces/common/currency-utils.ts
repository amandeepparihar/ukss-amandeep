/**
 * Currency Conversion Utilities
 *
 * Generic currency conversion using the `currencies` table.
 * The `currencies.value` column stores the exchange rate relative to GBP (base currency).
 * For example, if PLN value = 5.20, then 1 GBP = 5.20 PLN.
 *
 * These rates are updated weekly by an existing cron job.
 *
 * @taskId #164358
 */

import { prisma } from '../../prisma';
import { getLogger } from '../../logger-context';

export interface ExchangeRateResult {
  code: string;
  rate: number;
}

/**
 * Get exchange rate for a target currency from the `currencies` table.
 * Rate is relative to GBP: 1 GBP = `rate` units of target currency.
 *
 * @param currencyCode - ISO currency code (e.g., 'PLN', 'EUR', 'USD')
 * @returns The exchange rate
 * @throws Error if the currency code is not found or has no rate
 */
export async function getExchangeRate(currencyCode: string): Promise<ExchangeRateResult> {
  const logger = getLogger('currency-utils');
  const code = currencyCode.toUpperCase().trim();

  if (code === 'GBP') {
    return { code: 'GBP', rate: 1 };
  }

  const currency = await prisma.currency.findFirst({
    where: { code },
    select: { code: true, value: true },
  });

  if (!currency || !currency.value) {
    throw new Error(`Currency '${code}' not found in currencies table or has no exchange rate`);
  }

  const rate = Number(currency.value);

  if (isNaN(rate) || rate <= 0) {
    throw new Error(`Invalid exchange rate for '${code}': ${currency.value}`);
  }

  logger.debug({ code, rate }, 'Exchange rate fetched from currencies table');
  return { code, rate };
}

/**
 * Convert an amount from GBP to a target currency.
 *
 * @param gbpAmount - Amount in GBP
 * @param rate - Exchange rate (1 GBP = rate units of target currency)
 * @returns Converted amount
 */
export function convertFromGbp(gbpAmount: number, rate: number): number {
  return gbpAmount * rate;
}

/**
 * Apply a percentage margin on top of a price.
 *
 * @param amount - Base amount
 * @param marginPercent - Margin percentage (e.g., 10 for 10%)
 * @returns Amount with margin applied
 */
export function applyMarginPercent(amount: number, marginPercent: number): number {
  if (marginPercent === 0) return amount;
  return amount * (1 + marginPercent / 100);
}

/**
 * Full pipeline: convert GBP price to marketplace currency with margin and optional rounding.
 *
 * @param gbpPrice - Price in GBP
 * @param targetCurrency - Target currency code (e.g., 'PLN')
 * @param options - Optional margin and rounding function
 * @returns Converted price, rate used, and currency code
 */
export async function calculateMarketplacePrice(
  gbpPrice: number,
  targetCurrency: string,
  options?: {
    marginPercent?: number;
    roundingFn?: (amount: number) => number;
  }
): Promise<{ price: number; rate: number; currency: string }> {
  const { rate, code } = await getExchangeRate(targetCurrency);

  let price = convertFromGbp(gbpPrice, rate);

  if (options?.marginPercent && options.marginPercent > 0) {
    price = applyMarginPercent(price, options.marginPercent);
  }

  if (options?.roundingFn) {
    price = options.roundingFn(price);
  }

  price = Math.round(price * 100) / 100;

  return { price, rate, currency: code };
}
