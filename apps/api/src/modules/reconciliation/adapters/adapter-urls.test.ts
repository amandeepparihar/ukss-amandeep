/**
 * Unit tests for adapter getOrderUrl() methods.
 *
 * Each reconciliation adapter can generate a deep-link URL to the
 * marketplace's order admin page.  These tests verify URL generation
 * in isolation, without hitting real APIs or databases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks - must be declared before importing the adapters
// ---------------------------------------------------------------------------

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    storeManagement: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../../config', () => ({
  config: {
    // Toffs
    TOFFS_API_BASE_URL: 'https://toffs.com',
    TOFFS_STORE_ID: 999,
    TOFFS_STORE_NAME: 'Toffs',
    // Fruugo (constructor reads FRUUGO_STORE_ID)
    FRUUGO_STORE_ID: 888,
    // Debenhams (constructor reads DEBENHAMS_STORE_ID)
    DEBENHAMS_STORE_ID: 150,
  },
}));

// Mock heavy dependencies that adapters import at module level so they
// don't cause import errors.  We never call fetchOrders() in these tests,
// so the mocks can be stubs.
vi.mock('../../../lib/toffs-token/toffs-token-utils', () => ({
  fetchToffsAccessToken: vi.fn(),
}));

vi.mock('../../fruugo/fruugo-order-service', () => ({
  makeFruugoApiRequest: vi.fn(),
}));

vi.mock('../../shopify/shopify-orders.service', () => ({
  getTokenCredentials: vi.fn(),
}));

vi.mock('../../../lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { prisma } from '../../../lib/prisma';
import { config } from '../../../config';
import { ShopifyAdapter } from './shopify.adapter';
import { ToffsAdapter } from './toffs.adapter';
import { FruugoAdapter } from './fruugo.adapter';
import { DebenhamsAdapter } from './debenhams.adapter';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Reconciliation Adapter getOrderUrl()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Shopify
  // -------------------------------------------------------------------------
  describe('ShopifyAdapter', () => {
    it('returns correct URL when store is found', async () => {
      vi.mocked(prisma.storeManagement.findFirst).mockResolvedValue({
        storeOrderIntegrationApiHostname: 'my-shop.myshopify.com',
      } as any);

      const adapter = new ShopifyAdapter();
      const url = await adapter.getOrderUrl('123456', 118);

      expect(url).toBe('https://my-shop.myshopify.com/admin/orders/123456');
      expect(prisma.storeManagement.findFirst).toHaveBeenCalledWith({
        where: { storeId: 118 },
        select: { storeOrderIntegrationApiHostname: true },
      });
    });

    it('returns null when store is not found', async () => {
      vi.mocked(prisma.storeManagement.findFirst).mockResolvedValue(null);

      const adapter = new ShopifyAdapter();
      const url = await adapter.getOrderUrl('123456', 999);

      expect(url).toBeNull();
    });

    it('returns null when store has no hostname', async () => {
      vi.mocked(prisma.storeManagement.findFirst).mockResolvedValue({
        storeOrderIntegrationApiHostname: null,
      } as any);

      const adapter = new ShopifyAdapter();
      const url = await adapter.getOrderUrl('123456', 118);

      expect(url).toBeNull();
    });

    it('returns null when prisma throws an error', async () => {
      vi.mocked(prisma.storeManagement.findFirst).mockRejectedValue(
        new Error('DB connection failed'),
      );

      const adapter = new ShopifyAdapter();
      const url = await adapter.getOrderUrl('123456', 118);

      expect(url).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Toffs
  // -------------------------------------------------------------------------
  describe('ToffsAdapter', () => {
    it('returns correct URL when TOFFS_API_BASE_URL is configured', async () => {
      const adapter = new ToffsAdapter();
      const url = await adapter.getOrderUrl('ORD-001', 999);

      expect(url).toBe('https://toffs.com/sales/order/view/order_id/ORD-001');
    });

    it('returns null when TOFFS_API_BASE_URL is not configured', async () => {
      // Temporarily clear the config value
      const original = config.TOFFS_API_BASE_URL;
      (config as any).TOFFS_API_BASE_URL = undefined;

      try {
        const adapter = new ToffsAdapter();
        const url = await adapter.getOrderUrl('ORD-001', 999);
        expect(url).toBeNull();
      } finally {
        (config as any).TOFFS_API_BASE_URL = original;
      }
    });

    it('returns null when TOFFS_API_BASE_URL is empty string', async () => {
      const original = config.TOFFS_API_BASE_URL;
      (config as any).TOFFS_API_BASE_URL = '';

      try {
        const adapter = new ToffsAdapter();
        const url = await adapter.getOrderUrl('ORD-001', 999);
        expect(url).toBeNull();
      } finally {
        (config as any).TOFFS_API_BASE_URL = original;
      }
    });
  });

  // -------------------------------------------------------------------------
  // Fruugo
  // -------------------------------------------------------------------------
  describe('FruugoAdapter', () => {
    it('returns correct URL for a given order ID', async () => {
      const adapter = new FruugoAdapter();
      const url = await adapter.getOrderUrl('FR-12345', 888);

      expect(url).toBe('https://sell.fruugo.com/orders/order-detail/FR-12345');
    });

    it('always returns a URL regardless of storeId', async () => {
      const adapter = new FruugoAdapter();
      const url = await adapter.getOrderUrl('FR-99999', 0);

      expect(url).toBe('https://sell.fruugo.com/orders/order-detail/FR-99999');
    });

    it('handles numeric order IDs', async () => {
      const adapter = new FruugoAdapter();
      const url = await adapter.getOrderUrl('777', 888);

      expect(url).toBe('https://sell.fruugo.com/orders/order-detail/777');
    });
  });

  // -------------------------------------------------------------------------
  // Debenhams
  // -------------------------------------------------------------------------
  describe('DebenhamsAdapter', () => {
    it('returns correct URL for a given order ID', async () => {
      const adapter = new DebenhamsAdapter();
      const url = await adapter.getOrderUrl('DEB-12345', 150);

      expect(url).toBe('https://debenhamsuk-prod.mirakl.net/order/DEB-12345');
    });

    it('always returns a URL regardless of storeId', async () => {
      const adapter = new DebenhamsAdapter();
      const url = await adapter.getOrderUrl('DEB-99999', 0);

      expect(url).toBe('https://debenhamsuk-prod.mirakl.net/order/DEB-99999');
    });

    it('handles numeric order IDs', async () => {
      const adapter = new DebenhamsAdapter();
      const url = await adapter.getOrderUrl('42', 150);

      expect(url).toBe('https://debenhamsuk-prod.mirakl.net/order/42');
    });
  });
});
