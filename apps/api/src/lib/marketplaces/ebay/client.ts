/**
 * eBay Trading API Client
 * 
 * Uses official ebay-api npm package
 * https://www.npmjs.com/package/ebay-api
 */

import eBayApi from 'ebay-api';
import { EBayApiError } from 'ebay-api/lib/errors';
import { config } from '../../../config';
import { getLogger } from '../../logger-context';
import { nanoid } from 'nanoid';

// Note: Loggers are now created dynamically per instance to support multiple marketplaces
// See constructor for logger initialization

export interface EbayItem {
  ItemID: string;
  SKU?: string;
  Quantity?: number;
  Price?: number;
}

export interface EbayApiResponse {
  success: boolean;
  response: any;
  request: any;
  error?: string;
  errorCode?: string;
  ack?: string;
  correlationId?: string;
  partialFailureDetails?: PartialFailureDetail[];
}

export interface PartialFailureDetail {
  itemId?: string;
  sku?: string;
  errorCode: string;
  errorMessage: string;
  severityCode: 'Error' | 'Warning';
}

/**
 * Result of relisting a single ended eBay FixedPrice item. On success eBay mints
 * a NEW ItemID (the original ended listing stays ended); `newItemId` carries it so
 * the caller can update marketplace_item_identifier.
 */
export interface EbayRelistResult {
  success: boolean;
  /** The new ItemID eBay assigned to the relisted listing (success only). */
  newItemId?: string;
  errorCode?: string;
  errorMessage?: string;
  correlationId?: string;
}

/**
 * Live status of an eBay listing as resolved by GetItem:
 *  - 'active'    : listing is live on eBay (do NOT relist — would duplicate)
 *  - 'ended'     : listing exists but is Completed/Ended (relistable)
 *  - 'not-found' : eBay has no such item (gone for good / too old)
 *  - 'unknown'   : could not determine (transient API error) — treat conservatively
 */
export type EbayItemLiveStatus = 'active' | 'ended' | 'not-found' | 'unknown';

export interface ListingForBatch {
  listing_id: number;
  marketplace_item_id: string;
  product_sku: string;
  current_quantity: number;
  current_price: number;
  last_synced_quantity: number | null;
  last_synced_price: number | null;
}

export class EbayClient {
  private api: eBayApi;
  private isTestEnv: boolean;
  private marketplace: string;

  constructor(marketplace: string = 'ebay') {
    this.marketplace = marketplace.toLowerCase();
    this.isTestEnv = config.EBAY_TEST_ENVIRONMENT;

    // Initialize eBay API
    try {
      // Decode base64 authorization to get appId and certId
      const authorization = this.isTestEnv
        ? config.EBAY_API_AUTHORIZATION_SANDBOX
        : config.EBAY_API_AUTHORIZATION_LIVE;

      if (!authorization) {
        throw new Error('eBay API authorization not configured');
      }

      // Decode base64 (format is "appId:certId")
      const decoded = Buffer.from(authorization, 'base64').toString('utf-8');
      const [appId, certId] = decoded.split(':');

      this.api = new eBayApi({
        appId,
        certId,
        sandbox: this.isTestEnv,
        siteId: eBayApi.SiteId.EBAY_GB, // Default to UK, override per store
        autoRefreshToken: true, // Enable auto token refresh
      });

      getLogger().info(
        { marketplace: this.marketplace, sandbox: this.isTestEnv },
        'Marketplace API client initialized'
      );
    } catch (error) {
      getLogger().error({ marketplace: this.marketplace, error }, 'Failed to initialize marketplace API client');
      throw error;
    }
  }

  /**
   * Set OAuth token credentials
   * Uses the SDK's built-in method to set token
   */
  setOAuthToken(tokenData: any): void {
    // Set credentials using SDK's OAuth2 method
    this.api.OAuth2.setCredentials(tokenData);
  }

