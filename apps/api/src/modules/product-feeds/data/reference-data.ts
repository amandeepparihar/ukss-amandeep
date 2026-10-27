/**
 * Product Feeds - Reference Data Loaders
 *
 * Loads the static-per-run reference data that the product builder and
 * XML generator need:
 *   - currency rates (by ISO 4217 code)
 *   - shipping methods (by country ISO-3166-1 alpha-2 code)
 *   - additional product data (player names, keyed by product_id)
 *   - team -> team_type lookup
 *
 * All loaders are invoked once per run from the orchestrator (in parallel
 * via Promise.all) and the results are passed through the processing
 * pipeline. PHP originals are single-use per-call; the Node port caches.
 *
 * PHP sources:
 *   - `ukss-feed/build_data_functions.php::getCurrency()`
 *   - `ukss-feed/productTypeSet.php::getTeams()`
 *   - `ukss-feed/shipping.php` (entire file)
 */

import { prisma } from '../../../lib/prisma.js';
import { SHIPPING_COUNTRY_CODES, UK_SUPERSAVER_COST } from '../product-feeds.constants.js';
import type { ShippingMethod } from '../product-feeds.types.js';
import { TEAMS_SNAPSHOT } from './snapshots/teams.js';
import { PLAYER_OVERRIDES_SNAPSHOT } from './snapshots/player-overrides.js';

/**
 * All currency rates as a Map<ISO code, rate>.
 *
 * PHP does one-by-one `getCurrency($code)` SELECTs in a hot path; we
 * hydrate the whole table upfront and the orchestrator looks up per
 * feed country.
 *
 * Mirrors: build_data_functions.php:getCurrency()
 */
export async function loadCurrencyRates(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<
    Array<{ code: string; value: string | number }>
  >`
    SELECT code, value FROM currencies
  `;

  const map = new Map<string, number>();
  for (const row of rows) {
    const rate = Number(row.value);
    if (row.code && Number.isFinite(rate)) {
      map.set(row.code, rate);
    }
  }
  return map;
}

/**
 * Shipping methods keyed by country ISO-3166-1 alpha-2 (e.g. "GB", "US").
 *
 * For each of the 33 SHIPPING_COUNTRY_CODES we run two queries:
 *   1. `shipping_modules` -> flat + zones methods
 *   2. `courier_shipments JOIN shipping_delivery_time` -> courier + supersaver
 *
 * Titles follow the PHP convention:
 *   - GB (UK): "Standard Delivery" / "Priority Delivery" / "Express Delivery"
 *   - Others:  "Standard Airmail"  / "Priority Airmail"  / "Express Delivery(DHL)"
 *   - UK supersaver cost is hardcoded to UK_SUPERSAVER_COST (5.25) to
 *     mirror create_xml_feed.php:151-153 which patches the DB-loaded
 *     value at XML-gen time. The feeds config env (supersaverCost) is
 *     intentionally ignored for feed parity.
 *
 * Mirrors: shipping.php (entire file)
 */
