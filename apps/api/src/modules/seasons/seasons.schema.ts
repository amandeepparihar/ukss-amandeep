import { z } from 'zod';

export const seasonsSortByEnum = z.enum(['seasons_id', 'season', 'sort', 'created']);

export const seasonsSortOrderEnum = z.enum(['asc', 'desc']);

export const getSeasonsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  sortBy: seasonsSortByEnum.default('sort'),
  sortOrder: seasonsSortOrderEnum.default('asc'),
});

export const exportSeasonsQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']),
  search: z.string().trim().optional(),
  sortBy: seasonsSortByEnum.default('sort'),
  sortOrder: seasonsSortOrderEnum.default('asc'),
});

export const getSeasonParamsSchema = z.object({
  id: z.coerce.number().int().positive({ message: 'Invalid season ID' }),
});

export const nameAvailableQuerySchema = z.object({
  season: z.string().trim().min(1, 'Season is required'),
  excludeId: z.coerce.number().int().positive().optional(),
});

export const createSeasonSchema = z.object({
  season: z
    .string()
    .trim()
    .min(1, 'Season is required')
    .max(11, 'Season cannot exceed 11 characters')
    .regex(/^\d{4}-\d{4}$/, 'Season must be in the format YYYY-YYYY, e.g. 2023-2024'),
  sort: z.coerce
    .number({ invalid_type_error: 'Sort order is required and must be a whole number' })
    .int('Sort order is required and must be a whole number')
    .min(-2147483648, 'Sort order is too small')
    .max(2147483647, 'Sort order is too large'),
});

export const updateSeasonSchema = z.object({
  season: z
    .string()
    .trim()
    .min(1, 'Season is required')
    .max(11, 'Season cannot exceed 11 characters')
    .regex(/^\d{4}-\d{4}$/, 'Season must be in the format YYYY-YYYY, e.g. 2023-2024'),
  sort: z.coerce
    .number({ invalid_type_error: 'Sort order is required and must be a whole number' })
    .int('Sort order is required and must be a whole number')
    .min(-2147483648, 'Sort order is too small')
    .max(2147483647, 'Sort order is too large'),
});

export type GetSeasonsQuery = z.infer<typeof getSeasonsQuerySchema>;
export type ExportSeasonsQuery = z.infer<typeof exportSeasonsQuerySchema>;
export type GetSeasonParams = z.infer<typeof getSeasonParamsSchema>;
export type NameAvailableQuery = z.infer<typeof nameAvailableQuerySchema>;
export type CreateSeasonInput = z.infer<typeof createSeasonSchema>;
export type UpdateSeasonInput = z.infer<typeof updateSeasonSchema>;
