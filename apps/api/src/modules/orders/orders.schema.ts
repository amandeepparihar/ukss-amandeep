/**
 * Orders module Zod schemas — shared validation for orders endpoints.
 * Requirements: CX-003 (input validation), REQ-01-012 (page modes),
 *   REQ-01-013 (edit mode), REQ-02-006 through REQ-02-015 (filters/search)
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Page mode (REQ-01-012)
// ---------------------------------------------------------------------------

export const OrderPageModeSchema = z.enum(['listing', 'edit', 'processing']);
export type OrderPageMode = z.infer<typeof OrderPageModeSchema>;

// ---------------------------------------------------------------------------
// Order ID parameter (REQ-01-013: integer cast for SQL safety)
// ---------------------------------------------------------------------------

export const OrderIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// ---------------------------------------------------------------------------
// REQ-02-015: General search input whitelist
// ---------------------------------------------------------------------------

const SAFE_SEARCH_REGEX = /^[a-zA-Z0-9\s\u00C0-\u024F.,'\-@#&/+_():;]*$/;

// ---------------------------------------------------------------------------
// REQ-02-006 through REQ-02-015: Listing query params
// ---------------------------------------------------------------------------

export const OrderListQuerySchema = z.object({
  // Pagination (REQ-02-023)
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),

  // Sorting (REQ-02-010)
  sortBy: z.enum(['default', 'statusChanged', 'orderValue', 'recent_touchpoint', 'maximum_touchpoint']).default('default'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),

  // REQ-02-006: Status filter (includes special IDs 200, 1223-1225, 101, 102)
  status: z.coerce.number().int().optional(),

  // REQ-02-007: Seller/store filter (string value = store_url, matches PHP orders_from column)
  seller: z.string().optional(),

  // REQ-02-008: Marketplace dropdown (constrained to valid column map keys)
  marketplace: z.enum([
    '', 'amazon', 'tesco', 'mplaza', 'fruugo', 'rakuten', 'lazada',
    'priceminister', 'gosport', 'catch', 'ebay', 'terracegear', 'racecrate', 'decathlon',
  ]).optional(),

  // REQ-02-009: Order type filter
  orderType: z.enum(['', 'wholesale', 'online']).optional(),

  // REQ-02-011: Scanning status (only for status=14)
  scanningStatus: z.enum(['scanned', 'non-scanned', 'amazon-premium']).optional(),

  // REQ-02-011B: Date interval (months) — constrained to valid values
  interval: z.coerce.number().int().refine(
    (v) => [3, 6, 12].includes(v),
    { message: 'Interval must be 3, 6, or 12' }
  ).optional(),

  // REQ-02-011C: Size filter (when product search active)
  // PHP filters by products_options_values_id (numeric), so coerce to number
  sizeFilter: z.coerce.number().int().positive().optional(),

  // REQ-02-013: Marketplace search inputs
  marketplaceSearchValue: z.string().optional().refine(
    (val) => !val || SAFE_SEARCH_REGEX.test(val),
    { message: 'Marketplace search contains invalid characters' }
  ),

  // REQ-02-014: General search inputs
  search: z.string().optional().refine(
    (val) => !val || SAFE_SEARCH_REGEX.test(val),
    { message: 'Search contains invalid characters' }
  ),
  orderId: z.coerce.number().int().positive().optional(),
  toffsCode: z.string().optional().refine(
    (val) => !val || SAFE_SEARCH_REGEX.test(val),
    { message: 'Toffs code contains invalid characters' }
  ),
  fsBarcode: z.string().optional().refine(
    (val) => !val || SAFE_SEARCH_REGEX.test(val),
    { message: 'Barcode contains invalid characters' }
  ),
  productSearch: z.string().optional().refine(
    (val) => !val || SAFE_SEARCH_REGEX.test(val),
    { message: 'Product search contains invalid characters' }
  ),

  // REQ-02-017: Ship-by-date tab
  tab: z.enum(['today', 'tomorrow', 'twoDays', 'afterTwoDays', 'toBeRefund']).optional(),

  // Branch 1: customer filter
  customerId: z.coerce.number().int().positive().optional(),

  // Supplier filter (Branch 10)
  supplier: z.string().optional().refine(
    (val) => !val || SAFE_SEARCH_REGEX.test(val),
    { message: 'Supplier contains invalid characters' }
  ),

  // Popup/session filter (Branch 15)
  popupProductId: z.coerce.number().int().positive().optional(),
  popupCategoryId: z.coerce.number().int().positive().optional(),
});

export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;

// ---------------------------------------------------------------------------
// Tab counts query schema (REQ-02-017) — derived from listing schema
// ---------------------------------------------------------------------------

export const OrderTabCountsQuerySchema = OrderListQuerySchema.omit({
  page: true, pageSize: true, sortBy: true, sortOrder: true, tab: true, orderId: true,
});

export type OrderTabCountsQuery = z.infer<typeof OrderTabCountsQuerySchema>;

// ---------------------------------------------------------------------------
// Feature permissions response
// ---------------------------------------------------------------------------

export const OrderPermissionsSchema = z.object({
  refundPermission: z.boolean(),
  rejectPermission: z.boolean(),
});

// ---------------------------------------------------------------------------
// Order status dropdown item
// ---------------------------------------------------------------------------

export const OrderStatusSchema = z.object({
  id: z.number(),
  name: z.string(),
  displayOrder: z.number(),
});

export type OrderStatus = z.infer<typeof OrderStatusSchema>;

// ---------------------------------------------------------------------------
// DB configuration value (REQ-01-010)
// ---------------------------------------------------------------------------

export const ConfigurationValueSchema = z.object({
  key: z.string(),
  value: z.string(),
});

// ---------------------------------------------------------------------------
// AJAX response format (CX-008)
// ---------------------------------------------------------------------------

export const AjaxResponseSchema = z.object({
  status: z.enum(['success', 'error']),
  message: z.string(),
  data: z.unknown().optional(),
  redirect: z.string().optional(),
});

export type AjaxResponse = z.infer<typeof AjaxResponseSchema>;

// ---------------------------------------------------------------------------
// SPEC-04: Order edit page schemas
// ---------------------------------------------------------------------------

/** REQ-04-002: Navigation query (prev/next within same status) */
export const OrderNavigationSchema = z.object({
  status: z.coerce.number().int().min(0).optional(),
  direction: z.enum(['prev', 'next']),
});

