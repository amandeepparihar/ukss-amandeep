/**
 * OnBuy API Response Types
 *
 * Typed interfaces for the OnBuy REST API order endpoints.
 *
 * Single-step fetch pattern: GET ONBUY_ORDERS_API_URL returns full order details
 * in `result.results[]` (no separate detail call required).
 *
 * Source of truth: legacy SMS `marketplace_orders_controller.php` lines 1188-1509,
 * cross-checked against sample responses captured by the live OnBuy seller account.
 */

/**
 * Top-level shape of GET /v2//orders?... — wraps the order list under `results`.
 *
 * WHY the `result` key (not `data`): OnBuy's wrapper uses `{ status, result: { results: [...] } }`.
 * Legacy code reads `$response['results']` directly because `result` is unwrapped at one level.
 * We model the full envelope here for type safety.
 */
export interface OnBuyOrdersListEnvelope {
  status?: string | number;
  result?: {
    results?: OnBuyOrder[];
    total?: number;
  };
  /** Some OnBuy responses surface `results` at the top level — handle both shapes. */
  results?: OnBuyOrder[];
}

/**
 * Full order from the OnBuy orders endpoint.
 *
 * @example
 * {
 *   order_id: "62199227001004571",
 *   date: "2025-02-18 10:31:22",
 *   updated_at: "2025-02-18 10:32:11",
 *   status: "Awaiting Dispatch",
 *   currency_code: "GBP",
 *   delivery_service: "Standard",
 *   buyer: { name, email, phone },
 *   delivery_address: { line_1, line_2, line_3, town, county, postcode, country_code },
 *   products: [{ sku, name, onbuy_internal_reference, total_price, quantity, product_options }],
 *   price_subtotal: "32.00", price_delivery: "3.99", price_total: "35.99"
 * }
 */
export interface OnBuyOrder {
  order_id: string;
  date: string;
  updated_at: string;
  status: string;
  currency_code: string;
  delivery_service: string | null;
  buyer: OnBuyBuyer;
  delivery_address: OnBuyDeliveryAddress;
  products: OnBuyOrderProduct[];

  /** WHY string: OnBuy returns numeric prices as strings (e.g. "32.00"). parseFloat before use. */
  price_subtotal: string;
  price_delivery: string;
  price_total: string;
}

export interface OnBuyBuyer {
  name: string;
  email: string;
  /** WHY nullable: phone is not always populated on OnBuy orders. */
  phone?: string | null;
}

export interface OnBuyDeliveryAddress {
  line_1: string;
  line_2?: string | null;
  line_3?: string | null;
  town: string;
  county?: string | null;
  postcode: string;
  /** ISO 2-letter code (e.g. "GB"); resolved to country name via getCountryNameFromIsoCode. */
  country_code: string;
}

export interface OnBuyOrderProduct {
  sku: string;
  name: string;
  /** OnBuy's internal product reference; persisted as mop_product_id. */
  onbuy_internal_reference: string;

  /**
   * Total line price.
   * WHY duplicated per row: legacy parity (PMS 158584). Each expanded MOP row stores the
   * full line total — NOT divided by quantity — to match the legacy SMS calculation that
   * downstream UKSS revenue reports already rely on.
   */
  total_price: string;

  /** WHY string: OnBuy returns quantity as a string (e.g. "3"). parseInt before expanding. */
  quantity: string;

  /** Optional product variation label (size/colour); absent on simple SKUs. */
  product_options?: string | null;
}

/**
 * OnBuy auth/request-token response shape (already consumed by OnBuyClient.fetchAccessToken).
 * Documented here for completeness; not used directly in this module.
 */
export interface OnBuyAuthResponse {
  access_token: string;
  expires_at: number;
}
