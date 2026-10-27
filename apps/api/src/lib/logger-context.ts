import { AsyncLocalStorage } from 'async_hooks';
import type { Logger } from 'pino';
import { logger as globalLogger, createLogger } from './logger';
import { nanoid } from 'nanoid';

interface LoggerContext {
  executionId: string;
  defaultModule: string;
}

const asyncLocalStorage = new AsyncLocalStorage<LoggerContext>();

// Cache for module-specific loggers (reuses createLogger from lib/logger.ts)
const moduleLoggers = new Map<string, Logger>();

/**
 * Get or create a cached logger for a module
 * Uses the existing createLogger() which includes file streams
 */
function getCachedLogger(module: string): Logger {
  if (!moduleLoggers.has(module)) {
    moduleLoggers.set(module, createLogger(module));
  }
  return moduleLoggers.get(module)!;
}

/**
 * Get a logger with automatic executionId injection
 * 
 * @param module - Optional module name for separate log files
 *                 If not provided, uses the default module from execution context
 * 
 * @returns Logger instance with executionId (if in execution context)
 * 
 * @example
 * // Get default module logger with executionId
 * const logger = getLogger();
 * logger.info({ storeId }, 'Syncing store');
 * 
 * // Get different module logger with same executionId (for request/response logs)
 * const requestLogger = getLogger('marketplace-sync-request-ebay');
 * requestLogger.info({ payload }, 'API request sent');
 */
export function getLogger(module?: string): Logger {
  const context = asyncLocalStorage.getStore();
  
  // Determine which module to use
  const targetModule = module || context?.defaultModule;
  
  // Get the base logger for this module
  const baseLogger = targetModule ? getCachedLogger(targetModule) : globalLogger;
  
  // If in execution context, add executionId
  if (context) {
    return baseLogger.child({ executionId: context.executionId });
  }
  
  return baseLogger;
}

/**
 * Run a function within an execution context with automatic executionId
 * 
 * Used by:
 * - HTTP route handlers
 * - CLI scripts
 * - Background jobs
 * - Any other entry point
 * 
 * @param defaultModule - Default module name for getLogger() calls within this execution
 * @param callback - Function to execute
 * 
 * @example
 * // HTTP route
 * app.get('/endpoint', async (request) => {
 *   return runWithExecution('my-module', async () => {
 *     const result = await myService.process();
 *     return result;
 *   });
 * });
 * 
 * @example
 * // CLI script
 * async function main() {
 *   await runWithExecution('my-script', async () => {
 *     await processData();
 *   });
 * }
 */
export function runWithExecution<T>(
  defaultModule: string,
  callback: () => T | Promise<T>
): T | Promise<T> {
  const executionId = `EXEC_${Date.now()}_${nanoid(8)}`;
  
  return asyncLocalStorage.run({ executionId, defaultModule }, callback);
}
