/**
 * File Utilities
 *
 * Safe file operations for feed generation.
 * Uses temp file pattern for atomic writes.
 */

import * as fs from 'fs/promises';
import { createWriteStream, type WriteStream } from 'fs';
import * as path from 'path';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('file-utils');

/**
 * File utilities object.
 */
export const fileUtils = {
  /**
   * Ensure a directory exists, creating it if necessary.
   *
   * @param dirPath - Directory path to ensure
   *
   * @example
   * await fileUtils.ensureDir('/feeds/fruugo');
   */
  async ensureDir(dirPath: string): Promise<void> {
    // Handle both file path and directory path
    const dir = dirPath.includes('.') ? path.dirname(dirPath) : dirPath;
    await fs.mkdir(dir, { recursive: true });
  },

  /**
   * Write content to file using temp file pattern.
   * Writes to temp location first, then moves atomically.
   * This prevents partial writes if the process crashes.
   *
   * @param finalPath - Final destination path
   * @param content - Content to write
   * @param archive - Whether to archive existing file first
   *
   * @example
   * await fileUtils.writeWithTemp(
   *   '/feeds/product_feed.csv',
   *   csvContent,
   *   true // archive existing
   * );
   */
  async writeWithTemp(
    finalPath: string,
    content: string,
    archive?: boolean
  ): Promise<void> {
    const tempPath = await this.getTempPath(finalPath);

    // Ensure directories exist
    await this.ensureDir(tempPath);
    await this.ensureDir(finalPath);

    try {
      // Write to temp file
      await fs.writeFile(tempPath, content, 'utf-8');

      // Archive existing file if requested
      if (archive) {
        try {
          await this.archiveFile(finalPath);
        } catch {
          // File may not exist, which is fine
        }
      }

      // Move temp to final location
      await this.moveFile(tempPath, finalPath);

      logger.debug({ path: finalPath }, 'File written successfully');
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  },

  /**
   * Get temporary file path for a given final path.
   *
   * @param finalPath - Final destination path
   * @returns Temporary file path
   */
  async getTempPath(finalPath: string): Promise<string> {
    const dir = path.dirname(finalPath);
    const filename = path.basename(finalPath);
    const tempDir = path.join(dir, 'temp');
    return path.join(tempDir, filename);
  },

  /**
   * Archive a file by copying it to an Archive folder with timestamp.
   *
   * @param filePath - Path to file to archive
   *
   * @example
   * // Archives /feeds/product_feed.csv to
   * // /feeds/Archive/product_feed_2024-01-15T10-30-00.csv
   * await fileUtils.archiveFile('/feeds/product_feed.csv');
   */
  async archiveFile(filePath: string): Promise<string> {
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }

    const dir = path.dirname(filePath);
    const archiveDir = path.join(dir, 'Archive');
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);

    // Create timestamp string (filesystem safe)
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('Z', '');

    const archiveFilename = `${base}_${timestamp}${ext}`;
    const archivePath = path.join(archiveDir, archiveFilename);

    // Ensure archive directory exists
    await this.ensureDir(archiveDir);

    // Copy file to archive
    await fs.copyFile(filePath, archivePath);

    logger.debug(
      { original: filePath, archive: archivePath },
      'File archived'
    );

    return archivePath;
  },

  /**
   * Move a file from source to destination.
   * Uses rename for atomic operation when possible.
   *
   * @param source - Source file path
   * @param destination - Destination file path
   */
  async moveFile(source: string, destination: string): Promise<void> {
    try {
      // Try atomic rename first
      await fs.rename(source, destination);
    } catch (error) {
      // If rename fails (e.g., cross-device), fall back to copy + delete
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
        await fs.copyFile(source, destination);
        await fs.unlink(source);
      } else {
        throw error;
      }
    }
  },

  /**
   * Write content to file directly.
   * For simple writes without temp file pattern.
   *
   * @param filePath - Path to write to
   * @param content - Content to write
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    await this.ensureDir(filePath);
    await fs.writeFile(filePath, content, 'utf-8');
    logger.debug({ path: filePath }, 'File written');
  },

  /**
   * Read file contents.
   *
   * @param filePath - Path to file
   * @returns File contents as string
   */
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  },

  /**
   * Check if a file exists.
   *
   * @param filePath - Path to check
   * @returns True if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get file stats.
   *
   * @param filePath - Path to file
   * @returns File stats or null if not found
   */
  async getStats(filePath: string): Promise<fs.FileHandle | null> {
    try {
      const stats = await fs.stat(filePath);
      return stats as unknown as fs.FileHandle;
    } catch {
      return null;
    }
  },

  /**
   * Delete a file if it exists.
   *
   * @param filePath - Path to file
   * @returns True if file was deleted
   */
  async deleteFile(filePath: string): Promise<boolean> {
    try {
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * List files in a directory.
   *
   * @param dirPath - Directory path
   * @param pattern - Optional regex pattern to filter files
   * @returns Array of file names
   */
  async listFiles(dirPath: string, pattern?: RegExp): Promise<string[]> {
    try {
      const files = await fs.readdir(dirPath);

      if (pattern) {
        return files.filter((f) => pattern.test(f));
      }

      return files;
    } catch {
      return [];
    }
  },

  /**
   * Clean up old archive files, keeping only the most recent N files.
   *
   * @param archiveDir - Archive directory path
   * @param keepCount - Number of recent files to keep (default: 10)
   *
   * @example
   * await fileUtils.cleanupArchive('/feeds/Archive', 5);
   */
  async cleanupArchive(archiveDir: string, keepCount: number = 10): Promise<number> {
    let deletedCount = 0;

    try {
      const files = await fs.readdir(archiveDir);

      if (files.length <= keepCount) {
        return 0;
      }

      // Get file stats and sort by modification time (newest first)
      const fileStats = await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(archiveDir, file);
          const stats = await fs.stat(filePath);
          return { file, mtime: stats.mtime, path: filePath };
        })
      );

      fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Delete older files
      const toDelete = fileStats.slice(keepCount);

      for (const { path: filePath } of toDelete) {
        await fs.unlink(filePath);
        deletedCount++;
      }

      logger.info(
        { archiveDir, deleted: deletedCount, kept: keepCount },
        'Archive cleanup completed'
      );
    } catch (error) {
      logger.warn({ archiveDir, error }, 'Archive cleanup failed');
    }

    return deletedCount;
  },

  /**
   * Get file size in bytes.
   *
   * @param filePath - Path to file
   * @returns File size in bytes or 0 if not found
   */
  async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  },

  /**
   * Format file size for display.
   *
   * @param bytes - Size in bytes
   * @returns Formatted string (e.g., '1.5 MB')
   */
  formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  },

  /**
   * Create a streaming file writer for large files.
   * Use this for writing large feeds to avoid memory issues.
   *
   * @param tempPath - Temporary file path to write to
   * @returns StreamingFileWriter instance
   *
   * @example
   * const writer = await fileUtils.createStreamingWriter('/tmp/feed.xml');
   * await writer.write('<?xml version="1.0"?>');
   * await writer.write('<root>');
   * for (const chunk of chunks) {
   *   await writer.write(formatChunk(chunk));
   * }
   * await writer.write('</root>');
   * await writer.finalize('/feeds/feed.xml');
   */
  async createStreamingWriter(tempPath: string): Promise<StreamingFileWriter> {
    await this.ensureDir(tempPath);
    return new StreamingFileWriter(tempPath);
  },
};

