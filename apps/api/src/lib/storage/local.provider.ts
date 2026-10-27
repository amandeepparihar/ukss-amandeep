import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import { config } from '../../config';
import { createLogger } from '../logger';
import type { StorageProvider, UploadOptions, UploadResult } from './storage.interface';

const logger = createLogger('local-storage');

export class LocalStorageProvider implements StorageProvider {
  private basePath: string;
  private urlPrefix: string;

  constructor() {
    this.basePath = path.resolve(config.STORAGE_LOCAL_PATH);
    this.urlPrefix = config.STORAGE_LOCAL_URL_PREFIX;

    // Ensure base directory exists
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
      logger.info({ path: this.basePath }, 'Created storage directory');
    }
  }

  async upload(options: UploadOptions): Promise<UploadResult> {
    const filePath = this.getFilePath(options.key);
    const dir = path.dirname(filePath);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Calculate ETag (MD5 hash)
    let etag: string | undefined;

    if (Buffer.isBuffer(options.body)) {
      // Write buffer directly
      await fs.writeFile(filePath, options.body);
      etag = createHash('md5').update(options.body).digest('hex');
    } else {
      // Stream to file
      const writeStream = createWriteStream(filePath);
      const hash = createHash('md5');

      // Create a transform to calculate hash while writing
      const readable = options.body as Readable;
      readable.on('data', (chunk) => hash.update(chunk));

      await pipeline(readable, writeStream);
      etag = hash.digest('hex');
    }

    // Store metadata in a sidecar file
    if (options.metadata || options.contentType) {
      const metaPath = `${filePath}.meta.json`;
      await fs.writeFile(metaPath, JSON.stringify({
        contentType: options.contentType,
        metadata: options.metadata,
        uploadedAt: new Date().toISOString(),
      }));
    }

    logger.info({ key: options.key, path: filePath }, 'File uploaded to local storage');

    return {
      key: options.key,
      url: this.getPublicUrl(options.key),
      etag: `"${etag}"`,
    };
  }

  async getDownloadUrl(key: string): Promise<string> {
    // For local storage, just return the public URL
    // In a real scenario, you might generate a signed token for protected files
    return this.getPublicUrl(key);
  }

  async getUploadUrl(): Promise<string | null> {
    // Local storage doesn't support presigned upload URLs
    // Client must use server-side upload
    return null;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    const metaPath = `${filePath}.meta.json`;

    try {
      await fs.unlink(filePath);
      logger.info({ key }, 'File deleted from local storage');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // Also delete metadata file if exists
    try {
      await fs.unlink(metaPath);
    } catch {
      // Ignore if meta file doesn't exist
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getPublicUrl(key: string): string {
    // Return URL that can be served by static file middleware
    return `${config.API_URL}${this.urlPrefix}/${key}`;
  }

  generateKey(folder: string, filename: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `${folder}/${timestamp}-${random}-${sanitizedFilename}`;
  }

  async getContent(key: string): Promise<Buffer> {
    const filePath = this.getFilePath(key);
    return fs.readFile(filePath);
  }

  /**
   * Get metadata for a file
   */
  async getMetadata(key: string): Promise<{ contentType?: string; metadata?: Record<string, string> } | null> {
    const filePath = this.getFilePath(key);
    const metaPath = `${filePath}.meta.json`;

    try {
      const content = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Get the absolute file path for a key
   */
  private getFilePath(key: string): string {
    // Prevent path traversal attacks
    const normalizedKey = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return path.join(this.basePath, normalizedKey);
  }

  /**
   * Get the base path for local storage
   */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * Get the URL prefix for serving files
   */
  getUrlPrefix(): string {
    return this.urlPrefix;
  }
}

export const localStorageProvider = new LocalStorageProvider();
