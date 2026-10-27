/**
 * Seller Dynamics routing flags.
 *
 * @taskId #166531
 *
 * SD carries a `Flag` on every stock item and every order line. It is the field that
 * tells SD (and us, on the way back in) how an item was listed and whether it needs
 * personalisation:
 *
 *   UKSS       Listed outside the Stock2 SD T-Shirts module. Never emitted from here.
 *   UKSS-POD   T-shirt listed via the SD T-Shirts module, print-on-demand, no personalisation.
 *   UKSS-CUST  T-shirt listed via the SD T-Shirts module, customer name/number is printed.
 *
 * Pure constants and functions only (no DB, no config) so both the outbound listing
 * feed and the inbound order filter can share one source of truth for these strings.
 *
 * Which of the two module flags an item gets is decided by the legacy `Is_Your_Name`
 * column — see isCustomisableFromIsYourName() below.
 *
 * Outbound producer: modules/sd-tshirts/sd-tshirts.cron.ts (BulkUploadStock CSV `Flag` column).
 * Inbound consumer:  modules/seller-dynamics/sd-customisation.utils.ts (ticket #166445) —
 * which decides which order lines to import and which must carry customisation Notes.
 */

/** Items listed outside the SD T-Shirts module. Here for completeness — never emitted. */
export const SD_FLAG_UKSS = 'UKSS';

/** T-shirt listed via the SD T-Shirts module with no personalisation. */
export const SD_FLAG_POD = 'UKSS-POD';

/** T-shirt listed via the SD T-Shirts module that carries a printed name/number. */
export const SD_FLAG_CUST = 'UKSS-CUST';

/** Every flag SD may send us on an order line. */
export const SD_FLAGS = [SD_FLAG_UKSS, SD_FLAG_POD, SD_FLAG_CUST] as const;

export type SdFlag = (typeof SD_FLAGS)[number];

/**
 * The `Flag` to send on BulkUploadStock for a T-shirt approved through the SD T-Shirts
 * module.
 *
 * Plain UKSS is deliberately unreachable from here: emitting it would make SD treat a
 * personalised shirt as an ordinary line, so the order would come back with no Notes
 * requirement and ship with nothing printed on it.
 */
export function sdListingFlag(isCustomisable: boolean): SdFlag {
  return isCustomisable ? SD_FLAG_CUST : SD_FLAG_POD;
}

/**
 * Customisability is stored in the legacy `Is_Your_Name` column — `products.Is_Your_Name`
 * is the master and `new_products.is_your_name` is a mirror that
 * includes/modules/pages/fill_new_products/header_php.php refreshes from it, so both must
 * be written together. Both are `enum('No','Yes') NOT NULL` with no default, so only these
 * two exact strings may ever be written.
 *
 * This is the same field the storefront and the marketplace product feeds read to decide
 * whether an item takes a printed name/number — it is shared, not private to this module.
 */
export const IS_YOUR_NAME_YES = 'Yes';
export const IS_YOUR_NAME_NO = 'No';

export type IsYourName = typeof IS_YOUR_NAME_YES | typeof IS_YOUR_NAME_NO;

/** Legacy enum -> boolean. Anything that is not exactly 'Yes' is treated as not customisable. */
export function isCustomisableFromIsYourName(value: string | null | undefined): boolean {
  return value === IS_YOUR_NAME_YES;
}

/** Boolean -> legacy enum, for writing `products` / `new_products`. */
export function isYourNameFromCustomisable(isCustomisable: boolean): IsYourName {
  return isCustomisable ? IS_YOUR_NAME_YES : IS_YOUR_NAME_NO;
}
