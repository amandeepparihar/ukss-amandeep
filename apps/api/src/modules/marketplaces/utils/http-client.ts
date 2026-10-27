/**
 * HTTP Client
 *
 * Robust HTTP client for marketplace API integrations.
 * Integrates authentication, rate limiting, and retry handling.
 */

import { createLogger } from '../../../lib/logger';
import { AuthProviderFactory, type AuthProvider } from './auth-provider';
import { RateLimiter } from './rate-limiter';
import { RetryHandler } from './retry-handler';
import {
  HttpError,
  NetworkError,
  TimeoutError,
  ParseError,
  wrapError,
} from './errors';
import type { AuthConfig, RateLimitConfig, RetryConfig } from '../config/types';

const logger = createLogger('http-client');

/**
 * HTTP client configuration.
 */
export interface HttpClientConfig {
  /** Base URL for all requests */
  baseUrl: string;

  /** Authentication configuration */
  auth?: AuthConfig;

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Rate limiting configuration */
  rateLimit?: RateLimitConfig;

  /** Retry configuration */
  retry?: RetryConfig;

  /** Marketplace name for logging and errors */
  marketplace?: string;
}

/**
 * Request options for HTTP client.
 */
export interface RequestOptions {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  /** URL path (appended to baseUrl) */
  path: string;

  /** Request body */
  body?: unknown;

  /** Additional headers */
  headers?: Record<string, string>;

  /** Content type (affects serialization) */
  contentType?: 'json' | 'xml' | 'form' | 'multipart';

  /** Override timeout for this request */
  timeout?: number;

  /** Query parameters */
  params?: Record<string, string | number | boolean>;

  /** Skip rate limiting for this request */
  skipRateLimit?: boolean;

  /** Skip retry for this request */
  skipRetry?: boolean;
}

/**
 * HTTP response with metadata.
 */
export interface HttpResponse<T> {
  /** Response data */
  data: T;

  /** HTTP status code */
  status: number;

  /** Response headers */
  headers: Record<string, string>;

  /** Request duration in milliseconds */
  duration: number;
}

/**
 * HTTP client for marketplace API integrations.
 */
export class HttpClient {
  private readonly config: HttpClientConfig;
  private readonly authProvider: AuthProvider;
  private readonly rateLimiter?: RateLimiter;
  private readonly retryHandler: RetryHandler;

  constructor(config: HttpClientConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };

    this.authProvider = AuthProviderFactory.create(config.auth);

    if (config.rateLimit) {
      this.rateLimiter = new RateLimiter(config.rateLimit);
    }

