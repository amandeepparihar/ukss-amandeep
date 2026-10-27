import pino from 'pino';
import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';
import { createWriteStream, WriteStream } from 'fs';
import { Writable } from 'stream';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Get the directory of the current file (for ESM modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve logs directory path.
 *
 * Priority:
 * 1. LOGS_DIR environment variable (explicit override — required in production)
 * 2. Relative path from source file (development default)
 */
function resolveLogsDir(): string {
  if (process.env.LOGS_DIR) {
    return process.env.LOGS_DIR;
  }

  return path.resolve(__dirname, '../../logs');
}

const LOGS_DIR = resolveLogsDir();

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB in bytes

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  // Log to console that directory was created (can't use logger yet)
  console.log(`[Logger] Created logs directory: ${LOGS_DIR}`);
}

/**
 * Creates a writable stream that handles file size checking and rotation
 */
class FileRotationStream extends Writable {
  private filePath: string;
  private writeStream: WriteStream | null = null;
  private currentSize: number = 0;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
    this.initializeStream();
  }

  private initializeStream() {
    // Check if file exists and get its size
    if (fs.existsSync(this.filePath)) {
      const stats = fs.statSync(this.filePath);
      this.currentSize = stats.size;

      // If file exceeds 50MB, delete it
      if (this.currentSize >= MAX_FILE_SIZE) {
        console.log(`[Logger] Log file exceeds 50MB, deleting: ${this.filePath}`);
        fs.unlinkSync(this.filePath);
        this.currentSize = 0;
      }
    } else {
      this.currentSize = 0;
    }

    // Create or append to the file
    try {
      this.writeStream = createWriteStream(this.filePath, { flags: 'a' });
      console.log(`[Logger] Write stream initialized for: ${this.filePath}`);
      
      // Add error handler to catch write errors
      this.writeStream.on('error', (error) => {
        console.error(`[Logger] Write stream error for ${this.filePath}:`, error);
      });
      
      this.writeStream.on('open', () => {
        console.log(`[Logger] Write stream opened for: ${this.filePath}`);
      });
    } catch (error) {
      console.error(`[Logger] Failed to create write stream for ${this.filePath}:`, error);
      throw error;
    }
  }

  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (!this.writeStream) {
      return callback(new Error('Write stream not initialized'));
    }

    const chunkSize = chunk.length;

    // Check if adding this chunk would exceed the limit
    if (this.currentSize + chunkSize >= MAX_FILE_SIZE) {
      // Close current stream
      this.writeStream.end(() => {
        // Delete the file
        if (fs.existsSync(this.filePath)) {
          fs.unlinkSync(this.filePath);
        }
        // Reset size and create new stream
        this.currentSize = 0;
        this.initializeStream();
        // Write the chunk to the new file
        if (this.writeStream) {
          this.writeStream.write(chunk, encoding, callback);
          this.currentSize += chunkSize;
        } else {
          callback(new Error('Failed to reinitialize stream'));
        }
      });
    } else {
      // Write normally
      this.writeStream.write(chunk, encoding, (error) => {
        if (!error) {
          this.currentSize += chunkSize;
        }
        callback(error);
      });
    }
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void) {
    if (this.writeStream) {
      this.writeStream.end(() => {
        callback(error);
      });
    } else {
      callback(error);
    }
  }
}

/**
 * Creates a file stream for a specific module
 */
function createFileStream(module: string): Writable {
  const moduleDir = path.join(LOGS_DIR, module);
  const logFilePath = path.join(moduleDir, 'log.txt');

  // Ensure module directory exists
  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true });
    console.log(`[Logger] Created module log directory: ${moduleDir}`);
  }

  console.log(`[Logger] File stream created for module "${module}" at: ${logFilePath}`);
  return new FileRotationStream(logFilePath);
}

// Base logger configuration
const baseLoggerConfig: pino.LoggerOptions = {
  level: config.LOG_LEVEL,
  redact: {
    paths: ['password', 'token', 'refreshToken', 'accessToken', 'req.headers.authorization'],
    censor: '[REDACTED]',
  },
};

// Create base logger with console transport (pretty in dev, JSON in prod)
const consoleTransport =
  config.NODE_ENV === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined;

export const logger = pino({
  ...baseLoggerConfig,
  transport: consoleTransport,
});

/**
 * Logger type for dependency injection
 */
export type Logger = pino.Logger;

/**
 * Creates a logger instance for a specific module with both console and file logging
 * @param module - Module name (used as directory name for logs)
 * @returns Pino logger instance
 */
export function createLogger(module: string): Logger {
  // Create file stream for this module
  const fileStream = createFileStream(module);

  // Create multistream to write to both console and file
  const streams: pino.StreamEntry[] = [
    // Console stream - outputs JSON (can be piped through pino-pretty if needed)
    {
      level: config.LOG_LEVEL,
      stream: pino.destination({ sync: false }),
    },
    // File stream (always JSON format)
    {
      level: config.LOG_LEVEL,
      stream: fileStream,
    },
  ];

  // Create logger with multistream and module context
  return pino(baseLoggerConfig, pino.multistream(streams)).child({ module });
}

export default logger;