export type OrderNavigation = z.infer<typeof OrderNavigationSchema>;

/** REQ-04-007: Customer toggle body (priority or approve) */
export const CustomerToggleSchema = z.object({
  customersId: z.coerce.number().int().positive(),
});

export type CustomerToggle = z.infer<typeof CustomerToggleSchema>;

// ---------------------------------------------------------------------------
// SPEC-03: Order Details Panel schemas
// ---------------------------------------------------------------------------

/** REQ-03-009: Rejection request body (action types 1-5) */
export const RejectOrderSchema = z.object({
  actionType: z.number().int().min(1).max(5) as z.ZodType<1 | 2 | 3 | 4 | 5>,
});

export type RejectOrder = z.infer<typeof RejectOrderSchema>;

/** REQ-03-015: Refund review status change */
export const RefundReviewSchema = z.object({
  status: z.number().int().min(0).max(2),
  comment: z.string().max(1000).optional(),
});

export type RefundReview = z.infer<typeof RefundReviewSchema>;

/** REQ-03-013: Supplier assignment update */
export const UpdateSuppliersSchema = z.object({
  suppliers: z.string().max(500).regex(
    /^$|^(\d+)(;\d+)*$/,
    'Must be empty or semicolon-delimited numeric IDs (e.g. "1;5;12")',
  ),
});

export type UpdateSuppliers = z.infer<typeof UpdateSuppliersSchema>;

/** REQ-03-006: Delete order with optional restock */
export const DeleteOrderSchema = z.object({
  restock: z.boolean().default(false),
});

export type DeleteOrder = z.infer<typeof DeleteOrderSchema>;

// ---------------------------------------------------------------------------
// SPEC-07: Status Management schemas
// ---------------------------------------------------------------------------

/** REQ-07-001 + REQ-07-002: Status update request body */
export const StatusUpdateSchema = z.object({
  status: z.coerce.number().int().positive(),
  previousOrderStatus: z.coerce.number().int().min(0),
  comments: z.string().max(65535).default(''),
  notify: z.boolean().default(false),
  notifyComments: z.boolean().default(false),
  privateComment: z.boolean().default(false),
  useOriginalEmail: z.boolean().default(false),
  sendMessageAutomatically: z.boolean().default(false),
  pageForLog: z.string().max(100).default('EditOrderPage'),
});

