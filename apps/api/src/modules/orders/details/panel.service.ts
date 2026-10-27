/**
 * Order details panel service — fetches data for the right-side AJAX panel on the listing page.
 * Requirements: REQ-03-001 through REQ-03-025
 *
 * Optimized for a single panel load: one critical query + batch non-critical queries.
 * Uses Promise.allSettled for graceful degradation (CX-009 / REQ-03-025).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { groupBy, toIso } from '../orders.helpers';
import type {
  PanelOrderRow, EbayAckRow, PanelCustomerFraudRow,
  PanelProductRow, PanelProductAttributeRow, PanelSmsQuantityRow,
  PanelSupplierRow, PanelBulkSupplierRow, PanelLastOrderedRow,
  SupplierListRow,
  OrderPanelData, PanelProduct, PanelProductAttribute,
  PanelMarketplaceInfo,
} from './panel.types';
import { AIRO_TYPE_MANUFACTURER_ID_LIST, TOFFS_TYPE_MANUFACTURER_ID_LIST } from '../orders.constants';

const logger = createLogger('orders-panel');

// REQ-03-022: same eligibility rule as the Edit Order page's Allocate column
// (products.service.ts supplierSelectableManufacturerIds) — AIRO/Toffs manufacturer,
// no suppliers_orders_products row yet.
const SUPPLIER_SELECTABLE_MANUFACTURER_IDS = new Set<number>([
  ...AIRO_TYPE_MANUFACTURER_ID_LIST,
  ...TOFFS_TYPE_MANUFACTURER_ID_LIST,
]);

// ---------------------------------------------------------------------------
// Core order SELECT for panel (lighter than full edit page)
// ---------------------------------------------------------------------------

const PANEL_ORDER_SELECT = Prisma.raw(`
  o.orders_id, o.customers_id, o.orders_status,
  NULLIF(o.date_purchased, '0000-00-00 00:00:00') AS date_purchased,
  NULLIF(o.last_modified, '0000-00-00 00:00:00') AS last_modified,
  o.order_total, o.currency, o.payment_method, o.shipping_method,
  o.customers_name, o.customers_email_address, o.ip_address,
  o.is_prime_order, o.sift_score, o.fc_order_status,
  o.refund_status_for_reject_orders, o.refund_review_status, o.refund_review_comment,
  o.multisite_order_id, o.order_site, o.suppliers,
  o.ebay_orders_id AS ebay_order_id, o.gosport_order_id, o.catch_order_id,
  CAST(o.fruugo_orders_id AS CHAR) AS fruugo_order_id,
  o.amazon_orders_id AS amazon_order_id,
  o.mplaza_orders_id AS mplaza_order_id,
  o.tesco_customer_order_id AS tesco_order_id,
  o.rakuten_order_id,
  o.lazada_order_id,
  o.priceminister_order_id,
  o.decathlon_order_id,
  os.orders_status_name
`);

// ---------------------------------------------------------------------------
// Main data fetching
// ---------------------------------------------------------------------------

/**
 * REQ-03-001/002: Fetch all data needed for the order details panel.
 * Single entry point returning OrderPanelData or null if order not found.
 */
