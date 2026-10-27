/**
 * Marketplace Error Classes
 *
 * Typed errors for consistent error handling across all marketplace integrations.
 * Each error type carries specific context relevant to debugging.
 */

/**
 * Base error class for all marketplace-related errors.
 */
export class MarketplaceError extends Error {
  /** Error code for programmatic handling */
  readonly code: string;

  /** Name of the marketplace where error occurred */
  readonly marketplace?: string;

  /** Additional context about the error */
  readonly context?: Record<string, unknown>;

  /** Original error if this is wrapping another error */
  readonly cause?: Error;

  constructor(
    code: string,
    message: string,
    options?: {
      marketplace?: string;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'MarketplaceError';
    this.code = code;
    this.marketplace = options?.marketplace;
    this.context = options?.context;
    this.cause = options?.cause;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Convert error to JSON for logging.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      marketplace: this.marketplace,
      context: this.context,
      cause: this.cause?.message,
      stack: this.stack,
    };
  }
}

/**
 * Authentication error - invalid credentials or token expired.
 */
export class AuthenticationError extends MarketplaceError {
  constructor(message: string, marketplace?: string, cause?: Error) {
    super('AUTH_ERROR', message, { marketplace, cause });
    this.name = 'AuthenticationError';
  }
}

/**
 * Rate limit error - too many requests to marketplace API.
 */
export class RateLimitError extends MarketplaceError {
  /** Seconds to wait before retrying (from Retry-After header) */
  readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number, marketplace?: string) {
    super('RATE_LIMIT', message, {
      marketplace,
      context: { retryAfter },
    });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * HTTP error - non-2xx response from marketplace API.
 */
export class HttpError extends MarketplaceError {
  /** HTTP status code */
  readonly statusCode: number;

  /** Response body from the API */
  readonly responseBody?: unknown;

  /** Request URL that failed */
  readonly url?: string;

  /** HTTP method used */
  readonly method?: string;

  constructor(
    statusCode: number,
    message: string,
    options?: {
      responseBody?: unknown;
      url?: string;
      method?: string;
      marketplace?: string;
    }
  ) {
    super('HTTP_ERROR', message, {
      marketplace: options?.marketplace,
      context: {
        statusCode,
        url: options?.url,
        method: options?.method,
      },
    });
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.responseBody = options?.responseBody;
    this.url = options?.url;
    this.method = options?.method;
  }

  /**
   * Check if this is a client error (4xx).
   */
  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  /**
   * Check if this is a server error (5xx).
   */
  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  /**
   * Check if this error is retryable.
   */
  isRetryable(): boolean {
    const retryableCodes = [429, 500, 502, 503, 504];
    return retryableCodes.includes(this.statusCode);
  }
}

/**
 * Validation error - invalid request data.
 */
export class ValidationError extends MarketplaceError {
  /** Field-level validation errors */
  readonly fields?: Record<string, string>;

  constructor(message: string, fields?: Record<string, string>, marketplace?: string) {
    super('VALIDATION_ERROR', message, {
      marketplace,
      context: { fields },
    });
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

/**
 * Network error - connection issues, DNS failures, etc.
 */
export class NetworkError extends MarketplaceError {
  constructor(message: string, cause?: Error, marketplace?: string) {
    super('NETWORK_ERROR', message, { marketplace, cause });
    this.name = 'NetworkError';
  }

  /**
   * Network errors are always retryable.
   */
  isRetryable(): boolean {
    return true;
  }
}

/**
 * Timeout error - request took too long.
 */
export class TimeoutError extends MarketplaceError {
  /** Configured timeout in milliseconds */
  readonly timeoutMs: number;

  /** Request URL that timed out */
  readonly url?: string;

  constructor(timeoutMs: number, url?: string, marketplace?: string) {
    super('TIMEOUT', `Request timed out after ${timeoutMs}ms`, {
      marketplace,
      context: { timeoutMs, url },
    });
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.url = url;
  }

  /**
   * Timeout errors are retryable.
   */
  isRetryable(): boolean {
    return true;
  }
}

/**
 * Configuration error - invalid marketplace configuration.
 */
export class ConfigurationError extends MarketplaceError {
  constructor(message: string, marketplace?: string) {
    super('CONFIG_ERROR', message, { marketplace });
    this.name = 'ConfigurationError';
  }
}

/**
 * Parse error - failed to parse API response.
 */
export class ParseError extends MarketplaceError {
  /** Raw content that failed to parse */
  readonly rawContent?: string;

  /** Expected format (json, xml, csv) */
  readonly expectedFormat?: string;

  constructor(
    message: string,
    options?: {
      rawContent?: string;
      expectedFormat?: string;
      cause?: Error;
      marketplace?: string;
    }
  ) {
    super('PARSE_ERROR', message, {
      marketplace: options?.marketplace,
      cause: options?.cause,
      context: {
        expectedFormat: options?.expectedFormat,
      },
    });
    this.name = 'ParseError';
    this.rawContent = options?.rawContent?.substring(0, 1000); // Truncate for logging
    this.expectedFormat = options?.expectedFormat;
  }
}

/**
 * Check if an error is retryable.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.isRetryable();
  }
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    return true;
  }
  if (error instanceof RateLimitError) {
    return true;
  }
  return false;
}

/**
 * Wrap an unknown error in a MarketplaceError.
 */
export function wrapError(error: unknown, marketplace?: string): MarketplaceError {
  if (error instanceof MarketplaceError) {
    return error;
  }

  if (error instanceof Error) {
    // Check for common network error patterns
    if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      return new NetworkError(error.message, error, marketplace);
    }
    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      return new TimeoutError(30000, undefined, marketplace);
    }

    return new MarketplaceError('UNKNOWN_ERROR', error.message, {
      marketplace,
      cause: error,
    });
  }

  return new MarketplaceError('UNKNOWN_ERROR', String(error), { marketplace });
}
