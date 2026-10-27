/**
 * Error Serialization Utilities
 *
 * Pino (and JSON.stringify) cannot serialize JavaScript Error objects because
 * Error properties (message, stack, cause) are non-enumerable. These utilities
 * extract error details into plain objects suitable for structured logging.
 *
 * Usage:
 *   logger.error({ error: serializeError(err) }, 'Something failed');
 */

import { MarketplaceError } from '../../modules/marketplaces/utils/errors';

/**
 * Serialize any error into a plain object for Pino logging.
 *
 * Handles both standard Error objects and MarketplaceError instances.
 * Non-Error values are converted to string messages.
 *
 * @param error - The error to serialize (Error, MarketplaceError, or unknown)
 * @returns Plain object with message, stack, and cause properties
 *
 * @example
 * try { ... } catch (error) {
 *   logger.error({ error: serializeError(error) }, 'Request failed');
 * }
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof MarketplaceError) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error
        ? { message: error.cause.message, stack: error.cause.stack }
        : error.cause,
    };
  }

  return { message: String(error) };
}

/**
 * Format any error value into a human-readable message string.
 *
 * Useful for contexts where you need a single message string rather than
 * a full serialized object (e.g., email notifications, throw messages).
 *
 * @param error - The error to format
 * @returns A string error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
