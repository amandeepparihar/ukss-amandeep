import { z } from 'zod';

export const teamsSortByEnum = z.enum(['teams_id', 'team_name', 'sort', 'created']);

export const teamsSortOrderEnum = z.enum(['asc', 'desc']);

export const getTeamsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  sortBy: teamsSortByEnum.default('sort'),
  sortOrder: teamsSortOrderEnum.default('asc'),
});

// no pagination: the export always covers the full filtered set
export const exportTeamsQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']),
  search: z.string().trim().optional(),
  sortBy: teamsSortByEnum.default('sort'),
  sortOrder: teamsSortOrderEnum.default('asc'),
});

export const getTeamParamsSchema = z.object({
  id: z.coerce.number().int().positive({ message: 'Invalid team ID' }),
});

export const nameAvailableQuerySchema = z.object({
  name: z.string().trim().min(1, 'Team name is required'),
  excludeId: z.coerce.number().int().positive().optional(),
});

export const createTeamSchema = z.object({
  teamName: z
    .string()
    .trim()
    .min(1, 'Team name is required')
    .max(55, 'Team name cannot exceed 55 characters')
    .regex(/^[A-Z]/i, 'Team name must start with a letter'),
  sort: z.coerce
    .number({ invalid_type_error: 'Sort order is required and must be a whole number' })
    .int('Sort order is required and must be a whole number')
    .min(-2147483648, 'Sort order is too small')
    .max(2147483647, 'Sort order is too large'),
});

export const updateTeamSchema = createTeamSchema;

export type GetTeamsQuery = z.infer<typeof getTeamsQuerySchema>;
export type ExportTeamsQuery = z.infer<typeof exportTeamsQuerySchema>;
export type GetTeamParams = z.infer<typeof getTeamParamsSchema>;
export type NameAvailableQuery = z.infer<typeof nameAvailableQuerySchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
