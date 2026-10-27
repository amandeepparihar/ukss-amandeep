import { z } from 'zod';

// Auth Schemas
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  rememberMe: z.boolean().optional(),
});

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  confirmPassword: z.string(),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

// Google Login Schema
export const googleLoginSchema = z.object({
  credential: z.string().min(1, 'Google credential is required'),
});

export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;

// User Schemas
export const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  roleId: z.string().min(1, 'Role is required'),
  isActive: z.boolean().default(true),
});

export const updateUserSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  roleId: z.string().optional(),
  isActive: z.boolean().optional(),
  avatar: z.string().url().optional().nullable(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  avatar: z.string().url().optional().nullable(),
});

// Role Schemas
export const createRoleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

// Permission Schemas
export const permissionSchema = z.object({
  resource: z.string().min(1, 'Resource is required'),
  action: z.enum(['view', 'create', 'edit', 'delete']),
});

export const updateRolePermissionsSchema = z.object({
  permissions: z.array(permissionSchema),
});

// Menu Item Schemas
export const createMenuItemSchema = z.object({
  label: z.string().min(1, 'Label is required').max(100),
  icon: z.string().optional(),
  path: z.string().optional(),
  isExternal: z.boolean().default(false),
  parentId: z.string().optional(),
  permission: z.string().optional(),
  badgeKey: z.string().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const updateMenuItemSchema = createMenuItemSchema.partial();

// Query Schemas
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const sortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const searchSchema = z.object({
  search: z.string().optional(),
});

export const listQuerySchema = paginationSchema.merge(sortSchema).merge(searchSchema);

// File Schemas
export const uploadFileSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().positive(),
});

// Notification Schemas
export const sendNotificationSchema = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  templateCode: z.string().optional(),
  variables: z.record(z.unknown()).optional(),
  channel: z.enum(['EMAIL', 'SMS', 'PUSH', 'WHATSAPP']).optional(),
  subject: z.string().optional(),
  content: z.string().optional(),
  channels: z.array(z.enum(['EMAIL', 'SMS', 'PUSH', 'WHATSAPP'])).optional(),
  priority: z.number().int().min(1).max(10).default(5),
  scheduledFor: z.string().datetime().optional(),
});

// Export Schemas
export const exportSchema = z.object({
  resource: z.string().min(1),
  format: z.enum(['csv', 'excel', 'pdf']),
  filters: z.record(z.unknown()).optional(),
  columns: z.array(z.string()).optional(),
  template: z.string().optional(),
});

// System Settings Schemas
export const updateSettingSchema = z.object({
  value: z.unknown(),
});

export const createFeatureFlagSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(false),
  rules: z.object({
    users: z.array(z.string()).optional(),
    roles: z.array(z.string()).optional(),
    percentage: z.number().min(0).max(100).optional(),
  }).optional(),
});

// Type exports from schemas
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type PermissionInput = z.infer<typeof permissionSchema>;
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
export type ListQueryInput = z.infer<typeof listQuerySchema>;
export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;
export type ExportInput = z.infer<typeof exportSchema>;
