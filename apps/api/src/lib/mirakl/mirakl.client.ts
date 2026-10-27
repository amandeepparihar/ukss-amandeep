/**
 * Mirakl API Client for Debenhams
 * 
 * Handles offer updates and import status tracking for Mirakl-based marketplaces
 * API Documentation: Mirakl OF01, OF02, OF03 endpoints
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../../config';
import { createLogger } from '../logger';
import { nanoid } from 'nanoid';

export interface MiraklOffer {
  shop_sku: string;      // UPC/Barcode
  price?: number;
  quantity?: number;
  state_code?: string;   // e.g., "11" for active
  update_delete: 'update' | 'delete';
}

export interface MiraklUpdateResponse {
  import_id: number;
}

export interface MiraklImportStatus {
  date_created: string;
  has_error_report: boolean;
  import_id: number;
  lines_in_error: number;
  lines_in_pending: number;
  lines_in_success: number;
  lines_read: number;
  mode: string;
  offer_deleted: number;
  offer_inserted: number;
  offer_updated: number;
  status: 'WAITING' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  type: string;
}

export interface MiraklApiResponse {
  success: boolean;
  importId?: number;
  status?: MiraklImportStatus;
  errorReport?: string;
  error?: string;
  errorCode?: string;
  correlationId?: string;
}

export interface ListingForBatch {
  listing_id: number;
  marketplace_item_id: string;
  product_sku: string;
  upc: string;
  current_quantity: number;
  current_price: number;
  last_synced_quantity: number | null;
  last_synced_price: number | null;
}

export class MiraklClient {
  private axiosInstance: AxiosInstance;
  private marketplace: string;
  private logger: ReturnType<typeof createLogger>;
  private requestLogger: ReturnType<typeof createLogger>;
  private responseLogger: ReturnType<typeof createLogger>;

  constructor(marketplace: string = 'debenhams') {
    this.marketplace = marketplace.toLowerCase();

    // Create marketplace-specific loggers
    this.logger = createLogger(`marketplace-sync-${this.marketplace}`);
    this.requestLogger = createLogger(`marketplace-sync-request-${this.marketplace}`);
    this.responseLogger = createLogger(`marketplace-sync-response-${this.marketplace}`);

    // Get configuration from environment
    const isTestEnv = config.MIRAKL_TEST_ENVIRONMENT || false;
    const baseURL = isTestEnv
      ? config.MIRAKL_DEBENHAMS_STAGING_URL || 'https://debenhamsuk-dev.mirakl.net'
      : config.MIRAKL_DEBENHAMS_PRODUCTION_URL || 'https://debenhamsuk.mirakl.net';
    
    const apiKey = config.MIRAKL_DEBENHAMS_API_KEY || '';

    if (!apiKey) {
      throw new Error('Mirakl API key not configured');
    }

    // Initialize axios instance
    this.axiosInstance = axios.create({
      baseURL,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      timeout: 30000, // 30 seconds
    });

    this.logger.info(
      { marketplace: this.marketplace, baseURL, isTestEnv },
      'Mirakl API client initialized'
    );
  }

  /**
   * Update offers on Mirakl
   * OF01 - Import offers to update or delete
   */
  async updateOffers(storeId: number, offers: MiraklOffer[]): Promise<MiraklApiResponse> {
    const correlationId = `MIRAKL_${storeId}_${Date.now()}_${nanoid(8)}`;
    
    const payload = { offers };

    this.requestLogger.info({
      correlationId,
      storeId,
      marketplace: this.marketplace,
      offerCount: offers.length,
      payload,
    }, 'Updating offers on Mirakl');

    try {
      const startTime = Date.now();
      const response = await this.axiosInstance.post<MiraklUpdateResponse>('/api/offers', payload);
      const duration = Date.now() - startTime;

      this.responseLogger.info({
        correlationId,
        storeId,
        marketplace: this.marketplace,
        duration,
        importId: response.data.import_id,
        response: response.data,
      }, 'Offers update response received');

      return {
        success: true,
        importId: response.data.import_id,
        correlationId,
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      const errorCode = error.response?.status?.toString() || 'API_ERROR';

      this.logger.error({
        correlationId,
        storeId,
        marketplace: this.marketplace,
        errorCode,
        errorMessage,
        errorData: error.response?.data,
      }, 'Failed to update offers');

      return {
        success: false,
        error: errorMessage,
        errorCode,
        correlationId,
      };
    }
  }

  /**
   * Get import status
   * OF02 - Get information and statistics about an offer import
   */
  async getImportStatus(storeId: number, importId: number): Promise<MiraklApiResponse> {
    const correlationId = `MIRAKL_STATUS_${storeId}_${Date.now()}_${nanoid(8)}`;

    this.requestLogger.info({
      correlationId,
      storeId,
      marketplace: this.marketplace,
      importId,
    }, 'Checking import status');

    try {
      const startTime = Date.now();
      const response = await this.axiosInstance.get<MiraklImportStatus>(
        `/api/offers/imports/${importId}`
      );
      const duration = Date.now() - startTime;

      this.responseLogger.info({
        correlationId,
        storeId,
        marketplace: this.marketplace,
        duration,
        importId,
        status: response.data,
      }, 'Import status retrieved');

      return {
        success: true,
        status: response.data,
        correlationId,
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      const errorCode = error.response?.status?.toString() || 'API_ERROR';

      this.logger.error({
        correlationId,
        storeId,
        marketplace: this.marketplace,
        importId,
        errorCode,
        errorMessage,
      }, 'Failed to get import status');

      return {
        success: false,
        error: errorMessage,
        errorCode,
        correlationId,
      };
    }
  }

  /**
   * Get error report for a failed import
   * OF03 - Get the error report file for an offer import
   */
  async getErrorReport(storeId: number, importId: number): Promise<MiraklApiResponse> {
    const correlationId = `MIRAKL_ERROR_${storeId}_${Date.now()}_${nanoid(8)}`;

    this.requestLogger.info({
      correlationId,
      storeId,
      marketplace: this.marketplace,
      importId,
    }, 'Fetching error report');

    try {
      const startTime = Date.now();
      const response = await this.axiosInstance.get(
        `/api/offers/imports/${importId}/error_report`,
        {
          headers: {
            'Accept': 'application/octet-stream',
          },
          responseType: 'text',
        }
      );
      const duration = Date.now() - startTime;

      this.responseLogger.info({
        correlationId,
        storeId,
        marketplace: this.marketplace,
        duration,
        importId,
        errorReport: response.data,
      }, 'Error report retrieved');

      return {
        success: true,
        errorReport: response.data,
        correlationId,
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      const errorCode = error.response?.status?.toString() || 'API_ERROR';

      this.logger.error({
        correlationId,
        storeId,
        marketplace: this.marketplace,
        importId,
        errorCode,
        errorMessage,
      }, 'Failed to get error report');

      return {
        success: false,
        error: errorMessage,
        errorCode,
        correlationId,
      };
    }
  }

  /**
   * Create batches of offers based on batch size
   * Mirakl supports large batches, but we'll batch for manageability
   */
  createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Poll import status until complete or timeout
   * Recommended: Check every 5 minutes, max 1/minute
   * We use 30 seconds for faster feedback in sync operations
   */
  async waitForImportCompletion(
    storeId: number,
    importId: number,
    maxAttempts: number = 12, // 12 attempts
    delayMs: number = 30000    // 30 seconds between checks
  ): Promise<MiraklImportStatus | null> {
    this.logger.info(
      { storeId, importId, maxAttempts, delayMs },
      'Waiting for import completion'
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.getImportStatus(storeId, importId);

      if (!result.success || !result.status) {
        this.logger.warn({ storeId, importId, attempt }, 'Failed to get import status');
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      const status = result.status;
      this.logger.info(
        { storeId, importId, attempt, status: status.status, linesSuccess: status.lines_in_success, linesError: status.lines_in_error },
        'Import status check'
      );

      if (status.status === 'COMPLETE' || status.status === 'FAILED') {
        return status;
      }

      // Wait before next attempt
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    this.logger.warn({ storeId, importId }, 'Import status polling timed out');
    return null;
  }

  /**
   * Dummy method for compatibility with other marketplace clients
   * Not needed for Mirakl as authentication is done via API key in headers
   */
  async fetchAccessToken(jobId: string): Promise<string> {
    this.logger.debug({ jobId }, 'Mirakl uses API key authentication - no token fetch needed');
    return 'API_KEY_AUTH';
  }
}

export function createMiraklClient(marketplace: string = 'debenhams'): MiraklClient {
  return new MiraklClient(marketplace);
}
