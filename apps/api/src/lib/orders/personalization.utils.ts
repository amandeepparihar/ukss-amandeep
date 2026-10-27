/**
 * Personalization extra-info contract shared by marketplace order integrations.
 *
 * Every marketplace parses its own customisation format, but they all persist the
 * result in mop_marketplace_order_products.mop_extra_info using the SAME JSON shape.
 * Stage 2 (marketplace-orders.service.ts) reads `name`, `number` and `price` from it
 * and writes the "Other Name & Number" attribute onto the UKSS order product.
 *
 * Keep the key names stable — changing them silently stops personalisation reaching
 * the printing paperwork.
 */

export interface PersonalizationNameNumber {
  name: string;
  number: string;
}

/**
 * Build the mop_extra_info JSON string for a personalised line item.
 *
 * Returns null when there is nothing worth recording, so callers can leave the
 * column NULL rather than storing an empty object.
 *
 * @param parsed  name/number extracted from the marketplace's own notes format
 * @param extra   marketplace-specific keys to merge in (e.g. the raw source string).
 *                Stage 2 ignores unknown keys; they exist for audit/debugging.
 */
export function buildExtraInfoJson(
  parsed: PersonalizationNameNumber,
  extra?: Record<string, unknown>,
): string | null {
  const hasExtra = extra !== undefined && Object.keys(extra).length > 0;
  if (!parsed.name && !parsed.number && !hasExtra) {
    return null;
  }

  const extraInfo: Record<string, unknown> = {};

  if (parsed.name) {
    extraInfo.name = parsed.name;
  }
  if (parsed.number) {
    extraInfo.number = parsed.number;
  }
  // Personalisation cost is already included in the line item price the
  // marketplace charged, so the attribute carries no additional price.
  extraInfo.price = 0;

  if (hasExtra) {
    Object.assign(extraInfo, extra);
  }

  return JSON.stringify(extraInfo);
}
