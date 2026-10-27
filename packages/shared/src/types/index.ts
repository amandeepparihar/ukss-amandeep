// API Response Types
export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: ValidationError[];
  };
}

export interface ValidationError {
  field: string;
  message: string;
}

// User Types
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  isActive: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  roleId: string;
  role?: Role;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
  permissions?: Permission[];
  createdAt: string;
  updatedAt: string;
}

export interface Permission {
  id: string;
  resource: string;
  action: PermissionAction;
  roleId: string;
}

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

export interface Session {
  id: string;
  userId: string;
  userAgent?: string;
  ipAddress?: string;
  deviceInfo?: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
  lastActiveAt: string;
}

// Auth Types
export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUser extends User {
  permissions: string[];
}

// Menu Types
export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  path?: string;
  isExternal: boolean;
  parentId?: string;
  children?: MenuItem[];
  permission?: string;
  badgeKey?: string;
  sortOrder: number;
  isActive: boolean;
}

// Audit Log Types
export interface AuditLog {
  id: string;
  userId?: string;
  user?: User;
  action: string;
  resource: string;
  resourceId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// Notification Types
export type NotificationChannel = 'EMAIL' | 'SMS' | 'PUSH' | 'WHATSAPP';
export type NotificationStatus = 'PENDING' | 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'CANCELLED';

export interface Notification {
  id: string;
  userId?: string;
  email?: string;
  phone?: string;
  channel: NotificationChannel;
  subject?: string;
  content: string;
  status: NotificationStatus;
  sentAt?: string;
  deliveredAt?: string;
  error?: string;
  createdAt: string;
}

// File Types
export type FileStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface UploadedFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  storageUrl: string;
  width?: number;
  height?: number;
  thumbnails?: {
    small?: string;
    medium?: string;
    large?: string;
  };
  status: FileStatus;
  uploadedById: string;
  createdAt: string;
}

// Table Types
export interface TableColumn<T> {
  key: string;
  header: string;
  accessor?: keyof T | ((row: T) => unknown);
  sortable?: boolean;
  filterable?: boolean;
  filterType?: 'text' | 'number' | 'date' | 'select' | 'boolean' | 'dateRange';
  filterOptions?: { label: string; value: string }[];
  width?: number | string;
  minWidth?: number;
  maxWidth?: number;
  align?: 'left' | 'center' | 'right';
  hidden?: boolean;
}

export interface TableFilters {
  [key: string]: string | number | boolean | string[] | { from?: string; to?: string } | undefined;
}

export interface TableSort {
  field: string;
  order: 'asc' | 'desc';
}

export interface TablePagination {
  page: number;
  pageSize: number;
}

// Settings Types
export type SettingType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON' | 'SECRET';

export interface SystemSetting {
  id: string;
  key: string;
  value: unknown;
  type: SettingType;
  category: string;
  label: string;
  description?: string;
  isPublic: boolean;
  updatedAt: string;
}

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  rules?: {
    users?: string[];
    roles?: string[];
    percentage?: number;
  };
  createdAt: string;
  updatedAt: string;
}

// Sales Dashboard Types
export * from './sales-dashboard';
export * from './ebay-reconciliation';
