#!/usr/bin/env node
/**
 * Allegro Pipeline E2E Test Script
 *
 * Tests the full pipeline (Stage 1+2 -> Stage 3 -> Stage 4) using mock Allegro API
 * responses served from an in-process HTTP server. No real Allegro API calls are made.
 *
 * Usage:
 *   npx tsx apps/api/src/cli/test-allegro-pipeline.ts
 *
 * What it tests:
 *   - Stage 1+2: Fetch + transform using mock API data (3 test orders)
 *   - Stage 2: Insert into MOP tables (real DB write)
 *   - Stage 3: Process MOP -> UKSS orders (tax calculation, currency rate, ot_tax row)
 *   - Stage 4: Sync UKSS status -> MOP (status sync)
 *
 * Test orders:
 *   TEST-ALLEGRO-90001: Single product (PLN, 23% VAT)
 *   TEST-ALLEGRO-90002: Multi product (PLN, 23% VAT, 2 items)
 *   TEST-ALLEGRO-90003: Single product for cancellation test
 *
 * After running, compare UKSS orders against a known PHP-processed order.
 */

import http from 'http';
import { config } from '../config';
import { fetchAllegroOrders } from '../modules/allegro/allegro-order-service';
import { processMarketplaceOrdersToUKSS } from '../modules/marketplace-orders/marketplace-orders.service';
import { syncMarketplaceOrderStatus } from '../modules/order-status-sync/order-status-sync.service';
import { prisma } from '../lib/prisma';

// ─── Mock Data ───────────────────────────────────────────────────────
// Uses real SKUs that exist in the product database:
//   p-493453-2648
//   p-466342-2650
//   p-347598-2646

function createMockOrder(
  id: string,
  buyerFirstName: string,
  buyerLastName: string,
  email: string,
  phone: string,
  street: string,
  city: string,
  zipCode: string,
  deliveryCost: string,
  totalToPay: string,
  lineItems: Array<{
    id: string;
    offerId: string;
    externalId: string;
    name: string;
    quantity: number;
    price: string;
    taxRate: string;
    boughtAt: string;
  }>,
  status: string = 'READY_FOR_PROCESSING',
  fulfillmentStatus: string = 'NEW'
) {
  return {
    id,
    messageToSeller: null,
    buyer: {
      id: '99990001',
      email,
      login: 'test-user',
      firstName: buyerFirstName,
      lastName: buyerLastName,
      companyName: null,
      guest: false,
      personalIdentity: null,
      phoneNumber: phone,
      preferences: { language: 'pl-PL' },
      address: {
        street,
        city,
        postCode: zipCode,
        countryCode: 'PL',
      },
    },
    payment: {
      id: `pay-${id}`,
      type: 'ONLINE',
      provider: 'AF',
      finishedAt: '2026-04-06T11:50:31.426Z',
      paidAmount: { amount: totalToPay, currency: 'PLN' },
      reconciliation: null,
      features: ['ALLEGRO_PAY'],
    },
    status,
    fulfillment: {
      status: fulfillmentStatus,
      shipmentSummary: { lineItemsSent: 'NONE' },
      provider: { id: 'SELLER' },
    },
    delivery: {
      address: {
        firstName: buyerFirstName,
        lastName: buyerLastName,
        street,
        city,
        zipCode,
        countryCode: 'PL',
        companyName: null,
        phoneNumber: phone,
        modifiedAt: null,
      },
      method: { id: 'test-method-id', name: 'Kurier' },
      pickupPoint: null,
      cost: { amount: deliveryCost, currency: 'PLN' },
      smart: false,
      time: {
        from: '2026-04-12T22:00:00Z',
        to: '2026-04-13T21:59:59.999Z',
        guaranteed: null,
        dispatch: {
          from: '2026-04-07T22:00:00Z',
          to: '2026-04-08T21:59:59.999Z',
        },
      },
      calculatedNumberOfPackages: 1,
      cancellation: null,
    },
    invoice: { required: false, address: null, dueDate: null, features: null },
    lineItems: lineItems.map(li => ({
      id: li.id,
      offer: {
        id: li.offerId,
        name: li.name,
        external: { id: li.externalId },
        productSet: null,
      },
      quantity: li.quantity,
      originalPrice: { amount: li.price, currency: 'PLN' },
      price: { amount: li.price, currency: 'PLN' },
      reconciliation: null,
      selectedAdditionalServices: [],
      vouchers: [],
      tax: { rate: li.taxRate, subject: 'GOODS', exemption: null },
      boughtAt: li.boughtAt,
      discounts: null,
      deposit: null,
    })),
    surcharges: [],
    note: null,
    marketplace: { id: 'allegro-pl' },
    summary: { totalToPay: { amount: totalToPay, currency: 'PLN' } },
    updatedAt: '2026-04-06T11:50:31.426Z',
    revision: 'test-rev-001',
  };
}

