/**
 * Marketplace Orders — Shared Infrastructure
 *
 * Reusable types, constants, and helpers for all marketplace order integrations.
 * Import from this barrel to get everything needed for a marketplace order service.
 *
 * @example
 * import {
 *   createExecutionContext,
 *   createOrderHttpClient,
 *   insertMarketPlaceOrderDetails,
 *   OrderStatus,
 *   type FetchOrdersResult,
 *   type TransformedOrderMap,
 * } from '../../marketplaces/orders';
 */

export * from './types';
export * from './constants';
export {
  createExecutionContext,
  createOrderHttpClient,
  logFetchSummary,
  logStatusPushSummary,
  sendOrderFailureEmail,
  sendOrderCancellationRequest,
  createFailedFetchResult,
  serializeError,
  getErrorMessage,
  insertMarketPlaceOrderDetails,
  getOrderStatus,
  getOrderStatusWithGlobalExternalId,
  getLastFetchedOrderDate,
  getOrderProductDetails,
  getProductVariationDataFromSKU,
  getStoreDetails,
  getStoreInfo,
  getEbayUkStoreInfo,
  getCurrencyDetails,
  type ExecutionContext,
} from './base-order-service';
