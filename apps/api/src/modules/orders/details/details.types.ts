/**
 * Type definitions for order detail queries and responses.
 * Extracted from details.service.ts to stay under 500-line limit.
 */

// ---------------------------------------------------------------------------
// Raw query result types (database row shapes)
// ---------------------------------------------------------------------------

export interface CoreOrderRow {
  orders_id: number;
  customers_id: number;
  orders_status: number;
  orders_status_name: string | null;
  date_purchased: Date | string | null;
  ship_by_date: Date | string | null;
  order_total: number | null;
  currency: string | null;
  currency_value: number | null;
  payment_method: string | null;
  payment_module_code: string | null;
  shipping_method: string | null;
  shipping_module_code: string | null;
  customers_name: string | null;
  customers_company: string | null;
  customers_email_address: string | null;
  customers_telephone: string | null;
  ip_address: string | null;
  delivery_name: string | null;
  delivery_company: string | null;
  delivery_street_address: string | null;
  delivery_suburb: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  delivery_state: string | null;
  delivery_country: string | null;
  delivery_telephone: string | null;
  billing_name: string | null;
  billing_company: string | null;
  billing_street_address: string | null;
  billing_suburb: string | null;
  billing_city: string | null;
  billing_postcode: string | null;
  billing_state: string | null;
  billing_country: string | null;
  billing_telephone: string | null;
  amazon_order_id: string | null;
  mplaza_order_id: string | null;
  tesco_order_id: string | null;
  ebay_order_id: string | null;
  rakuten_order_id: string | null;
  lazada_order_id: string | null;
  priceministerorderid: string | null;
  gosport_order_id: string | null;
  catch_order_id: string | null;
  fruugo_order_id: string | null;
  decathlon_order_id: string | null;
  shopify_order_id: string | null;
  multisite_order_id: string | null;
  lock_for_review: string | null;
  sift_score: number | null;
  risk_score: number | null;
  riskified_decision: string | null;
  id_of_original_order: number | null;
  affiliate_commission_amount: number | null;
  affiliate_publishers_id: number | null;
  ref_keywords: string | null;
  ref_url: string | null;
  order_site: number | null;
  order_type: string | null;
  fc_order_id: string | null;
  fc_order_status: string | null;
  fc_auto_creation_bit: number | null;
  is_prime_order: string | null;
  courier_return_status: number | null;
}

export interface CustomerRow {
  customers_id: number;
  customers_firstname: string | null;
  customers_lastname: string | null;
  customers_telephone: string | null;
  customers_email_address: string | null;
  priority_customer: number | null;
  approve_customer: string | null;
  fraud_status: number | null;
}

export interface MarketplaceOrderRow { mo_order_id: string | null; mo_store_name: string | null; }
export interface LaybuyRow { laybuy_order_id: string | null; }
export interface TescoTrackingRow { parcel_tracking: string | null; }
export interface TrackingRow { tracking_no: string | null; }
export interface DhlRow { shipment_no: string | null; }
export interface RoyalMailRow { shipment_number: string | null; }
export interface DpdRow { parcel_number: string | null; consignment_number: string | null; shipment_no: string | null; }
export interface ScanRow { modified_date: Date | string | null; }
export interface ArchiveRow { process_archive: number | null; status: number | null; }

export interface PrevOrderRow {
  orders_id: number;
  date_purchased: Date | string | null;
  orders_status: number;
  orders_status_name: string | null;
  has_backorder: number;
  has_return: number;
}

export interface StoreRow {
  store_id: number;
  store_name: string | null;
  store_platform: string | null;
  store_logo: string | null;
}

export interface FcCheckRow { cnt: number; }
export interface MatchRow { matching_member_name: string | null; }
export interface ExchangeRow { orders_id: number; }
export interface AffiliateRow { publishers_name: string | null; }
export interface LockTicketRow { extra_option: number | null; }
export interface ViewerRow { admin_name: string | null; }
export interface NavRow { orders_id: number; }

// ---------------------------------------------------------------------------
// Public response types
// ---------------------------------------------------------------------------

export interface AddressInfo {
  name: string;
  company: string;
  street: string;
  suburb: string;
  city: string;
  postcode: string;
  state: string;
  country: string;
}

export interface MarketplaceIds {
  amazon: string | null;
  mplaza: string | null;
  tesco: string | null;
  tescoTracking: string | null;
  ebay: string | null;
  rakuten: string | null;
  lazada: string | null;
  priceminister: string | null;
  gosport: string | null;
  catch: string | null;
  fruugo: string | null;
  decathlon: string | null;
  laybuy: string | null;
  shopify: string | null;
  multisite: string | null;
  moOrders: Array<{ orderId: string; storeName: string }>;
  fcOrderId: string | null;
  fcStatus: string | null;
}

export interface TrackingInfo {
  orderTracking: string[];
  dhl: string[];
  royalMail: string[];
  dpd: string[];
  lastScanDate: string | null;
  courierReturnStatus: number | null;
}

export interface PreviousOrder {
  orderId: number;
  datePurchased: string | null;
  status: number;
  statusName: string | null;
  isBackorder: boolean;
  isReturned: boolean;
}

export interface OrderDetailData {
  orderId: number;
  status: number;
  statusName: string;
  datePurchased: string | null;
  shipByDate: string | null;
  orderTotal: number | null;
  currency: string | null;
  currencyValue: number | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  orderSite: number | null;
  orderType: string | null;
  customer: {
    id: number;
    name: string;
    company: string;
    phone: string;
    email: string;
    ipAddress: string;
    isPriority: boolean;
    isApproved: boolean;
  };
  deliveryAddress: AddressInfo;
  billingAddress: AddressInfo;
  marketplaceIds: MarketplaceIds;
  tracking: TrackingInfo;
  metadata: {
    isExchange: boolean;
    originalOrderId: number | null;
    exchangeOrderId: number | null;
    siftScore: number | null;
    riskScore: number | null;
    riskifiedStatus: string | null;
    matchedBy: string | null;
    lockStatus: {
      isLocked: boolean;
      extraOption: number | null;
    };
  };
  processing: {
    archiveDisplay: string;
  };
  referral: {
    keywords: string | null;
    url: string | null;
  };
  paymentInfo: {
    method: string | null;
    previousOrders: PreviousOrder[];
    commissionAmount: number | null;
    affiliateName: string | null;
  };
  store: {
    id: number;
    name: string;
    logo: string | null;
    platform: string | null;
  };
  flags: {
    fraudStatus: number;
    processOrder: boolean;
    isGreenFc: boolean;
    baselinkerSource: string | null;
    isPrime: boolean;
    isDhl: boolean;
    lockForReview: boolean;
    fcOrderId: string | null;
    fcAutoCreationBit: number | null;
    courierReturnStatus: number | null;
  };
}