    this.retryHandler = new RetryHandler(config.retry);
  }

  /**
   * Make an HTTP request.
   *
   * @param options - Request options
   * @returns Response data
   */
  async request<T>(options: RequestOptions): Promise<T> {
    const response = await this.requestWithResponse<T>(options);
    return response.data;
  }

  /**
   * Make an HTTP request and return full response with metadata.
   *
   * @param options - Request options
   * @returns Full response with data, status, headers, and timing
   */
  async requestWithResponse<T>(options: RequestOptions): Promise<HttpResponse<T>> {
    // Apply rate limiting
    if (this.rateLimiter && !options.skipRateLimit) {
      await this.rateLimiter.acquire();
    }

    // Build the request
    const url = this.buildUrl(options.path, options.params);
    const requestInit = await this.buildRequest(options);

    // Execute with retry
    const execute = async (): Promise<HttpResponse<T>> => {
      const startTime = Date.now();

      try {
        const response = await this.doRequest(url, requestInit, options.timeout);
        const duration = Date.now() - startTime;

        // Log successful request
        this.logRequest(options, response.status, duration);

        // Parse response
        const data = await this.parseResponse<T>(response, options.contentType);

        return {
          data,
          status: response.status,
          headers: this.extractHeaders(response.headers),
          duration,
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        this.logError(options, error, duration);
        throw error;
      }
    };

    if (options.skipRetry) {
      return execute();
    }

    return this.retryHandler.execute(execute, `${options.method} ${options.path}`);
  }

  /**
   * Build full URL with query parameters.
   */
  private buildUrl(path: string, params?: Record<string, string | number | boolean>): string {
    // If path is already a full URL, use it directly
    const isFullUrl = path.startsWith('http://') || path.startsWith('https://');
    let url: string;

    if (isFullUrl) {
      url = path;
    } else {
      // Ensure path starts with /
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      url = `${this.config.baseUrl}${normalizedPath}`;
    }

    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        searchParams.append(key, String(value));
      }
      url += `?${searchParams.toString()}`;
    }

    return url;
  }

  /**
   * Build request init object.
   */
  private async buildRequest(options: RequestOptions): Promise<RequestInit> {
    // Get auth headers
    const authHeaders = await this.authProvider.getHeaders();
    const authBody = await this.authProvider.getBodyParams();

    // Build headers
    const headers: Record<string, string> = {
      ...this.getContentTypeHeader(options.contentType),
      ...authHeaders,
      ...options.headers,
    };

    // Build body
    let body: string | FormData | undefined;
    if (options.body || Object.keys(authBody).length > 0) {
      body = this.serializeBody(options.body, authBody, options.contentType);
    }

    return {
      method: options.method,
      headers,
      body,
    };
  }

  /**
   * Get content type header based on content type.
   */
  private getContentTypeHeader(contentType?: string): Record<string, string> {
    switch (contentType) {
      case 'xml':
        return { 'Content-Type': 'application/xml' };
      case 'form':
        return { 'Content-Type': 'application/x-www-form-urlencoded' };
      case 'multipart':
        return {}; // Let fetch set it with boundary
      default:
        return { 'Content-Type': 'application/json' };
    }
  }

  /**
   * Serialize request body based on content type.
   */
  private serializeBody(
    body: unknown,
    authBody: Record<string, string>,
    contentType?: string
  ): string | FormData {
    // Merge auth body params if any
    const mergedBody =
      typeof body === 'object' && body !== null
        ? { ...authBody, ...(body as Record<string, unknown>) }
        : Object.keys(authBody).length > 0
        ? authBody
        : body;

    switch (contentType) {
      case 'xml':
        return mergedBody as string;

      case 'form':
        if (typeof mergedBody === 'object' && mergedBody !== null) {
          return new URLSearchParams(
            mergedBody as Record<string, string>
          ).toString();
        }
        return String(mergedBody);

      case 'multipart':
        const formData = new FormData();
        if (typeof mergedBody === 'object' && mergedBody !== null) {
          for (const [key, value] of Object.entries(mergedBody)) {
            formData.append(key, value as string | Blob);
          }
        }
        return formData;

      default:
        return JSON.stringify(mergedBody);
    }
  }

  /**
   * Execute the actual HTTP request.
   */
  private async doRequest(
    url: string,
    init: RequestInit,
    timeout?: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = timeout || this.config.timeout || 30000;

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check for HTTP errors
      if (!response.ok) {
        const responseBody = await this.tryParseErrorBody(response);
        throw new HttpError(response.status, response.statusText, {
          responseBody,
          url,
          method: init.method,
          marketplace: this.config.marketplace,
        });
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError(timeoutMs, url, this.config.marketplace);
      }

      // Handle network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError(error.message, error, this.config.marketplace);
      }

      // Re-throw known errors
      if (error instanceof HttpError) {
        throw error;
      }

      // Wrap unknown errors
      throw wrapError(error, this.config.marketplace);
    }
  }

  /**
   * Try to parse error response body.
   */
  private async tryParseErrorBody(response: Response): Promise<unknown> {
    try {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch {
      return undefined;
    }
  }

  /**
   * Parse response based on content type.
   */
  private async parseResponse<T>(
    response: Response,
    expectedType?: string
  ): Promise<T> {
    const contentType = response.headers.get('content-type') || '';

    try {
      // Empty response
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return undefined as T;
      }

      const text = await response.text();

      // Try to parse based on content type or expected type
      if (contentType.includes('json') || expectedType === 'json' || !expectedType) {
        try {
          return JSON.parse(text) as T;
        } catch {
          // If JSON parse fails and we didn't explicitly expect JSON, return text
          if (!contentType.includes('json') && expectedType !== 'json') {
            return text as T;
          }
          throw new ParseError('Failed to parse JSON response', {
            rawContent: text,
            expectedFormat: 'json',
            marketplace: this.config.marketplace,
          });
        }
      }

      // Return raw text for XML or other formats
      return text as T;
    } catch (error) {
      if (error instanceof ParseError) {
        throw error;
      }
      throw new ParseError('Failed to read response', {
        cause: error as Error,
        marketplace: this.config.marketplace,
      });
    }
  }

  /**
   * Extract headers from response.
   */
  private extractHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value;
    });
    return result;
  }

  /**
   * Log request completion (redacting sensitive info).
   */
  private logRequest(options: RequestOptions, status: number, duration: number): void {
    logger.debug(
      {
        method: options.method,
        path: options.path,
        status,
        duration,
        marketplace: this.config.marketplace,
      },
      `HTTP ${options.method} ${options.path} - ${status} (${duration}ms)`
    );
  }

  /**
   * Log request error (redacting sensitive info).
   */
  private logError(options: RequestOptions, error: unknown, duration: number): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        method: options.method,
        path: options.path,
        error: errorMessage,
        duration,
        marketplace: this.config.marketplace,
      },
      `HTTP ${options.method} ${options.path} failed: ${errorMessage}`
    );
  }

  /**
   * Make a GET request.
   */
  async get<T>(
    pathOrUrl: string,
    options?: Omit<RequestOptions, 'method' | 'path' | 'body'>
  ): Promise<HttpResponse<T>> {
    // Check if it's a full URL or just a path
    const isFullUrl = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://');
    const path = isFullUrl ? pathOrUrl : pathOrUrl;

    // If it's a full URL and we have a baseUrl, we need to handle it differently
    if (isFullUrl && this.config.baseUrl) {
      // Temporarily override baseUrl for this request
      const originalBaseUrl = this.config.baseUrl;
      this.config.baseUrl = '';
      try {
        return await this.requestWithResponse<T>({
          method: 'GET',
          path: pathOrUrl,
          ...options,
        });
      } finally {
        this.config.baseUrl = originalBaseUrl;
      }
    }

    return this.requestWithResponse<T>({
      method: 'GET',
      path,
      ...options,
    });
  }

  /**
   * Make a POST request.
   */
  async post<T>(
    pathOrUrl: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'path' | 'body'>
  ): Promise<HttpResponse<T>> {
    const isFullUrl = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://');

    if (isFullUrl && this.config.baseUrl) {
      const originalBaseUrl = this.config.baseUrl;
      this.config.baseUrl = '';
      try {
        return await this.requestWithResponse<T>({
          method: 'POST',
          path: pathOrUrl,
          body,
          ...options,
        });
      } finally {
        this.config.baseUrl = originalBaseUrl;
      }
    }

    return this.requestWithResponse<T>({
      method: 'POST',
      path: pathOrUrl,
      body,
      ...options,
    });
  }

  /**
   * Make a PUT request.
   */
  async put<T>(
    pathOrUrl: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'path' | 'body'>
  ): Promise<HttpResponse<T>> {
    const isFullUrl = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://');

    if (isFullUrl && this.config.baseUrl) {
      const originalBaseUrl = this.config.baseUrl;
      this.config.baseUrl = '';
      try {
        return await this.requestWithResponse<T>({
          method: 'PUT',
          path: pathOrUrl,
          body,
          ...options,
        });
      } finally {
        this.config.baseUrl = originalBaseUrl;
      }
    }

    return this.requestWithResponse<T>({
      method: 'PUT',
      path: pathOrUrl,
      body,
      ...options,
    });
  }

  /**
   * Make a DELETE request.
   */
  async delete<T>(
    pathOrUrl: string,
    options?: Omit<RequestOptions, 'method' | 'path' | 'body'>
  ): Promise<HttpResponse<T>> {
    const isFullUrl = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://');

    if (isFullUrl && this.config.baseUrl) {
      const originalBaseUrl = this.config.baseUrl;
      this.config.baseUrl = '';
      try {
        return await this.requestWithResponse<T>({
          method: 'DELETE',
          path: pathOrUrl,
          ...options,
        });
      } finally {
        this.config.baseUrl = originalBaseUrl;
      }
    }

    return this.requestWithResponse<T>({
      method: 'DELETE',
      path: pathOrUrl,
      ...options,
    });
  }

  /**
   * Get the rate limiter (for status checks).
   */
  getRateLimiter(): RateLimiter | undefined {
    return this.rateLimiter;
  }

  /**
   * Get the retry handler (for configuration checks).
   */
  getRetryHandler(): RetryHandler {
    return this.retryHandler;
  }
}

/**
 * Create an HTTP client with custom configuration.
 */
export function createHttpClient(config: HttpClientConfig): HttpClient {
  return new HttpClient(config);
}
