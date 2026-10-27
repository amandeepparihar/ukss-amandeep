/**
 * Sales Dashboard Zod Validation Schemas
 */

import { z } from 'zod';

// ─── Date Range & Granularity ──────────────────────────────────────

/**
 * Base date range schema used by all chart queries.
 * startDate and endDate must be YYYY-MM-DD strings, with startDate <= endDate.
 */
export const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

export const granularitySchema = z.enum(['daily', 'weekly', 'monthly']).default('monthly');

// ─── Event Enums ───────────────────────────────────────────────────

export const eventCategoryEnum = z.enum(['global', 'continental', 'domestic', 'commercial']);
export const eventTypeEnum = z.enum(['recurring_annual', 'recurring_biennial', 'recurring_quadrennial', 'one_off']);

// ─── Event Query / CRUD Schemas ────────────────────────────────────

export const eventsQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
  category: eventCategoryEnum.optional(),
  region: z.string().optional(),
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

export const createEventSchema = z.object({
  event_name: z.string().min(1).max(255),
  event_category: eventCategoryEnum,
  event_type: eventTypeEnum,
  region: z.string().min(1).max(100).default('Global'),
  buying_window_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  buying_window_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  event_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  event_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  year: z.coerce.number().int().min(2000).max(2100),
  is_active: z.boolean().optional().default(true),
  notes: z.string().optional(),
});

export const updateEventSchema = createEventSchema.partial();

// ─── Chart-Specific Query Schemas ──────────────────────────────────

export const teamSalesQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
  granularity: granularitySchema,
  league: z.string().optional(),
  continent: z.string().optional(),
  topN: z.coerce.number().int().min(1).default(5),
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

export const productTypeSalesQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
  granularity: granularitySchema,
  typeId: z.coerce.number().int().optional(),
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

export const genderSalesQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
  granularity: granularitySchema,
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

export const personalisationQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
  granularity: granularitySchema,
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

export const orderHealthQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
  granularity: granularitySchema,
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

// ─── V2 Chart Query Schemas ───────────────────────────────────────

export const dailyRevenueQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
  comparePriorYear: z.coerce.boolean().optional().default(false),
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

export const revenueDayHourQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

export const customerSegmentsQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
  granularity: granularitySchema,
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

export const returnRateQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
  typeId: z.coerce.number().int().optional(),
  alertThreshold: z.coerce.number().min(0).max(100).optional().default(15),
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

export const inventoryQuadrantQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
  turnoverThreshold: z.coerce.number().min(0).optional().default(2),
  stockDaysThreshold: z.coerce.number().min(0).optional().default(60),
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

export const geoRevenueQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  noCache: z.coerce.boolean().optional().default(false),
  country: z.string().optional(),
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);

// ─── Exported Types ────────────────────────────────────────────────

export type DateRangeQuery = z.infer<typeof dateRangeSchema>;
export type Granularity = z.infer<typeof granularitySchema>;
export type EventsQuery = z.infer<typeof eventsQuerySchema>;
export type CreateEvent = z.infer<typeof createEventSchema>;
export type UpdateEvent = z.infer<typeof updateEventSchema>;
export type TeamSalesQuery = z.infer<typeof teamSalesQuerySchema>;
export type ProductTypeSalesQuery = z.infer<typeof productTypeSalesQuerySchema>;
export type GenderSalesQuery = z.infer<typeof genderSalesQuerySchema>;
export type PersonalisationQuery = z.infer<typeof personalisationQuerySchema>;
export type OrderHealthQuery = z.infer<typeof orderHealthQuerySchema>;
export type DailyRevenueQuery = z.infer<typeof dailyRevenueQuerySchema>;
export type RevenueDayHourQuery = z.infer<typeof revenueDayHourQuerySchema>;
export type CustomerSegmentsQuery = z.infer<typeof customerSegmentsQuerySchema>;
export type ReturnRateQuery = z.infer<typeof returnRateQuerySchema>;
export type InventoryQuadrantQuery = z.infer<typeof inventoryQuadrantQuerySchema>;
export type GeoRevenueQuery = z.infer<typeof geoRevenueQuerySchema>;
