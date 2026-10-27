/**
 * Allegro Order Data Utilities
 *
 * Helper functions for Allegro API:
 *   - OAuth token management (refresh token flow, stored in store_management table)
 *   - Order data parsing helpers
 */

import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import type { AllegroTokenResponse } from '../../modules/allegro/allegro-api.types';
import { config } from '../../config';

const logger = createLogger('allegro-order-data-utils');

/**
 * Get a valid Allegro OAuth access token.
 *
 * Flow:
 *   1. Read current token + expiry from store_management table (store_id = 151)
 *   2. If token is still valid (not expired), return it
 *   3. If expired, use refresh_token to get a new access_token
 *   4. Save new tokens back to store_management
 *
 * WHY: Allegro access tokens expire every 12 hours. The refresh token is
 * long-lived but must be stored and updated after each refresh (Allegro
 * rotates refresh tokens on each use).
 *
 * @param storeId - Store ID in store_management table (151 for Allegro)
 * @returns Valid access token string
 */
export async function getValidAllegroAccessToken(storeId: number): Promise<string> {
  // Read current tokens from store_management
  const store = await prisma.$queryRawUnsafe<Array<{
    oauth_access_token: string | null;
    oauth_access_token_expiry: Date | null;
    oauth_refresh_token: string | null;
    oauth_refresh_token_expiry: Date | null;
  }>>(
    `SELECT oauth_access_token, oauth_access_token_expiry, oauth_refresh_token, oauth_refresh_token_expiry
     FROM store_management WHERE store_id = ?`,
    storeId
  );

  if (!store || store.length === 0) {
    throw new Error(`Store with ID ${storeId} not found in store_management`);
  }

  const {
    oauth_access_token: accessToken,
    oauth_access_token_expiry: accessTokenExpiry,
    oauth_refresh_token: refreshToken,
  } = store[0];

  if (!refreshToken) {
    throw new Error(`No OAuth refresh token found for store ${storeId}. Please authenticate first.`);
  }

  // Check if current access token is still valid (with 5-minute buffer)
  const bufferMs = 5 * 60 * 1000;
  if (accessToken && accessTokenExpiry && new Date(accessTokenExpiry).getTime() > Date.now() + bufferMs) {
    logger.debug({ storeId }, 'Using cached Allegro access token');
    return accessToken;
  }

  // Token expired or missing — refresh it
  logger.info({ storeId }, 'Allegro access token expired, refreshing...');
  return refreshAllegroAccessToken(storeId, refreshToken);
}

/**
 * Refresh the Allegro access token using the refresh token.
 *
 * Endpoint: POST https://allegro.pl/auth/oauth/token
 * Auth: Basic Auth (client_id:client_secret)
 * Body: grant_type=refresh_token&refresh_token={token} (x-www-form-urlencoded)
 *
 * WHY: Allegro rotates both access AND refresh tokens on each refresh call.
 * We must save the new refresh token back to the database.
 */
async function refreshAllegroAccessToken(storeId: number, refreshToken: string): Promise<string> {
  const clientId = config.ALLEGRO_CLIENT_ID;
  const clientSecret = config.ALLEGRO_CLIENT_SECRET;
  const tokenUrl = config.ALLEGRO_AUTH_URL || 'https://allegro.pl/auth/oauth/token';

  if (!clientId || !clientSecret) {
    throw new Error('ALLEGRO_CLIENT_ID and ALLEGRO_CLIENT_SECRET must be configured');
  }
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Allegro token refresh failed: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const tokenData = (await response.json()) as AllegroTokenResponse;

  if (!tokenData.access_token) {
    throw new Error('Allegro token response missing access_token');
  }

  // Calculate expiry dates
  const accessTokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000);
  // Allegro refresh tokens are valid for 3 months (90 days)
  const refreshTokenExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  // Save new tokens back to store_management
  await prisma.$executeRawUnsafe(
    `UPDATE store_management
     SET oauth_access_token = ?, oauth_access_token_expiry = ?,
         oauth_refresh_token = ?, oauth_refresh_token_expiry = ?
     WHERE store_id = ?`,
    tokenData.access_token,
    accessTokenExpiry,
    tokenData.refresh_token,
    refreshTokenExpiry,
    storeId
  );

  logger.info(
    { storeId, expiresIn: tokenData.expires_in },
    'Allegro access token refreshed and saved to database'
  );

  return tokenData.access_token;
}

/**
 * Get the Allegro order status as a combined string.
 *
 * @param orderStatus - Allegro order status (e.g., 'READY_FOR_PROCESSING')
 * @param fulfillmentStatus - Allegro fulfillment status (e.g., 'NEW')
 * @returns Combined status string for moOrderStatus field
 */
export function getAllegroOrderStatus(orderStatus: string, fulfillmentStatus: string): string {
  return `${orderStatus}/${fulfillmentStatus}`;
}

/**
 * Extract the SKU from an Allegro line item's offer.external.id field.
 *
 * WHY: The SKU format varies — it's whatever was set as the external ID
 * when listing the product on Allegro. Maps to npv_products_sku in DB.
 *
 * @param lineItem - Allegro line item
 * @returns SKU string or null if no external ID
 */
export function extractSkuFromLineItem(lineItem: { offer: { external: { id: string } | null } }): string | null {
  return lineItem.offer.external?.id || null;
}

/**
 * Calculate VAT amount from a price that includes VAT.
 *
 * Allegro prices include VAT. The tax rate is provided per line item.
 * Formula: vatAmount = price - (price / (1 + taxRate/100))
 *
 * @param priceIncVat - Price including VAT
 * @param taxRatePercent - Tax rate as percentage (e.g., 23.00)
 * @returns VAT amount
 */
export function calculateVatFromInclusivePrice(priceIncVat: number, taxRatePercent: number): number {
  if (taxRatePercent <= 0) return 0;
  return priceIncVat - (priceIncVat / (1 + taxRatePercent / 100));
}
