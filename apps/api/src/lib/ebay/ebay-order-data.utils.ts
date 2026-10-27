/**
 * eBay Order Data Utilities
 *
 * Helper functions for parsing eBay XML responses and transforming order data.
 * These utilities handle eBay-specific quirks (email masking, variation SKUs, currency attributes).
 */

import { XMLParser } from 'fast-xml-parser';
import type {
  EbayGetOrdersResponse,
  EbayOrder,
  EbayTransaction,
  EbayOrderStatus,
  EbayCancelStatus,
} from '../../modules/ebay/ebay-api.types';
import { EBAY_ORDER_STATUS_MAP } from '../../modules/ebay/ebay-api.types';

/**
 * XML parser instance configured for eBay responses.
 *
 * Options:
 * - ignoreAttributes: false — Keep attributes (currencyID, etc.)
 * - attributeNamePrefix: '' — No prefix for attributes
 * - textNodeName: '_text' — Access text content via _text
 * - parseAttributeValue: true — Convert attribute values to correct types
 * - trimValues: true — Remove whitespace
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '_text',
  parseAttributeValue: true,
  trimValues: true,
  parseTagValue: false, // Don't auto-convert text nodes (keep as strings)
});

/**
 * Parse eBay XML response to JavaScript object.
 *
 * Generic XML parser for all eBay Trading API responses (GetOrders, CompleteSale, etc.).
 *
 * @param xmlString - Raw XML response from eBay API
 * @returns Parsed response object
 * @throws Error if XML parsing fails
 *
 * @example
 * const response = await axios.post(API_URL, xmlBody);
 * const parsed = parseEbayXmlResponse<EbayGetOrdersResponse>(response.data);
 * const orders = extractOrdersArray(parsed);
 */
