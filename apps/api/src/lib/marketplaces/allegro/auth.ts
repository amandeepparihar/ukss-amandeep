/**
 * Allegro OAuth2 Token Management
 *
 * Manages access and refresh tokens stored in the `store_management` table.
 * Allegro's refresh token is single-use — each refresh invalidates the previous one
 * and returns a new refresh token that must be persisted.
 *
 * Token lifecycle:
 * - Access token: ~12 hours
 * - Refresh token: ~3 months (single-use)
 * - When refresh token expires: manual browser re-auth needed
 *
 * @taskId #164358
 */

import { prisma } from '../../prisma';
import { config } from '../../../config';
import { getLogger } from '../../logger-context';

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer before expiry

export interface AllegroTokens {
  accessToken: string;
  accessTokenExpiry: Date;
  refreshToken: string;
  refreshTokenExpiry: Date | null;
}

/**
 * Get a valid access token for the Allegro store.
 * Automatically refreshes if the current token is expired or about to expire.
 *
 * @param storeId - The Allegro store ID in store_management
 * @returns A valid access token string
 * @throws Error if no tokens found or refresh fails
 */
export async function getAccessToken(storeId: number): Promise<string> {
  const logger = getLogger('allegro-auth');

  const store = await prisma.storeManagement.findUnique({
    where: { storeId },
    select: {
      oauthAccessToken: true,
      oauthAccessTokenExpiry: true,
      oauthRefreshToken: true,
      oauthRefreshTokenExpiry: true,
    },
  });

  if (!store || !store.oauthRefreshToken) {
    throw new Error(
      `No OAuth tokens found for Allegro store ${storeId}. Run 'pnpm cli allegro seed-token' first.`
    );
  }

  // Check if access token is still valid (with buffer)
  if (
    store.oauthAccessToken &&
    store.oauthAccessTokenExpiry &&
    new Date(store.oauthAccessTokenExpiry).getTime() > Date.now() + TOKEN_EXPIRY_BUFFER_MS
  ) {
    logger.debug({ storeId }, 'Using existing access token');
    return store.oauthAccessToken.replace(/[\r\n\s]+/g, '');
  }

  // Access token expired or missing — refresh it
  logger.info({ storeId }, 'Access token expired or missing, refreshing...');
  const tokens = await refreshAccessToken(storeId, store.oauthRefreshToken.replace(/[\r\n\s]+/g, ''));
  return tokens.accessToken;
}

/**
 * Refresh the Allegro access token using the stored refresh token.
 * Updates both access and refresh tokens in the database.
 *
 * @param storeId - The Allegro store ID
 * @param currentRefreshToken - The current refresh token (optional, reads from DB if not provided)
 * @returns The new token set
 */
