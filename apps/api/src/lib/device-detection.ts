import crypto from 'crypto';
import * as UAParser from 'ua-parser-js';

export interface DeviceInfo {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  deviceType: string; // desktop, mobile, tablet
  deviceVendor?: string;
  deviceModel?: string;
}

export interface DeviceFingerprint {
  fingerprint: string;
  info: DeviceInfo;
}

/**
 * Parse user agent string to extract device information
 */
export function parseUserAgent(userAgent?: string): DeviceInfo {
  if (!userAgent) {
    return {
      browser: 'Unknown',
      browserVersion: '',
      os: 'Unknown',
      osVersion: '',
      deviceType: 'desktop',
    };
  }

  const parser = new UAParser.UAParser(userAgent);
  const result = parser.getResult();

  return {
    browser: result.browser.name || 'Unknown',
    browserVersion: result.browser.version || '',
    os: result.os.name || 'Unknown',
    osVersion: result.os.version || '',
    deviceType: result.device.type || 'desktop',
    deviceVendor: result.device.vendor,
    deviceModel: result.device.model,
  };
}

/**
 * Generate a device fingerprint from request data
 */
export function generateDeviceFingerprint(
  userAgent?: string,
  acceptHeaders?: string,
  clientFingerprint?: string
): DeviceFingerprint {
  const info = parseUserAgent(userAgent);

  const fingerprintData = [
    userAgent || '',
    acceptHeaders || '',
    clientFingerprint || '',
    info.browser,
    info.os,
    info.deviceType,
  ].join('|');

  const fingerprint = crypto
    .createHash('sha256')
    .update(fingerprintData)
    .digest('hex');

  return {
    fingerprint,
    info,
  };
}

/**
 * Get a human-readable device name
 */
export function getDeviceName(info: DeviceInfo): string {
  const parts: string[] = [];

  if (info.deviceVendor && info.deviceModel) {
    parts.push(`${info.deviceVendor} ${info.deviceModel}`);
  }

  if (info.browser && info.browser !== 'Unknown') {
    parts.push(info.browser);
  }

  if (info.os && info.os !== 'Unknown') {
    parts.push(`on ${info.os}`);
  }

  if (parts.length === 0) {
    parts.push('Unknown Device');
  }

  return parts.join(' ');
}
