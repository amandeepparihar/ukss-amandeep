import { config } from '../../config';
import { createLogger } from '../logger';
import type { StorageProvider } from './storage.interface';
import { LocalStorageProvider } from './local.provider';
import { S3StorageProvider } from './s3.provider';

export type { StorageProvider, UploadOptions, UploadResult } from './storage.interface';
export { LocalStorageProvider } from './local.provider';
export { S3StorageProvider } from './s3.provider';

const logger = createLogger('storage');

/**
 * Get the configured storage provider based on STORAGE_PROVIDER env variable
 */
function createStorageProvider(): StorageProvider {
  const provider = config.STORAGE_PROVIDER;

  logger.info({ provider }, 'Initializing storage provider');

  switch (provider) {
    case 'local':
      return new LocalStorageProvider();
    case 's3':
      return new S3StorageProvider();
    default:
      logger.warn({ provider }, 'Unknown storage provider, falling back to local');
      return new LocalStorageProvider();
  }
}

/**
 * The active storage provider instance
 * Use this for all file storage operations
 */
export const storageProvider = createStorageProvider();

/**
 * Helper to get the current storage provider type
 */
export function getStorageProviderType(): 'local' | 's3' {
  return config.STORAGE_PROVIDER;
}

/**
 * Check if presigned URLs are supported by the current provider
 */
export function supportsPresignedUrls(): boolean {
  return config.STORAGE_PROVIDER === 's3';
}