export async function getOrderPanelData(orderId: number): Promise<OrderPanelData | null> {
  // Critical query: core order data
  const orderRows = await prisma.$queryRaw<PanelOrderRow[]>(
    Prisma.sql`SELECT ${PANEL_ORDER_SELECT}
               FROM orders o
               LEFT JOIN orders_status os ON o.orders_status = os.orders_status_id AND os.language_id = 1
               WHERE o.orders_id = ${orderId}`
  );

  if (orderRows.length === 0) return null;
  const o = orderRows[0];

  // Critical query: products for this order
  const productRows = await prisma.$queryRaw<PanelProductRow[]>(
    Prisma.sql`SELECT
      op.orders_products_id, op.products_id, op.products_name, op.products_model,
      op.products_quantity, op.backorder, op.box_number, op.refund, op.fc_order_id,
      p.manufacturers_id AS p_manufacturers_id
    FROM orders_products op
    LEFT JOIN products p ON op.products_id = p.products_id
    WHERE op.orders_id = ${orderId}`
  );

  // Collect IDs for batch queries
  const opIds = productRows.map(r => r.orders_products_id);
  // Include individual parts of comma-separated models so the batch query
  // covers all candidates used by resolveCommaModel() later (PHP lines 622-632).
  const productModels = [...new Set(
    productRows.flatMap(r => {
      const m = r.products_model;
      if (!m) return [];
      if (m.includes(',')) {
        const parts = m.split(',').filter(p => p);
        return [m, ...parts];
      }
      return [m];
    })
  )];
  const productIds = [...new Set(productRows.map(r => r.products_id))];

  // Non-critical batch queries (REQ-03-025: N+1 prevention)
  const settled = await Promise.allSettled([
    // Q1: Product attributes
    opIds.length > 0
      ? prisma.$queryRaw<PanelProductAttributeRow[]>(Prisma.sql`
          SELECT opa.orders_products_id, opa.products_options, opa.products_options_values,
                 opa.products_options_id, opa.products_options_values_id
          FROM orders_products_attributes opa
          WHERE opa.orders_products_id IN (${Prisma.join(opIds)})
        `)
      : Promise.resolve([] as PanelProductAttributeRow[]),

    // Q2: SMS quantities
    productModels.length > 0
      ? prisma.$queryRaw<PanelSmsQuantityRow[]>(Prisma.sql`
          SELECT pl.product_code, pl.product_lists_id, pl.parent_product_lists_id,
                 pl.quantity_map, pq.size_id, SUM(pq.quantity) AS total_qty
          FROM product_lists pl
          LEFT JOIN product_quantities pq ON pl.product_lists_id = pq.product_lists_id
          WHERE pl.product_code IN (${Prisma.join(productModels)})
          GROUP BY pl.product_code, pl.product_lists_id, pl.parent_product_lists_id,
                   pl.quantity_map, pq.size_id
        `)
      : Promise.resolve([] as PanelSmsQuantityRow[]),

    // Q3: Supplier assignments (REQ-03-025 — single query for all products)
    opIds.length > 0
      ? prisma.$queryRaw<PanelSupplierRow[]>(Prisma.sql`
          SELECT sop.order_product_id AS orders_products_id,
                 so.supplier_order_id AS supplier_order_id,
                 sop.supplier_id, s.suppliers_name AS supplier_name,
                 so.order_number, so.close_order, sop.manufacturers_id
          FROM suppliers_orders_products sop
          JOIN orders_products op ON op.orders_products_id = sop.order_product_id
          LEFT JOIN suppliers_orders so ON sop.supplier_order_id = so.supplier_order_id
          LEFT JOIN suppliers s ON sop.supplier_id = s.suppliers_id
          WHERE op.orders_id = ${orderId}
          ORDER BY sop.supplier_order_product_id DESC
        `)
      : Promise.resolve([] as PanelSupplierRow[]),

    // Q4: Last ordered supplier per product (REQ-03-019)
    productIds.length > 0
      ? prisma.$queryRaw<PanelLastOrderedRow[]>(Prisma.sql`
          SELECT sop2.order_product_id AS orders_products_id, sop2.product_id AS products_id,
                 s.suppliers_name AS supplier_name,
                 NULLIF(sop2.date_added, '0000-00-00 00:00:00') AS ordered_date
          FROM (
            SELECT MAX(sop_inner.supplier_order_product_id) AS max_id, sop_inner.product_id
            FROM suppliers_orders_products sop_inner
            WHERE sop_inner.product_id IN (${Prisma.join(productIds)})
            GROUP BY sop_inner.product_id
          ) latest
          JOIN suppliers_orders_products sop2 ON sop2.supplier_order_product_id = latest.max_id
          LEFT JOIN suppliers_orders so ON sop2.supplier_order_id = so.supplier_order_id
          LEFT JOIN suppliers s ON sop2.supplier_id = s.suppliers_id
        `)
      : Promise.resolve([] as PanelLastOrderedRow[]),

    // Q5: Bulk upload suppliers
    productIds.length > 0
      ? prisma.$queryRaw<PanelBulkSupplierRow[]>(Prisma.sql`
          SELECT p.products_id, bus.bus_bulk_upload_supplier AS bus_name
          FROM products p
          JOIN bulk_upload_supplier bus ON p.bus_bulk_upload_supplier_id = bus.bus_bulk_upload_supplier_id
          WHERE p.products_id IN (${Prisma.join(productIds)})
            AND p.bus_bulk_upload_supplier_id != 0
        `)
      : Promise.resolve([] as PanelBulkSupplierRow[]),

    // Q6: eBay order status (conditional, for marketplace wiring)
    // PHP: SELECT ebay_order_status FROM ebay_orders WHERE ebay_orders_id = :ebay_orders_id
    // Status values 0/1/4 indicate unacknowledged states
    o.ebay_order_id
      ? prisma.$queryRaw<EbayAckRow[]>(Prisma.sql`
          SELECT ebay_order_status AS unacknowledged FROM ebay_orders
          WHERE ebay_orders_id = ${o.ebay_order_id} LIMIT 1
        `)
      : Promise.resolve([] as EbayAckRow[]),

    // Q7: All suppliers for dropdown (REQ-03-013)
    prisma.$queryRaw<SupplierListRow[]>(Prisma.sql`
      SELECT suppliers_id, suppliers_name FROM suppliers ORDER BY suppliers_name
    `),

    // Q8: Customer fraud status (REQ-03-007 — document buttons condition)
    prisma.$queryRaw<PanelCustomerFraudRow[]>(Prisma.sql`
      SELECT fraud_status FROM customers WHERE customers_id = ${o.customers_id}
    `),
  ]);

  // Extract with safe defaults
  const sv = <T>(r: PromiseSettledResult<T>, def: T): T =>
    r.status === 'fulfilled' ? r.value : (logger.warn({ err: (r as PromiseRejectedResult).reason }, 'Non-critical panel query failed'), def);

  const attributeRows = sv(settled[0], [] as PanelProductAttributeRow[]);
  const smsQuantityRows = sv(settled[1], [] as PanelSmsQuantityRow[]);
  const supplierRows = sv(settled[2], [] as PanelSupplierRow[]);
  const lastOrderedRows = sv(settled[3], [] as PanelLastOrderedRow[]);
  const bulkSupplierRows = sv(settled[4], [] as PanelBulkSupplierRow[]);
  const ebayAckRows = sv(settled[5], [] as EbayAckRow[]);
  const allSuppliersRows = sv(settled[6], [] as SupplierListRow[]);
  const customerFraudRows = sv(settled[7], [] as PanelCustomerFraudRow[]);

  // Build lookup maps
  const attrsByOpId = groupBy(attributeRows, r => r.orders_products_id);
  const supplierByOpId = new Map<number, PanelSupplierRow>();
  for (const s of supplierRows) {
    if (!supplierByOpId.has(s.orders_products_id)) {
      supplierByOpId.set(s.orders_products_id, s);
    }
  }
  const lastOrderedByProductId = new Map<number, PanelLastOrderedRow>();
  for (const lo of lastOrderedRows) {
    if (!lastOrderedByProductId.has(lo.products_id)) {
      lastOrderedByProductId.set(lo.products_id, lo);
    }
  }
  const bulkSupplierByProductId = new Map<number, string>();
  for (const bs of bulkSupplierRows) {
    if (bs.bus_name) bulkSupplierByProductId.set(bs.products_id, bs.bus_name);
  }
  const smsQtyByModel = new Map<string, PanelSmsQuantityRow[]>();
  for (const row of smsQuantityRows) {
    const existing = smsQtyByModel.get(row.product_code) ?? [];
    existing.push(row);
    smsQtyByModel.set(row.product_code, existing);
  }

  // Assemble products (REQ-03-017 through REQ-03-021)
  const products: PanelProduct[] = await Promise.all(productRows.map(async row => {
    const rawAttrsForProduct = attrsByOpId.get(row.orders_products_id) ?? [];
    const attrs = rawAttrsForProduct.map(mapAttribute);
    const supplier = supplierByOpId.get(row.orders_products_id) ?? null;
    const lastOrdered = lastOrderedByProductId.get(row.products_id) ?? null;
    const model = row.products_model ?? null;

    // Resolve the order's size attribute to the manufacturers_options_values_id
    // space that product_quantities.size_id actually uses (PHP lines 594-617 /
    // product_code_existance() functions_general.php lines 2836-2871). Computed once
    // and shared by both the comma-model resolution and the SMS quantity lookup below.
    const mfgSizeIds = await resolveMfgSizeIds(rawAttrsForProduct);

    // Resolve comma-separated products_model (PHP ajax_show_order_details.php lines 622-632).
    const resolvedModel = await resolveCommaModel(model, smsQtyByModel, mfgSizeIds);

    // SMS quantity resolution (REQ-03-017)
    const smsQuantity = resolveSmsQuantity(resolvedModel, mfgSizeIds, smsQtyByModel);

    return {
      ordersProductsId: row.orders_products_id,
      productsId: row.products_id,
      name: row.products_name ?? '',
      model: resolvedModel,
      quantity: row.products_quantity,
      backorder: row.backorder ?? 'No',
      boxNumber: row.box_number,
      fcOrderId: row.fc_order_id,
      isRefund: (row.refund ?? 0) === 1,
      attributes: attrs,
      smsQuantity,
      supplier: supplier ? {
        supplierOrderId: supplier.supplier_order_id,
        supplierId: supplier.supplier_id,
        supplierName: supplier.supplier_name,
        orderNumber: supplier.order_number,
        isAssigned: (supplier.supplier_order_id ?? 0) > 0,
        closeOrder: supplier.close_order,
      } : null,
      lastOrdered: lastOrdered?.supplier_name ? {
        supplierName: lastOrdered.supplier_name,
        orderedDate: toIso(lastOrdered.ordered_date),
      } : null,
      bulkUploadSupplier: bulkSupplierByProductId.get(row.products_id) ?? null,
      toffsCopaType: null, // Deferred to SPEC-16 (Toffs/Copa sheet integration)
      manufacturersId: row.p_manufacturers_id != null ? Number(row.p_manufacturers_id) : null,
      // REQ-03-022: eligible for "Buy From Retailer" batch selection when the
      // manufacturer is AIRO/Toffs type AND no suppliers_orders_products row
      // exists yet (mirrors products.service.ts's isSupplierSelectable).
      isSupplierSelectable: (
        row.p_manufacturers_id != null &&
        SUPPLIER_SELECTABLE_MANUFACTURER_IDS.has(Number(row.p_manufacturers_id)) &&
        !supplier
      ),
      supplierType: AIRO_TYPE_MANUFACTURER_ID_LIST.includes(Number(row.p_manufacturers_id))
        ? 'airo'
        : TOFFS_TYPE_MANUFACTURER_ID_LIST.includes(Number(row.p_manufacturers_id))
          ? 'toffs'
          : null,
    };
  }));

  // Marketplace info (REQ-03-011)
  const marketplace: PanelMarketplaceInfo = {
    ebayOrderId: o.ebay_order_id,
    ebayUnacknowledged: ebayAckRows[0]?.unacknowledged ?? null,
    gosportOrderId: o.gosport_order_id,
    catchOrderId: o.catch_order_id,
    fruugoOrderId: o.fruugo_order_id,
    multisiteOrderId: o.multisite_order_id,
    amazonOrderId: o.amazon_order_id,
    mplazaOrderId: o.mplaza_order_id,
    tescoOrderId: o.tesco_order_id,
    rakutenOrderId: o.rakuten_order_id,
    lazadaOrderId: o.lazada_order_id,
    priceministerOrderId: o.priceminister_order_id,
    decathlonOrderId: o.decathlon_order_id,
  };

  return {
    orderId: o.orders_id,
    customersId: o.customers_id,
    status: o.orders_status,
    statusName: o.orders_status_name ?? 'Unknown',
    datePurchased: toIso(o.date_purchased),
    lastModified: toIso(o.last_modified),
    orderTotal: o.order_total != null ? Number(o.order_total) : null,
    currency: o.currency,
    paymentMethod: o.payment_method,
    shippingMethod: o.shipping_method,
    customerName: o.customers_name,
    customerEmail: o.customers_email_address,
    ipAddress: o.ip_address,
    isPrime: o.is_prime_order === 'true',
    siftScoreBit: (o.sift_score ?? 0) > 0,
    fcOrderStatus: o.fc_order_status,
    fraudStatus: Number(customerFraudRows[0]?.fraud_status ?? 0),
    refundStatusForReject: Number(o.refund_status_for_reject_orders ?? 0),
    refundReviewStatus: Number(o.refund_review_status ?? 0),
    refundReviewComment: o.refund_review_comment,
    orderSite: o.order_site,
    suppliers: o.suppliers,
    marketplace,
    products,
    productCount: products.length,
    allSuppliers: allSuppliersRows.map(s => ({
      id: s.suppliers_id,
      name: s.suppliers_name ?? '',
    })),
  };
}

