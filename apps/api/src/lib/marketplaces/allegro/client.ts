/**
 * Allegro API Client
 *
 * Handles communication with the Allegro REST API.
 * Uses single PATCH /sale/product-offers/{offerId} for price + stock updates.
 *
 * API Reference: https://developer.allegro.pl/documentation
 *
 * @taskId #164358
 */

import { getLogger } from '../../logger-context';

const ALLEGRO_CONTENT_TYPE = 'application/vnd.allegro.public.v1+json';

export interface AllegroOfferUpdate {
  offerId: string;
  price?: number;
  stock?: number;
  currency?: string;
}

export interface AllegroApiResponse {
  success: boolean;
  httpCode: number;
  error?: string;
  errorCode?: string;
}

export interface AllegroOffer {
  id: string;
  name: string;
  external?: { id?: string };
  sellingMode?: {
    price?: { amount: string; currency: string };
  };
  stock?: { available: number };
  publication?: { status: string };
}

export interface AllegroOffersResponse {
  offers: AllegroOffer[];
  count: number;
  totalCount: number;
}

export class AllegroClient {
  private readonly baseUrl: string;
  private readonly logger = getLogger('allegro-client');

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Update a single Allegro offer's price and/or stock.
   *
   * Uses PATCH /sale/product-offers/{offerId}
   */
  async updateOffer(
    offerId: string,
    accessToken: string,
    update: { price?: number; stock?: number; currency?: string }
  ): Promise<AllegroApiResponse> {
    const body: Record<string, unknown> = {};

    if (update.price !== undefined) {
      body.sellingMode = {
        price: {
          amount: update.price.toFixed(2),
          currency: update.currency || 'PLN',
        },
      };
    }

    if (update.stock !== undefined) {
      body.stock = {
        available: update.stock,
      };
    }

    const url = `${this.baseUrl}/sale/product-offers/${offerId}`;

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': ALLEGRO_CONTENT_TYPE,
          'Accept': ALLEGRO_CONTENT_TYPE,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return { success: true, httpCode: response.status };
      }

      // Parse error response
      const errorBody = await response.json().catch(() => null) as {
        errors?: Array<{ code?: string; message?: string; userMessage?: string }>;
      } | null;
      const firstError = errorBody?.errors?.[0];
      const errorMessage = firstError?.message || firstError?.userMessage || `HTTP ${response.status}`;
      const errorCode = firstError?.code || `HTTP_${response.status}`;

      this.logger.warn(
        { offerId, httpCode: response.status, errorCode, errorMessage },
        'Allegro offer update failed'
      );

      return {
        success: false,
        httpCode: response.status,
        error: errorMessage,
        errorCode,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      this.logger.error({ offerId, error }, 'Allegro API request failed');
      return {
        success: false,
        httpCode: 0,
        error: message,
        errorCode: 'NETWORK_ERROR',
      };
    }
  }

  /**
   * Fetch offers from Allegro (paginated).
   * Used by the populate-listings CLI command.
   *
   * Uses GET /sale/offers
   */
  async getOffers(
    accessToken: string,
    limit: number = 1000,
    offset: number = 0
  ): Promise<AllegroOffersResponse> {
    const url = `${this.baseUrl}/sale/offers?limit=${limit}&offset=${offset}&publication.status=ACTIVE`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': ALLEGRO_CONTENT_TYPE,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to fetch Allegro offers (HTTP ${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      offers: AllegroOffer[];
      count: number;
      totalCount: number;
    };

    return {
      offers: data.offers || [],
      count: data.count || 0,
      totalCount: data.totalCount || 0,
    };
  }

  /**
   * Split items into batches for processing.
   */
  createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
}

/**
 * Create an Allegro client instance.
 */
export function createAllegroClient(baseUrl: string): AllegroClient {
  return new AllegroClient(baseUrl);
}
