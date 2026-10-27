/**
 * Allegro API Response Types
 *
 * Typed interfaces for the Allegro REST API responses.
 * Allegro uses a single-step fetch pattern — the checkout-forms endpoint
 * returns full order details including line items, buyer, and delivery info.
 *
 * API docs: https://developer.allegro.pl/documentation/
 *
 * Known quirks:
 *   - Content-Type must be `application/vnd.allegro.public.v1+json`
 *   - OAuth2 with refresh token (12hr access token expiry)
 *   - Pagination ceiling: offset + limit cannot exceed 10,000
 *   - SKU format in offer.external.id varies (not always p-{id}-{var})
 */

// ─── Checkout Forms (Orders) ─────────────────────────────────────────

/**
 * Response from GET /order/checkout-forms
 *
 * Single-step fetch — returns full order details in the list response.
 */
export interface AllegroCheckoutFormsResponse {
  checkoutForms: AllegroCheckoutForm[];
  count: number;
  totalCount: number;
}

/**
 * Individual checkout form (order) from Allegro.
 */
export interface AllegroCheckoutForm {
  id: string;
  messageToSeller: string | null;
  buyer: AllegroBuyer;
  payment: AllegroPayment;
  status: AllegroOrderStatus;
  fulfillment: AllegroFulfillment;
  delivery: AllegroDelivery;
  invoice: AllegroInvoice;
  lineItems: AllegroLineItem[];
  surcharges: unknown[];
  note: string | null;
  marketplace: { id: string };
  summary: AllegroSummary;
  updatedAt: string;
  revision: string;
}

export interface AllegroBuyer {
  id: string;
  email: string;
  login: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  guest: boolean;
  personalIdentity: string | null;
  phoneNumber: string | null;
  preferences: { language: string };
  address: {
    street: string;
    city: string;
    postCode: string;
    countryCode: string;
  };
}

export interface AllegroPayment {
  id: string;
  type: string;
  provider: string;
  finishedAt: string | null;
  paidAmount: AllegroMoney;
  reconciliation: unknown | null;
  features: string[];
}

export interface AllegroMoney {
  amount: string;
  currency: string;
}

export interface AllegroFulfillment {
  status: AllegroFulfillmentStatus;
  shipmentSummary: {
    lineItemsSent: 'NONE' | 'SOME' | 'ALL';
  };
  provider: { id: string };
}

export interface AllegroDelivery {
  address: AllegroDeliveryAddress;
  method: {
    id: string;
    name: string;
  };
  pickupPoint: unknown | null;
  cost: AllegroMoney;
  smart: boolean;
  time: {
    from: string;
    to: string;
    guaranteed: unknown | null;
    dispatch: {
      from: string;
      to: string;
    };
  };
  calculatedNumberOfPackages: number;
  cancellation: unknown | null;
}

export interface AllegroDeliveryAddress {
  firstName: string;
  lastName: string;
  street: string;
  city: string;
  zipCode: string;
  countryCode: string;
  companyName: string | null;
  phoneNumber: string | null;
  modifiedAt: string | null;
}

export interface AllegroInvoice {
  required: boolean;
  address: unknown | null;
  dueDate: string | null;
  features: unknown | null;
}

export interface AllegroLineItem {
  id: string;
  offer: {
    id: string;
    name: string;
    external: {
      id: string;
    } | null;
    productSet: unknown | null;
  };
  quantity: number;
  originalPrice: AllegroMoney;
  price: AllegroMoney;
  reconciliation: unknown | null;
  selectedAdditionalServices: unknown[];
  vouchers: unknown[];
  tax: {
    rate: string;
    subject: string;
    exemption: string | null;
  };
  boughtAt: string;
  discounts: unknown | null;
  deposit: unknown | null;
}

export interface AllegroSummary {
  totalToPay: AllegroMoney;
}

// ─── Status Types ────────────────────────────────────────────────────

export type AllegroOrderStatus = 'BOUGHT' | 'FILLED_IN' | 'READY_FOR_PROCESSING' | 'CANCELLED';

export type AllegroFulfillmentStatus =
  | 'NEW'
  | 'PROCESSING'
  | 'READY_FOR_SHIPMENT'
  | 'READY_FOR_PICKUP'
  | 'SENT'
  | 'PICKED_UP'
  | 'CANCELLED'
  | 'SUSPENDED'
  | 'RETURNED';

/**
 * Maps Allegro order status + fulfillment status to a human-readable label.
 */
export const ALLEGRO_ORDER_STATUS_MAP: Record<string, string> = {
  BOUGHT: 'BOUGHT',
  FILLED_IN: 'FILLED_IN',
  READY_FOR_PROCESSING: 'READY_FOR_PROCESSING',
  CANCELLED: 'CANCELLED',
} as const;

export const ALLEGRO_FULFILLMENT_STATUS_MAP: Record<string, string> = {
  NEW: 'NEW',
  PROCESSING: 'PROCESSING',
  READY_FOR_SHIPMENT: 'READY_FOR_SHIPMENT',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  SENT: 'SENT',
  PICKED_UP: 'PICKED_UP',
  CANCELLED: 'CANCELLED',
  SUSPENDED: 'SUSPENDED',
  RETURNED: 'RETURNED',
} as const;

// ─── Carrier Types ──────────────────────────────────────────────────

/**
 * Response from GET /order/carriers
 */
export interface AllegroCarriersResponse {
  carriers: AllegroCarrier[];
}

export interface AllegroCarrier {
  id: string;
  name?: string;
}

// ─── Shipment & Fulfillment Update Types ─────────────────────────────

/**
 * Request body for POST /order/checkout-forms/{id}/shipments
 */
export interface AllegroAddShipmentRequest {
  carrierId: string;
  waybill: string;
  carrierName?: string;
  lineItems?: Array<{ id: string }>;
}

/**
 * Request body for PUT /order/checkout-forms/{id}/fulfillment
 */
export interface AllegroFulfillmentUpdateRequest {
  status: AllegroFulfillmentStatus;
  shipmentSummary?: {
    lineItemsSent: 'NONE' | 'SOME' | 'ALL';
  };
}

// ─── OAuth Token Types ───────────────────────────────────────────────

/**
 * Response from POST https://allegro.pl/auth/oauth/token
 */
export interface AllegroTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  allegro_api: boolean;
  jti: string;
}

/**
 * Allegro content type header value.
 * WHY: Allegro requires this specific content type, not standard application/json.
 */
export const ALLEGRO_CONTENT_TYPE = 'application/vnd.allegro.public.v1+json';
