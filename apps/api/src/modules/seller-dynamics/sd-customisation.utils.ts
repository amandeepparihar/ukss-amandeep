/**
 * Seller Dynamics — line-item flags and customisation Notes.
 *
 * @taskId #166445
 *
 * Pure functions only (no DB, no config) so the fetch-policy rules that decide which
 * lines are imported and what gets written to mop_extra_info are unit-testable.
 *
 * SD carries product customisation (the name/number printed on a shirt) in the
 * <Notes> element of GetCustomerOrdersExtended, at line-item level.
 *
 * Verified format, captured from the SD test account
 * (retailerId e1e95ad7-63c1-4a2b-9c8f-00f9698efbd4) on 2026-07-27 — a labelled,
 * LF-separated string, raw bytes b'Name: Leo Numan\nNumber: 19':
 *
 *   Name: Leo Numan
 *   Number: 19
 *
 * This is NOT the "Harsh, 10" comma form requested of SD by email; we parse what
 * SD actually sends. Deliberately no comma/space fallback heuristics: if SD ever
 * changes the format we want an empty name/number plus the preserved raw string,
 * which shows up as a visible gap, rather than a silently mis-parsed print job.
 *
 * Confirmed 2026-07-27: in production, ONLY UKSS-CUST carries Name/Number, and it is
 * mandatory there. UKSS-POD is a fulfilment routing flag (print on demand), not a
 * personalisation flag — it does not carry customisation data. The test account's 9
 * seeded lines all had Notes regardless of flag; that's an artifact of how Gary seeded
 * the test data, not representative of production traffic.
 */

import {
  buildExtraInfoJson,
  type PersonalizationNameNumber,
} from '../../lib/orders/personalization.utils';
import type { SdCustomerOrderExtended } from './sd-order-types';

/** Labels SD uses, lowercased. Anything else on a line is ignored. */
const NAME_LABEL = 'name';
const NUMBER_LABEL = 'number';

/**
 * Line-item flags we import. UKSS-POD (print on demand) and UKSS-CUST (customised)
 * were added by SD for the Glade Sports customisation work; before they were accepted,
 * those lines were dropped — which silently truncated any order mixing them with a
 * plain UKSS line (verified: test order 46359274-12182187 does exactly that).
 */
export const SD_ACCEPTED_FLAGS = ['UKSS', 'UKSS-POD', 'UKSS-CUST'];

/**
 * The only flag that carries mandatory Name/Number personalisation in production.
 * UKSS-POD and plain UKSS never require it — treating UKSS-POD as if it did
 * previously caused every print-on-demand order with no Notes to look like a data
 * error to Stage 2's "personalized order data missing" alert.
 */
export const SD_MANDATORY_CUSTOMISATION_FLAG = 'UKSS-CUST';

/** Normalise an SD flag for comparison — SD's casing is not contractually guaranteed. */
export function normalizeSdFlag(flag: unknown): string {
  return typeof flag === 'string' ? flag.trim().toUpperCase() : '';
}

export function isAcceptedSdFlag(flag: unknown): boolean {
  return SD_ACCEPTED_FLAGS.includes(normalizeSdFlag(flag));
}

export function isMandatoryCustomisationFlag(flag: unknown): boolean {
  return normalizeSdFlag(flag) === SD_MANDATORY_CUSTOMISATION_FLAG;
}

/**
 * Parse an SD <Notes> string into the printed name and number.
 *
 * Returns empty strings for absent/blank/unrecognised input — never throws.
 */
export function parseSdNotes(raw: string | null | undefined): PersonalizationNameNumber {
  const result: PersonalizationNameNumber = { name: '', number: '' };

  if (typeof raw !== 'string' || raw.trim() === '') {
    return result;
  }

  // Split on either line ending — SD sends LF today, but a CRLF switch must not
  // leave a stray \r inside the parsed value.
  for (const line of raw.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;

    const label = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (value === '') continue;

    if (label === NAME_LABEL) {
      result.name = value;
    } else if (label === NUMBER_LABEL) {
      result.number = value;
    }
  }

  return result;
}

/**
 * Build the mop_extra_info payload for one SD line item.
 *
 * Returns null when there is nothing to record — a plain UKSS or UKSS-POD line with
 * no Notes — so those orders keep the NULL they'd get without this feature and never
 * trip Stage 2's "personalized order data missing" alert once the SD store is added
 * to PERSONALIZE_ORDERS_SITE. Only UKSS-CUST is written unconditionally: it's an
 * audit record of a mandatory-data line even when Notes is missing (see
 * hasMissingMandatoryCustomisation(), which is what actually triggers the alert).
 *
 * The raw Notes string is kept alongside the parsed values: if SD changes the format,
 * the source is still on the row to re-parse from.
 */
export function buildSdExtraInfo(
  item: Pick<SdCustomerOrderExtended, 'Flag' | 'Notes'>,
): string | null {
  const rawNotes = typeof item.Notes === 'string' ? item.Notes.trim() : '';
  const flag = normalizeSdFlag(item.Flag);

  if (!rawNotes && flag !== SD_MANDATORY_CUSTOMISATION_FLAG) {
    return null;
  }

  const extra: Record<string, unknown> = { sdFlag: flag };
  if (rawNotes) {
    extra.sdNotes = rawNotes;
  }

  return buildExtraInfoJson(parseSdNotes(item.Notes), extra);
}

/**
 * True when a line item is flagged UKSS-CUST but its Notes did not yield both a
 * name and a number — i.e. the mandatory personalisation data is missing.
 *
 * Used by the fetch service to alert ryan@uksoccershop.com / simon@uksoccershop.com
 * (a customised order shipping with no printed name/number is a customer-facing
 * problem, not just a data-quality one).
 */
export function hasMissingMandatoryCustomisation(
  item: Pick<SdCustomerOrderExtended, 'Flag' | 'Notes'>,
): boolean {
  if (!isMandatoryCustomisationFlag(item.Flag)) {
    return false;
  }
  const { name, number } = parseSdNotes(item.Notes);
  return !name && !number;
}
