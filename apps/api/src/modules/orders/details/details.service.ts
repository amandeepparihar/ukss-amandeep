/**
 * Orders detail service — fetches comprehensive order data for the edit page.
 * Requirements: REQ-04-001 through REQ-04-027 (data fetching portions)
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { toIso } from '../orders.helpers';
import type {
  CoreOrderRow, CustomerRow, MarketplaceOrderRow, LaybuyRow, TescoTrackingRow,
  TrackingRow, DhlRow, RoyalMailRow, DpdRow, ScanRow, ArchiveRow, PrevOrderRow,
  StoreRow, FcCheckRow, MatchRow, ExchangeRow, AffiliateRow, LockTicketRow, ViewerRow, NavRow,
  OrderDetailData, PreviousOrder,
} from './details.types';

export type { OrderDetailData } from './details.types';

const logger = createLogger('orders-details');

// Core order SELECT with explicit columns (no SELECT *)
const ORDER_SELECT = `
  o.orders_id, o.customers_id, o.orders_status,
  NULLIF(o.date_purchased, '0000-00-00 00:00:00') AS date_purchased,
  NULLIF(o.ship_by_date, '0000-00-00 00:00:00') AS ship_by_date,
  o.order_total, o.currency, o.currency_value, o.payment_method, o.payment_module_code,
  o.shipping_method, o.shipping_module_code,
  o.customers_name, o.customers_company, o.customers_email_address, o.customers_telephone,
  o.ip_address,
  o.delivery_name, o.delivery_company, o.delivery_street_address, o.delivery_suburb,
  o.delivery_city, o.delivery_postcode, o.delivery_state, o.delivery_country, o.delivery_telephone,
  o.billing_name, o.billing_company, o.billing_street_address, o.billing_suburb,
  o.billing_city, o.billing_postcode, o.billing_state, o.billing_country, o.billing_telephone,
  o.amazon_orders_id AS amazon_order_id, o.mplaza_orders_id AS mplaza_order_id,
  o.tesco_customer_order_id AS tesco_order_id, o.ebay_orders_id AS ebay_order_id,
  o.rakuten_order_id, o.lazada_order_id, o.priceminister_order_id AS priceministerorderid,
  o.gosport_order_id, o.catch_order_id, CAST(o.fruugo_orders_id AS CHAR) AS fruugo_order_id,
  o.decathlon_order_id, o.multisite_shopify_order_id AS shopify_order_id, o.multisite_order_id,
  o.lock_for_review, o.sift_score, o.risk_score,
  o.riskified_status AS riskified_decision,
  o.id_of_original_order, o.affiliate_commission_amount, o.affiliate_id AS affiliate_publishers_id,
  o.ref_keywords, o.ref_url, o.order_site, o.order_type,
  o.fc_order_id, o.fc_order_status, o.fc_auto_creation_bit, o.is_prime_order,
  o.courier_return_status,
  os.orders_status_name
`;

// ---------------------------------------------------------------------------
// Main data fetching
// ---------------------------------------------------------------------------

/**
 * REQ-04-001: Fetch comprehensive order data for the edit page.
 * Runs independent queries in parallel for efficiency.
 */