export async function refreshAccessToken(
  storeId: number,
  currentRefreshToken?: string
): Promise<AllegroTokens> {
  const logger = getLogger('allegro-auth');

  // Get refresh token from DB if not provided
  if (!currentRefreshToken) {
    const store = await prisma.storeManagement.findUnique({
      where: { storeId },
      select: { oauthRefreshToken: true },
    });

    if (!store?.oauthRefreshToken) {
      throw new Error(`No refresh token found for Allegro store ${storeId}`);
    }
    currentRefreshToken = store.oauthRefreshToken;
  }

  // Sanitize token — DB TEXT columns may contain newlines/whitespace
  currentRefreshToken = currentRefreshToken.replace(/[\r\n\s]+/g, '');

  const clientId = config.ALLEGRO_CLIENT_ID;
  const clientSecret = config.ALLEGRO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('ALLEGRO_CLIENT_ID and ALLEGRO_CLIENT_SECRET must be configured');
  }

  const authUrl = config.ALLEGRO_AUTH_URL;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  logger.info({ storeId }, 'Requesting new access token from Allegro');

  let response: Response;
  try {
    response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentRefreshToken,
      }),
    });
  } catch (error) {
    throw new Error(
      `Failed to connect to Allegro auth endpoint: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ storeId, status: response.status, errorBody }, 'Allegro token refresh failed');

    // If invalid_grant, the refresh token may have been consumed by another process
    // Re-read from DB and retry once
    if (response.status === 400 && errorBody.includes('invalid_grant')) {
      logger.warn({ storeId }, 'Refresh token invalid — re-reading from DB and retrying once');
      const store = await prisma.storeManagement.findUnique({
        where: { storeId },
        select: { oauthRefreshToken: true },
      });

      if (store?.oauthRefreshToken && store.oauthRefreshToken !== currentRefreshToken) {
        logger.info({ storeId }, 'Found updated refresh token in DB, retrying...');
        return refreshAccessToken(storeId, store.oauthRefreshToken);
      }

      throw new Error(
        `Allegro refresh token is invalid/expired for store ${storeId}. Manual re-authorization required.`
      );
    }

    throw new Error(`Allegro token refresh failed (HTTP ${response.status}): ${errorBody}`);
  }

  const tokenData = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number; // seconds
  };

  const now = new Date();
  const accessTokenExpiry = new Date(now.getTime() + tokenData.expires_in * 1000);
  // Allegro refresh tokens last ~3 months
  const refreshTokenExpiry = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  // Persist both tokens atomically
  await prisma.storeManagement.update({
    where: { storeId },
    data: {
      oauthAccessToken: tokenData.access_token,
      oauthAccessTokenExpiry: accessTokenExpiry,
      oauthRefreshToken: tokenData.refresh_token,
      oauthRefreshTokenExpiry: refreshTokenExpiry,
    },
  });

  logger.info(
    { storeId, expiresIn: tokenData.expires_in },
    'Allegro tokens refreshed and saved'
  );

  return {
    accessToken: tokenData.access_token,
    accessTokenExpiry,
    refreshToken: tokenData.refresh_token,
    refreshTokenExpiry,
  };
}

/**
 * Seed the initial refresh token for an Allegro store.
 * Used once during setup after the browser-based authorization flow.
 *
 * @param storeId - The Allegro store ID in store_management
 * @param refreshToken - The initial refresh token from the OAuth authorization flow
 */
export async function seedInitialToken(storeId: number, refreshToken: string): Promise<void> {
  const logger = getLogger('allegro-auth');

  const store = await prisma.storeManagement.findUnique({
    where: { storeId },
    select: { storeId: true, storeName: true },
  });

  if (!store) {
    throw new Error(`Store ID ${storeId} not found in store_management`);
  }

  await prisma.storeManagement.update({
    where: { storeId },
    data: {
      oauthRefreshToken: refreshToken,
      oauthRefreshTokenExpiry: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });

  logger.info({ storeId, storeName: store.storeName }, 'Initial Allegro refresh token seeded');
}

/**
 * Get the current token status for an Allegro store.
 *
 * @param storeId - The Allegro store ID
 * @returns Token status information
 */
export async function getTokenStatus(storeId: number): Promise<{
  hasAccessToken: boolean;
  accessTokenExpiry: Date | null;
  accessTokenValid: boolean;
  hasRefreshToken: boolean;
  refreshTokenExpiry: Date | null;
  refreshTokenValid: boolean;
}> {
  const store = await prisma.storeManagement.findUnique({
    where: { storeId },
    select: {
      oauthAccessToken: true,
      oauthAccessTokenExpiry: true,
      oauthRefreshToken: true,
      oauthRefreshTokenExpiry: true,
    },
  });

  if (!store) {
    throw new Error(`Store ID ${storeId} not found in store_management`);
  }

  const now = Date.now();

  return {
    hasAccessToken: !!store.oauthAccessToken,
    accessTokenExpiry: store.oauthAccessTokenExpiry,
    accessTokenValid: !!(
      store.oauthAccessToken &&
      store.oauthAccessTokenExpiry &&
      new Date(store.oauthAccessTokenExpiry).getTime() > now
    ),
    hasRefreshToken: !!store.oauthRefreshToken,
    refreshTokenExpiry: store.oauthRefreshTokenExpiry,
    refreshTokenValid: !!(
      store.oauthRefreshToken &&
      (!store.oauthRefreshTokenExpiry ||
        new Date(store.oauthRefreshTokenExpiry).getTime() > now)
    ),
  };
}