  /**
   * Fetch eBay OAuth access token using refresh token
   * Uses the SDK's built-in OAuth2 methods
   */
  async fetchAccessToken(jobId: string = 'SYNC'): Promise<string> {
    const correlationId = `EBAY_AUTH_${Date.now()}_${nanoid(8)}`;
    const refreshToken = this.isTestEnv
      ? config.EBAY_API_REFRESH_TOKEN_SANDBOX
      : config.EBAY_API_REFRESH_TOKEN_LIVE;

    if (!refreshToken) {
      throw new Error('eBay refresh token not configured');
    }

    getLogger().info(
      { correlationId, jobId, marketplace: this.marketplace, env: this.isTestEnv ? 'sandbox' : 'live' },
      'Fetching access token using SDK'
    );

    try {
      // Set the refresh token for the SDK to use
      this.api.OAuth2.setCredentials({
        access_token: '', // Will be refreshed
        expires_in: 0,
        refresh_token: refreshToken,
        refresh_token_expires_in: 0,
        token_type: 'User Access Token',
      });

      // Refresh the token using SDK's built-in method
      const token = await this.api.OAuth2.refreshToken();

      getLogger().info(
        { correlationId, jobId, marketplace: this.marketplace, expiresIn: token.expires_in },
        'Access token fetched successfully via SDK'
      );
      return token.access_token;
    } catch (error) {
      // Handle EBayApiError
      if (error instanceof EBayApiError) {
        const errorCode = error.errorCode?.toString() || 'OAUTH_ERROR';
        getLogger().error(
          { 
            correlationId, 
            jobId,
            marketplace: this.marketplace,
            errorCode,
            errorMessage: error.message,
            statusCode: error.meta?.res?.status 
          },
          'Failed to fetch access token - EBayApiError'
        );
        throw error;
      }

      getLogger().error(
        { correlationId, jobId, marketplace: this.marketplace, error },
        'Failed to fetch access token via SDK'
      );
      throw error;
    }
  }

  /**
   * Get rate limits using eBay Analytics API
   * 
   * @param apiContext - API context (e.g., 'tradingapi')
   * @param apiName - Optional API name filter
   * @returns Rate limit data from eBay
   */
  async getRateLimits(apiContext: string = 'tradingapi', apiName?: string): Promise<any> {
    getLogger().info(
      { apiContext, apiName, marketplace: this.marketplace },
      'Fetching rate limits via SDK Analytics API'
    );

    try {
      const data = await this.api.developer.analytics.getRateLimits(apiContext, apiName);
      
      getLogger().debug(
        { apiContext, apiName, data },
        'Rate limits fetched successfully'
      );
      
      return data;
    } catch (error) {
      getLogger().error(
        { apiContext, apiName, error: error instanceof Error ? error.message : String(error) },
        'Failed to fetch rate limits via SDK'
      );
      throw error;
    }
  }

