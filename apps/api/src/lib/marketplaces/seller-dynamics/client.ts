/**
 * Seller Dynamics SOAP API Client
 *
 * @taskId #165838 (parent #165486)
 *
 * Implements the two SOAP operations needed for price + inventory sync:
 *   - BulkUploadStock              (submit CSV of updates, returns fileName)
 *   - BulkUploadCheckWithErrors    (poll fileName, returns completed flag + errorCount + per-line errors)
 *
 * SD rate limits (per method): ≤25 calls per 5 minutes, ≥10s between same-method calls.
 * Caller is responsible for inter-call timing — see adapter.ts.
 *
 * Reference responses captured against sandbox (retailerId e1e95ad7-63c1-4a2b-9c8f-00f9698efbd4):
 *
 *   BulkUploadStock — success:
 *     <BulkUploadStockResult>
 *       <status>Success</status>
 *       <response>Upload successful</response>
 *       <fileName>79d06f4a-0add-450e-ac79-f02a70185402.csv</fileName>
 *     </BulkUploadStockResult>
 *
 *   BulkUploadCheckWithErrors — in flight:
 *     <BulkUploadCheckWithErrorsResult>
 *       <status>Success</status>
 *       <response>Import Not Complete</response>
 *       <completed>false</completed>
 *       <errorCount>0</errorCount>
 *       <newGoodsCount>0</newGoodsCount>
 *       <errors />
 *     </BulkUploadCheckWithErrorsResult>
 *
 *   BulkUploadCheckWithErrors — done, all rows succeeded:
 *     <BulkUploadCheckWithErrorsResult>
 *       <status>Success</status>
 *       <response>Import Complete</response>
 *       <completed>true</completed>
 *       <errorCount>0</errorCount>
 *       <newGoodsCount>0</newGoodsCount>
 *       <errors />
 *     </BulkUploadCheckWithErrorsResult>
 *
 *   BulkUploadCheckWithErrors — done, UPDATE rows failed (errors EMPTY despite errorCount):
 *     <BulkUploadCheckWithErrorsResult>
 *       <status>Success</status>
 *       <response>Import Complete</response>
 *       <completed>true</completed>
 *       <errorCount>1</errorCount>
 *       <newGoodsCount>0</newGoodsCount>
 *       <errors />            <!-- SD does NOT populate this for UPDATE failures -->
 *     </BulkUploadCheckWithErrorsResult>
 *
 *   BulkUploadCheckWithErrors — done, CREATE rows failed (errors populated):
 *     <errors>
 *       <UploadError>
 *         <lineNumber>2</lineNumber>           <!-- 1-indexed, header is line 1, data starts at 2 -->
 *         <errorCode>InvalidCostPrice</errorCode>
 *       </UploadError>
 *     </errors>
 *
 * The adapter's failure-attribution logic depends on the empty-vs-populated <errors/> distinction.
 */

import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { nanoid } from 'nanoid';
import { config } from '../../../config';
import { getLogger } from '../../logger-context';
import { xmlUtils, type XmlParseOptions } from '../../../modules/marketplaces/utils/xml.utils';
import type {
  SdCustomerOrderExtended,
  SdGetOrdersResult,
  SdOrderUpdateItem,
  SdUpdateOrdersResult,
} from '../../../modules/seller-dynamics/sd-order-types';

/** Per-row CSV record. Sent as part of BulkUploadStock stockString. */
export interface SellerDynamicsStockRow {
  sku: string;
  /** Marketplace selling price (overrides SD's pricing profile). Sent as FixedPriceOverride__SPEC. */
  fixedPrice: number;
  /** Supplier/production cost. We currently send the same value as fixedPrice. */
  costPrice: number;
  /** Available stock count. Integer. */
  stockLevel: number;
}

export interface SellerDynamicsUploadResponse {
  success: boolean;
  status: string;          // "Success" or fault
  response: string;        // human-readable message from SD
  fileName?: string;       // GUID returned on successful submission
  error?: string;          // populated on transport/parse failures
  errorCode?: string;
}

export interface SellerDynamicsUploadError {
  lineNumber: number;      // 1-indexed; header counts as line 1, data starts at 2
  errorCode: string;
}

export interface SellerDynamicsCheckResponse {
  success: boolean;
  status: string;
  response: string;
  fileName?: string;
  completed: boolean;
  errorCount: number;
  newGoodsCount: number;
  /** Per-line failure records. EMPTY for UPDATE failures even when errorCount > 0 (SD quirk). */
  errors: SellerDynamicsUploadError[];
  error?: string;
  errorCode?: string;
}

