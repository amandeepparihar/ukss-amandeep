/**
 * Sportdeal Order Data Utilities
 *
 * Helper functions for parsing Sportdeal API responses.
 * The main transformation logic lives in sportdeal-order-service.ts.
 */

import { SPORTDEAL_ORDER_STATUS_MAP, type SportdealOrderItem } from '../../modules/sportdeal/sportdeal-api.types';

/**
 * Map a Sportdeal numeric order status to a human-readable string.
 *
 * Status codes are returned by the Sportdeal API in the `order_status` field.
 *
 * @param orderStatus - Numeric status code from Sportdeal API
 * @returns Human-readable status string (e.g., 'CONFIRMED', 'CANCELED', 'UNKNOWN')
 *
 * @example
 * getSportdealOrderStatus(20)  // → 'CONFIRMED'
 * getSportdealOrderStatus(25)  // → 'CANCELED'
 * getSportdealOrderStatus(99)  // → 'UNKNOWN'
 */
export function getSportdealOrderStatus(orderStatus: number): string {
  return SPORTDEAL_ORDER_STATUS_MAP[orderStatus] || 'UNKNOWN';
}

/**
 * Parse Sportdeal order items from the API response.
 *
 * WHY: The Sportdeal API inconsistently returns `order_items` as either:
 *   - A JSON string: '[ {"ean":"123","quantity":1,...} ]'
 *   - A parsed array: [ {"ean":"123","quantity":1,...} ]
 * This function normalizes both cases to an array.
 *
 * @param orderItems - The `order_items` field from the API (string or array)
 * @returns Parsed array of SportdealOrderItem
 *
 * @example
 * parseSportdealOrderItems('[{"ean":"123","quantity":1}]')  // → [{ean:"123",quantity:1}]
 * parseSportdealOrderItems([{ean:"123",quantity:1}])        // → [{ean:"123",quantity:1}]
 * parseSportdealOrderItems(undefined)                        // → []
 */
export function parseSportdealOrderItems(
  orderItems: string | SportdealOrderItem[] | undefined | null
): SportdealOrderItem[] {
  if (!orderItems) {
    return [];
  }

  if (typeof orderItems === 'string') {
    try {
      return JSON.parse(orderItems) as SportdealOrderItem[];
    } catch {
      return [];
    }
  }

  if (Array.isArray(orderItems)) {
    return orderItems;
  }

  return [];
}