// TEST-ALLEGRO-90001: Single product, PLN, 23% VAT
const MOCK_ORDER_1 = createMockOrder(
  'test-allegro-90001',
  'Jan', 'Kowalski',
  'test-single@example.pl', '+48600100200',
  'ul. Marszalkowska 1', 'Warszawa', '00-001',
  '15.00', '240.90',
  [{
    id: 'li-001',
    offerId: '18463494001',
    externalId: 'p-493453-2648',
    name: 'Test Product Single',
    quantity: 1,
    price: '225.90',
    taxRate: '23.00',
    boughtAt: '2026-04-06T11:50:28.211Z',
  }]
);

// TEST-ALLEGRO-90002: Multi product (2 items), PLN, 23% VAT
const MOCK_ORDER_2 = createMockOrder(
  'test-allegro-90002',
  'Anna', 'Nowak',
  'test-multi@example.pl', '+48600200300',
  'ul. Krakowska 42', 'Krakow', '30-001',
  '20.00', '449.80',
  [
    {
      id: 'li-002a',
      offerId: '18463494002',
      externalId: 'p-466342-2650',
      name: 'Test Product A',
      quantity: 1,
      price: '189.90',
      taxRate: '23.00',
      boughtAt: '2026-04-06T11:55:00.000Z',
    },
    {
      id: 'li-002b',
      offerId: '18463494003',
      externalId: 'p-493453-2648',
      name: 'Test Product B',
      quantity: 1,
      price: '239.90',
      taxRate: '23.00',
      boughtAt: '2026-04-06T11:55:00.000Z',
    },
  ]
);

// TEST-ALLEGRO-90003: Single product for cancellation test
const MOCK_ORDER_3 = createMockOrder(
  'test-allegro-90003',
  'Piotr', 'Wisniewski',
  'test-cancel@example.pl', '+48600300400',
  'ul. Dluga 7', 'Gdansk', '80-001',
  '0.00', '99.90',
  [{
    id: 'li-003',
    offerId: '18463494004',
    externalId: 'p-347598-2646',
    name: 'Test Product Cancel',
    quantity: 1,
    price: '99.90',
    taxRate: '23.00',
    boughtAt: '2026-04-06T12:00:00.000Z',
  }]
);

const MOCK_CHECKOUT_FORMS_RESPONSE = {
  checkoutForms: [MOCK_ORDER_1, MOCK_ORDER_2, MOCK_ORDER_3],
  count: 3,
  totalCount: 3,
};

// ─── Mock HTTP Server ────────────────────────────────────────────────

function startMockServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '';
      console.log(`[MOCK] ${req.method} ${url}`);

      res.setHeader('Content-Type', 'application/vnd.allegro.public.v1+json');

      // Checkout forms list endpoint
      if (url.includes('/order/checkout-forms') && !url.match(/checkout-forms\/[a-zA-Z0-9-]+\//)) {
        res.end(JSON.stringify(MOCK_CHECKOUT_FORMS_RESPONSE));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      console.log(`[MOCK] Server started on port ${addr.port}`);
      resolve({ server, port: addr.port });
    });
  });
}

