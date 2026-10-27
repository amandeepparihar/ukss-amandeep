/**
 * Executive Dashboard Zod Validation Schemas
 */

import { z } from 'zod';

/**
 * Shared query schema for all 3 executive-dashboard endpoints — this module
 * is range-driven only (no period-tab enum, unlike sales-dashboard's kpi tab).
 */
export const executiveDashboardQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  stores: z.string().optional(),
  noCache: z.coerce.boolean().optional().default(false),
  comparePrevious: z.coerce.boolean().optional().default(false),
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] },
);
