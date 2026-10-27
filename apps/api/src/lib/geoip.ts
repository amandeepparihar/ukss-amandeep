import { redis } from './redis.js';

export interface LocationInfo {
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Get location information from IP address using ip-api.com (free tier)
 */
export async function getLocationFromIP(
  ipAddress?: string
): Promise<LocationInfo | null> {
  if (!ipAddress || isPrivateIP(ipAddress) || ipAddress === '::1' || ipAddress === '127.0.0.1') {
    return {
      city: 'Local',
      country: 'Local Network',
      countryCode: 'LOCAL',
    };
  }

  try {
    const cacheKey = `geoip:${ipAddress}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const response = await fetch(
      `http://ip-api.com/json/${ipAddress}?fields=status,message,country,countryCode,region,regionName,city,timezone,lat,lon`
    );

    if (!response.ok) {
      console.error('GeoIP API error:', response.statusText);
      return null;
    }

    const data = await response.json();

    if (data.status === 'fail') {
      console.error('GeoIP lookup failed:', data.message);
      return null;
    }

    const locationInfo: LocationInfo = {
      city: data.city || undefined,
      region: data.regionName || undefined,
      country: data.country || undefined,
      countryCode: data.countryCode || undefined,
      timezone: data.timezone || undefined,
      latitude: data.lat || undefined,
      longitude: data.lon || undefined,
    };

    await redis.setex(cacheKey, 86400, JSON.stringify(locationInfo));

    return locationInfo;
  } catch (error) {
    console.error('Error fetching GeoIP data:', error);
    return null;
  }
}

/**
 * Format location as a readable string
 */
export function formatLocation(location: LocationInfo | null): string {
  if (!location) {
    return 'Unknown Location';
  }

  const parts: string[] = [];

  if (location.city) {
    parts.push(location.city);
  }

  if (location.region && location.region !== location.city) {
    parts.push(location.region);
  }

  if (location.country) {
    parts.push(location.country);
  }

  return parts.length > 0 ? parts.join(', ') : 'Unknown Location';
}

/**
 * Check if an IP address is private/local
 */
function isPrivateIP(ip: string): boolean {
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^127\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/,
  ];

  return privateRanges.some((range) => range.test(ip));
}

/**
 * Get the client IP from various request headers
 */
export function getClientIP(request: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}): string {
  const headers = [
    'x-real-ip',
    'x-forwarded-for',
    'cf-connecting-ip',
    'x-client-ip',
    'x-cluster-client-ip',
  ];

  for (const header of headers) {
    const value = request.headers[header];
    if (value) {
      const ip = Array.isArray(value) ? value[0] : value;
      const firstIP = ip.split(',')[0].trim();
      if (firstIP && !isPrivateIP(firstIP)) {
        return firstIP;
      }
    }
  }

  return request.ip || '127.0.0.1';
}
