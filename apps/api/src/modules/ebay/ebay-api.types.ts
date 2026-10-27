/**
 * eBay Trading API — TypeScript Interfaces
 *
 * Type definitions for eBay Trading API XML responses.
 * Covers GetOrders, CompleteSale, and related operations.
 *
 * API Documentation:
 * - GetOrders: https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetOrders.html
 * - CompleteSale: https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/CompleteSale.html
 *
 * Notes:
 * - eBay uses XML, not JSON (SOAP-style POST with XML body)
 * - Currency values have `currencyID` attributes (e.g., currencyID="GBP")
 * - Variation SKU takes priority over Item SKU
 * - Email addresses may show as "Invalid Request" (use BuyerUserID instead)
 */

/**
 * eBay Order Status Values
 *
 * These appear in the `OrderStatus` field of the GetOrders response.
 */
export enum EbayOrderStatus {
  ACTIVE = 'Active',              // Buyer hasn't paid yet
  IN_PROCESS = 'InProcess',       // Payment processing
  COMPLETED = 'Completed',        // Paid, ready for fulfillment
  CANCELLED = 'Cancelled',        // Order cancelled
  CANCEL_PENDING = 'CancelPending', // Cancellation requested
}

/**
 * eBay Cancellation Status Values
 *
 * These appear in the `CancelStatus` field when a cancellation is requested.
 */
export enum EbayCancelStatus {
  NOT_APPLICABLE = 'NotApplicable',     // No cancellation
  CANCEL_PENDING = 'CancelPending',     // Cancellation requested by buyer
  CANCEL_REQUESTED = 'CancelRequested', // Seller requested cancellation
  CANCELLED = 'Cancelled',              // Cancellation completed
  INVALID = 'Invalid',                  // Invalid cancellation request
}

/**
 * eBay Checkout Status
 *
 * Contains payment and shipping completion flags.
 */
export interface EbayCheckoutStatus {
  eBayPaymentStatus?: string;      // NoPaymentFailure, BuyerECheckBounced, etc.
  LastModifiedTime?: string;       // ISO 8601 timestamp
  PaymentMethod?: string;          // PayPal, CreditCard, etc.
  Status?: string;                 // Complete, Incomplete, Pending
}

/**
 * eBay Shipping Details
 *
 * Contains shipping method and status information.
 */
export interface EbayShippingDetails {
  SellingManagerSalesRecordNumber?: number;
  ShippingServiceOptions?: {
    ShippingService?: string;      // e.g., 'UK_RoyalMailFirstClassStandard'
    ShippingServiceCost?: {
      _text?: string;
      currencyID?: string;
    };
  };
}

/**
 * eBay Buyer Information
 *
 * Contains buyer details (may have email masked).
 */
export interface EbayBuyer {
  Email?: string;                  // Often shows "Invalid Request" (API quirk)
  UserID?: string;                 // Use this instead of email (e.g., "buyer123")
  BuyerInfo?: {
    ShippingAddress?: EbayAddress;
  };
}

/**
 * eBay Shipping Address
 *
 * Contains delivery address details.
 */
export interface EbayAddress {
  Name?: string;                   // Full name
  Street1?: string;
  Street2?: string;
  CityName?: string;
  StateOrProvince?: string;
  Country?: string;                // ISO 3166-1 alpha-2 (e.g., "GB", "US")
  CountryName?: string;            // Full country name
  Phone?: string;
  PostalCode?: string;
}

/**
 * eBay Money Type (with currency attribute)
 *
 * Many price fields in eBay XML responses include a currencyID attribute.
 * Example: <Total currencyID="GBP">29.99</Total>
 */
export interface EbayMoney {
  _text?: string;                  // The numeric value
  currencyID?: string;             // Currency code (GBP, USD, EUR, etc.)
}

/**
 * eBay Transaction (Single Product Line)
 *
 * Each order contains a TransactionArray with one or more transactions.
 * Each transaction represents one product purchased.
 */
