import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import type { RateEntry, RateSnapshot } from './medusa-price-sync.types';

/**
 * UKSS exchange-rate source for the Medusa price sync. Redmine #166532 (HLA row 4).
 *
 * Reads `ukssmain.currencies` read-only, normalises it, validates it and hashes it
 * into an immutable snapshot. This module never calls an FX API and never writes to
 * `currencies` — the legacy Zen Cart cron owns that table.
 *
 * THE MARGIN, and what was actually found
 * ---------------------------------------
 * The HLA states the 2% commercial margin is already applied by the legacy
 * `worldpay_exchange_rates` cron and must never be applied twice. The cron does
 * contain the multiplication:
 *
 *   $conversion_value = $exchange_rates[$code] * (1 + EXTRA_MARGIN_CURRENCY);
 *
 * added for PM #152196 in July 2024. But `EXTRA_MARGIN_CURRENCY` is defined
 * NOWHERE in the UKSS PHP tree available on this machine, and on PHP 5.6 an
 * undefined constant degrades to its own name as a string, making
 * `(1 + EXTRA_MARGIN_CURRENCY)` evaluate to 1 — a silent no-op. A uniform factor
 * is also invisible in the data: it cancels out of every cross-rate, and the
 * AED/USD peg reproduces 3.6725 either way, so no arithmetic check can settle it.
 *
 * The checkout here is a dev copy, so the live install may well define the
 * constant. This therefore stays an OPEN ITEM to confirm on the live UKSS host
 * (`grep -rn EXTRA_MARGIN_CURRENCY` on the docroot), and the design is arranged so
 * either answer is a configuration change rather than a code change:
 * MEDUSA_PRICE_SYNC_MARGIN_PERCENT defaults to "0" — the HLA's assumption, source
 * already margined — and if it is ever set, the margin is applied HERE, once, and
 * recorded on the snapshot. Medusa refuses margin_included: false outright, so
 * un-margined rates can never reach a price row by accident.
 *
 * Note also there are TWO historical rate crons writing this table:
 * `worldpay_exchange_rates` (exchangerate-api, all 17 currencies) and
 * `currency_update` (ECB reference rates x CURRENCY_UPLIFT_RATIO = 1.05, which
 * covers neither AED nor the 2% story). AED carries the same last_updated as every
 * other row and is absent from the ECB feed, so the worldpay cron is the one that
 * produced the current data. If that ever changes, the effective margin changes
 * with it — which is why the snapshot records what it assumed.
 */

/** UKSS holds GBP at exactly 1.00000000 and the crons never touch it. */
export const BASE_CURRENCY = 'gbp';

/** The 18 currencies in scope for #166532. */
export const SUPPORTED_CURRENCIES = [
  'gbp', 'chf', 'eur', 'usd', 'sgd', 'cad', 'aud', 'nzd', 'aed',
  'pln', 'myr', 'dkk', 'hkd', 'nok', 'sek', 'mxn', 'inr', 'jpy',
];

/** Medusa's default when UKSS has no decimal_places for a currency. */
const DEFAULT_DECIMAL_PLACES = 2;

export class RateSourceError extends Error {
  constructor(
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RateSourceError';
  }
}

/**
 * Reads every in-scope currency from UKSS.
 *
 * `value` is a Prisma Decimal and is converted with .toString(), which yields the
 * exact stored decimal. Number() here would be the one line that silently ruins
 * the arithmetic downstream.
 */
export async function readUkssRates(): Promise<RateEntry[]> {
  const rows = await prisma.currency.findMany({
    where: { code: { in: SUPPORTED_CURRENCIES.map((c) => c.toUpperCase()) } },
    select: {
      code: true,
      value: true,
      decimalPlaces: true,
      lastUpdated: true,
    },
    orderBy: { code: 'asc' },
  });

  return rows.map((row) => ({
    currency: String(row.code).toLowerCase(),
    rate: row.value.toString(),
    decimalPlaces: parseDecimalPlaces(row.decimalPlaces),
    lastUpdated: row.lastUpdated ?? null,
  }));
}

/**
 * `decimal_places` is a char(1) in UKSS, so it arrives as "2" or null.
 *
 * Note UKSS records JPY as 2, which is wrong for a zero-decimal currency — a JPY
 * price with pence is wrong on the invoice and at the gateway. That is the "two
 * rounding authorities" decision still open on the HLA; UKSS is passed through
 * faithfully here rather than silently corrected, so the wrong value is visible
 * in the run's snapshot instead of buried in this function.
 */
