/**
 * Product Feeds - SFTP Uploader
 *
 * Uploads compressed feed files to:
 *   - Google Merchant Center (partnerupload.google.com:19321)
 *     - all `*_all.xml.gz` + `*_fifa-world-cup.xml.gz` files (~18 files)
 *   - Microsoft Advertising (sftp.ads.microsoft.com:19321)
 *     - only `US-United-States-of-America_all.xml.gz` and
 *       `UK-United-Kingdom_all.xml.gz`
 *
 * Credentials come from `getProductFeedsConfig()` which in turn reads
 * validated env vars (see `config/index.ts`). If credentials are not
 * set (typical in dev), the upload is SKIPPED with a warning -- no
 * throw, no fatal error. The feed run can still deliver the email
 * report and finish cleanly.
 *
 * Single-file failures are logged and counted in `UploadResult.errors`
 * but do not abort the remaining uploads.
 *
 * PHP source: ukss-feed/ftp-connect.php (Google), ftp-connect-ms.php (Microsoft)
 */

import path from 'node:path';
import { readdir, access } from 'node:fs/promises';
import SftpClient from 'ssh2-sftp-client';
import { createLogger } from '../../../lib/logger.js';
import type { SftpCredentials } from '../product-feeds.config.js';
import type { UploadResult } from '../product-feeds.types.js';

const logger = createLogger('product-feeds-sftp');

/** Files that get uploaded to Microsoft Advertising. */
const MICROSOFT_ALLOWED_FILES: readonly string[] = [
  'US-United-States-of-America_all.xml.gz',
  'UK-United-Kingdom_all.xml.gz',
];

/**
 * Files that match the Google target set: the `_all.xml.gz` for each
 * country feed plus all `_fifa-world-cup.xml.gz` FIFA feeds.
 */
function isGoogleTarget(filename: string): boolean {
  return (
    filename.endsWith('_all.xml.gz') || filename.endsWith('_fifa-world-cup.xml.gz')
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Find `.gz` files in `dir` that match `filter`. */
async function listTargetFiles(
  dir: string,
  filter: (filename: string) => boolean,
): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((name) => name.endsWith('.gz') && filter(name));
}

/**
 * Connect, upload each file in sequence, disconnect. Returns an
 * `UploadResult` with counts and per-file errors. Connection errors
 * are captured in `errors[0]` and `filesUploaded` stays 0.
 */
async function uploadFiles(
  target: UploadResult['target'],
  credentials: SftpCredentials,
  files: Array<{ localPath: string; remoteName: string }>,
): Promise<UploadResult> {
  const result: UploadResult = {
    target,
    filesUploaded: 0,
    filesFailed: 0,
    errors: [],
  };

  const client = new SftpClient();
  try {
    await client.connect({
      host: credentials.host,
      port: credentials.port,
      username: credentials.username,
      password: credentials.password,
    });

    for (const { localPath, remoteName } of files) {
      try {
        if (!(await fileExists(localPath))) {
          const msg = `Local file not found: ${localPath}`;
          logger.warn({ target, localPath }, msg);
          result.filesFailed++;
          result.errors.push(msg);
          continue;
        }

        await client.put(localPath, remoteName);
        result.filesUploaded++;
        logger.info(
          { target, localPath, remoteName },
          'Feed uploaded successfully',
        );
      } catch (err) {
        const msg = `Upload failed for ${remoteName}: ${(err as Error).message}`;
        logger.error({ target, remoteName, err }, 'Feed upload failed');
        result.filesFailed++;
        result.errors.push(msg);
      }
    }
  } catch (err) {
    const msg = `SFTP connection failed: ${(err as Error).message}`;
    logger.error({ target, err }, 'SFTP connection failed');
    result.errors.push(msg);
    result.filesFailed = files.length;
  } finally {
    try {
      await client.end();
    } catch {
      // swallow -- disconnect-on-already-closed is noisy but harmless
    }
  }

  return result;
}

/**
 * Upload all matching feed files to Google Merchant Center.
 * Returns a skipped-upload `UploadResult` when `credentials` is null.
 */
export async function uploadToGoogle(
  outputDir: string,
  credentials: SftpCredentials | null,
): Promise<UploadResult> {
  if (credentials === null) {
    logger.warn('Google SFTP credentials missing -- skipping Google upload');
    return {
      target: 'google',
      filesUploaded: 0,
      filesFailed: 0,
      errors: ['credentials not configured'],
    };
  }

  const names = await listTargetFiles(outputDir, isGoogleTarget);
  const files = names.map((name) => ({
    localPath: path.join(outputDir, name),
    remoteName: name,
  }));

  logger.info({ fileCount: files.length }, 'Starting Google SFTP upload');
  return uploadFiles('google', credentials, files);
}

/**
 * Upload UK + US `_all.xml.gz` to Microsoft Advertising.
 * Returns a skipped-upload `UploadResult` when `credentials` is null.
 */
export async function uploadToMicrosoft(
  outputDir: string,
  credentials: SftpCredentials | null,
): Promise<UploadResult> {
  if (credentials === null) {
    logger.warn('Microsoft SFTP credentials missing -- skipping Microsoft upload');
    return {
      target: 'microsoft',
      filesUploaded: 0,
      filesFailed: 0,
      errors: ['credentials not configured'],
    };
  }

  const files = MICROSOFT_ALLOWED_FILES.map((name) => ({
    localPath: path.join(outputDir, name),
    remoteName: name,
  }));

  logger.info({ fileCount: files.length }, 'Starting Microsoft SFTP upload');
  return uploadFiles('microsoft', credentials, files);
}