export async function getOrderDetails(orderId: number): Promise<OrderDetailData | null> {
  try {
  // C-1 fix: use Prisma.raw() for static SQL fragments instead of $queryRawUnsafe
  const selectFragment = Prisma.raw(ORDER_SELECT);
  const orderRows = await prisma.$queryRaw<CoreOrderRow[]>(
    Prisma.sql`SELECT ${selectFragment} FROM orders o
     LEFT JOIN orders_status os ON o.orders_status = os.orders_status_id AND os.language_id = 1
     WHERE o.orders_id = ${orderId}`
  );

  if (orderRows.length === 0) return null;
  const o = orderRows[0];

  // Critical queries — must succeed for the page to render
  const [customer, store] = await Promise.all([
    fetchCustomer(o.customers_id),
    fetchStore(o.order_site ?? 0),
  ]);

  // Non-critical queries — use allSettled so one failure doesn't block the page (I-3 fix)
  const settled = await Promise.allSettled([
    prisma.$queryRaw<MarketplaceOrderRow[]>(Prisma.sql`SELECT mo_order_id, mo_store_name FROM mo_marketplace_orders WHERE mo_ukss_order_id = ${orderId}`),
    prisma.$queryRaw<LaybuyRow[]>(Prisma.sql`SELECT laybuy_order_id FROM laybuy_orders WHERE order_id = ${orderId} LIMIT 1`),
    o.tesco_order_id
      ? prisma.$queryRaw<TescoTrackingRow[]>(Prisma.sql`SELECT parcel_tracking FROM tesco_orders WHERE order_id = ${orderId} LIMIT 1`)
      : Promise.resolve([] as TescoTrackingRow[]),
    prisma.$queryRaw<TrackingRow[]>(Prisma.sql`SELECT DISTINCT tracking_no FROM orders_products WHERE orders_id = ${orderId}`),
    prisma.$queryRaw<DhlRow[]>(Prisma.sql`SELECT shipment_no FROM dhl_shipments WHERE orders_id = ${orderId}`),
    prisma.$queryRaw<RoyalMailRow[]>(Prisma.sql`SELECT shipment_number FROM royal_mail_shipments WHERE orders_id = ${orderId}`),
    prisma.$queryRaw<DpdRow[]>(Prisma.sql`SELECT parcel_number, consignment_number, shipment_no FROM dpd_shipments WHERE orders_id = ${orderId}`),
    prisma.$queryRaw<ScanRow[]>(Prisma.sql`SELECT NULLIF(modified_date, '0000-00-00 00:00:00') AS modified_date FROM scanning_activity_logs WHERE orders_id = ${orderId} ORDER BY scan_log_id DESC LIMIT 1`),
    prisma.$queryRaw<ArchiveRow[]>(Prisma.sql`SELECT process_archive, status FROM pre_processed_order_products WHERE orders_id = ${orderId} ORDER BY process_archive DESC`),
    fetchPreviousOrders(o.customers_id, orderId, o.date_purchased),
    // REQ-04-018: GREEN FC — matches PHP edit_order.php line ~4514:
    // INNER JOIN suppliers_orders_products ensures box_number='DELIVERY' only counts
    // when a corresponding SOP record exists (BUG-430: plain op.box_number check
    // returned true for DELIVERY products without a SOP record).
    prisma.$queryRaw<FcCheckRow[]>(Prisma.sql`
      SELECT COUNT(*) as cnt FROM orders_products op
       LEFT JOIN new_products_variations npv ON op.products_id = npv.npv_products_id
       WHERE op.orders_id = ${orderId}
         AND (op.jit_marked = 'yes'
              OR EXISTS (SELECT 1 FROM suppliers_orders_products sop WHERE sop.order_product_id = op.orders_products_id AND op.box_number = 'DELIVERY')
              OR (npv.fc_product_id IS NOT NULL AND npv.fc_product_id != ''))
    `),
    prisma.$queryRaw<MatchRow[]>(Prisma.sql`SELECT matching_member_name FROM orders_products WHERE orders_id = ${orderId} AND matching_status = 'Yes' LIMIT 1`),
    prisma.$queryRaw<ExchangeRow[]>(Prisma.sql`SELECT orders_id FROM orders WHERE id_of_original_order = ${orderId} LIMIT 1`),
    o.affiliate_publishers_id
      ? prisma.$queryRaw<AffiliateRow[]>(Prisma.sql`SELECT publishers_name FROM affiliate_publishers_names WHERE publishers_id = ${o.affiliate_publishers_id}`)
      : Promise.resolve([] as AffiliateRow[]),
    // REQ-04-007: matches PHP orders.php lockdivdata handler (~line 2973) — reason
    // for a locked order: customer requested cancellation (4) or amendment (6/7).
    prisma.$queryRaw<LockTicketRow[]>(Prisma.sql`
      SELECT extra_option FROM customers_tickets
       WHERE orders_id = ${orderId} AND order_status_id = 2 AND extra_option IN (4, 6, 7)
       ORDER BY date_added DESC LIMIT 1
    `),
  ]);

  // Extract results with safe defaults for rejected queries
  const val = <T>(r: PromiseSettledResult<T>, def: T): T => {
    if (r.status === 'fulfilled') return r.value;
    logger.warn({ err: r.reason }, 'Non-critical order detail query failed');
    return def;
  };
  const moOrders = val(settled[0], [] as MarketplaceOrderRow[]);
  const laybuyRows = val(settled[1], [] as LaybuyRow[]);
  const tescoTrackingRows = val(settled[2], [] as TescoTrackingRow[]);
  const trackingRows = val(settled[3], [] as TrackingRow[]);
  const dhlRows = val(settled[4], [] as DhlRow[]);
  const royalMailRows = val(settled[5], [] as RoyalMailRow[]);
  const dpdRows = val(settled[6], [] as DpdRow[]);
  const scanRows = val(settled[7], [] as ScanRow[]);
  const archiveRows = val(settled[8], [] as ArchiveRow[]);
  const prevOrders = val(settled[9], [] as PreviousOrder[]);
  const fcCheck = val(settled[10], [] as FcCheckRow[]);
  const matchRows = val(settled[11], [] as MatchRow[]);
  const exchangeRows = val(settled[12], [] as ExchangeRow[]);
  const affiliateRows = val(settled[13], [] as AffiliateRow[]);
  const lockTicketRows = val(settled[14], [] as LockTicketRow[]);

  const fraudStatus = customer?.fraud_status ?? 0;
  // BUG-424: Match PHP edit_order.php line ~4439 exactly — only these two values show DHL label.
  // substring 'dhl' check was too broad and shipping_module_code is not used in PHP.
  const isDhl = o.shipping_method === 'Courier Shipments (DHL Courier)' ||
    o.shipping_method === 'Express Shipping';

  // REQ-04-007: Phone fallback — delivery > billing > customer
  const phone = o.delivery_telephone || o.billing_telephone || o.customers_telephone || customer?.customers_telephone || '';

  // REQ-04-008: Fruugo address override — use customer fields for Fruugo orders
  const isFruugo = !!o.fruugo_order_id;
  const deliveryAddress = isFruugo
    ? { name: o.customers_name ?? '', company: o.customers_company ?? '', street: o.delivery_street_address ?? '', suburb: o.delivery_suburb ?? '', city: o.delivery_city ?? '', postcode: o.delivery_postcode ?? '', state: o.delivery_state ?? '', country: o.delivery_country ?? '' }
    : { name: o.delivery_name ?? '', company: o.delivery_company ?? '', street: o.delivery_street_address ?? '', suburb: o.delivery_suburb ?? '', city: o.delivery_city ?? '', postcode: o.delivery_postcode ?? '', state: o.delivery_state ?? '', country: o.delivery_country ?? '' };
  const billingAddress = isFruugo
    ? { name: o.customers_name ?? '', company: o.customers_company ?? '', street: o.billing_street_address ?? '', suburb: o.billing_suburb ?? '', city: o.billing_city ?? '', postcode: o.billing_postcode ?? '', state: o.billing_state ?? '', country: o.billing_country ?? '' }
    : { name: o.billing_name ?? '', company: o.billing_company ?? '', street: o.billing_street_address ?? '', suburb: o.billing_suburb ?? '', city: o.billing_city ?? '', postcode: o.billing_postcode ?? '', state: o.billing_state ?? '', country: o.billing_country ?? '' };

  return {
    orderId: o.orders_id,
    status: o.orders_status,
    statusName: o.orders_status_name ?? 'Unknown',
    datePurchased: toIso(o.date_purchased),
    shipByDate: toIso(o.ship_by_date),
    // I-6 fix: MySQL DECIMAL may return as Prisma.Decimal — ensure JS number
    orderTotal: o.order_total != null ? Number(o.order_total) : null,
    currency: o.currency,
    currencyValue: o.currency_value != null ? Number(o.currency_value) : null,
    paymentMethod: o.payment_method,
    shippingMethod: o.shipping_method,
    orderSite: o.order_site,
    orderType: o.order_type,
    customer: {
      id: o.customers_id, name: o.customers_name ?? '', company: o.customers_company ?? '',
      phone, email: o.customers_email_address ?? '', ipAddress: o.ip_address ?? '',
      isPriority: customer?.priority_customer === 1, isApproved: customer?.approve_customer === '1',
    },
    deliveryAddress,
    billingAddress,
    marketplaceIds: {
      amazon: o.amazon_order_id, mplaza: o.mplaza_order_id, tesco: o.tesco_order_id,
      tescoTracking: tescoTrackingRows[0]?.parcel_tracking ?? null,
      ebay: o.ebay_order_id, rakuten: o.rakuten_order_id, lazada: o.lazada_order_id,
      priceminister: o.priceministerorderid, gosport: o.gosport_order_id,
      catch: o.catch_order_id, fruugo: o.fruugo_order_id, decathlon: o.decathlon_order_id,
      laybuy: laybuyRows[0]?.laybuy_order_id ?? null,
      shopify: o.shopify_order_id, multisite: o.multisite_order_id,
      moOrders: moOrders.filter(m => m.mo_order_id).map(m => ({ orderId: m.mo_order_id!, storeName: m.mo_store_name ?? '' })),
      fcOrderId: o.fc_order_id, fcStatus: o.fc_order_status || null,
    },
    tracking: {
      orderTracking: trackingRows.map(r => r.tracking_no).filter(Boolean) as string[],
      dhl: dhlRows.map(r => r.shipment_no).filter(Boolean) as string[],
      royalMail: royalMailRows.map(r => r.shipment_number).filter(Boolean) as string[],
      dpd: dpdRows.map(r => r.parcel_number || r.consignment_number).filter(Boolean) as string[],
      lastScanDate: scanRows[0] ? toIso(scanRows[0].modified_date) : null,
      courierReturnStatus: o.courier_return_status,
    },
    metadata: {
      isExchange: !!(o.id_of_original_order && o.id_of_original_order > 0),
      originalOrderId: o.id_of_original_order,
      exchangeOrderId: exchangeRows[0]?.orders_id ?? null,
      siftScore: o.sift_score, riskScore: o.risk_score,
      riskifiedStatus: o.riskified_decision,
      matchedBy: matchRows[0]?.matching_member_name ?? null,
      lockStatus: { isLocked: o.lock_for_review === '1', extraOption: lockTicketRows[0]?.extra_option ?? null },
    },
    processing: { archiveDisplay: buildArchiveDisplay(archiveRows) },
    referral: { keywords: o.ref_keywords, url: o.ref_url },
    paymentInfo: {
      method: o.payment_method, previousOrders: prevOrders,
      commissionAmount: o.affiliate_commission_amount != null ? Number(o.affiliate_commission_amount) : null,
      affiliateName: affiliateRows[0]?.publishers_name ?? null,
    },
    store: { id: store.id, name: store.name, logo: store.logo, platform: store.platform },
    flags: {
      fraudStatus, processOrder: determineProcessOrder(fraudStatus, o.orders_status),
      // M-2 fix: COUNT(*) may return bigint — convert to Number
      isGreenFc: Number(fcCheck[0]?.cnt ?? 0) > 0,
      baselinkerSource: null,
      isPrime: o.is_prime_order === 'true', isDhl,
      lockForReview: o.lock_for_review === '1',
      fcOrderId: o.fc_order_id, fcAutoCreationBit: o.fc_auto_creation_bit,
      courierReturnStatus: o.courier_return_status,
    },
  };
  } catch (err) {
    logger.error({ err, orderId }, 'Failed to fetch order details');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// REQ-04-004 + REQ-04-013: Concurrent viewer detection
// ---------------------------------------------------------------------------

export async function getOrderViewers(
  orderId: number, currentAdminId: number
): Promise<Array<{ name: string }>> {
  const rows = await prisma.$queryRaw<ViewerRow[]>(Prisma.sql`
    SELECT DISTINCT a.admin_name
    FROM admin_activity_log aal
    JOIN admin a ON aal.admin_id = a.admin_id
    WHERE aal.status = '0'
      AND aal.page_parameters LIKE ${`%oID=${orderId}&action=edit&%`}
      AND aal.admin_id != ${currentAdminId}
      AND aal.admin_id != 0
  `);
  return rows.map(r => ({ name: r.admin_name ?? '' }));
}

// ---------------------------------------------------------------------------
// REQ-04-002: Prev/Next order navigation (separated WHERE and ORDER BY)
// ---------------------------------------------------------------------------

export async function getNextOrderId(
  currentOrderId: number, status: number | null, direction: 'prev' | 'next'
): Promise<number | null> {
  const statusFilter = status != null ? Prisma.sql`AND o.orders_status = ${status}` : Prisma.empty;
  const whereDir = direction === 'next'
    ? Prisma.sql`o.orders_id > ${currentOrderId}`
    : Prisma.sql`o.orders_id < ${currentOrderId}`;
  const orderBy = direction === 'next'
    ? Prisma.sql`ORDER BY o.orders_id ASC`
    : Prisma.sql`ORDER BY o.orders_id DESC`;

  const rows = await prisma.$queryRaw<NavRow[]>(Prisma.sql`
    SELECT o.orders_id FROM orders o
    WHERE ${whereDir} ${statusFilter}
    ${orderBy} LIMIT 1
  `);
  return rows[0]?.orders_id ?? null;
}

// ---------------------------------------------------------------------------
// REQ-04-007: Toggle priority customer (atomic SQL to prevent race conditions)
// ---------------------------------------------------------------------------

export async function togglePriorityCustomer(customersId: number): Promise<boolean> {
  // C-2 fix: wrap in transaction to prevent TOCTOU on read-back
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`UPDATE customers SET priority_customer = 1 - COALESCE(priority_customer, 0) WHERE customers_id = ${customersId}`
    );
    const rows = await tx.$queryRaw<Array<{ priority_customer: number }>>(
      Prisma.sql`SELECT priority_customer FROM customers WHERE customers_id = ${customersId}`
    );
    return (rows[0]?.priority_customer ?? 0) === 1;
  });
}