/** Mandatory SD SOAP namespace. */
const TNS = 'https://my.sellerdynamics.com/';

/**
 * Recursively replace SOAP xsi:nil elements with null.
 *
 * With `ignoreAttributes: false`, fast-xml-parser turns `<ItemShipDate xsi:nil="true" />`
 * into `{ '@_xsi:nil': 'true' }` — a truthy object. Downstream code that does
 * `value ? new Date(value) : null` or `Number(value)` then sees the object and produces
 * an Invalid Date / NaN, which the DB rejects. Normalising these to null up front keeps
 * every field read (dates, numbers, strings) correct.
 */
function stripXsiNil<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripXsiNil(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj['@_xsi:nil'] === 'true' || obj['@_xsi:nil'] === true) {
      return null as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = stripXsiNil(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** CSV header for the stockString payload. Order is significant. */
export const SD_CSV_HEADER = 'SKU,FixedPriceOverride__SPEC,CostPrice,StockLevel';

/**
 * Build the CSV body sent inside <tns:stockString>.
 *
 * CRITICAL: every line is trim()'d and stripped of common invisible characters
 * (NBSP, ZWSP, BOM). On 2026-05-14 a previous POC failed because the uploaded
 * CSV had 12 leading spaces on each data row — SD silently rejected the rows
 * with misleading error codes. Do not relax this hardening.
 */
export function buildSellerDynamicsCsv(rows: SellerDynamicsStockRow[]): string {
  const lines: string[] = [SD_CSV_HEADER];
  for (const row of rows) {
    // Numeric formatting: 2 decimals for price, integer for stock.
    const price = row.fixedPrice.toFixed(2);
    const cost = row.costPrice.toFixed(2);
    const qty = Math.floor(row.stockLevel).toString();
    lines.push(`${row.sku},${price},${cost},${qty}`);
  }
  return lines
    .map((line) => line.trim().replace(/[\u00A0\u200B\uFEFF]/g, ''))
    .join('\n');
}

export class SellerDynamicsClient {
  private axiosInstance: AxiosInstance;
  private readonly encryptedLogin: string;
  private readonly retailerId: string;
  private readonly retailerMarketplaceName: string;

  constructor() {
    const apiUrl = config.SELLER_DYNAMICS_API_URL;
    this.encryptedLogin = config.SELLER_DYNAMICS_ENCRYPTED_LOGIN;
    this.retailerId = config.SELLER_DYNAMICS_RETAILER_ID;
    this.retailerMarketplaceName = config.SELLER_DYNAMICS_RETAILER_MARKETPLACE_NAME;

    if (!this.encryptedLogin) {
      throw new Error('SELLER_DYNAMICS_ENCRYPTED_LOGIN is not configured');
    }
    if (!this.retailerId) {
      throw new Error('SELLER_DYNAMICS_RETAILER_ID is not configured');
    }

    this.axiosInstance = axios.create({
      baseURL: apiUrl,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      timeout: 60000,
      // SD returns HTTP 200 with SOAP fault inside on auth/validation failures.
      // We always inspect the body; never short-circuit on status code alone.
      validateStatus: () => true,
    });

    getLogger('marketplace-sync-seller-dynamics').info(
      { apiUrl, retailerMarketplaceName: this.retailerMarketplaceName },
      'Seller Dynamics SOAP client initialized',
    );
  }

  /**
   * Submit a CSV of stock+price updates. Returns a fileName GUID that must
   * subsequently be polled via {@link bulkUploadCheckWithErrors}.
   *
   * Caller MUST respect the ≥11s gap between successive BulkUploadStock calls.
   */
  async bulkUploadStock(
    rows: SellerDynamicsStockRow[],
    importName: string,
  ): Promise<SellerDynamicsUploadResponse> {
    const correlationId = `SD_UPLOAD_${Date.now()}_${nanoid(8)}`;
    const logger = getLogger('marketplace-sync-seller-dynamics');
    const stockString = buildSellerDynamicsCsv(rows);

    // Hardcoded true for both update flags. The whole point of this call is to
    // update existing stock+cost; making these env-controlled would invite a
    // misconfiguration that silently no-ops stock updates → oversells.
    const envelope =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n' +
      '  <soap:Body>\n' +
      `    <tns:BulkUploadStock xmlns:tns="${TNS}">\n` +
      `      <tns:encryptedLogin>${xmlUtils.escape(this.encryptedLogin)}</tns:encryptedLogin>\n` +
      `      <tns:retailerId>${xmlUtils.escape(this.retailerId)}</tns:retailerId>\n` +
      `      <tns:stockString>${xmlUtils.escape(stockString)}</tns:stockString>\n` +
      `      <tns:importName>${xmlUtils.escape(importName)}</tns:importName>\n` +
      `      <tns:retailerMarketplaceName>${xmlUtils.escape(this.retailerMarketplaceName)}</tns:retailerMarketplaceName>\n` +
      '      <tns:updateExistingItemsStock>true</tns:updateExistingItemsStock>\n' +
      '      <tns:updateExistingItemsCost>true</tns:updateExistingItemsCost>\n' +
      '    </tns:BulkUploadStock>\n' +
      '  </soap:Body>\n' +
      '</soap:Envelope>';

    logger.info(
      { correlationId, importName, rowCount: rows.length, csvBytes: stockString.length },
      'Submitting BulkUploadStock',
    );

    try {
      const response = await this.axiosInstance.post('', envelope, {
        headers: { SOAPAction: `${TNS}BulkUploadStock` },
      });

      const parsed = this.parseEnvelope(response.data);
      const result =
        parsed?.['BulkUploadStockResponse']?.['BulkUploadStockResult'] ?? null;

      if (response.status !== 200 || !result) {
        const fault = parsed?.['soap:Fault'] ?? parsed?.Fault;
        const error = fault
          ? this.stringifyFault(fault)
          : `Unexpected SOAP response (HTTP ${response.status})`;
        logger.error(
          { correlationId, status: response.status, body: response.data },
          'BulkUploadStock SOAP error',
        );
        return {
          success: false,
          status: 'Fault',
          response: error,
          error,
          errorCode: `HTTP_${response.status}`,
        };
      }

      const status = String(result.status ?? '');
      const responseText = String(result.response ?? '');
      const fileName = result.fileName ? String(result.fileName) : undefined;

      const isSuccess = status === 'Success' && !!fileName;

      logger.info(
        { correlationId, status, responseText, fileName, success: isSuccess },
        'BulkUploadStock response',
      );

      return {
        success: isSuccess,
        status,
        response: responseText,
        fileName,
        error: isSuccess ? undefined : `SD reported status="${status}": ${responseText}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ correlationId, error: errorMessage }, 'BulkUploadStock transport failure');
      return {
        success: false,
        status: 'TransportError',
        response: errorMessage,
        error: errorMessage,
        errorCode: 'TRANSPORT_ERROR',
      };
    }
  }

  /**
   * Poll the import status for a previously-submitted fileName.
   *
   * Caller MUST respect the ≥11s gap between successive
   * BulkUploadCheckWithErrors calls.
   */
  async bulkUploadCheckWithErrors(
    fileName: string,
  ): Promise<SellerDynamicsCheckResponse> {
    const correlationId = `SD_CHECK_${Date.now()}_${nanoid(8)}`;
    const logger = getLogger('marketplace-sync-seller-dynamics');

    const envelope =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n' +
      '  <soap:Body>\n' +
      `    <tns:BulkUploadCheckWithErrors xmlns:tns="${TNS}">\n` +
      `      <tns:encryptedLogin>${xmlUtils.escape(this.encryptedLogin)}</tns:encryptedLogin>\n` +
      `      <tns:retailerId>${xmlUtils.escape(this.retailerId)}</tns:retailerId>\n` +
      `      <tns:fileName>${xmlUtils.escape(fileName)}</tns:fileName>\n` +
      '    </tns:BulkUploadCheckWithErrors>\n' +
      '  </soap:Body>\n' +
      '</soap:Envelope>';

    try {
      const response = await this.axiosInstance.post('', envelope, {
        headers: { SOAPAction: `${TNS}BulkUploadCheckWithErrors` },
      });

      const parsed = this.parseEnvelope(response.data);
      const result =
        parsed?.['BulkUploadCheckWithErrorsResponse']?.[
          'BulkUploadCheckWithErrorsResult'
        ] ?? null;

      if (response.status !== 200 || !result) {
        const fault = parsed?.['soap:Fault'] ?? parsed?.Fault;
        const error = fault
          ? this.stringifyFault(fault)
          : `Unexpected SOAP response (HTTP ${response.status})`;
        logger.error(
          { correlationId, fileName, status: response.status, body: response.data },
          'BulkUploadCheckWithErrors SOAP error',
        );
        return {
          success: false,
          status: 'Fault',
          response: error,
          completed: false,
          errorCount: 0,
          newGoodsCount: 0,
          errors: [],
          error,
          errorCode: `HTTP_${response.status}`,
        };
      }

      const status = String(result.status ?? '');
      const responseText = String(result.response ?? '');
      const completed = result.completed === true || result.completed === 'true';
      const errorCount = Number(result.errorCount ?? 0);
      const newGoodsCount = Number(result.newGoodsCount ?? 0);

      // <errors> may be: '' (self-closing), null, or an object with UploadError
      // children (single object or array).
      let errors: SellerDynamicsUploadError[] = [];
      const rawErrors = result.errors;
      if (rawErrors && typeof rawErrors === 'object') {
        const raw = rawErrors.UploadError;
        const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
        errors = list.map((e: any) => ({
          lineNumber: Number(e.lineNumber ?? 0),
          errorCode: String(e.errorCode ?? 'UnknownError'),
        }));
      }

      logger.info(
        {
          correlationId,
          fileName,
          status,
          completed,
          errorCount,
          newGoodsCount,
          parsedErrorCount: errors.length,
        },
        'BulkUploadCheckWithErrors response',
      );

      return {
        success: status === 'Success',
        status,
        response: responseText,
        fileName,
        completed,
        errorCount,
        newGoodsCount,
        errors,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { correlationId, fileName, error: errorMessage },
        'BulkUploadCheckWithErrors transport failure',
      );
      return {
        success: false,
        status: 'TransportError',
        response: errorMessage,
        completed: false,
        errorCount: 0,
        newGoodsCount: 0,
        errors: [],
        error: errorMessage,
        errorCode: 'TRANSPORT_ERROR',
      };
    }
  }

  /**
   * Poll {@link bulkUploadCheckWithErrors} until completed=true or attempts exhausted.
   *
   * Returns the final response on success, or null on timeout. Sleeps
   * delayMs between attempts — caller must pass ≥11000.
   */
  async waitForImportCompletion(
    fileName: string,
    maxAttempts: number = 5,
    delayMs: number = 240000,
  ): Promise<SellerDynamicsCheckResponse | null> {
    if (delayMs < 11000) {
      throw new Error(
        `waitForImportCompletion: delayMs must be ≥11000ms (SD rate limit), got ${delayMs}`,
      );
    }

    const logger = getLogger('marketplace-sync-seller-dynamics');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Wait BEFORE every call (including attempt #1) so the gap from the
      // preceding BulkUploadStock call is respected.
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const result = await this.bulkUploadCheckWithErrors(fileName);

      if (!result.success && result.errorCode === 'TRANSPORT_ERROR') {
        logger.warn(
          { fileName, attempt, error: result.error },
          'Transport error during poll — will retry',
        );
        continue;
      }

      if (result.completed) {
        logger.info(
          { fileName, attempt, errorCount: result.errorCount },
          'Import completed',
        );
        return result;
      }

      logger.debug(
        { fileName, attempt, status: result.status, response: result.response },
        'Import still in progress',
      );
    }

    logger.warn({ fileName, maxAttempts }, 'Import polling timed out');
    return null;
  }

  /**
   * Fetch orders from SD via GetCustomerOrdersExtended.
   *
   * Returns a flat list — each row is one GoodsPurchased line item.
   * Caller must group by MarketPlaceOrderID to reconstruct orders.
   * Max 50 rows per page; caller must paginate until orders.length < 50.
   */
  async getCustomerOrdersExtended(
    orderType: 'PENDING' | 'HISTORIC' | 'FBA',
    fromDate: string,
    toDate: string,
    pageNumber: number,
  ): Promise<SdGetOrdersResult> {
    const correlationId = `SD_ORDERS_${Date.now()}_${nanoid(8)}`;
    const logger = getLogger('sd-order-service');

    const envelope =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n' +
      '  <soap:Body>\n' +
      `    <tns:GetCustomerOrdersExtended xmlns:tns="${TNS}">\n` +
      `      <tns:encryptedLogin>${xmlUtils.escape(this.encryptedLogin)}</tns:encryptedLogin>\n` +
      `      <tns:retailerId>${xmlUtils.escape(this.retailerId)}</tns:retailerId>\n` +
      `      <tns:orderType>${xmlUtils.escape(orderType)}</tns:orderType>\n` +
      `      <tns:fromDate>${xmlUtils.escape(fromDate)}</tns:fromDate>\n` +
      `      <tns:toDate>${xmlUtils.escape(toDate)}</tns:toDate>\n` +
      `      <tns:pageNumber>${pageNumber}</tns:pageNumber>\n` +
      '    </tns:GetCustomerOrdersExtended>\n' +
      '  </soap:Body>\n' +
      '</soap:Envelope>';

    logger.info(
      { correlationId, orderType, fromDate, toDate, pageNumber },
      'Fetching orders via GetCustomerOrdersExtended',
    );

    try {
      const response = await this.axiosInstance.post('', envelope, {
        headers: { SOAPAction: `${TNS}GetCustomerOrdersExtended` },
      });

      // parseTagValue:false keeps every SOAP text node as a string. SD order fields map
      // to string DB columns (zipcode, EAN, phone, address lines may be all-numeric);
      // the transform explicitly Number()/parseFloat()s the few numeric fields it needs.
      const parsed = this.parseEnvelope(response.data, { parseTagValue: false });
      const result =
        parsed?.['GetCustomerOrdersExtendedResponse']?.['GetCustomerOrdersExtendedResult'] ?? null;

      if (response.status !== 200 || !result) {
        const fault = parsed?.['soap:Fault'] ?? parsed?.Fault;
        const error = fault
          ? this.stringifyFault(fault)
          : `Unexpected SOAP response (HTTP ${response.status})`;
        logger.error(
          { correlationId, status: response.status, body: response.data },
          'GetCustomerOrdersExtended SOAP error',
        );
        return {
          success: false,
          orders: [],
          meta: { PageSize: 0, PageNumber: pageNumber, RecordsAffected: 0, IsError: true, ErrorMessage: error },
          error,
        };
      }

      const isError = result.IsError === true || result.IsError === 'true';
      if (isError) {
        const errorMsg = String(result.ErrorMessage ?? 'Unknown SD error');
        logger.error({ correlationId, errorMsg }, 'GetCustomerOrdersExtended returned error');
        return {
          success: false,
          orders: [],
          meta: {
            PageSize: Number(result.PageSize ?? 0),
            PageNumber: Number(result.PageNumber ?? pageNumber),
            RecordsAffected: 0,
            IsError: true,
            ErrorMessage: errorMsg,
          },
          error: errorMsg,
        };
      }

      // Orders are nested under <Customers>:
      //   GetCustomerOrdersExtendedResult > Customers > CustomerOrderExtended.
      // CustomerOrderExtended may be: null/empty, a single object, or an array.
      // Fall back to the un-wrapped path defensively in case SD ever omits <Customers>.
      const rawOrders = result.Customers?.CustomerOrderExtended ?? result.CustomerOrderExtended;
      let orders: SdCustomerOrderExtended[] = [];
      if (rawOrders) {
        const list = Array.isArray(rawOrders) ? rawOrders : [rawOrders];
        // Normalise xsi:nil elements (e.g. <ItemShipDate xsi:nil="true"/>) to null so
        // downstream date/number parsing doesn't choke on attribute-only objects.
        orders = list.map((o) => stripXsiNil(o) as SdCustomerOrderExtended);
      }

      // Pagination fields are nested under <Pagination>.
      const pagination = result.Pagination ?? {};
      const meta = {
        PageSize: Number(pagination.PageSize ?? result.PageSize ?? 50),
        PageNumber: Number(pagination.PageNumber ?? result.PageNumber ?? pageNumber),
        RecordsAffected: Number(pagination.RecordsAffected ?? result.RecordsAffected ?? orders.length),
        IsError: false,
      };

      logger.info(
        { correlationId, orderCount: orders.length, pageNumber, recordsAffected: meta.RecordsAffected },
        'GetCustomerOrdersExtended response',
      );

      return { success: true, orders, meta };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ correlationId, error: errorMessage }, 'GetCustomerOrdersExtended transport failure');
      return {
        success: false,
        orders: [],
        meta: { PageSize: 0, PageNumber: pageNumber, RecordsAffected: 0, IsError: true, ErrorMessage: errorMessage },
        error: errorMessage,
      };
    }
  }

  /**
   * Push order status updates (SHIPPED) back to SD with tracking info.
   *
   * Each item identifies a GoodsPurchasedId (line item) to update.
   * Caller MUST respect the ≥10s gap between successive calls.
   */
  async updateOrdersWithTracking(
    items: SdOrderUpdateItem[],
    updateType: 'SHIPPED' | 'REFUNDED' = 'SHIPPED',
  ): Promise<SdUpdateOrdersResult> {
    const correlationId = `SD_STATUS_${Date.now()}_${nanoid(8)}`;
    const logger = getLogger('sd-status-update-service');

    if (items.length === 0) {
      return { success: true };
    }

    const itemsXml = items
      .map(
        (item) =>
          '        <tns:OrderUpdateItemWithTracking>\n' +
          `          <tns:GoodsPurchasedId>${xmlUtils.escape(item.GoodsPurchasedId)}</tns:GoodsPurchasedId>\n` +
          `          <tns:Courier>${xmlUtils.escape(item.Courier)}</tns:Courier>\n` +
          `          <tns:OtherCourier>${xmlUtils.escape(item.OtherCourier)}</tns:OtherCourier>\n` +
          `          <tns:ShippingMethod>${xmlUtils.escape(item.ShippingMethod)}</tns:ShippingMethod>\n` +
          `          <tns:TrackingNumber>${xmlUtils.escape(item.TrackingNumber)}</tns:TrackingNumber>\n` +
          `          <tns:RecordVersion>${xmlUtils.escape(item.RecordVersion)}</tns:RecordVersion>\n` +
          '        </tns:OrderUpdateItemWithTracking>',
      )
      .join('\n');

    const envelope =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n' +
      '  <soap:Body>\n' +
      `    <tns:UpdateOrdersWithTracking xmlns:tns="${TNS}">\n` +
      `      <tns:encryptedLogin>${xmlUtils.escape(this.encryptedLogin)}</tns:encryptedLogin>\n` +
      `      <tns:retailerId>${xmlUtils.escape(this.retailerId)}</tns:retailerId>\n` +
      '      <tns:orderItemIds>\n' +
      itemsXml + '\n' +
      '      </tns:orderItemIds>\n' +
      `      <tns:updateType>${xmlUtils.escape(updateType)}</tns:updateType>\n` +
      '    </tns:UpdateOrdersWithTracking>\n' +
      '  </soap:Body>\n' +
      '</soap:Envelope>';

    logger.info(
      { correlationId, itemCount: items.length, updateType },
      'Pushing status via UpdateOrdersWithTracking',
    );

    try {
      const response = await this.axiosInstance.post('', envelope, {
        headers: { SOAPAction: `${TNS}UpdateOrdersWithTracking` },
      });

      const parsed = this.parseEnvelope(response.data);
      const result =
        parsed?.['UpdateOrdersWithTrackingResponse']?.['UpdateOrdersWithTrackingResult'] ?? null;

      if (response.status !== 200 || !result) {
        const fault = parsed?.['soap:Fault'] ?? parsed?.Fault;
        const error = fault
          ? this.stringifyFault(fault)
          : `Unexpected SOAP response (HTTP ${response.status})`;
        logger.error(
          { correlationId, status: response.status, body: response.data },
          'UpdateOrdersWithTracking SOAP error',
        );
        return { success: false, error };
      }

      const isError = result.IsError === true || result.IsError === 'true';
      if (isError) {
        const errorMsg = String(result.ErrorMessage ?? 'Unknown SD error');
        logger.error({ correlationId, errorMsg }, 'UpdateOrdersWithTracking returned error');
        return { success: false, error: errorMsg };
      }

      logger.info(
        { correlationId, recordsAffected: result.RecordsAffected },
        'UpdateOrdersWithTracking succeeded',
      );

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ correlationId, error: errorMessage }, 'UpdateOrdersWithTracking transport failure');
      return { success: false, error: errorMessage };
    }
  }

  private parseEnvelope(rawXml: string, options?: XmlParseOptions): any {
    try {
      const parsed = xmlUtils.parse<any>(rawXml, options);
      // Top-level is <soap:Envelope> / <soap:Body>; navigate down to the body.
      const envelope = parsed?.['soap:Envelope'] ?? parsed?.Envelope ?? parsed;
      const body = envelope?.['soap:Body'] ?? envelope?.Body ?? envelope;
      return body ?? parsed;
    } catch {
      return null;
    }
  }

  private stringifyFault(fault: unknown): string {
    if (typeof fault === 'string') return fault;
    try {
      return JSON.stringify(fault);
    } catch {
      return 'SOAP Fault';
    }
  }
}

export function createSellerDynamicsClient(): SellerDynamicsClient {
  return new SellerDynamicsClient();
}
