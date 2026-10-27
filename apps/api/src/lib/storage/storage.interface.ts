/**
 * Storage Provider Interface
 * Defines the contract for file storage implementations (S3, Local, etc.)
 */

export interface UploadResult {
  key: string;
  url: string;
  etag?: string;
}

export interface UploadOptions {
  key: string;
  body: Buffer | NodeJS.ReadableStream;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface StorageProvider {
  /**
   * Upload a file to storage
   */
  upload(options: UploadOptions): Promise<UploadResult>;

  /**
   * Get a URL for downloading a file
   * For S3: returns signed URL
   * For Local: returns static file URL
   */
  getDownloadUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * Get a URL for client-side upload (presigned URL)
   * For Local: not supported - returns null
   */
  getUploadUrl(key: string, contentType: string, expiresIn?: number): Promise<string | null>;

  /**
   * Delete a file from storage
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get the public URL for a file
   */
  getPublicUrl(key: string): string;

  /**
   * Generate a unique key for a file
   */
  generateKey(folder: string, filename: string): string;

  /**
   * Get file content as Buffer
   */
  getContent(key: string): Promise<Buffer>;
}