// ---------------------------------------------------------------------------
// REQ-03-015: Refund review status change
// ---------------------------------------------------------------------------

/**
 * Update refund_review_status and optionally refund_review_comment.
 * status: 0 = remove from review, 1 = add to review, 2 = resolve
 */
export async function updateRefundReviewStatus(
  orderId: number,
  status: number,
  comment?: string,
): Promise<void> {
  if (status === 1 && comment != null) {
    await prisma.$executeRaw(
      Prisma.sql`UPDATE orders
                 SET refund_review_status = ${status}, refund_review_comment = ${comment}
                 WHERE orders_id = ${orderId}`
    );
  } else {
    await prisma.$executeRaw(
      Prisma.sql`UPDATE orders SET refund_review_status = ${status} WHERE orders_id = ${orderId}`
    );
  }
  logger.info({ orderId, status }, 'Updated refund review status');
}

// ---------------------------------------------------------------------------
// REQ-03-013: Update supplier assignment
// ---------------------------------------------------------------------------

/**
 * Update the semicolon-delimited suppliers field on orders.
 */
export async function updateOrderSuppliers(
  orderId: number,
  suppliers: string,
): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`UPDATE orders SET suppliers = ${suppliers} WHERE orders_id = ${orderId}`
  );
  logger.info({ orderId, suppliers }, 'Updated order suppliers');
}

