/** BigInt-safe JSON serializer (BigInts are converted to strings) */
export function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
}

// Audit Redis keys
export const REDIS_KEY_AUDIT_STATUS = 'reconciliation:audit:status';
export const REDIS_KEY_AUDIT_REPORT = 'reconciliation:audit:report';
export const REDIS_KEY_AUDIT_LOCK = 'reconciliation:audit:lock';
export const AUDIT_STATUS_TTL = 24 * 60 * 60;  // 24h
export const AUDIT_REPORT_TTL = 24 * 60 * 60;  // 24h
export const AUDIT_LOCK_TTL = 15 * 60;          // 15min