  /**
   * Call eBay ReviseInventoryStatus API
   * Using the official SDK's Trading API
   */
  async reviseInventoryStatus(
    storeId: number,
    items: EbayItem[],
    _accessToken: string // SDK uses the token set via OAuth2.setCredentials
  ): Promise<EbayApiResponse> {
    // Generate correlation ID for request/response tracking
    const correlationId = `${this.marketplace.toUpperCase()}_${storeId}_${Date.now()}_${nanoid(8)}`;
    
    // Validate inputs - ensure items array exists and is not empty
    if (!items || !Array.isArray(items) || items.length === 0) {
      return {
        success: false,
        response: null,
        request: null,
        error: 'No items provided for sync',
        errorCode: 'VALIDATION_EMPTY_ITEMS',
      };
    }

    if (items.length > 4) {
      return {
        success: false,
        response: null,
        request: null,
        error: 'eBay API limit: maximum 4 items per call',
        errorCode: 'VALIDATION_BATCH_SIZE_EXCEEDED',
      };
    }

    // Validate eBay listing restrictions
    const restrictionError = this.validateEbayListingRestrictions(items);
    if (restrictionError) {
      return {
        success: false,
        response: null,
        request: null,
        error: restrictionError.message,
        errorCode: restrictionError.code,
      };
    }

    // Set site ID for the store
    const siteId = this.getEbaySiteId(storeId);
    this.api.config.siteId = siteId;

    // Build inventory status items for the SDK
    const inventoryStatus = items.map((item) => {
      const status: any = {
        ItemID: item.ItemID,
      };

      if (item.SKU) {
        status.SKU = item.SKU;
      }

      if (item.Quantity !== undefined && item.Quantity !== null) {
        status.Quantity = item.Quantity;
      }

      if (item.Price !== undefined && item.Price !== null) {
        // Convert price to string without rounding
        status.StartPrice = item.Price.toString();
      }

      return status;
    });

    const requestPayload = { InventoryStatus: inventoryStatus };

    // Log request with correlation ID
    getLogger(`marketplace-sync-request-${this.marketplace}`).info(
      { 
        correlationId, 
        storeId,
        marketplace: this.marketplace,
        siteId,
        itemCount: items.length,
        method: 'ReviseInventoryStatus',
        payload: requestPayload 
      },
      'API Request'
    );

    const startTime = Date.now();

    try {
      getLogger().debug(
        { correlationId, storeId, marketplace: this.marketplace, itemCount: items.length, siteId },
        'Calling ReviseInventoryStatus API via SDK'
      );

      // Call the official SDK Trading API method
      // The SDK automatically handles OAuth token in the headers
      const response = await this.api.trading.ReviseInventoryStatus(requestPayload);

      const duration = Date.now() - startTime;

      // Log response with correlation ID
      getLogger(`marketplace-sync-response-${this.marketplace}`).info(
        {
          correlationId,
          storeId,
          marketplace: this.marketplace,
          duration,
          ack: response.Ack,
          response: response,
        },
        'API Response'
      );

      getLogger().debug(
        { correlationId, storeId, marketplace: this.marketplace, ack: response.Ack, duration },
        'SDK API response received'
      );

      // Check response acknowledgement
      if (response.Ack === 'Success' || response.Ack === 'Warning') {
        return {
          success: true,
          response,
          request: requestPayload,
          ack: response.Ack,
          correlationId,
        };
      }

      // Handle PartialFailure - some items succeeded, others failed
      if (response.Ack === 'PartialFailure') {
        const errorDetails = this.parseEbayErrors(response);
        
        // Count actual errors (not warnings)
        const actualErrors = errorDetails.filter(d => d.severityCode === 'Error');
        
        getLogger().warn(
          { 
            correlationId, 
            storeId,
            marketplace: this.marketplace,
            totalErrors: errorDetails.length,
            actualErrors: actualErrors.length,
            ack: response.Ack 
          },
          'API returned PartialFailure - some items failed'
        );

        return {
          success: true, // Consider PartialFailure as overall success
          response,
          request: requestPayload,
          ack: response.Ack,
          correlationId,
          partialFailureDetails: errorDetails,
        };
      }

      // Handle Failure - check if it contains mixed severity errors (Warning + Error)
      // eBay sometimes returns Ack='Failure' even when some items only have warnings
      if (response.Ack === 'Failure') {
        const errorDetails = this.parseEbayErrors(response);
        
        // Count actual errors (not warnings)
        const actualErrors = errorDetails.filter(d => d.severityCode === 'Error');
        const warningsOnly = errorDetails.filter(d => d.severityCode === 'Warning');
        
        // If there are any actual errors or warnings, treat as partial failure
        if (errorDetails.length > 0) {
          getLogger().warn(
            { 
              correlationId, 
              storeId,
              marketplace: this.marketplace,
              totalErrors: errorDetails.length,
              actualErrors: actualErrors.length,
              warnings: warningsOnly.length,
              ack: response.Ack 
            },
            'API returned Failure but contains item-level errors - treating as PartialFailure'
          );

          return {
            success: true, // Treat as success to allow granular processing
            response,
            request: requestPayload,
            ack: response.Ack,
            correlationId,
            partialFailureDetails: errorDetails,
          };
        }
        
        // If no parseable item-level errors, fall through to complete failure handling
      }

      // Extract error details from SDK response for complete failures
      const errors = Array.isArray(response.Errors) ? response.Errors : [response.Errors];
      const firstError = errors.find((e: any) => e) || {};
      const errorCode = firstError.ErrorCode || 'UNKNOWN_ERROR';
      const errorMessage =
        firstError.LongMessage || firstError.ShortMessage || 'Unknown error';

      getLogger().error(
        { 
          correlationId, 
          storeId,
          marketplace: this.marketplace,
          errorCode, 
          errorMessage,
          ack: response.Ack 
        },
        'API returned error response'
      );

      return {
        success: false,
        response,
        request: requestPayload,
        error: errorMessage,
        errorCode: errorCode.toString(),
        ack: response.Ack,
        correlationId,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Handle EBayApiError from the SDK
      if (error instanceof EBayApiError) {
        const errorCode = error.errorCode?.toString() || error.meta?.res?.status?.toString() || 'EBAY_API_ERROR';
        const errorMessage = error.message || 'eBay API error';
        const errorDetails = this.parseEbayErrors(error.meta);
        const hasItemLevelErrors = errorDetails.some((detail) => detail.itemId || detail.sku);
        
        // Log error response
        getLogger(`marketplace-sync-response-${this.marketplace}`).error(
          {
            correlationId,
            storeId,
            marketplace: this.marketplace,
            duration,
            errorCode,
            errorMessage,
            meta: error.meta,
          },
          'API Error Response'
        );

        getLogger().error(
          { 
            correlationId, 
            storeId,
            marketplace: this.marketplace,
            errorCode, 
            errorMessage,
            statusCode: error.meta?.res?.status 
          },
          'SDK API call failed with EBayApiError'
        );

        // The SDK can throw for Trading API Ack=Failure responses even when eBay
        // includes per-item ErrorParameters. Preserve those details so the adapter
        // stores the SKU-specific error instead of applying the first batch error
        // to every listing in the request.
        if (hasItemLevelErrors) {
          return {
            success: true,
            response: error.meta,
            request: requestPayload,
            error: errorMessage,
            errorCode,
            ack: error.meta?.Ack,
            correlationId,
            partialFailureDetails: errorDetails,
          };
        }

        return {
          success: false,
          response: null,
          request: requestPayload,
          error: errorMessage,
          errorCode,
          correlationId,
        };
      }

      // Handle generic errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      getLogger(`marketplace-sync-response-${this.marketplace}`).error(
        {
          correlationId,
          storeId,
          marketplace: this.marketplace,
          duration,
          error: errorMessage,
        },
        'API Exception'
      );

      getLogger().error(
        { correlationId, storeId, marketplace: this.marketplace, error: errorMessage },
        'SDK API call failed'
      );

      return {
        success: false,
        response: null,
        request: requestPayload,
        error: errorMessage,
        errorCode: 'API_EXCEPTION',
        correlationId,
      };
    }
  }