export type StatusUpdate = z.infer<typeof StatusUpdateSchema>;

/** REQ-07-025: Touchpoint increment body */
export const TouchpointSchema = z.object({
  touchpoints: z.coerce.number().int().min(0),
});

export type Touchpoint = z.infer<typeof TouchpointSchema>;

/** REQ-07-023: Status template request param */
export const StatusTemplateParamSchema = z.object({
  statusId: z.coerce.number().int().positive(),
});

export type StatusTemplateParam = z.infer<typeof StatusTemplateParamSchema>;

/** REQ-07-018: Status history item (response shape) */
export const StatusHistoryItemSchema = z.object({
  id: z.number(),
  orderId: z.number(),
  statusId: z.number(),
  statusName: z.string(),
  dateAdded: z.string(),
  customerNotified: z.boolean(),
  comments: z.string(),
  commentBy: z.string().nullable(),
  commentPrivate: z.string().nullable(),
  statusChangeFrom: z.string().nullable(),
});

export type StatusHistoryItem = z.infer<typeof StatusHistoryItemSchema>;

// ---------------------------------------------------------------------------
// SPEC-06: Product-Level Actions schemas
// ---------------------------------------------------------------------------

/** Product ID path parameter (reusable across product action endpoints) */
export const ProductIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  productId: z.coerce.number().int().positive(),
});

export type ProductIdParam = z.infer<typeof ProductIdParamSchema>;

/** REQ-06-001: Box number assignment */
export const BoxNumberSchema = z.object({
  boxNumber: z.string().max(50).default(''),
});

export type BoxNumberInput = z.infer<typeof BoxNumberSchema>;

/** REQ-06-008: JIT toggle */
export const JitToggleSchema = z.object({
  checkBit: z.enum(['yes', 'no']),
});

export type JitToggleInput = z.infer<typeof JitToggleSchema>;

/** REQ-06-014: Backorder toggle (supports bulk via underscore-separated IDs) */
export const BackorderToggleSchema = z.object({
  orderProductId: z.string().min(1).regex(
    /^\d+(_\d+)*$/,
    'Must be a single numeric ID or underscore-separated IDs (e.g. "123" or "123_456_789")',
  ),
  backorder: z.enum(['Yes', 'No']),
});

export type BackorderToggleInput = z.infer<typeof BackorderToggleSchema>;

/** REQ-06-021: Ship check toggle */
export const ShipCheckSchema = z.object({
  shipChk: z.enum(['yes', 'no']),
});

export type ShipCheckInput = z.infer<typeof ShipCheckSchema>;

/** REQ-06-022: Printing status toggle */
export const PrintingStatusSchema = z.object({
  printed: z.enum(['Printed', 'Not Printed']),
});

export type PrintingStatusInput = z.infer<typeof PrintingStatusSchema>;

/** REQ-06-023: Arrived status toggle */
export const ArrivedStatusSchema = z.object({
  arrived: z.enum(['Arrived', 'Not Arrived']),
});

export type ArrivedStatusInput = z.infer<typeof ArrivedStatusSchema>;

/** REQ-06-025 / REQ-06-026: Box1 / Box2 free text update */
export const BoxFieldSchema = z.object({
  value: z.string().max(255).default(''),
});

export type BoxFieldInput = z.infer<typeof BoxFieldSchema>;

// ---------------------------------------------------------------------------
// SPEC-13: Order Processing Engine schemas
// ---------------------------------------------------------------------------

/** REQ-13-003: Simulation disagreement comment */
export const SimulationDisagreeSchema = z.object({
  comment: z.string().min(1).max(5000),
});

export type SimulationDisagreeInput = z.infer<typeof SimulationDisagreeSchema>;

/** REQ-13-008: Remote order processing request */
export const RemoteProcessSchema = z.object({
  type: z.enum(['complete', 'multipart', 'part', 'invoice', 'print']),
  products: z.array(z.object({
    ordersProductsId: z.number().int().positive(),
    boxNumber: z.string().max(50).default(''),
  })).min(1),
});

export type RemoteProcessInput = z.infer<typeof RemoteProcessSchema>;

/** REQ-13-006: Batch processing request */
export const BatchProcessSchema = z.object({
  orderIds: z.array(z.number().int().positive()).min(1).max(500),
});

export type BatchProcessInput = z.infer<typeof BatchProcessSchema>;
