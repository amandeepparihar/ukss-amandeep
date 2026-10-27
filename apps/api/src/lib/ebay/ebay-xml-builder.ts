/**
 * eBay XML Request Builders
 *
 * Functions to construct XML requests for eBay Trading API calls.
 * eBay uses SOAP-style XML (not JSON), requiring properly formatted XML bodies.
 *
 * API Documentation:
 * - GetOrders: https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetOrders.html
 * - CompleteSale: https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/CompleteSale.html
 */

/**
 * Build GetOrders XML request body.
 *
 * Fetches orders modified within a date range, with pagination support.
 *
 * @param options - Request options
 * @param options.fromDate - Start date for ModTimeFrom filter (ISO 8601)
 * @param options.toDate - End date for ModTimeTo filter (ISO 8601)
 * @param options.pageNumber - Page number for pagination (default: 1)
 * @param options.ordersPerPage - Orders per page (max 100, default: 10)
 * @returns XML string for GetOrders request
 *
 * @example
 * const xml = buildGetOrdersRequest({
 *   fromDate: '2026-03-23T00:00:00Z',
 *   toDate: '2026-03-30T23:59:59Z',
 *   pageNumber: 1,
 *   ordersPerPage: 10,
 * });
 */
export function buildGetOrdersRequest(options: {
  fromDate: string;
  toDate: string;
  pageNumber?: number;
  ordersPerPage?: number;
}): string {
  const { fromDate, toDate, pageNumber = 1, ordersPerPage = 10 } = options;

  // Validate ordersPerPage (max 100 per eBay API docs)
  const validOrdersPerPage = Math.min(Math.max(1, ordersPerPage), 100);

  return `<?xml version="1.0" encoding="utf-8"?>
<GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ModTimeFrom>${escapeXml(fromDate)}</ModTimeFrom>
  <ModTimeTo>${escapeXml(toDate)}</ModTimeTo>
  <OrderRole>Seller</OrderRole>
  <Pagination>
    <EntriesPerPage>${validOrdersPerPage}</EntriesPerPage>
    <PageNumber>${pageNumber}</PageNumber>
  </Pagination>
  <IncludeFinalValueFee>false</IncludeFinalValueFee>
</GetOrdersRequest>`;
}

/**
 * Build CompleteSale XML request body.
 *
 * Marks an order as shipped and provides tracking information.
 *
 * @param options - Request options
 * @param options.itemId - eBay Item ID (from Transaction/Item/ItemID)
 * @param options.transactionId - Transaction ID (from OrderLineItemID)
 * @param options.trackingNumber - Tracking number
 * @param options.shippingCarrier - Carrier name (e.g., "Royal Mail", "DHL")
 * @returns XML string for CompleteSale request
 *
 * @example
 * const xml = buildCompleteSaleRequest({
 *   itemId: '123456789',
 *   transactionId: '0',
 *   trackingNumber: 'RMA123456789GB',
 *   shippingCarrier: 'Royal Mail',
 * });
 */
export function buildCompleteSaleRequest(options: {
  itemId: string;
  transactionId: string;
  trackingNumber: string;
  shippingCarrier: string;
}): string {
  const { itemId, transactionId, trackingNumber, shippingCarrier } = options;

  return `<?xml version="1.0" encoding="utf-8"?>
<CompleteSaleRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <ItemID>${escapeXml(itemId)}</ItemID>
  <TransactionID>${escapeXml(transactionId)}</TransactionID>
  <Paid>true</Paid>
  <Shipped>true</Shipped>
  <Shipment>
    <ShipmentTrackingDetails>
      <ShipmentTrackingNumber>${escapeXml(trackingNumber)}</ShipmentTrackingNumber>
      <ShippingCarrierUsed>${escapeXml(shippingCarrier)}</ShippingCarrierUsed>
    </ShipmentTrackingDetails>
  </Shipment>
</CompleteSaleRequest>`;
}

/**
 * Escape XML special characters.
 *
 * Replaces: & < > " '
 *
 * @param text - Text to escape
 * @returns Escaped text safe for XML
 *
 * @example
 * escapeXml('AT&T') // → 'AT&amp;T'
 * escapeXml('<script>') // → '&lt;script&gt;'
 */
function escapeXml(text: string): string {
  if (typeof text !== 'string') {
    return String(text);
  }

  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
