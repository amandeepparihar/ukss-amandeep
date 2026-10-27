/**
 * Sportdeal API Response Types
 *
 * Typed interfaces for the Sportdeal REST API responses.
 * Verified against actual production API responses from sportdeal-order-feed logs
 * on server 92.52.120.222 (2026-03-24).
 *
 * Sportdeal uses a two-step fetch pattern:
 *   1. GET orders list endpoint → SportdealOrderListResponse (contains order IDs + summary)
 *   2. GET order detail endpoint per ID → SportdealOrderDetailResponse (full order data)
 */

/**
 * Response from the orders list endpoint.
 *
 * URL pattern: SPORTDEAL_ORDERS_API_URL with date placeholders
 * Example: /api/orders?from=2026-03-01T00:00:00.000Z&to=2026-03-24T00:00:00.000Z
 */
export interface SportdealOrderListResponse {
  items: SportdealOrderListItem[];
}

/**
 * Individual order in the list response.
 * Contains only summary fields — full details require a second API call.
 *
 * @example
 * { id: 85945, created_at: [], delivery_cost: 14 }
 */
export interface SportdealOrderListItem {
  /** Sportdeal order ID — used to fetch detail via SPORTDEAL_ORDER_PRODUCT_API_URL + id */
  id: number;

  /**
   * Order creation timestamp.
   * WHY: The API returns an empty array [] when the field is not populated.
   * This is a Sportdeal API quirk — treat empty arrays as null.
   */
  created_at: string | [];

  /** Delivery cost charged to customer (in marketplace currency) */
  delivery_cost: number;
}

/**
 * Full order detail response from the per-order endpoint.
 *
 * URL pattern: SPORTDEAL_ORDER_PRODUCT_API_URL + orderId
 * Example: /api/orders/85945
 *
 * @example
 * {
 *   id: 85945,
 *   supplier_id: 1922,
 *   order_status: 20,
 *   final_cost_price: 94.68,
 *   vat: 26.732752,
 *   commission: 23.097,
 *   first_name: "Maurice",
 *   last_name: "Bekking",
 *   customer_email: "user@example.com",
 *   shipping_street: "Melisstokenlaan",
 *   shipping_house_number: "2598",
 *   order_items: "[{\"ean\":\"...\",\"quantity\":1,\"supplier_sku\":\"p-495788-3431\",\"name\":\"...\",\"price\":\"69.9900\"}]"
 * }
 */
export interface SportdealOrderDetailResponse {
  id: number;
  supplier_id: number;
  supplier_quote_id: number;
  supplier_name: string;
  order_type: number;
  order_status: number;
  reject_reason: string | null;
  delivery_cost: number;
  external_order_id: string | null;

  /** Supplier's cost price (what UKSS receives, before commission/VAT) */
  direct_cost_price: number;

  /** Final cost price after adjustments */
  final_cost_price: number;

  /** Sportdeal's commission amount (NOT part of our revenue) */
  commission: number;

  /** VAT amount for the entire order (must be distributed across products) */
  vat: number;

  /** Original order amount */
  order_amount_org: number;

  /** Original delivery cost */
  delivery_cost_org: number;

  /** Customer-facing delivery cost */
  delivery_customer: number;

  /** Sportdeal discount applied */
  sdeal_discount: number;

  /** Original VAT amount */
  vat_org: number;

  /** Indirect discount */
  indirect_discount: number;

  expected_arrival_date: string | null;
  original_expected_arrival_date: string | [];
  confirmed_expected_arrival_date: string | null;
  payment_schedule: string | null;
  settle_payment_schedule: string | null;
  payment_date: string | null;
  settle_payment_date: string | null;
  finance_status: string | null;
  commission_status: string | null;
  note: string | null;

  customer_email: string | null;
  customer_phone: string | null;
  company: string;
  first_name: string;
  last_name: string;

  /** Street name (mapped to moOrderShippingLine2) */
  shipping_street: string;

  /** House/building number (mapped to moOrderShippingLine1) */
  shipping_house_number: string;

  /** Full address string combining street + house number */
  shipping_addition_address: string;

  shipping_zipcode: string;
  shipping_city: string;
  shipping_region: string;

  /** ISO 2-letter country code (e.g., "NL", "DE", "FR") */
  shipping_countryid: string;

  /**
   * Order items as a JSON string or parsed array.
   *
   * WHY: The API inconsistently returns this as a JSON string in some responses
   * and as a parsed array in others. The transformation code must handle both.
   */
  order_items: string | SportdealOrderItem[];

  /** Sportdeal's customer-facing order reference (e.g., "SD-NL-O-000039795") */
  customer_order_id: string;

  /**
   * Order creation date — injected from the list response's created_at field.
   * Not present in the raw detail response; merged by the fetch service.
   */
  created_at?: string | [];

  /**
   * Delivery cost — injected from the list response's delivery_cost field.
   * Takes precedence over the detail response's delivery_cost for the final order total.
   */
  order_delivery_cost?: number;
}

/**
 * Individual product line item within an order.
 *
 * @example
 * {
 *   ean: "8059490072341",
 *   quantity: 1,
 *   supplier_sku: "p-495788-3431",
 *   name: "2025-2026 Ado Den Haag Home Shirt",
 *   price: "69.9900",
 *   cost_price: 47.99
 * }
 */
export interface SportdealOrderItem {
  /** EAN/barcode */
  ean: string;

  /** Quantity ordered (0 means cancelled/invalid — skip this item) */
  quantity: number;

  /** UKSS product SKU (matches new_product_variations.npv_sku) */
  supplier_sku: string;

  /** Product display name */
  name: string;

  /** Original unit price inclusive of commission (e.g., "69.9900") */
  price: string;

  /**
   * Actual item cost — what UKSS receives after Sportdeal's commission is removed.
   * Present in API responses from 2026-04-10 onward.
   * When present, use this as the item cost instead of price.
   *
   * WHY string | number: Sportdeal has a history of inconsistent API types
   * (e.g. order_items returned as JSON string or parsed array). Typed as a union
   * to match reality; always parse via parseFloat(String(cost_price)) before use.
   */
  cost_price?: number | string;
}

/**
 * Sportdeal order status codes from the API.
 * Maps numeric status to human-readable string.
 */
export const SPORTDEAL_ORDER_STATUS_MAP: Record<number, string> = {
  1: 'CREATED',
  5: 'WAITING_APPROVAL',
  8: 'WAITING_HOLIDAY',
  10: 'SENT_TO_SUPPLIER',
  20: 'CONFIRMED',
  25: 'CANCELED',
  50: 'RECEIVED',
  51: 'COMPLETED',
} as const;
