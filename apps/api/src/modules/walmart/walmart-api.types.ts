/**
 * Walmart Marketplace API Response Types
 *
 * Typed interfaces for the Walmart Marketplace REST API order endpoints.
 *
 * Source of truth: legacy SMS `marketplace_orders_controller.php` lines 1530-1672 (fetch),
 * `:1698-1881` (transform), and `documentation/walmart/walmart_integration_ai_technical_guide.md`.
 *
 * Single-step fetch: GET /v3/orders?status=Created returns full order details in
 * `result.list.elements.order[]` (3-level nesting — Walmart envelope quirk).
 */

/** Top-level envelope for GET /v3/orders */
export interface WalmartOrdersListEnvelope {
  list?: {
    meta?: {
      totalCount?: number;
      limit?: number;
      nextCursor?: string;
    };
    elements?: {
      order?: WalmartOrder[];
    };
  };
}

/** Full order from the Walmart orders endpoint */
export interface WalmartOrder {
  /** Walmart's purchase order id — used as `mo_order_id` and dedup key */
  purchaseOrderId: string;
  /** Customer-facing order id (NOT used for dedup — PM #160625 fix) */
  customerOrderId: string;
  /** Buyer email */
  customerEmailId: string;
  /** Unix milliseconds — divide by 1000 before passing to `new Date()` */
  orderDate: number;
  shippingInfo: WalmartShippingInfo;
  orderLines: {
    orderLine: WalmartOrderLine[];
  };
}

export interface WalmartShippingInfo {
  phone?: string;
  /** Unix milliseconds */
  estimatedDeliveryDate?: number;
  /** Unix milliseconds */
  estimatedShipDate?: number;
  methodCode?: string;
  postalAddress: WalmartPostalAddress;
}

export interface WalmartPostalAddress {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  /** ISO-3166-1 alpha-3 (e.g. 'USA') — we ignore this and hardcode `'United States'` per legacy parity */
  country?: string;
  addressType?: string;
}

export interface WalmartOrderLine {
  /** Per-order line index — used as `mop_product_id` */
  lineNumber: string;
  item: {
    productName: string;
    sku: string;
  };
  /** Unit-of-measurement + quantity for this line. Drives the per-unit row expansion. */
  orderLineQuantity: {
    unitOfMeasurement: string; // e.g. "EACH"
    /** WHY string: Walmart sometimes returns quantity as a string. parseInt before use. */
    amount: string | number;
  };
  statusDate?: number;
  orderLineStatuses: {
    orderLineStatus: WalmartOrderLineStatus[];
  };
  charges: {
    charge: WalmartCharge[];
  };
  refund?: unknown;
  fulfillment?: {
    fulfillmentOption?: string;
    shipMethod?: string;
    pickUpDateTime?: number;
  };
}

export interface WalmartOrderLineStatus {
  status: string; // 'Created' | 'Acknowledged' | 'Shipped' | 'Cancelled' | 'Delivered' | ...
  statusQuantity: {
    unitOfMeasurement: string;
    amount: string | number;
  };
  cancellationReason?: string;
  trackingInfo?: WalmartTrackingInfo;
}

export interface WalmartTrackingInfo {
  shipDateTime?: number; // Unix ms
  carrierName?: { carrier?: string; otherCarrier?: string };
  methodCode?: string;
  trackingNumber?: string;
  trackingURL?: string;
}

/**
 * Per-line charge entry. Walmart can return multiple — legacy and our migration use index 0 only
 * (matches `marketplace_orders_controller.php:1777-1779`). `mo_shipping_total` is hardcoded `0`,
 * so we don't aggregate shipping charges here.
 */
export interface WalmartCharge {
  chargeType: string; // 'PRODUCT' | 'SHIPPING' | ...
  chargeName?: string;
  chargeAmount: {
    /** ISO-4217 currency code (e.g. 'USD') */
    currency: string;
    /** Per-unit price (NOT a duplicated line total like OnBuy's `total_price`). */
    amount: number;
  };
  tax?: {
    taxName?: string;
    taxAmount?: { currency?: string; amount?: number };
  };
}

/**
 * Carrier-name mapping (PM #160619).
 *
 * UKSS internal carrier slugs → Walmart's required canonical carrier name. Hardcoded as a
 * change-controlled const rather than env-driven JSON: only 5 entries, rarely changes, easier to
 * review. Lookup with `WALMART_CARRIER_MAP[slug.toLowerCase()] ?? slug` so unmapped values pass
 * through (matches legacy `if(isset($walmart_carrier_array[...]))`).
 *
 * Source: legacy `app/config/ukss_configure.php` `WALMART_CARRIER_ARRAY`.
 */
export const WALMART_CARRIER_MAP: Record<string, string> = {
  usps: 'USPS',
  dhl: 'DHL',
  royal_mail: 'Royal Mail',
  canada_post: 'Canada Post',
  japan_post: 'Japan Post',
};

/**
 * Walmart order statuses we know about. Used for `mop_order_status_to_update` switching in Stage 6.
 * Lower-case form because we `.toLowerCase()` before comparing.
 */
export const WALMART_PUSH_STATUS = {
  ACKNOWLEDGED: 'acknowledged',
  CANCELLED: 'cancelled',
  SHIPPED: 'shipped',
} as const;

/** Cancellation reason codes (Walmart-defined enum). PM #164896 introduced the customer-override path. */
export const WALMART_CANCELLATION_REASON = {
  /** Default — used when the seller is cancelling because we cannot fulfil */
  SELLER_CANCEL_OUT_OF_STOCK: 'SELLER_CANCEL_OUT_OF_STOCK',
  /** PM #164896 — used when `customer_cancellation_request='1'` on the MOP row */
  CUSTOMER_REQUESTED_SELLER_TO_CANCEL: 'CUSTOMER_REQUESTED_SELLER_TO_CANCEL',
} as const;

/** UnitOfMeasurement quirks from legacy — DO NOT normalize. */
export const WALMART_UOM_CANCEL = 'EA' as const; // legacy `:1308`
export const WALMART_UOM_SHIP = 'EACH' as const; // legacy `:1334`
