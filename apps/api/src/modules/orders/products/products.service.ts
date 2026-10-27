/**
 * Order products service — batched queries for the products table on order edit page.
 * Requirements: REQ-05-001 through REQ-05-019
 *
 * Uses max 8 queries (within REQ-05-019's 10-query limit).
 * Non-critical queries use Promise.allSettled to degrade gracefully.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { createLogger } from '../../../lib/logger';
import { groupBy, toIso } from '../orders.helpers';
import { AIRO_TYPE_MANUFACTURER_ID_LIST, TOFFS_TYPE_MANUFACTURER_ID_LIST } from '../orders.constants';
import type {
  OrderProductRow, ProductAttributeRow, SmsQuantityRow,
  SupplierAssignmentRow, ProductCommentRow, MultipartFcRow,
  TshirtCheckRow, PrinterRow,
  OrderProductItem, ProductAttribute, SupplierInfo, OrderProductsResponse,
} from './products.types';

const logger = createLogger('orders-products');

/**
 * Main entry point: fetch all product data for an order.
 * Returns structured response with products, conditional column flags, and sections.
 */
export async function getOrderProducts(
  orderId: number,
  orderStatus: number,
  orderSite: number | null,
  orderReturnCheck: string,
  currency: string,
  currencyValue: number,
  isExchangeOrder: boolean,
): Promise<OrderProductsResponse> {
  // Query 1 (critical): All products for this order
  const productRows = await prisma.$queryRaw<OrderProductRow[]>(Prisma.sql`
    SELECT
      op.orders_products_id, op.orders_id, op.products_id,
      op.products_model, op.product_barcode, op.products_name,
      op.products_price, op.final_price, op.products_tax, op.products_quantity,
      op.onetime_charges, op.free_offer, op.backorder, op.replacementStatus,
      op.change_quanty, op.change_name, op.box_number, op.kids_chk,
      op.ship_chk, NULLIF(op.ship_date, '0000-00-00 00:00:00') AS ship_date, op.box1, op.print_box_name,
      op.return_chk, op.return_com, op.refund, op.tax_refund,
      op.scanning_status, op.scan_checkpoint, op.member_name,
      op.matching_status, op.matching_member_name, op.exchange_comment_status,
      op.order_printing_status, op.printing_status, op.arrived_status,
      op.jit_marked, op.assign_box_number, op.bundle_product_id,
      op.fc_order_id, op.fc_order_product_id, op.fc_batch_id, op.fc_tote_id,
      op.fc_item_received_scan_user, op.fc_item_sent_scan_user,
      op.add_to_multipart_fc, op.multipart_batch_id, op.multipart_fc_batch_id,
      op.pb_printer_id, NULLIF(op.printing_date, '0000-00-00 00:00:00') AS printing_date, op.is_mystery, op.similar_products_code,
      op.is_manually_added,
      p.products_quantity AS sms_products_quantity,
      p.quantity_map AS p_quantity_map,
      p.manufacturers_id AS p_manufacturers_id
    FROM orders_products op
    LEFT JOIN products p ON op.products_id = p.products_id
    WHERE op.orders_id = ${orderId}
  `);

  if (productRows.length === 0) {
    return {
      products: [],
      conditionalColumns: { showBundleColumn: false, showAllocateColumn: false, showPrintingColumn: false },
      allBackordered: false,
      refundedProducts: [],
      mysteryProducts: [],
      orderReturnCheck,
      isExchangeOrder,
      currency,
      currencyValue,
    };
  }

  // Collect IDs for batch queries
  const opIds = productRows.map(r => r.orders_products_id);
  const productModels = productRows
    .map(r => r.products_model)
    .filter((m): m is string => !!m);
  const uniqueModels = [...new Set(productModels)];
  const productIds = productRows.map(r => r.products_id);
  const printerIds = productRows
    .map(r => r.pb_printer_id)
    .filter((id): id is number => id != null && id > 0);
  const uniquePrinterIds = [...new Set(printerIds)];
  const multipartFcBatchIds = productRows
    .map(r => r.multipart_fc_batch_id)
    .filter((id): id is string => id != null && id !== '');
  const uniqueMultipartFcBatchIds = [...new Set(multipartFcBatchIds)];

  // Build Prisma.join for IN clauses (only if arrays are non-empty)
  const opIdsJoin = Prisma.join(opIds);
  const productIdsJoin = Prisma.join(productIds);

  // Queries 2-8: Non-critical, use allSettled
  const settled = await Promise.allSettled([
    // Query 2: All attributes for all order products
    prisma.$queryRaw<ProductAttributeRow[]>(Prisma.sql`
      SELECT
        opa.orders_products_attributes_id,
        opa.orders_products_id,
        opa.products_options,
        opa.products_options_values,
        opa.options_values_price,
        opa.price_prefix,
        opa.product_attribute_is_free,
        opa.products_options_id,
        opa.products_options_values_id,
        opa.Size_change,
        pov2po.products_options_values_id AS resolved_options_values_id
      FROM orders_products_attributes opa
      LEFT JOIN products_options_values_to_products_options pov2po
        ON opa.products_options_id = pov2po.products_options_id
        AND opa.products_options_values_id = pov2po.products_options_values_id
      WHERE opa.orders_products_id IN (${opIdsJoin})
    `),

    // Query 3: SMS quantities batch lookup
    uniqueModels.length > 0
      ? prisma.$queryRaw<SmsQuantityRow[]>(Prisma.sql`
          SELECT
            pl.product_code, pl.product_lists_id, pl.products_code_type,
            pl.parent_product_lists_id, pl.quantity_map,
            pq.size_id, SUM(pq.quantity) AS total_qty
          FROM product_lists pl
          LEFT JOIN product_quantities pq ON pl.product_lists_id = pq.product_lists_id
          WHERE pl.product_code IN (${Prisma.join(uniqueModels)})
          GROUP BY pl.product_code, pl.product_lists_id, pl.products_code_type,
                   pl.parent_product_lists_id, pl.quantity_map, pq.size_id
        `)
      : Promise.resolve([] as SmsQuantityRow[]),

    // Query 4: Supplier assignments
    prisma.$queryRaw<SupplierAssignmentRow[]>(Prisma.sql`
      SELECT
        sop.supplier_order_product_id,
        sop.order_product_id,
        sop.supplier_order_id,
        sop.supplier_id,
        sop.product_model,
        sop.allocate,
        sop.exception,
        sop.manufacturers_id
      FROM suppliers_orders_products sop
      JOIN orders_products op ON op.orders_products_id = sop.order_product_id
      WHERE op.orders_id = ${orderId}
      ORDER BY sop.supplier_order_product_id DESC
    `),

    // Query 5: Product list comments
    uniqueModels.length > 0
      ? prisma.$queryRaw<ProductCommentRow[]>(Prisma.sql`
          SELECT pl.product_code, pl.pl_comment
          FROM product_lists pl
          WHERE pl.product_code IN (${Prisma.join(uniqueModels)})
            AND pl.pl_comment IS NOT NULL AND pl.pl_comment != ''
        `)
      : Promise.resolve([] as ProductCommentRow[]),

    // Query 6: Multipart FC batch data
    uniqueMultipartFcBatchIds.length > 0
      ? prisma.$queryRaw<MultipartFcRow[]>(Prisma.sql`
          SELECT mfo.mfo_id, mfo.fc_batch_name, mfo.fc_order_id
          FROM multipart_fc_orders mfo
          WHERE mfo.mfo_id IN (${Prisma.join(uniqueMultipartFcBatchIds.map(Number))})
        `)
      : Promise.resolve([] as MultipartFcRow[]),

    // Query 7: T-shirt products check (virtual_product_type_id = 4)
    prisma.$queryRaw<TshirtCheckRow[]>(Prisma.sql`
      SELECT DISTINCT p.products_id
      FROM products p
      WHERE p.virtual_product_type_id = 4
        AND p.products_status = '1'
        AND p.products_id IN (${productIdsJoin})
    `),

    // Query 8: Printer names
    uniquePrinterIds.length > 0
      ? prisma.$queryRaw<PrinterRow[]>(Prisma.sql`
          SELECT admin_id, admin_name FROM admin
          WHERE admin_id IN (${Prisma.join(uniquePrinterIds)})
        `)
      : Promise.resolve([] as PrinterRow[]),
  ]);

  // Extract results with safe defaults
  const val = <T>(r: PromiseSettledResult<T>, def: T): T => {
    if (r.status === 'fulfilled') return r.value;
    logger.warn({ err: r.reason }, 'Non-critical order products query failed');
    return def;
  };

  const attributeRows = val(settled[0], [] as ProductAttributeRow[]);
  const smsQuantityRows = val(settled[1], [] as SmsQuantityRow[]);
  const supplierRows = val(settled[2], [] as SupplierAssignmentRow[]);
  const commentRows = val(settled[3], [] as ProductCommentRow[]);
  const multipartFcRows = val(settled[4], [] as MultipartFcRow[]);
  const tshirtRows = val(settled[5], [] as TshirtCheckRow[]);
  const printerRows = val(settled[6], [] as PrinterRow[]);

  // Build lookup maps
  const attrsByOpId = groupBy(attributeRows, r => r.orders_products_id);
  const supplierByOpId = new Map<number, SupplierAssignmentRow>();
  for (const s of supplierRows) {
    // First occurrence = latest (ordered DESC)
    if (!supplierByOpId.has(s.order_product_id)) {
      supplierByOpId.set(s.order_product_id, s);
    }
  }
  const commentsByModel = new Map<string, string>();
  for (const c of commentRows) {
    if (c.pl_comment) commentsByModel.set(c.product_code, c.pl_comment);
  }
  const multipartFcByMfoId = new Map<number, MultipartFcRow>();
  for (const m of multipartFcRows) {
    multipartFcByMfoId.set(m.mfo_id, m);
  }
  const tshirtProductIds = new Set(tshirtRows.map(r => r.products_id));
  const printerNamesById = new Map<number, string>();
  for (const p of printerRows) {
    if (p.admin_name) printerNamesById.set(p.admin_id, p.admin_name);
  }

  // SMS quantity lookup: group by product_code
  const smsQtyByModel = new Map<string, SmsQuantityRow[]>();
  for (const row of smsQuantityRows) {
    const existing = smsQtyByModel.get(row.product_code) ?? [];
    existing.push(row);
    smsQtyByModel.set(row.product_code, existing);
  }

  // Allocation: any product with a supplier assignment row is "allocation pending"
  // (matches PHP $order_product_id_arr which includes all supplier rows)
  const allocationPendingIds = new Set<number>(
    supplierRows.map(s => s.order_product_id)
  );

  // m3: hoist combined manufacturer ids to a Set so isSupplierSelectable
  // avoids spreading two arrays on every row iteration.
  const supplierSelectableManufacturerIds = new Set<number>([
    ...AIRO_TYPE_MANUFACTURER_ID_LIST,
    ...TOFFS_TYPE_MANUFACTURER_ID_LIST,
  ]);

  // Assemble products
  const allProducts: OrderProductItem[] = productRows.map(row => {
    const attrs = (attrsByOpId.get(row.orders_products_id) ?? []).map(mapAttribute);
    const supplier = supplierByOpId.get(row.orders_products_id) ?? null;
    const model = row.products_model ?? null;

    // Check for trainers personalisation (REQ-05-004)
    const hasTrainersPersonalisation = attrs.some(a =>
      a.optionName.toLowerCase().includes('trainers personalisation') ||
      a.optionName.toLowerCase().includes('shorts number')
    );

    // SMS quantity resolution
    const { quantity: smsQuantity, quantityMap: smsQuantityMap } = resolveSmsQuantity(
      model, attrs, smsQtyByModel
    );

    // Multipart FC batch name
    let multipartFcBatchName: string | null = null;
    if (row.multipart_fc_batch_id) {
      const mfo = multipartFcByMfoId.get(Number(row.multipart_fc_batch_id));
      if (mfo?.fc_batch_name) multipartFcBatchName = mfo.fc_batch_name;
    }

    // Printer name
    let printerName: string | null = null;
    if (row.pb_printer_id && row.pb_printer_id > 0) {
      printerName = printerNamesById.get(row.pb_printer_id) ?? null;
    }

    return {
      ordersProductsId: row.orders_products_id,
      productsId: row.products_id,
      model,
      barcode: row.product_barcode,
      name: row.products_name ?? '',
      price: Number(row.products_price ?? 0),
      finalPrice: Number(row.final_price ?? 0),
      tax: Number(row.products_tax ?? 0),
      quantity: row.products_quantity,
      onetimeCharges: Number(row.onetime_charges ?? 0),
      freeOffer: (row.free_offer ?? 0) === 1,
      backorder: row.backorder ?? 'No',
      replacementStatus: row.replacementStatus,
      changeQuantity: String(row.change_quanty ?? '0') === '1',
      changeName: String(row.change_name ?? '0') === '1',
      boxNumber: row.box_number,
      kidsChk: row.kids_chk,
      shipChk: row.ship_chk ?? 'no',
      shipDate: toIso(row.ship_date),
      box1: row.box1,
      printBoxName: row.print_box_name,
      returnChk: row.return_chk ?? 'no',
      returnComment: row.return_com,
      refund: (row.refund ?? 0) === 1,
      taxRefund: (row.tax_refund ?? 0) === 1,
      scanningStatus: row.scanning_status ?? 'No',
      scanCheckpoint: row.scan_checkpoint,
      memberName: row.member_name,
      matchingStatus: row.matching_status ?? 'No',
      matchingMemberName: row.matching_member_name,
      exchangeCommentStatus: row.exchange_comment_status ?? 'NO',
      orderPrintingStatus: row.order_printing_status ?? 0,
      printingStatus: row.printing_status,
      arrivedStatus: row.arrived_status,
      jitMarked: row.jit_marked ?? 'no',
      assignBoxNumber: row.assign_box_number,
      bundleProductId: row.bundle_product_id,
      fcOrderId: row.fc_order_id,
      fcOrderProductId: row.fc_order_product_id,
      fcBatchId: row.fc_batch_id,
      fcToteId: row.fc_tote_id,
      fcItemReceivedScanUser: row.fc_item_received_scan_user,
      fcItemSentScanUser: row.fc_item_sent_scan_user,
      addToMultipartFc: row.add_to_multipart_fc,
      multipartBatchId: row.multipart_batch_id,
      multipartFcBatchId: row.multipart_fc_batch_id,
      pbPrinterId: row.pb_printer_id,
      printingDate: toIso(row.printing_date),
      printerName,
      isMystery: row.is_mystery === 'yes',
      similarProductsCode: row.similar_products_code,
      isManuallyAdded: row.is_manually_added === 'yes',
      smsProductsQuantity: row.sms_products_quantity != null ? Number(row.sms_products_quantity) : null,
      productQuantityMap: row.p_quantity_map != null ? Number(row.p_quantity_map) : null,
      manufacturersId: row.p_manufacturers_id != null ? Number(row.p_manufacturers_id) : null,
      attributes: attrs,
      smsQuantity,
      smsQuantityMap,
      supplier: supplier ? mapSupplier(supplier) : null,
      productComment: model ? (commentsByModel.get(model) ?? null) : null,
      multipartFcBatchName,
      hasTrainersPersonalisation,
      isTshirtProduct: tshirtProductIds.has(row.products_id),
      isAllocationPending: allocationPendingIds.has(row.orders_products_id),
      isSupplierSelectable: (
        supplierSelectableManufacturerIds.has(Number(row.p_manufacturers_id))
        && !allocationPendingIds.has(row.orders_products_id)
      ),
    };
  });

  // Conditional columns (REQ-05-001)
  const showBundleColumn = allProducts.some(p => !!p.bundleProductId);
  const showAllocateColumn = allProducts.some(p => p.isAllocationPending || p.isSupplierSelectable);
  const showPrintingColumn = allProducts.some(p => p.isTshirtProduct);

  // REQ-05-002: All backordered check — compare non-refunded backorders against total products
  // Refunded products are excluded because the PHP source counts backorders only among
  // non-refunded lines when determining whether the whole order is backordered.
  const nonRefundedBackorders = allProducts.filter(p => p.backorder === 'Yes' && !p.refund && !p.taxRefund);
  const allBackordered = allProducts.length > 0 && nonRefundedBackorders.length === allProducts.length;

  // Separate products by category
  const normalProducts = allProducts.filter(p => !p.refund && !p.taxRefund);
  const refundedProducts = allProducts.filter(p => p.refund || p.taxRefund);
  const mysteryProducts = allProducts.filter(p => p.isMystery);

  return {
    products: normalProducts,
    conditionalColumns: { showBundleColumn, showAllocateColumn, showPrintingColumn },
    allBackordered,
    refundedProducts,
    mysteryProducts,
    orderReturnCheck,
    isExchangeOrder,
    currency,
    currencyValue,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapAttribute(row: ProductAttributeRow): ProductAttribute {
  return {
    id: row.orders_products_attributes_id,
    optionName: row.products_options ?? '',
    optionValue: row.products_options_values ?? '',
    optionId: row.products_options_id,
    optionValueId: row.products_options_values_id,
    resolvedOptionValueId: row.resolved_options_values_id,
    price: row.options_values_price != null ? Number(row.options_values_price) : null,
    pricePrefix: row.price_prefix,
    isFree: (row.product_attribute_is_free ?? 0) === 1,
    sizeChanged: String(row.Size_change ?? '0') === '1',
  };
}

function mapSupplier(row: SupplierAssignmentRow): SupplierInfo {
  return {
    supplierOrderProductId: row.supplier_order_product_id,
    supplierOrderId: row.supplier_order_id ?? null,
    supplierId: row.supplier_id,
    allocate: row.allocate,
    exception: row.exception,
    manufacturersId: row.manufacturers_id,
  };
}

/**
 * REQ-05-015: Resolve SMS quantity from product_lists + product_quantities.
 * Returns numeric quantity or 'OFS' (Out For Stock) string.
 */
function resolveSmsQuantity(
  model: string | null,
  attrs: ProductAttribute[],
  smsQtyByModel: Map<string, SmsQuantityRow[]>,
): { quantity: string | number; quantityMap: number | null } {
  if (!model) return { quantity: '', quantityMap: null };

  const rows = smsQtyByModel.get(model);
  if (!rows || rows.length === 0) return { quantity: '', quantityMap: null };

  // Get quantity_map from first row
  const quantityMap = rows[0].quantity_map ?? null;
  if (quantityMap === 1) {
    return { quantity: 'OFS', quantityMap };
  }

  // Find the size attribute to match against size_id
  const sizeAttr = attrs.find(a => a.optionId === 1);
  const sizeOptValId = sizeAttr?.resolvedOptionValueId ?? sizeAttr?.optionValueId ?? null;

  if (sizeOptValId != null) {
    // Sum quantities matching this size
    const matchingRows = rows.filter(r => r.size_id != null && Number(r.size_id) === sizeOptValId);
    const total = matchingRows.reduce((sum, r) => sum + Number(r.total_qty ?? 0), 0);

    if (total > 0) return { quantity: total, quantityMap };

    // Parent fallback: when products_code_type=4 or total<1, the PHP code queries
    // parent via parent_product_lists_id. This only works if the parent happens to
    // share a product_code already in the batch. Full parent lookup would need an
    // additional query — deferred as a known limitation until proven needed.
    // The parent row is only found if it shares a product_code with another order product.
    const parentId = rows[0].parent_product_lists_id;
    if (parentId && parentId > 0) {
      const parentTotal = rows
        .filter(r => r.product_lists_id === parentId && r.size_id != null && Number(r.size_id) === sizeOptValId)
        .reduce((sum, r) => sum + Number(r.total_qty ?? 0), 0);
      if (parentTotal > 0) return { quantity: total + parentTotal, quantityMap };
    }

    return { quantity: total <= 0 ? 0 : total, quantityMap };
  }

  // No size attribute — sum all quantities
  const total = rows.reduce((sum, r) => sum + Number(r.total_qty ?? 0), 0);
  return { quantity: total <= 0 ? 0 : total, quantityMap };
}