export interface EbayTransaction {
  OrderLineItemID?: string;        // Unique product identifier (e.g., "12345-67890-12345")
  Buyer?: {
    Email?: string;                // Masked relay address (e.g., "abc123@members.ebay.com") or "Invalid Request"
    UserID?: string;               // Buyer's eBay username
    UserFirstName?: string;
    UserLastName?: string;
    VATStatus?: string;
  };
  Item?: {
    ItemID?: string;               // eBay listing ID
    SKU?: string;                  // Item-level SKU (use Variation/SKU if available)
    Title?: string;                // Product title
  };
  Variation?: {
    SKU?: string;                  // **ALWAYS USE THIS** over Item/SKU
    VariationTitle?: string;       // e.g., "Size: XL, Color: Blue"
    VariationSpecifics?: {
      NameValueList?: Array<{
        Name?: string;             // e.g., "Size"
        Value?: string;            // e.g., "XL"
      }>;
    };
  };
  QuantityPurchased?: number;      // Number of units
  TransactionPrice?: EbayMoney;    // Unit price (VAT included)
  ActualHandlingCost?: EbayMoney;  // Handling fee (if applicable)
  ActualShippingCost?: EbayMoney;  // Shipping cost (order-level, duplicated per transaction)
  Taxes?: {
    TotalTaxAmount?: EbayMoney;    // VAT amount for this product
    TaxDetails?: {
      TaxOnSubtotalAmount?: EbayMoney;
      TaxOnShippingAmount?: EbayMoney;
    };
  };
  CreatedDate?: string;            // Transaction creation timestamp
}

/**
 * eBay Order (Full Order Detail)
 *
 * This is the main order object returned by GetOrders.
 */
export interface EbayOrder {
  OrderID?: string;                // Unique order ID (e.g., "06-14288-98493")
  OrderStatus?: EbayOrderStatus;   // Active, Completed, Cancelled, etc.
  CancelStatus?: EbayCancelStatus; // Cancellation status (if applicable)
  CancelReason?: string;           // Reason for cancellation (e.g., "OutOfStock")
  CreatedTime?: string;            // ISO 8601 timestamp (order placed)
  CheckoutStatus?: EbayCheckoutStatus;
  ShippingDetails?: EbayShippingDetails;
  Buyer?: string;                  // Buyer's eBay username (use this, not Email)
  BuyerUserID?: string;            // Same as Buyer (for consistency)
  BuyerCheckoutMessage?: string;   // Buyer's note/message
  ShippingAddress?: EbayAddress;   // Delivery address
  Total?: EbayMoney;               // Order total (including shipping, VAT)
  Subtotal?: EbayMoney;            // Products subtotal (before shipping)
  AmountPaid?: EbayMoney;          // Amount paid by buyer
  ShippingServiceSelected?: {
    ShippingService?: string;      // Shipping method code
    ShippingServiceCost?: EbayMoney;
  };
  TransactionArray?: {
    Transaction?: EbayTransaction | EbayTransaction[]; // **Can be single object or array**
  };
  PaidTime?: string;               // When payment was completed
  ShippedTime?: string;            // When order was marked as shipped
}

/**
 * GetOrders API Response
 *
 * Root response from eBay GetOrders call.
 */
export interface EbayGetOrdersResponse {
  GetOrdersResponse?: {
    Timestamp?: string;            // API response timestamp
    Ack?: string;                  // Success, Warning, Failure
    Version?: string;              // API version (e.g., "1451")
    Build?: string;                // API build version
    OrderArray?: {
      Order?: EbayOrder | EbayOrder[]; // **Can be single object or array**
    };
    OrdersPerPage?: number;        // Number of orders per page (max 100)
    PageNumber?: number;           // Current page number
    ReturnedOrderCountActual?: number; // Orders returned in this response
    HasMoreOrders?: boolean;       // True if more pages available
    Errors?: {
      ShortMessage?: string;
      LongMessage?: string;
      ErrorCode?: string;
      SeverityCode?: string;
    };
  };
}

/**
 * OAuth Token Response
 *
 * Response from eBay OAuth token endpoint.
 */
export interface EbayOAuthTokenResponse {
  access_token: string;            // Access token for API calls
  expires_in: number;              // Token lifetime in seconds (7200 = 2 hours)
  token_type: string;              // Usually "User Access Token"
}

/**
 * CompleteSale API Response
 *
 * Response from eBay CompleteSale call (mark order as shipped).
 */
export interface EbayCompleteSaleResponse {
  CompleteSaleResponse?: {
    Timestamp?: string;
    Ack?: string;                  // Success, Warning, Failure
    Version?: string;
    Build?: string;
    Errors?: {
      ShortMessage?: string;
      LongMessage?: string;
      ErrorCode?: string;
      SeverityCode?: string;
    };
  };
}

/**
 * eBay Order Status Map
 *
 * Maps eBay OrderStatus to human-readable strings.
 */
export const EBAY_ORDER_STATUS_MAP: Record<string, string> = {
  Active: 'Awaiting Payment',
  InProcess: 'Processing',
  Completed: 'Pending',
  Cancelled: 'Cancelled',
  CancelPending: 'On Hold',
};