function parseDecimalPlaces(raw: string | null | undefined): number {
  if (raw == null || raw === '') {
    return DEFAULT_DECIMAL_PLACES;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 6
    ? parsed
    : DEFAULT_DECIMAL_PLACES;
}

/**
 * `currencies.value` is decimal(13,8), so 8 is the source's true precision.
 *
 * Prisma's Decimal.toString() strips trailing zeros — 5.00034600 comes back as
 * "5.000346" — so the string's own scale understates what the column holds.
 * Rounding a margined rate back to the string's scale would therefore throw away
 * real precision, hence the floor.
 */
const RATE_SCALE = 8;

/**
 * Multiplies a decimal-string rate by (1 + percent) without floating point.
 *
 * Only called when the source is declared NOT to include the margin. Kept in
 * integer arithmetic for the same reason the rates are strings: this is the last
 * multiplication before ten million prices are derived from the result.
 */
export function applyMargin(rate: string, marginPercent: string): string {
  if (marginPercent === '0' || marginPercent === '') {
    return rate;
  }

  const rateParts = splitDecimal(rate);
  const marginParts = splitDecimal(marginPercent);

  // (1 + p/100) as a scaled integer: 10^(s+2) + p, at scale s+2.
  const factorScale = marginParts.scale + 2;
  const factor = 10n ** BigInt(factorScale) + marginParts.value;

  const product = rateParts.value * factor;
  const productScale = rateParts.scale + factorScale;

  return rescale(product, productScale, Math.max(rateParts.scale, RATE_SCALE));
}

function splitDecimal(raw: string): { value: bigint; scale: number } {
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new RateSourceError(`Not a plain decimal string: ${JSON.stringify(raw)}`);
  }
  const [whole, fraction = ''] = raw.split('.');
  return { value: BigInt(whole + fraction), scale: fraction.length };
}

function rescale(value: bigint, fromScale: number, toScale: number): string {
  const drop = fromScale - toScale;
  let scaled = value;

  if (drop > 0) {
    const divisor = 10n ** BigInt(drop);
    const quotient = scaled / divisor;
    const remainder = scaled % divisor;
    scaled = remainder * 2n >= divisor ? quotient + 1n : quotient;
  } else if (drop < 0) {
    scaled = scaled * 10n ** BigInt(-drop);
  }

  if (toScale === 0) {
    return scaled.toString();
  }

  const text = scaled.toString().padStart(toScale + 1, '0');
  return `${text.slice(0, -toScale)}.${text.slice(-toScale)}`;
}

/**
 * SHA-256 over the normalised, sorted snapshot.
 *
 * Every batch of a run reuses the hash so a run spanning two hours cannot apply
 * Monday's USD rate to the first 300k variants and Tuesday's to the rest, leaving
 * the catalogue inconsistent with no way to detect it. Hashed over the STRING
 * rates for the same reason they travel as strings.
 */
export function hashSnapshot(
  baseCurrency: string,
  ratesAsOf: Date,
  rates: Record<string, string>,
): string {
  const normalised = Object.keys(rates)
    .sort()
    .map((c) => `${c}=${rates[c]}`)
    .join(';');

  return `sha256:${createHash('sha256')
    .update(`${baseCurrency}|${ratesAsOf.toISOString()}|${normalised}`)
    .digest('hex')}`;
}

export type BuildSnapshotOptions = {
  maxRateAgeHours: number;
  /** Extra margin to apply because the source lacks it. "0" = already margined. */
  marginPercent: string;
  /** Previous run's rates, to bound how far any single rate may have moved. */
  previousRates?: Record<string, string>;
  maxRateMovementPercent?: number;
  now?: Date;
};

/**
 * Builds a validated snapshot, or throws.
 *
 * Throwing is the point. A rate source that is stale, incomplete or has jumped
 * implausibly is not something to work around — every price in the catalogue is
 * derived from it, and a bad snapshot silently mis-prices the whole store. The CLI
 * turns these into a non-zero exit and no run at all.
 */
