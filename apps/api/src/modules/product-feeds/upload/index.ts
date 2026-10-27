/**
 * Product Feeds - Upload Barrel Export
 *
 * SFTP uploaders (Google Merchant Center + Microsoft Advertising) and
 * the post-run email notifier.
 */

export { uploadToGoogle, uploadToMicrosoft } from './sftp-uploader.js';
export { sendFeedReport } from './email-notifier.js';