// ─── Mock OAuth Token ────────────────────────────────────────────────
// We need to bypass OAuth for testing. We override the token function import.
// Instead, we'll set a dummy token expiry in the future so the service uses a cached token.

// ─── Test Runner ─────────────────────────────────────────────────────

async function runTest() {
  console.log('=======================================================');
  console.log('  ALLEGRO PIPELINE E2E TEST');
  console.log('=======================================================\n');

  // Start mock server
  const { server, port } = await startMockServer();
  const mockBaseUrl = `http://127.0.0.1:${port}`;

  // Override config to point to mock server
  const origApiBaseUrl = config.ALLEGRO_API_BASE_URL;
  const origStoreId = config.ALLEGRO_STORE_ID;
  const origCurrency = config.ALLEGRO_CURRENCY;

  (config as any).ALLEGRO_API_BASE_URL = mockBaseUrl;
  if (!config.ALLEGRO_STORE_ID) {
    (config as any).ALLEGRO_STORE_ID = 151;
  }
  if (!config.ALLEGRO_CURRENCY) {
    (config as any).ALLEGRO_CURRENCY = 'PLN';
  }

  // Set a dummy OAuth token in the database so the service doesn't try to refresh
  const storeId = config.ALLEGRO_STORE_ID;
  const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
  await prisma.$executeRawUnsafe(
    `UPDATE store_management
     SET oauth_access_token = ?, oauth_access_token_expiry = ?
     WHERE store_id = ?`,
    'test-mock-access-token',
    futureExpiry,
    storeId
  );

  try {
    // -- Stage 1+2: Fetch & Insert ──────────────────────────────
    console.log('-- STAGE 1+2: Fetch orders from mock API & insert into MOP --\n');
    const fetchResult = await fetchAllegroOrders();
    console.log('Fetch result:', JSON.stringify(fetchResult, null, 2));
    console.log();

    if (!fetchResult.success || fetchResult.ordersInserted === 0) {
      console.error('FAIL: Stage 1+2 failed - no orders inserted');
      return;
    }
    console.log(`PASS: Stage 1+2: ${fetchResult.ordersInserted} orders inserted into MOP\n`);

    // -- Stage 3: Process MOP -> UKSS ─────────────────────────────
    console.log('-- STAGE 3: Process marketplace orders to UKSS --\n');
    const processResult = await processMarketplaceOrdersToUKSS(10);
    console.log('Process result:', JSON.stringify(processResult, null, 2));
    console.log();

    if (processResult.processed === 0) {
      console.warn('WARNING: Stage 3: No orders processed (may have been grabbed by PHP cron)');
    } else {
      console.log(`PASS: Stage 3: ${processResult.processed} orders processed to UKSS\n`);
    }

    // -- Verify: Check tax and currency for test orders ──────────
    console.log('-- VERIFICATION: Checking DB for test orders --\n');

    const testOrders = await prisma.$queryRawUnsafe<any[]>(`
      SELECT mo.mo_id, mo.mo_order_id, mo.mo_order_total, mo.mo_order_currency,
             mo.mo_ukss_conversion_rate, mo.mo_ukss_order_id
      FROM mo_marketplace_orders mo
      WHERE mo.mo_order_id IN ('test-allegro-90001', 'test-allegro-90002', 'test-allegro-90003')
      ORDER BY mo.mo_order_id
    `);

    console.log('MOP orders:');
    for (const o of testOrders) {
      console.log(`  Order ${o.mo_order_id}: total=${o.mo_order_total}, currency=${o.mo_order_currency}, rate=${o.mo_ukss_conversion_rate}, ukss_id=${o.mo_ukss_order_id}`);
    }
    console.log();

    // Check UKSS orders for tax data
    const ukssOrderIds = testOrders.filter((o: any) => o.mo_ukss_order_id).map((o: any) => o.mo_ukss_order_id);
    if (ukssOrderIds.length > 0) {
      const placeholders = ukssOrderIds.map(() => '?').join(',');
      const ukssOrders = await prisma.$queryRawUnsafe<any[]>(`
        SELECT orders_id, order_tax, order_total, currency, currency_value
        FROM orders WHERE orders_id IN (${placeholders})
        ORDER BY orders_id
      `, ...ukssOrderIds);

      console.log('UKSS orders:');
      for (const o of ukssOrders) {
        console.log(`  Order ${o.orders_id}: order_tax=${o.order_tax}, total=${o.order_total}, currency=${o.currency}, rate=${o.currency_value}`);
      }
      console.log();

      // Check orders_total for ot_tax rows
      const totals = await prisma.$queryRawUnsafe<any[]>(`
        SELECT orders_id, title, class, value, sort_order
        FROM orders_total WHERE orders_id IN (${placeholders})
        ORDER BY orders_id, sort_order
      `, ...ukssOrderIds);

      console.log('Orders total rows:');
      for (const t of totals) {
        const marker = t.class === 'ot_tax' ? ' <-- TAX ROW' : '';
        console.log(`  Order ${t.orders_id}: ${t.class} = ${t.value} (${t.title})${marker}`);
      }
      console.log();

      // Check MOP product VAT data
      const vatData = await prisma.$queryRawUnsafe<any[]>(`
        SELECT mop.mop_mo_id, mop.mop_order_id, mop.mop_product_sku,
               mop.mop_product_price, mop.mop_product_vat_amount
        FROM mop_marketplace_order_products mop
        WHERE mop.mop_order_id IN ('test-allegro-90001', 'test-allegro-90002', 'test-allegro-90003')
        ORDER BY mop.mop_order_id, mop.mop_id
      `);

      console.log('MOP product VAT data:');
      for (const v of vatData) {
        console.log(`  Order ${v.mop_order_id}: sku=${v.mop_product_sku}, price=${v.mop_product_price}, vat=${v.mop_product_vat_amount}`);
      }
    } else {
      console.log('WARNING: No UKSS orders found for test orders (PHP cron may have processed them first)');
    }

    // -- Stage 4: Sync status ────────────────────────────────────
    console.log('\n-- STAGE 4: Sync order status (UKSS -> MOP) --\n');
    const syncResult = await syncMarketplaceOrderStatus(20);
    console.log('Sync result:', JSON.stringify(syncResult, null, 2));
    console.log();

    // -- Duplicate check ─────────────────────────────────────────
    console.log('-- DEDUP TEST: Running fetch again (should insert 0) --\n');
    const dupResult = await fetchAllegroOrders();
    console.log(`Dedup result: Found=${dupResult.ordersFound}, Inserted=${dupResult.ordersInserted}, Skipped=${dupResult.ordersSkipped}`);
    if (dupResult.ordersInserted === 0) {
      console.log('PASS: Dedup check works - no duplicate insertions\n');
    } else {
      console.error('FAIL: Dedup check failed - orders were inserted again!\n');
    }

    console.log('=======================================================');
    console.log('  TEST COMPLETE');
    console.log('=======================================================');
    console.log('\nNext steps:');
    console.log('1. Compare test order UKSS data against a known PHP-processed order');
    console.log('2. Verify ot_tax row exists for orders with VAT data');
    console.log('3. Verify currency_value matches mo_ukss_conversion_rate');

  } finally {
    // Restore config
    (config as any).ALLEGRO_API_BASE_URL = origApiBaseUrl;
    (config as any).ALLEGRO_STORE_ID = origStoreId;
    (config as any).ALLEGRO_CURRENCY = origCurrency;

    server.close();
    await prisma.$disconnect();
  }
}

runTest().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
