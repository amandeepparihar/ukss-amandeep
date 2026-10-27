/**
 * Storage Service - Abstraction layer over storage providers
 *
 * This service delegates to the configured storage provider (local or S3).
 * The provider is selected based on the STORAGE_PROVIDER environment variable.
 *
 * For backwards compatibility, this file exports s3Service which actually
 * uses the configured storage provider.
 */

import { storageProvider, supportsPresignedUrls } from '../../lib/storage';
import type { UploadOptions as StorageUploadOptions, UploadResult as StorageUploadResult } from '../../lib/storage';

// Re-export types for backwards compatibility
export interface UploadResult {
  key: string;
  bucket?: string;
  url: string;
  etag?: string;
}

export interface UploadOptions {
  key: string;
  body: Buffer | NodeJS.ReadableStream;
  contentType: string;
  metadata?: Record<string, string>;
}

/**
 * Storage Service - Uses the configured storage provider
 */
export class StorageService {
  /**
   * Upload a file to storage
   */
  async upload(options: UploadOptions): Promise<UploadResult> {
    const result = await storageProvider.upload(options);
    return {
      key: result.key,
      url: result.url,
      etag: result.etag,
    };
  }

  /**
   * Get a signed URL for downloading a file
   * For local storage, this returns the static file URL
   */
  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return storageProvider.getDownloadUrl(key, expiresIn);
  }

  /**
   * Get a signed URL for uploading (client-side upload)
   * Only supported for S3 - returns empty string for local storage
   */
  async getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn = 3600
  ): Promise<string> {
    if (!supportsPresignedUrls()) {
      throw new Error('Presigned upload URLs are not supported with local storage. Use server-side upload instead.');
    }
    const url = await storageProvider.getUploadUrl(key, contentType, expiresIn);
    return url || '';
  }

  /**
   * Delete a file from storage
   */
  async delete(key: string): Promise<void> {
    await storageProvider.delete(key);
  }

  /**
   * Check if a file exists
   */
  async exists(key: string): Promise<boolean> {
    return storageProvider.exists(key);
  }

  /**
   * Get the public URL for a file
   */
  getPublicUrl(key: string): string {
    return storageProvider.getPublicUrl(key);
  }

  /**
   * Generate a unique key for a file
   */
  generateKey(folder: string, filename: string): string {
    return storageProvider.generateKey(folder, filename);
  }

  /**
   * Check if presigned URLs are supported
   */
  supportsPresignedUrls(): boolean {
    return supportsPresignedUrls();
  }
}

// Export singleton for backwards compatibility
export const s3Service = new StorageService();