// ---------------------------------------------------------------------------
// REQ-03-005: Cancel refund (reset refund_status_for_reject_orders from 1 to 0)
// ---------------------------------------------------------------------------

/**
 * Cancel a pending refund on a rejected order.
 * Only affects orders where refund_status_for_reject_orders = 1.
 * Ported from: orders.php case 'cancel_refund' (lines 7768-7771)
 */
export async function cancelOrderRefund(orderId: number): Promise<boolean> {
  const affected: number = await prisma.$executeRaw(
    Prisma.sql`UPDATE orders
               SET refund_status_for_reject_orders = 0
               WHERE refund_status_for_reject_orders = 1 AND orders_id = ${orderId}`
  );
  logger.info({ orderId, affected }, 'Cancel refund');
  return affected > 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapAttribute(row: PanelProductAttributeRow): PanelProductAttribute {
  const optName = row.products_options ?? '';
  return {
    optionName: optName,
    optionValue: row.products_options_values ?? '',
    optionValueId: row.products_options_values_id ?? null,
    isSize: optName.toLowerCase().includes('size') || (row.products_options_id === 1),
  };
}

/**
 * Resolve an order product's size attribute to the set of product_quantities.size_id
 * values that represent that size in SMS.
 *
 * ROOT CAUSE NOTE: product_quantities.size_id is NOT the raw
 * orders_products_attributes.products_options_values_id — it is
 * manufacturers_sizes_to_default_sizes.manufacturers_options_values_id, which itself
 * equals products_options_values_to_products_options.products_options_values_to_products_options_id
 * (a different id space, confirmed against prod: e.g. products_options_values_id=2611
 * resolves to manufacturers_options_values_id=4401, and product_quantities rows for
 * that product use size_id 4399-4403 — never 2611). Any code comparing
 * products_options_values_id directly against product_quantities.size_id will never
 * match for manufacturer-specific sizing (Puma/Nike/Adidas/etc. — the majority of
 * products), silently reporting 'OFS' regardless of real stock.
 *
 * Matches PHP (ajax_show_order_details.php lines 594-617 + product_code_existance()
 * in functions_general.php lines 2836-2871):
 *  - products_options_id === 1 (the generic "Size" system) → the raw
 *    products_options_values_id already lives in the "default size" space.
 *  - any other products_options_id (manufacturer-specific size chart) → convert to
 *    the default size space first via products_options_values_to_products_options.
 *  - either way, look up manufacturers_sizes_to_default_sizes for the manufacturer's
 *    candidate size_id(s) matching that default size value.
 */
async function resolveMfgSizeIds(
  rawAttrs: PanelProductAttributeRow[],
): Promise<Set<number> | null> {
  const sizeAttr = rawAttrs.find(a => {
    const optName = (a.products_options ?? '').toLowerCase();
    return optName.includes('size') || a.products_options_id === 1;
  });

  if (!sizeAttr || sizeAttr.products_options_id == null || sizeAttr.products_options_values_id == null) {
    return null;
  }

  const opId = sizeAttr.products_options_id;
  let defaultOptValId: number;

  if (opId === 1) {
    // Standard size system → use products_options_values_id directly
    defaultOptValId = sizeAttr.products_options_values_id;
  } else {
    // Manufacturer-specific size → resolve to default_options_values_id (PHP lines 607-612)
    const resolved = await prisma.$queryRaw<{ default_options_values_id: number }[]>(
      Prisma.sql`SELECT mst.default_options_values_id
                 FROM products_options_values_to_products_options povt
                 JOIN manufacturers_sizes_to_default_sizes mst
                   ON povt.products_options_values_to_products_options_id = mst.manufacturers_options_values_id
                 WHERE povt.products_options_values_id = ${sizeAttr.products_options_values_id}
                 LIMIT 1`
    );
    if (resolved.length === 0) {
      return null;
    }
    defaultOptValId = resolved[0].default_options_values_id;
  }

  // Get all manufacturer size IDs for this opId + default size value
  // (PHP product_code_existance lines 2846-2850)
  const mfgSizes = await prisma.$queryRaw<{ manufacturers_options_values_id: number }[]>(
    Prisma.sql`SELECT manufacturers_options_values_id
               FROM manufacturers_sizes_to_default_sizes
               WHERE manufacturers_options_id = ${opId}
                 AND default_options_values_id = ${defaultOptValId}`
  );

  if (mfgSizes.length === 0) {
    return null;
  }

  return new Set(mfgSizes.map(r => Number(r.manufacturers_options_values_id)));
}

/**
 * Resolve comma-separated products_model values.
 * PHP (ajax_show_order_details.php lines 622-632) uses commas to encode fallback
 * product codes:
 *  - No comma → use model directly
 *  - Comma + empty first part (e.g. ",SOMECODE") → use second part
 *  - Comma + non-empty first part → check product_code_existance() which verifies
 *    the product code has a matching size in product_quantities via manufacturer
 *    size mapping (PHP functions_general.php lines 2836-2871)
 */
async function resolveCommaModel(
  model: string | null,
  smsQtyByModel: Map<string, PanelSmsQuantityRow[]>,
  mfgSizeIds: Set<number> | null,
): Promise<string | null> {
  if (!model || !model.includes(',')) return model;

  const parts = model.split(',');
  if (!parts[0]) {
    return parts[1] || model;
  }

  const model0 = parts[0];
  const model1 = parts[1] || model;

  // Check if model0 exists in product_lists (via smsQtyByModel batch data)
  const model0Rows = smsQtyByModel.get(model0);
  if (!model0Rows || model0Rows.length === 0) {
    return model1;
  }

  if (!mfgSizeIds || mfgSizeIds.size === 0) {
    return model1;
  }

  // Check if model0 has product_quantities entries for any of these manufacturer sizes.
  // Uses smsQtyByModel batch data instead of individual DB queries
  // (PHP product_code_existance lines 2856-2864)
  const hasMatchingSize = model0Rows.some(r => r.size_id != null && mfgSizeIds.has(Number(r.size_id)));

  return hasMatchingSize ? model0 : model1;
}

/**
 * REQ-03-017: Resolve SMS quantity from product_lists + product_quantities.
 * Matches by size_id when a size attribute is present (per-size matching).
 * Returns number (qty), 'OFS' (quantity_map=1), or 'N/A' (not found).
 *
 * mfgSizeIds must be the resolved manufacturers_sizes_to_default_sizes id set from
 * resolveMfgSizeIds() — NOT the raw products_options_values_id — since that is the id
 * space product_quantities.size_id actually uses. See resolveMfgSizeIds() doc for the
 * verified prod-data mismatch this fixes.
 */
function resolveSmsQuantity(
  model: string | null,
  mfgSizeIds: Set<number> | null,
  smsQtyByModel: Map<string, PanelSmsQuantityRow[]>,
): number | string {
  if (!model) return 'N/A';

  const rows = smsQtyByModel.get(model);
  if (!rows || rows.length === 0) return 'N/A';

  const quantityMap = rows[0].quantity_map ?? null;
  if (quantityMap === 1) return 'OFS';

  if (mfgSizeIds && mfgSizeIds.size > 0) {
    // Match by resolved size_id for accurate per-size quantity
    const matchingRows = rows.filter(r => r.size_id != null && mfgSizeIds.has(Number(r.size_id)));
    const total = matchingRows.reduce((sum, r) => sum + Number(r.total_qty ?? 0), 0);
    if (total > 0) return total;

    // Parent fallback (if parent shares a product_code already in the batch)
    const parentId = rows[0].parent_product_lists_id;
    if (parentId && parentId > 0) {
      const parentTotal = rows
        .filter(r => r.product_lists_id === parentId && r.size_id != null && mfgSizeIds.has(Number(r.size_id)))
        .reduce((sum, r) => sum + Number(r.total_qty ?? 0), 0);
      if (parentTotal > 0) return parentTotal;
    }
    return 'OFS';
  }

  // No size — sum all quantities
  const total = rows.reduce((sum, r) => sum + Number(r.total_qty ?? 0), 0);
  return total <= 0 ? 'OFS' : total;
}