export async function buildRateSnapshot(
  options: BuildSnapshotOptions,
): Promise<RateSnapshot> {
  const entries = await readUkssRates();
  const now = options.now ?? new Date();

  if (!entries.length) {
    throw new RateSourceError('ukssmain.currencies returned no in-scope rows');
  }

  const base = entries.find((e) => e.currency === BASE_CURRENCY);
  if (!base) {
    throw new RateSourceError(`Base currency ${BASE_CURRENCY} is missing from UKSS`);
  }

  /**
   * The base must be exactly 1. Both legacy crons deliberately exclude GBP, so
   * anything else means somebody has edited it by hand — and every generated price
   * would then be scaled by that error with nothing else looking wrong.
   */
  if (splitDecimal(base.rate).value !== 10n ** BigInt(splitDecimal(base.rate).scale)) {
    throw new RateSourceError(
      `Base currency ${BASE_CURRENCY} must be exactly 1, UKSS holds ${base.rate}`,
      { rate: base.rate },
    );
  }

  const rates: Record<string, string> = {};
  const decimals: Record<string, number> = {};
  const excluded: RateSnapshot['excluded'] = [];
  let oldest: Date | null = null;

  for (const entry of entries) {
    if (entry.currency === BASE_CURRENCY) {
      continue;
    }

    if (splitDecimal(entry.rate).value === 0n) {
      excluded.push({ currency: entry.currency, reason: 'rate_is_zero' });
      continue;
    }

    if (!entry.lastUpdated) {
      excluded.push({ currency: entry.currency, reason: 'never_updated' });
      continue;
    }

    rates[entry.currency] = applyMargin(entry.rate, options.marginPercent);
    decimals[entry.currency] = entry.decimalPlaces;

    if (!oldest || entry.lastUpdated < oldest) {
      oldest = entry.lastUpdated;
    }
  }

  if (!Object.keys(rates).length) {
    throw new RateSourceError('No usable target rates after normalisation', {
      excluded,
    });
  }

  /**
   * Age is measured from the OLDEST included rate, not the newest.
   *
   * A cron that updated 16 of 17 currencies and failed on the seventeenth would
   * otherwise pass the freshness check while pricing one currency off a month-old
   * rate. Worst case is the only honest reading.
   */
  const ratesAsOf = oldest as Date;
  const ageHours = (now.getTime() - ratesAsOf.getTime()) / 36e5;

  if (ageHours > options.maxRateAgeHours) {
    throw new RateSourceError(
      `Rate snapshot is ${ageHours.toFixed(1)}h old (oldest: ${ratesAsOf.toISOString()}), ` +
        `limit is ${options.maxRateAgeHours}h — the UKSS rate cron has probably stopped running`,
      { ageHours, ratesAsOf: ratesAsOf.toISOString(), limit: options.maxRateAgeHours },
    );
  }

  /**
   * Movement guard. A rate that has jumped 40% overnight is far more likely to be
   * a broken upstream feed than a real currency event, and the consequence is the
   * whole catalogue repriced wrongly in that currency.
   */
  if (options.previousRates && options.maxRateMovementPercent) {
    const moved = detectExcessiveMovement(
      rates,
      options.previousRates,
      options.maxRateMovementPercent,
    );

    if (moved.length) {
      throw new RateSourceError(
        `Rate movement exceeds ${options.maxRateMovementPercent}%: ` +
          moved.map((m) => `${m.currency} ${m.from}->${m.to} (${m.percent.toFixed(2)}%)`).join(', '),
        { moved },
      );
    }
  }

  return {
    baseCurrency: BASE_CURRENCY,
    rates,
    decimals,
    ratesAsOf,
    ageHours,
    marginIncluded: true,
    marginAppliedPercent: options.marginPercent,
    hash: hashSnapshot(BASE_CURRENCY, ratesAsOf, rates),
    excluded,
  };
}

/**
 * Rates that moved more than the allowed percentage.
 *
 * Float arithmetic is fine here and only here: this is a threshold comparison for
 * a human-set tolerance, not a value that ends up in a price.
 */
export function detectExcessiveMovement(
  rates: Record<string, string>,
  previous: Record<string, string>,
  maxPercent: number,
): Array<{ currency: string; from: string; to: string; percent: number }> {
  const moved: Array<{ currency: string; from: string; to: string; percent: number }> = [];

  for (const [currency, rate] of Object.entries(rates)) {
    const before = previous[currency];
    if (!before) {
      continue;
    }

    const from = Number(before);
    const to = Number(rate);
    if (!Number.isFinite(from) || from === 0) {
      continue;
    }

    const percent = Math.abs((to - from) / from) * 100;
    if (percent > maxPercent) {
      moved.push({ currency, from: before, to: rate, percent });
    }
  }

  return moved;
}
