/**
 * Debenhams (Mirakl) Marketplace Type Definitions
 *
 * TypeScript interfaces for Debenhams API data structures.
 */

// ============================================
// API Response Types
// ============================================

/**
 * Full response from GET /orders endpoint
 */
export interface DebenhamsFetchOrdersResponse {
    orders: DebenhamsOrder[];
    total_count: number;
  }
  
  /**
   * Debenhams order structure from API
   */
  export interface DebenhamsOrder {
    order_id: string;
    commercial_id: string;
    created_date: string;
    last_updated_date: string;
    acceptance_decision_date?: string;
    customer_debited_date?: string;
    order_state: DebenhamsOrderState;
    order_state_reason_code?: string | null;
    order_state_reason_label?: string | null;
    currency_iso_code: string;
    price: number;
    shipping_price: number;
    total_price: number;
    total_commission: number;
    shipping_deadline?: string;
    shipping_type_code?: string;
    shipping_type_label?: string;
    shipping_type_standard_code?: string;
    shipping_zone_code?: string;
    shipping_zone_label?: string;
    shipping_carrier_code?: string | null;
    shipping_carrier_standard_code?: string | null;
    shipping_company?: string | null;
    shipping_tracking?: string | null;
    shipping_tracking_url?: string | null;
    shipping_pudo_id?: string | null;
    customer_notification_email: string;
    customer: DebenhamsCustomer;
    order_lines: DebenhamsOrderLine[];
    channel?: DebenhamsChannel;
    fulfillment?: DebenhamsFulfillment;
    delivery_date?: DebenhamsDeliveryDate;
    promotions?: DebenhamsPromotions;
    order_additional_fields?: DebenhamsAdditionalField[];
    order_refunds?: unknown | null;
    order_taxes?: unknown | null;
    order_tax_mode?: string;
    payment_type?: string;
    paymentType?: string;
    payment_workflow?: string;
    quote_id?: string | null;
    leadtime_to_ship?: number;
    can_cancel?: boolean;
    can_shop_ship?: boolean;
    customer_directly_pays_seller?: boolean;
    fully_refunded?: boolean;
    has_customer_message?: boolean;
    has_incident?: boolean;
    has_invoice?: boolean;
  }
  
  /**
   * Debenhams order states (Mirakl standard)
   */
  export type DebenhamsOrderState =
    | 'STAGING'
    | 'WAITING_ACCEPTANCE'
    | 'WAITING_DEBIT'
    | 'WAITING_DEBIT_PAYMENT'
    | 'SHIPPING'
    | 'SHIPPED'
    | 'TO_COLLECT'
    | 'RECEIVED'
    | 'CLOSED'
    | 'REFUSED'
    | 'CANCELED';
  
  /**
   * Debenhams order line (product) structure
   */
  export interface DebenhamsOrderLine {
    order_line_id: string;
    order_line_index: number;
    order_line_state: string;
    order_line_state_reason_code?: string | null;
    order_line_state_reason_label?: string | null;
    offer_id: number;
    offer_sku: string;
    offer_state_code?: string;
    product_sku: string;
    product_shop_sku: string;
    product_title: string;
    description?: string | null;
    category_code?: string;
    category_label?: string;
    price: number;
    price_unit: number;
    total_price: number;
    quantity: number;
    shipping_price: number;
    shipping_price_unit?: number | null;
    shipping_price_additional_unit?: number | null;
    commission_fee?: number;
    commission_vat?: number;
    commission_rate_vat?: number;
    total_commission?: number;
    created_date: string;
    last_updated_date: string;
    debited_date?: string;
    shipped_date?: string | null;
    received_date?: string | null;
    price_additional_info?: string | null;
    price_amount_breakdown?: DebenhamsPriceBreakdown;
    shipping_price_amount_breakdown?: DebenhamsPriceBreakdown;
    order_line_additional_fields?: DebenhamsAdditionalField[];
    product_medias?: DebenhamsProductMedia[];
    shipping_from?: DebenhamsShippingFrom;
    cancelations?: unknown[];
    refunds?: unknown[];
    fees?: unknown[];
    taxes?: unknown[];
    shipping_taxes?: unknown[];
    commission_taxes?: DebenhamsCommissionTax[];
    promotions?: unknown[];
    can_refund?: boolean;
  }
  
  /**
   * Customer information
   */
  export interface DebenhamsCustomer {
    customer_id: string;
    firstname: string;
    lastname: string;
    civility?: string | null;
    locale?: string;
    shipping_address: DebenhamsAddress;
    billing_address: DebenhamsAddress;
  }
  
  /**
   * Address structure
   */
  export interface DebenhamsAddress {
    firstname: string;
    lastname: string;
    street_1: string;
    street_2?: string | null;
    additional_info?: string | null;
    city: string;
    state?: string | null;
    zip_code: string;
    country: string;
    country_iso_code: string;
    phone?: string | null;
    company?: string | null;
    company_2?: string | null;
  }
  
  /**
   * Additional field (used for personalization)
   */
  export interface DebenhamsAdditionalField {
    code: string;
    type?: string;
    value: string;
  }
  
  /**
   * Channel information
   */
  export interface DebenhamsChannel {
    code: string;
    label: string;
  }
  
  /**
   * Fulfillment information
   */
  export interface DebenhamsFulfillment {
    center?: {
      code: string;
    };
  }
  
  /**
   * Delivery date range
   */
  export interface DebenhamsDeliveryDate {
    earliest: string;
    latest: string;
  }
  
  /**
   * Promotions summary
   */
  export interface DebenhamsPromotions {
    applied_promotions: unknown[];
    total_deduced_amount: number;
  }
  
  /**
   * Price breakdown
   */
  export interface DebenhamsPriceBreakdown {
    parts: Array<{
      amount: number;
      commissionable?: boolean;
      debitable_from_customer?: boolean;
      payable_to_shop?: boolean;
    }>;
  }
  
  /**
   * Product media
   */
  export interface DebenhamsProductMedia {
    media_url: string;
    mime_type: string;
    type: 'LARGE' | 'MEDIUM' | 'SMALL';
  }
  
  /**
   * Shipping from information
   */
  export interface DebenhamsShippingFrom {
    address?: {
      city?: string | null;
      country_iso_code?: string;
      state?: string | null;
      street_1?: string | null;
      street_2?: string | null;
      zip_code?: string | null;
    };
    warehouse?: string | null;
  }
  
  /**
   * Commission tax
   */
  export interface DebenhamsCommissionTax {
    amount: number;
    code: string;
    rate: number;
  }
  
  // ============================================
  // Parsed Data Types
  // ============================================
  
  /**
   * Parsed personalization data
   */
  export interface DebenhamsPersonalization {
    name: string;
    number: string;
    price?: number;
  }
  
  // ============================================
  // Service Result Types
  // ============================================
  
  /**
   * Order fetch result
   */
  export interface DebenhamsFetchOrdersResult {
    success: boolean;
    message: string;
    orderCount?: number;
    error?: string;
  }
  
  /**
   * Status update result
   */
  export interface DebenhamsStatusUpdateResult {
    success: boolean;
    processed: number;
    succeeded: number;
    failed: number;
    results?: Array<{
      mopId: number;
      orderId: string;
      status: string;
      success: boolean;
      error?: string;
    }>;
    error?: string;
  }
  
  /**
   * Single status update input
   */
  export interface DebenhamsStatusUpdateInput {
    mopId: number;
    orderId: string;
    ukssOrderId: string;
    orderLineId: string;
    quantity: number;
    status: string;
    trackingNumber?: string;
    trackingCarrier?: string;
  }
  
