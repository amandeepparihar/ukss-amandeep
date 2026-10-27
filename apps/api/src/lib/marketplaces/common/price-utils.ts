/**
 * Price Adjustment Utilities for Marketplace Sync
 * 
 * @taskId #165004
 * 
 * Provides utilities for applying configurable price adjustments
 * to product prices before syncing to marketplaces.
 */

export interface PriceAdjustmentResult {
  basePrice: number;
  priceAdjustment: number;
  adjustedPrice: number;
  isValid: boolean;
  error?: string;
}

/**
 * @taskId #165004
 * 
 * Applies a price adjustment to a base price for marketplace sync.
 * 
 * Performs validation to ensure the adjusted price is positive.
 * 
 * @param basePrice - The original product price (before adjustment)
 * @param rawAdjustment - The price adjustment value (can be positive or negative)
 * @param minPrice - Minimum allowed price (default: 0.01)
 * @returns Result object with base, adjustment, adjusted price, and validation status
 * 
 * @example
 * ```typescript
 * const result = applyPriceAdjustment(20.00, 5.00);
 * if (result.isValid) {
 *   // Use result.adjustedPrice (25.00)
 * }
 * ```
 */
export function applyPriceAdjustment(
  basePrice: number,
  rawAdjustment: unknown,
  minPrice: number = 0.01
): PriceAdjustmentResult {
  // Coerce to number: Prisma raw queries return DECIMAL columns as Prisma.Decimal
  // instances (or strings on some drivers), so basePrice may not be a JS number even
  // though typed as one. Without this, `basePrice + priceAdjustment` would do string
  // concatenation or NaN arithmetic.
  const numericBase = Number(basePrice);
  const priceAdjustment = Number(rawAdjustment) || 0;
  const adjustedPrice = numericBase + priceAdjustment;

  // Validate that adjusted price is positive
  if (adjustedPrice < minPrice) {
    return {
      basePrice: numericBase,
      priceAdjustment,
      adjustedPrice,
      isValid: false,
      error: `Price adjustment (${priceAdjustment}) resulted in price below minimum (${adjustedPrice} < ${minPrice})`,
    };
  }

  return {
    basePrice: numericBase,
    priceAdjustment,
    adjustedPrice,
    isValid: true,
  };
}