export async function loadShippingMethods(): Promise<Map<string, ShippingMethod[]>> {
  const out = new Map<string, ShippingMethod[]>();

  await Promise.all(
    SHIPPING_COUNTRY_CODES.map(async (countryCode) => {
      const methods: ShippingMethod[] = [];

      // --- 1. Flat / zones (shipping_modules) ---------------------------
      const flatZoneRows = await prisma.$queryRaw<
        Array<{
          shipping_price: string | number;
          delivery_time: string | null;
          shipping_method: string;
        }>
      >`
        SELECT shipping_price, delivery_time, shipping_method
        FROM shipping_modules
        WHERE countries_list LIKE ${'%' + countryCode + '%'}
          AND (shipping_method = 'flat' OR shipping_method = 'zones')
      `;

      for (const row of flatZoneRows) {
        const isFlat = row.shipping_method === 'flat';
        const deliveryTime = row.delivery_time ?? '';
        const id: ShippingMethod['id'] = isFlat ? 'flat' : 'zones';
        const module = isFlat ? 'Flat Rates' : 'Zone Rates';

        let title: string;
        if (countryCode === 'GB') {
          title = isFlat
            ? `Standard Delivery - ${deliveryTime}`
            : `Priority Delivery - ${deliveryTime}`;
        } else {
          title = isFlat
            ? `Standard Airmail - ${deliveryTime}`
            : `Priority Airmail - ${deliveryTime}`;
        }

        methods.push({
          id,
          module,
          text: `${module} (Standard Airmail)`,
          title,
          cost: String(row.shipping_price ?? ''),
          time: deliveryTime,
        });
      }

      // --- 2. Courier / supersaver (courier_shipments JOIN sdt) ---------
      const courierRows = await prisma.$queryRaw<
        Array<{
          shipping_price: string | number;
          delivery_time: string | null;
          shipping_method: string;
        }>
      >`
        SELECT cp.shipping_price, sdt.delivery_time, sdt.shipping_method
        FROM courier_shipments cp
        JOIN shipping_delivery_time sdt ON cp.zone_title = sdt.zone_title
        WHERE (sdt.shipping_method LIKE 'courier' OR sdt.shipping_method LIKE 'supersaver')
          AND cp.countries_list LIKE ${'%' + countryCode + '%'}
      `;

      for (const row of courierRows) {
        const deliveryTime = row.delivery_time ?? '';
        if (row.shipping_method === 'courier') {
          const title =
            countryCode === 'GB'
              ? `Express Delivery - ${deliveryTime}`
              : `Express Delivery(DHL) - ${deliveryTime}`;

          methods.push({
            id: 'courier',
            module: 'Courier Shipments',
            text: 'Courier Shipments (DHL Courier)',
            title,
            cost: String(row.shipping_price ?? ''),
            time: deliveryTime,
          });
        } else if (countryCode === 'GB') {
          // supersaver is UK-only; PHP overrides to 5.25 at XML-gen time
          // regardless of DB/config value (create_xml_feed.php:151-153).
          // Abhinav Gautam
          methods.push({
            id: 'supersaver',
            module: 'Super Saver Rate',
            text: 'Super Saver Rate (Shipping to GB)',
            title: `Super Saver Delivery - ${deliveryTime}`,
            cost: UK_SUPERSAVER_COST,
            time: deliveryTime,
          });
        }
      }

      if (methods.length > 0) {
        out.set(countryCode, methods);
      }
    }),
  );

  return out;
}

/**
 * Team name -> team_type, loaded from a compile-time snapshot of the
 * PHP feed's `teams` table (`data/snapshots/teams.ts`).
 *
 * The PHP feed runs against its own DB which holds a hand-curated
 * `teams(team, team_type)` whitelist. That whitelist diverges from the
 * raw `np_team_type` column in two directions: it includes teams whose
 * `np_team_type` is empty (e.g. `nk maribor`) and it omits teams whose
 * `np_team_type` is set in prod but never made it into the curated list
 * (e.g. `pogon szczecin`). Reading directly from `new_products` produced
 * ~1,879 field-level diffs vs PHP, so the JS port now ships the same
 * snapshot baked into the bundle — refresh via the
 * `feeds:refresh-overrides` CLI command when the PHP table changes.
 * Abhinav Gautam
 */
export async function loadTeamTypes(): Promise<Map<string, string>> {
  return new Map(Object.entries(TEAMS_SNAPSHOT));
}

/**
 * Player-name overrides keyed by `products_id`. Mirrors PHP's
 * `additional_data` lookup at `build_data.php:94-100`, which sits
 * between the `np_player_name` column and the title-regex fallback.
 *
 * Snapshot bundled at compile time from `data/snapshots/player-overrides.ts`
 * — refresh via the `feeds:refresh-overrides` CLI command. Abhinav Gautam
 */
export async function loadPlayerOverrides(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (const [pid, name] of Object.entries(PLAYER_OVERRIDES_SNAPSHOT)) {
    const id = Number(pid);
    if (Number.isFinite(id) && name) map.set(id, name);
  }
  return map;
}
