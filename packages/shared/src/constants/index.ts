// API Endpoints
export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/api/auth/login',
    LOGOUT: '/api/auth/logout',
    REFRESH: '/api/auth/refresh',
    FORGOT_PASSWORD: '/api/auth/forgot-password',
    RESET_PASSWORD: '/api/auth/reset-password',
    VERIFY_EMAIL: '/api/auth/verify-email',
    TWO_FACTOR_SETUP: '/api/auth/2fa/setup',
    TWO_FACTOR_VERIFY: '/api/auth/2fa/verify',
    TWO_FACTOR_DISABLE: '/api/auth/2fa/disable',
    SESSIONS: '/api/auth/sessions',
    ME: '/api/auth/me',
    CHANGE_PASSWORD: '/api/auth/me/password',
  },
  USERS: '/api/users',
  ROLES: '/api/roles',
  PERMISSIONS: '/api/permissions',
  MENU: '/api/menu',
  FILES: {
    UPLOAD: '/api/files/upload',
    PRESIGNED: '/api/files/upload/presigned',
    COMPLETE: '/api/files/upload/complete',
  },
  NOTIFICATIONS: '/api/notifications',
  EXPORTS: '/api/exports',
  SETTINGS: '/api/settings',
  FEATURE_FLAGS: '/api/feature-flags',
  AUDIT_LOGS: '/api/audit-logs',
} as const;

// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// Error Codes
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',
  INVALID_TWO_FACTOR_CODE: 'INVALID_TWO_FACTOR_CODE',
  TWO_FACTOR_TOKEN_REQUIRED: 'TWO_FACTOR_TOKEN_REQUIRED',
  INVALID_GOOGLE_TOKEN: 'INVALID_GOOGLE_TOKEN',
  GOOGLE_ACCOUNT_NOT_LINKED: 'GOOGLE_ACCOUNT_NOT_LINKED',
} as const;

// Pagination
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export const MAX_PAGE_SIZE = 100;

// Auth
export const ACCESS_TOKEN_EXPIRY = '15m';
export const REFRESH_TOKEN_EXPIRY = '7d';
export const PASSWORD_MIN_LENGTH = 8;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MINUTES = 15;

// File Upload
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

// Thumbnail Sizes
export const THUMBNAIL_SIZES = {
  small: { width: 150, height: 150 },
  medium: { width: 300, height: 300 },
  large: { width: 600, height: 600 },
} as const;

// Notification
export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'WHATSAPP'] as const;
export const NOTIFICATION_PRIORITIES = {
  URGENT: 1,
  HIGH: 3,
  NORMAL: 5,
  LOW: 7,
  BULK: 10,
} as const;

// Date/Time Formats
export const DATE_FORMAT = 'yyyy-MM-dd';
export const TIME_FORMAT = 'HH:mm:ss';
export const DATETIME_FORMAT = 'yyyy-MM-dd HH:mm:ss';
export const DISPLAY_DATE_FORMAT = 'dd MMM yyyy';
export const DISPLAY_DATETIME_FORMAT = 'dd MMM yyyy, HH:mm';

// Resources (for permissions)
export const RESOURCES = [
  'users',
  'roles',
  'permissions',
  'menu',
  'settings',
  'files',
  'notifications',
  'audit-logs',
  'exports',
  'feature-flags',
  'books',
  'students',
  'issues'
] as const;

// Permission Actions
export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete'] as const;

// System Roles
export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'super-admin',
  ADMIN: 'admin',
  USER: 'user',
} as const;

// Log Levels
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

// Queue Names
export const QUEUE_NAMES = {
  EMAIL: 'notifications:email',
  SMS: 'notifications:sms',
  PUSH: 'notifications:push',
  WHATSAPP: 'notifications:whatsapp',
  IMAGE_PROCESSING: 'image:processing',
  FILE_CLEANUP: 'file:cleanup',
  EXPORT: 'export',
} as const;

// Marketplaces
/**
 * Marketplace identifiers (lowercase, canonical names)
 * 
 * These constants are the single source of truth for marketplace identifiers.
 * Used throughout the codebase for adapter factory, config defaults, validation, etc.
 */
export const MARKETPLACES = {
  EBAY: 'ebay',
  ONBUY: 'onbuy',
  DEBENHAMS: 'debenhams',
  MIRAKL: 'mirakl',
  SPORTDEAL: 'sportdeal',
  ALLEGRO: 'allegro',
  SELLER_DYNAMICS: 'seller-dynamics',
} as const;

/**
 * List of implemented/supported marketplaces
 */
export const SUPPORTED_MARKETPLACES = [
  MARKETPLACES.EBAY,
  MARKETPLACES.ONBUY,
  MARKETPLACES.DEBENHAMS,
  MARKETPLACES.SPORTDEAL,
  MARKETPLACES.ALLEGRO,
  MARKETPLACES.SELLER_DYNAMICS,
] as const;

/**
 * List of all known marketplaces (including unimplemented ones)
 */
export const ALL_MARKETPLACES = [
  MARKETPLACES.EBAY,
  MARKETPLACES.ONBUY,
  MARKETPLACES.DEBENHAMS,
  MARKETPLACES.SPORTDEAL,
  MARKETPLACES.ALLEGRO,
  MARKETPLACES.SELLER_DYNAMICS,
] as const;

/**
 * Type for marketplace identifiers
 */
export type Marketplace = typeof MARKETPLACES[keyof typeof MARKETPLACES];

/**
 * Type for supported marketplaces
 */
export type SupportedMarketplace = typeof SUPPORTED_MARKETPLACES[number];