export function parseEbayXmlResponse<T = any>(xmlString: string): T {
  try {
    return xmlParser.parse(xmlString) as T;
  } catch (error) {
    throw new Error(`Failed to parse eBay XML response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * @deprecated Use parseEbayXmlResponse instead
 * @see parseEbayXmlResponse
 */
export function parseGetOrdersResponse(xmlString: string): EbayGetOrdersResponse {
  return parseEbayXmlResponse<EbayGetOrdersResponse>(xmlString);
}

/**
 * Extract array of orders from GetOrders response.
 *
 * WHY: eBay XML returns either:
 * - Single order: { Order: { OrderID: "123", ... } }
 * - Multiple orders: { Order: [ { OrderID: "123" }, { OrderID: "456" } ] }
 *
 * This function normalizes both cases to always return an array.
 *
 * @param response - Parsed GetOrdersResponse object
 * @returns Array of EbayOrder objects
 *
 * @example
 * const orders = extractOrdersArray(parsedResponse);
 * orders.forEach(order => console.log(order.OrderID));
 */
export function extractOrdersArray(response: EbayGetOrdersResponse): EbayOrder[] {
  const orderArray = response.GetOrdersResponse?.OrderArray?.Order;

  if (!orderArray) {
    return [];
  }

  // Normalize single object to array
  return Array.isArray(orderArray) ? orderArray : [orderArray];
}

/**
 * Extract array of transactions from an order.
 *
 * WHY: Similar to orders, eBay returns transactions as either a single object or array.
 *
 * @param order - EbayOrder object
 * @returns Array of EbayTransaction objects
 *
 * @example
 * const transactions = extractTransactionsArray(order);
 * transactions.forEach(txn => console.log(txn.OrderLineItemID));
 */
export function extractTransactionsArray(order: EbayOrder): EbayTransaction[] {
  const transactionArray = order.TransactionArray?.Transaction;

  if (!transactionArray) {
    return [];
  }

  // Normalize single object to array
  return Array.isArray(transactionArray) ? transactionArray : [transactionArray];
}

/**
 * Get SKU from transaction (prioritize Variation/SKU over Item/SKU).
 *
 * WHY: eBay has two SKU fields:
 * - Variation/SKU: Specific variant SKU (e.g., "p-118576-3516" for size XL)
 * - Item/SKU: Generic listing SKU (may be empty or generic)
 *
 * ALWAYS use Variation/SKU if available.
 *
 * @param transaction - EbayTransaction object
 * @returns SKU string or null if not found
 *
 * @example
 * const sku = getTransactionSku(txn);
 * // "p-118576-3516" (from Variation/SKU)
 */
export function getTransactionSku(transaction: EbayTransaction): string | null {
  // Priority 1: Variation SKU (most specific)
  if (transaction.Variation?.SKU) {
    return transaction.Variation.SKU;
  }

  // Priority 2: Item SKU (fallback)
  if (transaction.Item?.SKU) {
    return transaction.Item.SKU;
  }

  return null;
}

/**
 * Extract currency code from eBay Money object.
 *
 * WHY: eBay XML represents prices as:
 * <Total currencyID="GBP">29.99</Total>
 *
 * Parsed as: { _text: "29.99", currencyID: "GBP" }
 *
 * @param money - eBay Money object (with currencyID attribute)
 * @returns Currency code (e.g., "GBP") or "GBP" as default
 *
 * @example
 * const currency = extractCurrency(order.Total);
 * // "GBP"
 */
export function extractCurrency(money: { _text?: string; currencyID?: string } | undefined): string {
  return money?.currencyID || 'GBP'; // Default to GBP for UK eBay
}

/**
 * Extract numeric value from eBay Money object.
 *
 * @param money - eBay Money object
 * @returns Numeric value (e.g., 29.99) or 0 if not parseable
 *
 * @example
 * const total = extractMoneyValue(order.Total);
 * // 29.99
 */
export function extractMoneyValue(money: { _text?: string; currencyID?: string } | undefined): number {
  if (!money || !money._text) {
    return 0;
  }

  const parsed = parseFloat(money._text);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Get UKSS-compatible order status from eBay OrderStatus.
 *
 * Maps eBay status codes to human-readable strings.
 *
 * @param orderStatus - eBay OrderStatus value
 * @returns Mapped status string or "Unknown" if not found
 *
 * @example
 * getEbayOrderStatus('Completed') // → 'Pending'
 * getEbayOrderStatus('Cancelled') // → 'Cancelled'
 */
export function getEbayOrderStatus(orderStatus: string | undefined): string {
  if (!orderStatus) {
    return 'Unknown';
  }

  return EBAY_ORDER_STATUS_MAP[orderStatus] || 'Unknown';
}

/**
 * Calculate VAT per product unit.
 *
 * WHY: UK eBay prices include 20% VAT. If TaxAmount is not provided,
 * calculate VAT backwards from the price.
 *
 * Formula: VAT = (Price / 1.20) * 0.20
 *
 * @param unitPrice - Product unit price (VAT included)
 * @param taxAmount - Tax amount from API (if available)
 * @returns VAT per unit
 *
 * @example
 * calculateVatPerUnit(29.99, 0) // → 5.00 (calculated)
 * calculateVatPerUnit(29.99, 5.00) // → 5.00 (from API)
 */
export function calculateVatPerUnit(unitPrice: number, taxAmount: number): number {
  if (taxAmount > 0) {
    return taxAmount; // Use provided tax amount
  }

  // Calculate VAT backwards (20% UK VAT included in price)
  // Formula: VAT = (Price / 1.20) * 0.20
  const vatRate = 0.20; // 20%
  const priceExVat = unitPrice / (1 + vatRate);
  const vat = unitPrice - priceExVat;

  return Math.round(vat * 100) / 100; // Round to 2 decimal places
}

/** Regex for validating a standard email address format. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Get buyer email, with fallback to a synthetic address using BuyerUserID.
 *
 * WHY: eBay returns relay emails (e.g., "abc123@members.ebay.com") on most
 * transactions but may return garbage values like "Invalid Request" for older
 * orders or certain account types. We validate the format rather than checking
 * for specific strings so any non-email value is automatically rejected.
 * When no valid email is found we construct a deterministic synthetic address
 * using BuyerUserID so records are still unique and traceable.
 *
 * Priority:
 *   1. First Transaction.Buyer.Email that passes email format validation
 *   2. "{BuyerUserID}@members.ebay.com" using order-level BuyerUserID
 *   3. "{Buyer}@members.ebay.com" using the legacy Buyer field
 *   4. null if none of the above are available
 *
 * @param order - EbayOrder object
 * @returns Buyer email or synthetic "@members.ebay.com" address
 *
 * @example
 * getBuyerEmail(order) // → "abc123@members.ebay.com"  (from transaction)
 * getBuyerEmail(order) // → "john123@members.ebay.com" (synthetic fallback)
 */
export function getBuyerEmail(order: EbayOrder): string | null {
  // 1) Use the first transaction email that passes basic format validation
  const transactions = extractTransactionsArray(order);
  const email = transactions
    .map((txn) => txn.Buyer?.Email?.trim())
    .find((e) => e && EMAIL_REGEX.test(e));

  if (email) {
    return email.toLowerCase();
  }

  // 2) Fallback: build synthetic address from BuyerUserID / Buyer
  const userId = order.BuyerUserID || order.Buyer;
  return userId ? `${userId}@members.ebay.com` : null;
}

/**
 * Check if order has pagination (HasMoreOrders flag).
 *
 * @param response - Parsed GetOrdersResponse object
 * @returns True if more pages available
 *
 * @example
 * if (hasMoreOrders(response)) {
 *   // Fetch next page
 * }
 */
export function hasMoreOrders(response: EbayGetOrdersResponse): boolean {
  return response.GetOrdersResponse?.HasMoreOrders === true;
}

/**
 * Check if eBay API response indicates an error.
 *
 * WHY: eBay returns Ack='Warning' for successful requests with advisory messages
 * (deprecation notices, minor data issues). The response still contains valid data.
 * Only Ack='Failure' should be treated as an error.
 *
 * @param response - Parsed GetOrdersResponse object
 * @returns True if response has errors
 *
 * @example
 * if (isErrorResponse(response)) {
 *   console.error(response.GetOrdersResponse?.Errors);
 * }
 */
export function isErrorResponse(response: EbayGetOrdersResponse): boolean {
  const ack = response.GetOrdersResponse?.Ack;
  return ack === 'Failure';
}

/**
 * Get error message from eBay API response.
 *
 * @param response - Parsed GetOrdersResponse object
 * @returns Error message string or null if no error
 *
 * @example
 * const errorMsg = getErrorMessage(response);
 * if (errorMsg) {
 *   logger.error({ errorMsg }, 'eBay API error');
 * }
 */
export function getErrorMessage(response: EbayGetOrdersResponse): string | null {
  const errors = response.GetOrdersResponse?.Errors;

  if (!errors) {
    return null;
  }

  const shortMsg = errors.ShortMessage || '';
  const longMsg = errors.LongMessage || '';
  const errorCode = errors.ErrorCode || '';

  return `${shortMsg}${longMsg ? ` - ${longMsg}` : ''}${errorCode ? ` (Code: ${errorCode})` : ''}`;
}
