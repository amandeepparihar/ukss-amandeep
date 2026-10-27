import type { PaginationMeta, TableFilters, TableSort, TablePagination } from '../types';

export { descriptionPlainToHtml, descriptionHtmlToPlain, looksLikeHtml } from './description-format';

/**
 * Build query string from table parameters
 */
export function buildQueryString(params: {
  pagination?: TablePagination;
  sort?: TableSort;
  filters?: TableFilters;
  search?: string;
}): string {
  const queryParams = new URLSearchParams();

  if (params.pagination) {
    queryParams.set('page', String(params.pagination.page));
    queryParams.set('pageSize', String(params.pagination.pageSize));
  }

  if (params.sort?.field) {
    queryParams.set('sortBy', params.sort.field);
    queryParams.set('sortOrder', params.sort.order);
  }

  if (params.search) {
    queryParams.set('search', params.search);
  }

  if (params.filters) {
    Object.entries(params.filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        if (typeof value === 'object' && !Array.isArray(value)) {
          // Date range filter
          const range = value as { from?: string; to?: string };
          if (range.from) queryParams.set(`filter[${key}][gte]`, range.from);
          if (range.to) queryParams.set(`filter[${key}][lte]`, range.to);
        } else if (Array.isArray(value)) {
          // Multi-select filter
          value.forEach((v) => queryParams.append(`filter[${key}][]`, String(v)));
        } else {
          queryParams.set(`filter[${key}]`, String(value));
        }
      }
    });
  }

  return queryParams.toString();
}

/**
 * Parse query string to table parameters
 */
export function parseQueryString(queryString: string): {
  pagination: TablePagination;
  sort?: TableSort;
  filters: TableFilters;
  search?: string;
} {
  const params = new URLSearchParams(queryString);

  const pagination: TablePagination = {
    page: parseInt(params.get('page') || '1', 10),
    pageSize: parseInt(params.get('pageSize') || '20', 10),
  };

  let sort: TableSort | undefined;
  const sortBy = params.get('sortBy');
  if (sortBy) {
    sort = {
      field: sortBy,
      order: (params.get('sortOrder') as 'asc' | 'desc') || 'asc',
    };
  }

  const search = params.get('search') || undefined;

  const filters: TableFilters = {};
  params.forEach((value, key) => {
    const match = key.match(/^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/);
    if (match) {
      const [, field, operator] = match;
      if (operator) {
        if (!filters[field]) filters[field] = {};
        (filters[field] as Record<string, string>)[operator === 'gte' ? 'from' : 'to'] = value;
      } else if (key.endsWith('[]')) {
        const arrayField = field.slice(0, -2);
        if (!filters[arrayField]) filters[arrayField] = [];
        (filters[arrayField] as string[]).push(value);
      } else {
        filters[field] = value;
      }
    }
  });

  return { pagination, sort, filters, search };
}

/**
 * Calculate pagination metadata
 */
export function calculatePaginationMeta(
  total: number,
  page: number,
  pageSize: number
): PaginationMeta {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2).toLowerCase();
}

/**
 * Check if file type is an image
 */
export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Slugify a string
 */
export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if value is empty (null, undefined, empty string, empty array, empty object)
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * Omit keys from an object
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  keys.forEach((key) => delete result[key]);
  return result;
}

/**
 * Pick keys from an object
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  keys.forEach((key) => {
    if (key in obj) result[key] = obj[key];
  });
  return result;
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Format permission string (e.g., "users:view" -> "View Users")
 */
export function formatPermission(permission: string): string {
  const [resource, action] = permission.split(':');
  const formattedAction = action.charAt(0).toUpperCase() + action.slice(1);
  const formattedResource = resource.charAt(0).toUpperCase() + resource.slice(1).replace(/-/g, ' ');
  return `${formattedAction} ${formattedResource}`;
}

/**
 * Check if user has permission
 */
export function hasPermission(
  userPermissions: string[],
  requiredPermission: string | string[]
): boolean {
  if (Array.isArray(requiredPermission)) {
    return requiredPermission.every((p) => userPermissions.includes(p));
  }
  return userPermissions.includes(requiredPermission);
}

/**
 * Check if user has any of the permissions
 */
export function hasAnyPermission(
  userPermissions: string[],
  requiredPermissions: string[]
): boolean {
  return requiredPermissions.some((p) => userPermissions.includes(p));
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    delay?: number;
    backoff?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const { retries = 3, delay = 1000, backoff = 2, onRetry } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        onRetry?.(lastError, attempt + 1);
        await sleep(delay * Math.pow(backoff, attempt));
      }
    }
  }

  throw lastError!;
}