/**
 * Streaming file writer for large files.
 * Writes data in chunks to avoid memory issues.
 */
export class StreamingFileWriter {
  private readonly tempPath: string;
  private stream: WriteStream | null = null;
  private bytesWritten = 0;
  private closed = false;

  constructor(tempPath: string) {
    this.tempPath = tempPath;
  }

  /**
   * Initialize the write stream.
   */
  private async ensureStream(): Promise<WriteStream> {
    if (!this.stream) {
      this.stream = createWriteStream(this.tempPath, { encoding: 'utf-8' });
    }
    return this.stream;
  }

  /**
   * Write data to the stream.
   *
   * @param data - String data to write
   */
  async write(data: string): Promise<void> {
    if (this.closed) {
      throw new Error('StreamingFileWriter is closed');
    }

    const stream = await this.ensureStream();

    return new Promise((resolve, reject) => {
      const canContinue = stream.write(data, 'utf-8', (err) => {
        if (err) {
          reject(err);
        } else {
          this.bytesWritten += Buffer.byteLength(data, 'utf-8');
          resolve();
        }
      });

      // If buffer is full, wait for drain
      if (!canContinue) {
        stream.once('drain', () => {
          resolve();
        });
      }
    });
  }

  /**
   * Get bytes written so far.
   */
  getBytesWritten(): number {
    return this.bytesWritten;
  }

  /**
   * Close the stream and move to final path.
   *
   * @param finalPath - Final destination path
   * @param archive - Whether to archive existing file first
   */
  async finalize(finalPath: string, archive?: boolean): Promise<void> {
    if (this.closed) {
      throw new Error('StreamingFileWriter is already closed');
    }

    // Close the stream
    if (this.stream) {
      await new Promise<void>((resolve, reject) => {
        this.stream!.end((err: Error | null | undefined) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    this.closed = true;

    // Ensure final directory exists
    await fileUtils.ensureDir(finalPath);

    // Archive existing file if requested
    if (archive && await fileUtils.exists(finalPath)) {
      await fileUtils.archiveFile(finalPath);
    }

    // Move temp file to final location
    await fileUtils.moveFile(this.tempPath, finalPath);

    logger.info(
      { path: finalPath, bytes: this.bytesWritten },
      'Streaming file finalized'
    );
  }

  /**
   * Abort the write and clean up temp file.
   * Call this on error to delete partial file.
   */
  async abort(): Promise<void> {
    if (this.closed) return;

    // Close the stream
    if (this.stream) {
      this.stream.destroy();
    }

    this.closed = true;

    // Delete temp file
    await fileUtils.deleteFile(this.tempPath);

    logger.warn(
      { path: this.tempPath, bytesWritten: this.bytesWritten },
      'Streaming file aborted'
    );
  }
}

export default fileUtils;