// ---------------------------------------------------------------------------
// REQ-04-007: Toggle approve customer (atomic SQL)
// ---------------------------------------------------------------------------

export async function toggleApproveCustomer(customersId: number): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // approve_customer is enum('0','1') — MySQL arithmetic on enums operates on the
    // ordinal index (1='0', 2='1'), not the value, so `1 - COALESCE(col, 0)` writes an
    // out-of-range index and silently corrupts the column. Toggle by string value instead.
    await tx.$executeRaw(
      Prisma.sql`UPDATE customers SET approve_customer = CASE WHEN approve_customer = '1' THEN '0' ELSE '1' END WHERE customers_id = ${customersId}`
    );
    const rows = await tx.$queryRaw<Array<{ approve_customer: string | null }>>(
      Prisma.sql`SELECT approve_customer FROM customers WHERE customers_id = ${customersId}`
    );
    return rows[0]?.approve_customer === '1';
  });
}

// ---------------------------------------------------------------------------
// REQ-04-019: Toggle lock for review (atomic SQL)
// ---------------------------------------------------------------------------

export async function toggleLockForReview(orderId: number): Promise<boolean> {
  const isLocked = await prisma.$transaction(async (tx) => {
    // lock_for_review is enum('0','1') — same enum-arithmetic footgun as approve_customer.
    await tx.$executeRaw(
      Prisma.sql`UPDATE orders SET lock_for_review = CASE WHEN lock_for_review = '1' THEN '0' ELSE '1' END WHERE orders_id = ${orderId}`
    );
    const rows = await tx.$queryRaw<Array<{ lock_for_review: string | null }>>(
      Prisma.sql`SELECT lock_for_review FROM orders WHERE orders_id = ${orderId}`
    );
    return rows[0]?.lock_for_review === '1';
  });
  logger.info({ orderId, lockForReview: isLocked }, 'Toggled lock for review');
  return isLocked;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchCustomer(customersId: number): Promise<CustomerRow | null> {
  const rows = await prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
    SELECT customers_id, customers_firstname, customers_lastname,
           customers_telephone, customers_email_address,
           priority_customer, approve_customer, fraud_status
    FROM customers WHERE customers_id = ${customersId}
  `);
  return rows[0] ?? null;
}

async function fetchPreviousOrders(
  customersId: number, currentOrderId: number, datePurchased: Date | string | null
): Promise<PreviousOrder[]> {
  // #208 fix: filter by date_purchased (not orders_id) and detect backorder/return
  // at product level (orders_products) — matches PHP edit_order.php lines 4101-4121.
  if (!datePurchased) return [];
  const rows = await prisma.$queryRaw<PrevOrderRow[]>(Prisma.sql`
    SELECT o.orders_id, NULLIF(o.date_purchased, '0000-00-00 00:00:00') AS date_purchased,
           o.orders_status, os.orders_status_name,
           EXISTS(SELECT 1 FROM orders_products op WHERE op.orders_id = o.orders_id AND op.backorder = 'Yes') AS has_backorder,
           EXISTS(SELECT 1 FROM orders_products op WHERE op.orders_id = o.orders_id AND op.return_chk = 'yes') AS has_return
    FROM orders o
    LEFT JOIN orders_status os ON o.orders_status = os.orders_status_id AND os.language_id = 1
    WHERE o.customers_id = ${customersId}
      AND o.orders_id != ${currentOrderId}
      AND o.date_purchased < ${datePurchased}
    ORDER BY o.date_purchased DESC LIMIT 4
  `);
  return rows.map(r => ({
    orderId: r.orders_id, datePurchased: toIso(r.date_purchased), status: r.orders_status,
    statusName: r.orders_status_name,
    isBackorder: Number(r.has_backorder) === 1,
    isReturned: Number(r.has_return) === 1,
  }));
}

async function fetchStore(orderSite: number): Promise<{ id: number; name: string; logo: string | null; platform: string | null }> {
  if (orderSite === 0 || orderSite === 89) {
    return { id: orderSite, name: 'Uksoccershop', logo: null, platform: null };
  }
  const rows = await prisma.$queryRaw<StoreRow[]>(Prisma.sql`
    SELECT sm.store_id, sm.store_name, sm.store_platform, sc.store_logo
    FROM store_management sm LEFT JOIN store_customization sc ON sm.store_id = sc.store_id
    WHERE sm.store_id = ${orderSite} LIMIT 1
  `);
  if (rows.length === 0) return { id: orderSite, name: 'Uksoccershop', logo: null, platform: null };
  return { id: rows[0].store_id, name: rows[0].store_name ?? 'Uksoccershop', logo: rows[0].store_logo, platform: rows[0].store_platform };
}

/** REQ-04-022: Determine if order can be processed based on fraud status. */
function determineProcessOrder(fraudStatus: number, orderStatus: number): boolean {
  if (fraudStatus === 1) return false;
  if (fraudStatus === 0 && orderStatus === 112) return false;
  return true;
}

/** REQ-04-012: Build archive display string. */
function buildArchiveDisplay(rows: ArchiveRow[]): string {
  if (rows.length === 0) return 'N/A';
  const parts = rows.map(r => {
    if (r.status === 3) return 'N/A';
    if ((r.status === 1 || r.status === 2 || r.status === 4) && (r.process_archive ?? 0) > 0) return String(r.process_archive);
    return 'Waiting to be processed';
  });
  return parts.join(', ');
}

