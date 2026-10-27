/**
 * Product Feeds Module - Configuration
 *
 * Reads validated env vars from the central config and exposes typed,
 * derived values used across the module (SFTP configs, deal category IDs,
 * email recipient list, etc.).
 */

import { config } from '../../config/index.js';

export interface SftpCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ProductFeedsConfig {
  outputDir: string;
  cdnUrl: string;
  currentSeason: number;
  chunkSize: number;
  skipImageColor: boolean;
  emailRecipients: string[];
  dealCategoryIds: number[];
  google: SftpCredentials | null;
  microsoft: SftpCredentials | null;
}

/**
 * Builds the product feeds module configuration from validated env vars.
 * SFTP configs are returned as null when credentials are not set (e.g. in
 * development) -- upload will be skipped rather than failing validation.
 */
export function getProductFeedsConfig(): ProductFeedsConfig {
  const dealCategoryIds = [
    config.DAILY_DEAL_CATEGORY_ID,
    config.PRODUCT_FEED_WEEKLY_DEAL_CATEGORY_ID,
    config.PRODUCT_FEED_PERMANENT_DEAL_CATEGORY_ID,
  ].filter((id): id is number => typeof id === 'number' && id > 0);

  const emailRecipients = config.PRODUCT_FEED_EMAIL_RECIPIENTS
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

  const google = config.PRODUCT_FEED_GOOGLE_SFTP_USER && config.PRODUCT_FEED_GOOGLE_SFTP_PASS
    ? {
        host: config.PRODUCT_FEED_GOOGLE_SFTP_HOST,
        port: config.PRODUCT_FEED_GOOGLE_SFTP_PORT,
        username: config.PRODUCT_FEED_GOOGLE_SFTP_USER,
        password: config.PRODUCT_FEED_GOOGLE_SFTP_PASS,
      }
    : null;

  const microsoft = config.PRODUCT_FEED_MICROSOFT_SFTP_USER && config.PRODUCT_FEED_MICROSOFT_SFTP_PASS
    ? {
        host: config.PRODUCT_FEED_MICROSOFT_SFTP_HOST,
        port: config.PRODUCT_FEED_MICROSOFT_SFTP_PORT,
        username: config.PRODUCT_FEED_MICROSOFT_SFTP_USER,
        password: config.PRODUCT_FEED_MICROSOFT_SFTP_PASS,
      }
    : null;

  return {
    outputDir: config.PRODUCT_FEED_OUTPUT_DIR,
    cdnUrl: config.PRODUCT_FEED_CDN_URL,
    currentSeason: config.PRODUCT_FEED_CURRENT_SEASON,
    chunkSize: config.PRODUCT_FEED_CHUNK_SIZE,
    skipImageColor: config.PRODUCT_FEED_SKIP_IMAGE_COLOR,
    emailRecipients,
    dealCategoryIds,
    google,
    microsoft,
  };
}