  /**
   * Relist an ended eBay FixedPrice listing via RelistFixedPriceItem.
   *
   * Used by the relist job when eBay reported a listing as ended (error 21916750)
   * but we still hold stock (> 0): rather than leave the listing dead, relist it.
   * eBay reuses the original listing's data and returns a NEW ItemID (the old one
   * stays ended). Quantity/StartPrice are overridden with the values we want live
   * immediately, so the relisted listing is correct from the moment it goes up.
   *
   * The original item must be relistable (eBay only allows relisting within ~90
   * days of ending and for accounts/items still in good standing); otherwise eBay
   * returns an error which is surfaced in the result for the caller to record.
   *
   * The OAuth token must already be set on the client (fetchAccessToken first),
   * exactly as reviseInventoryStatus requires.
   */
  async relistFixedPriceItem(
    storeId: number,
    itemId: string,
    quantity?: number,
    price?: number
  ): Promise<EbayRelistResult> {
    const correlationId = `${this.marketplace.toUpperCase()}_RELIST_${storeId}_${Date.now()}_${nanoid(8)}`;

    if (!itemId) {
      return { success: false, errorMessage: 'No ItemID provided for relist', errorCode: 'VALIDATION_EMPTY_ITEM_ID', correlationId };
    }

    const siteId = this.getEbaySiteId(storeId);
    this.api.config.siteId = siteId;

    // Only the ItemID is required; Quantity/StartPrice override the reused values.
    const item: any = { ItemID: itemId };
    if (quantity !== undefined && quantity !== null) item.Quantity = quantity;
    if (price !== undefined && price !== null) item.StartPrice = price.toString();
    const requestPayload = { Item: item };

    getLogger(`marketplace-sync-request-${this.marketplace}`).info(
      { correlationId, storeId, marketplace: this.marketplace, siteId, itemId, method: 'RelistFixedPriceItem', payload: requestPayload },
      'API Request'
    );

    const startTime = Date.now();

    try {
      const response = await this.api.trading.RelistFixedPriceItem(requestPayload);
      const duration = Date.now() - startTime;

      getLogger(`marketplace-sync-response-${this.marketplace}`).info(
        { correlationId, storeId, marketplace: this.marketplace, duration, ack: response?.Ack, newItemId: response?.ItemID, response },
        'API Response'
      );

      if (response?.Ack === 'Success' || response?.Ack === 'Warning') {
        const newItemId = response?.ItemID ? String(response.ItemID) : undefined;
        if (!newItemId) {
          // Ack success but no ItemID is anomalous — do not silently treat as relisted.
          return { success: false, errorMessage: 'Relist acknowledged but eBay returned no new ItemID', errorCode: 'RELIST_NO_ITEM_ID', correlationId };
        }
        return { success: true, newItemId, correlationId };
      }

      // Failure / PartialFailure: surface the first actual error.
      const details = this.parseEbayErrors(response);
      const firstError = details.find((d) => d.severityCode === 'Error') || details[0];
      const errorCode = firstError?.errorCode || 'RELIST_FAILED';
      const errorMessage = firstError?.errorMessage || 'Relist failed';

      getLogger().warn(
        { correlationId, storeId, marketplace: this.marketplace, itemId, ack: response?.Ack, errorCode, errorMessage },
        'RelistFixedPriceItem failed'
      );

      return { success: false, errorCode, errorMessage, correlationId };
    } catch (error) {
      const duration = Date.now() - startTime;
      if (error instanceof EBayApiError) {
        const errorCode = error.errorCode?.toString() || error.meta?.res?.status?.toString() || 'EBAY_API_ERROR';
        const errorMessage = error.message || 'eBay API error';
        getLogger(`marketplace-sync-response-${this.marketplace}`).error(
          { correlationId, storeId, marketplace: this.marketplace, duration, itemId, errorCode, errorMessage, meta: error.meta },
          'Relist API Error Response'
        );
        return { success: false, errorCode, errorMessage, correlationId };
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      getLogger().error(
        { correlationId, storeId, marketplace: this.marketplace, itemId, error: errorMessage },
        'RelistFixedPriceItem call failed'
      );
      return { success: false, errorMessage, errorCode: 'API_EXCEPTION', correlationId };
    }
  }

  /**
   * Parse eBay error response to extract item-level failure details
   * Handles both single errors and arrays of errors
   */
  private parseEbayErrors(response: any): PartialFailureDetail[] {
    const details: PartialFailureDetail[] = [];
    
    if (!response || !response.Errors) {
      return details;
    }

    // Normalize errors to array
    const errors = Array.isArray(response.Errors) ? response.Errors : [response.Errors];

    for (const error of errors) {
      if (!error) continue;

      const severityCode = error.SeverityCode || 'Error';
      const errorCode = error.ErrorCode?.toString() || 'UNKNOWN_ERROR';
      let errorMessage = error.LongMessage || error.ShortMessage || 'Unknown error';

      // Extract ItemID and SKU from ErrorParameters, and substitute eBay's
      // {N} placeholders (e.g. "Input data for tag <{0}>") with the parameter
      // values so the stored message names the offending tag instead of a
      // literal {0} (critical for diagnosing error 37 "Input data is invalid").
      let itemId: string | undefined;
      let sku: string | undefined;

      if (error.ErrorParameters) {
        const params = Array.isArray(error.ErrorParameters)
          ? error.ErrorParameters
          : [error.ErrorParameters];

        for (const param of params) {
          if (!param || param.ParamID === undefined || param.ParamID === null) continue;

          const value = param.Value?.toString() ?? '';
          errorMessage = errorMessage.split(`{${param.ParamID}}`).join(value);

          if (param.ParamID === 'ItemID') {
            itemId = value;
          } else if (param.ParamID === 'SKU') {
            sku = value;
          }
        }
      }

      details.push({
        itemId,
        sku,
        errorCode,
        errorMessage,
        severityCode,
      });
    }

    return details;
  }

  /**
   * Validate eBay listing restrictions
   */
  private validateEbayListingRestrictions(
    items: EbayItem[]
  ): { code: string; message: string } | null {
    for (const item of items) {
      // Validate ItemID format
      if (!item.ItemID || item.ItemID.trim() === '') {
        return {
          code: 'RESTRICTION_EMPTY_ITEM_ID',
          message: 'ItemID cannot be empty',
        };
      }

      if (!/^\d+$/.test(item.ItemID)) {
        return {
          code: 'RESTRICTION_INVALID_ITEM_ID',
          message: `Invalid ItemID format: ${item.ItemID}. Must be numeric.`,
        };
      }

      // Validate quantity restrictions
      if (item.Quantity !== undefined && item.Quantity !== null) {
        if (item.Quantity < 0) {
          return {
            code: 'RESTRICTION_NEGATIVE_QUANTITY',
            message: `Quantity cannot be negative: ${item.Quantity}`,
          };
        }

        if (item.Quantity > 999999) {
          return {
            code: 'RESTRICTION_QUANTITY_TOO_HIGH',
            message: `Quantity exceeds eBay maximum (999999): ${item.Quantity}`,
          };
        }
      }

      // Validate price restrictions
      if (item.Price !== undefined && item.Price !== null) {
        if (item.Price <= 0) {
          return {
            code: 'RESTRICTION_INVALID_PRICE',
            message: `Price must be greater than 0: ${item.Price}`,
          };
        }

        if (item.Price > 999999.99) {
          return {
            code: 'RESTRICTION_PRICE_TOO_HIGH',
            message: `Price exceeds eBay maximum (999999.99): ${item.Price}`,
          };
        }
      }

      // Validate SKU restrictions
      if (item.SKU && item.SKU.length > 50) {
        return {
          code: 'RESTRICTION_SKU_TOO_LONG',
          message: `SKU exceeds maximum length (50): ${item.SKU}`,
        };
      }
    }

    return null;
  }

  /**
   * Get eBay site ID for a store
   */
  getEbaySiteId(storeId: number): number {
    try {
      const siteIdMap = JSON.parse(config.EBAY_STORE_SITE_ID_MAP);
      if (siteIdMap && typeof siteIdMap === 'object' && siteIdMap[storeId]) {
        return parseInt(siteIdMap[storeId], 10);
      }
    } catch (error) {
      getLogger().warn({ storeId, marketplace: this.marketplace, error }, 'Failed to parse EBAY_STORE_SITE_ID_MAP');
    }

    // Default to UK (3)
    return eBayApi.SiteId.EBAY_GB;
  }

  /**
   * Split listings into batches
   */
  createBatches<T>(items: T[], batchSize: number): T[][] {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return [];
    }

    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Get active listings for a store
   * Using the official SDK
   */
  async getActiveListings(storeId: number, _accessToken: string, limit: number = 100) {
    const correlationId = `${this.marketplace.toUpperCase()}_LISTINGS_${storeId}_${Date.now()}_${nanoid(8)}`;
    const siteId = this.getEbaySiteId(storeId);
    this.api.config.siteId = siteId;

    const requestPayload = {
      StartTimeFrom: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      StartTimeTo: new Date().toISOString(),
      Pagination: {
        EntriesPerPage: limit,
        PageNumber: 1,
      },
      DetailLevel: 'ReturnAll',
    };

    try {
      getLogger().info(
        { correlationId, storeId, marketplace: this.marketplace, limit, siteId },
        'Fetching active listings via SDK'
      );

      // Log request
      getLogger(`marketplace-sync-request-${this.marketplace}`).info(
        { 
          correlationId, 
          storeId,
          marketplace: this.marketplace,
          siteId, 
          method: 'GetSellerList',
          payload: requestPayload 
        },
        'GetSellerList Request'
      );

      const startTime = Date.now();

      // SDK automatically uses the set OAuth token
      const response = await this.api.trading.GetSellerList(requestPayload);

      const duration = Date.now() - startTime;
      const itemCount = Array.isArray(response.ItemArray?.Item) 
        ? response.ItemArray.Item.length 
        : (response.ItemArray?.Item ? 1 : 0);

      // Log response
      getLogger(`marketplace-sync-response-${this.marketplace}`).info(
        {
          correlationId,
          storeId,
          marketplace: this.marketplace,
          duration,
          itemCount,
          ack: response.Ack,
        },
        'GetSellerList Response'
      );
      
      getLogger().info(
        { correlationId, storeId, marketplace: this.marketplace, count: itemCount, duration },
        'Active listings fetched via SDK'
      );

      return response;
    } catch (error) {
      // Handle EBayApiError
      if (error instanceof EBayApiError) {
        const errorCode = error.errorCode?.toString() || 'EBAY_API_ERROR';
        
        getLogger(`marketplace-sync-response-${this.marketplace}`).error(
          {
            correlationId,
            storeId,
            marketplace: this.marketplace,
            errorCode,
            errorMessage: error.message,
            meta: error.meta,
          },
          'GetSellerList Error'
        );

        getLogger().error(
          { 
            correlationId, 
            storeId,
            marketplace: this.marketplace,
            errorCode,
            errorMessage: error.message 
          },
          'Failed to fetch active listings - EBayApiError'
        );
        throw error;
      }

      getLogger().error(
        { correlationId, storeId, marketplace: this.marketplace, error },
        'Failed to fetch active listings via SDK'
      );
      throw error;
    }
  }

  /**
   * Resolve a single listing's live status on eBay via GetItem. Read-only.
   *
   * Used to guard against acting on a stale `21916750` ("FixedPrice item ended")
   * signal: OutOfStockControl listings report transient/false "ended" while still
   * Active, so we must confirm with eBay before deleting or relisting. The OAuth
   * token must already be set (fetchAccessToken first).
   */
  async getItemListingStatus(storeId: number, itemId: string): Promise<EbayItemLiveStatus> {
    this.api.config.siteId = this.getEbaySiteId(storeId);
    try {
      const resp = await this.api.trading.GetItem({ ItemID: itemId, DetailLevel: 'ReturnAll' });
      if (resp?.Ack === 'Success' || resp?.Ack === 'Warning') {
        const ls = String(resp?.Item?.SellingStatus?.ListingStatus ?? '').toLowerCase();
        return ls === 'active' ? 'active' : 'ended';
      }
      // Ack=Failure: eBay error 17 = "Item not found".
      const details = this.parseEbayErrors(resp);
      if (details.some((d) => d.errorCode === '17')) return 'not-found';
      getLogger().warn({ storeId, itemId, ack: resp?.Ack }, 'GetItem returned non-success without item-not-found');
      return 'unknown';
    } catch (error) {
      if (error instanceof EBayApiError) {
        const code = error.errorCode?.toString();
        if (code === '17') return 'not-found';
        getLogger().warn({ storeId, itemId, code, msg: error.message }, 'GetItem EBayApiError');
        return 'unknown';
      }
      getLogger().warn(
        { storeId, itemId, error: error instanceof Error ? error.message : String(error) },
        'GetItem exception'
      );
      return 'unknown';
    }
  }

  /**
   * Fetch the set of ALL currently-active eBay ItemIDs for the account via
   * GetMyeBaySelling (ActiveList) — not time-windowed, so it includes old GTC
   * listings. Used by reconciliation to detect listings we wrongly marked deleted
   * that are actually still live. Read-only. Token must already be set.
   */
  async getActiveItemIds(storeId: number, entriesPerPage: number = 200): Promise<Set<string>> {
    this.api.config.siteId = this.getEbaySiteId(storeId);
    const ids = new Set<string>();
    let pageNumber = 1;
    let totalPages = 1;

    do {
      const resp = await this.api.trading.GetMyeBaySelling({
        ActiveList: { Include: true, Pagination: { EntriesPerPage: entriesPerPage, PageNumber: pageNumber } },
        DetailLevel: 'ReturnAll',
      });
      const active = resp?.ActiveList;
      totalPages = parseInt(String(active?.PaginationResult?.TotalNumberOfPages ?? '1'), 10) || 1;
      for (const item of toArrayEbay<any>(active?.ItemArray?.Item)) {
        const id = String(item?.ItemID ?? '').trim();
        if (id) ids.add(id);
      }
      pageNumber += 1;
    } while (pageNumber <= totalPages);

    getLogger().info(
      { storeId, marketplace: this.marketplace, activeCount: ids.size, pages: totalPages },
      'Fetched all active eBay ItemIDs'
    );
    return ids;
  }

  /**
   * Page through GetMyeBaySelling ActiveList yielding RAW items (variations
   * included via DetailLevel ReturnAll). Read-only; token must already be set.
   * Used by the reconciliation snapshot job — parsing happens in
   * modules/ebay-reconciliation/ebay-snapshot.parse.ts so it stays unit-testable.
   */
  async *iterateActiveListings(
    storeId: number,
    entriesPerPage: number = 200
  ): AsyncGenerator<{ pageNumber: number; totalPages: number; totalEntries: number; items: unknown[] }> {
    this.api.config.siteId = this.getEbaySiteId(storeId);
    let pageNumber = 1;
    let totalPages = 1;

    do {
      const resp = await this.api.trading.GetMyeBaySelling({
        ActiveList: { Include: true, Pagination: { EntriesPerPage: entriesPerPage, PageNumber: pageNumber } },
        DetailLevel: 'ReturnAll',
      });
      const active = resp?.ActiveList;
      totalPages = parseInt(String(active?.PaginationResult?.TotalNumberOfPages ?? '1'), 10) || 1;
      const totalEntries = parseInt(String(active?.PaginationResult?.TotalNumberOfEntries ?? '0'), 10) || 0;
      yield { pageNumber, totalPages, totalEntries, items: toArrayEbay<unknown>(active?.ItemArray?.Item) };
      pageNumber += 1;
    } while (pageNumber <= totalPages);
  }

  /**
   * BUYER-facing availability via the Browse API (get_item_by_legacy_id).
   * This is the ONLY authoritative oversell check — under OutOfStockControl a
   * seller-side-0 variation can still be IN_STOCK to buyers (see
   * .claude/skills/ebay-sync-rules). Returns null when the item/SKU cannot be
   * resolved (treat as "unchecked", never as "safe").
   */
  async getBrowseAvailability(
    storeId: number,
    itemId: string,
    variationSku?: string
  ): Promise<{ status: string; qty: number | null } | null> {
    this.api.config.siteId = this.getEbaySiteId(storeId);
    try {
      const params: Record<string, string> = { legacy_item_id: itemId };
      if (variationSku) params.legacy_variation_sku = variationSku;
      const res = await this.api.buy.browse.getItemByLegacyId(params as any);
      const ea = toArrayEbay<any>(res?.estimatedAvailabilities)[0];
      if (!ea) return null;
      return {
        status: String(ea.estimatedAvailabilityStatus ?? 'UNKNOWN'),
        qty: ea.estimatedAvailableQuantity != null ? Number(ea.estimatedAvailableQuantity) : null,
      };
    } catch (error) {
      getLogger().warn(
        { storeId, itemId, variationSku, error: error instanceof Error ? error.message : String(error) },
        'Browse getItemByLegacyId failed — availability unchecked'
      );
      return null;
    }
  }
}

// Coerce eBay's "single object OR array OR undefined" shape into an array.
function toArrayEbay<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Create eBay client instance (using official ebay-api SDK)
 * @param marketplace - Marketplace name (e.g., 'ebay')
 */
export function createEbayClient(marketplace: string = 'ebay'): EbayClient {
  return new EbayClient(marketplace);
}
