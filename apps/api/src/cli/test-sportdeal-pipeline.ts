#!/usr/bin/env node
/**
 * Sportdeal Pipeline E2E Test Script
 *
 * Tests the full pipeline (Stage 1→2→3→4) using mock Sportdeal API responses
 * served from an in-process HTTP server. No real Sportdeal API calls are made.
 *
 * Usage:
 *   npx tsx apps/api/src/cli/test-sportdeal-pipeline.ts
 *
 * What it tests:
 *   - Stage 1: Fetch + transform using mock API data (3 test orders)
 *   - Stage 2: Insert into MOP tables (real DB write)
 *   - Stage 3: Process MOP → UKSS orders (tax calculation, currency rate, ot_tax row)
 *   - Stage 4: Sync UKSS status → MOP (if/else if chain)
 *
 * Test orders:
 *   TEST-90001: Single product (EUR, has VAT)
 *   TEST-90002: Multi product (EUR, has VAT, 2 items)
 *   TEST-90003: Cancelled order (for Stage 5 cancellation test)
 *
 * After running, compare UKSS orders against a known PHP-processed order.
 */

import http from 'http';
import { config } from '../config';
import { fetchSportdealOrders } from '../modules/sportdeal/sportdeal-order-service';
import { processMarketplaceOrdersToUKSS } from '../modules/marketplace-orders/marketplace-orders.service';
import { syncMarketplaceOrderStatus } from '../modules/order-status-sync/order-status-sync.service';
import { prisma } from '../lib/prisma';

// ─── Mock Data ───────────────────────────────────────────────────────
// Uses real SKUs that exist in the product database:
//   p-475771-3169  (Man City Away Shirt, €89.99)
//   p-496336-3431  (Another shirt, €69.99)
//   p-392371-3198  (Accessory, €17.99)

const MOCK_LIST_RESPONSE = {
  items: [
    { id: 90001, created_at: '2026-03-25T10:00:00.000Z', delivery_cost: 9.47 },
    { id: 90002, created_at: '2026-03-25T10:05:00.000Z', delivery_cost: 12.50 },
    { id: 90003, created_at: '2026-03-25T10:10:00.000Z', delivery_cost: 0 },
  ],
};

// TEST-90001: Single product, EUR, with VAT
const MOCK_DETAIL_90001 = {
  id: 90001,
  supplier_id: 1922,
  supplier_quote_id: 1,
  supplier_name: 'UKSS',
  order_type: 1,
  order_status: 20, // CONFIRMED
  reject_reason: null,
  delivery_cost: 14,
  external_order_id: null,
  direct_cost_price: 68.99,
  final_cost_price: 68.99,
  commission: 15.50,
  vat: 20.80,
  order_amount_org: 89.99,
  delivery_cost_org: 9.47,
  delivery_customer: 9.47,
  sdeal_discount: 0,
  vat_org: 20.80,
  indirect_discount: 0,
  expected_arrival_date: null,
  original_expected_arrival_date: [],
  confirmed_expected_arrival_date: null,
  payment_schedule: null,
  settle_payment_schedule: null,
  payment_date: null,
  settle_payment_date: null,
  finance_status: null,
  commission_status: null,
  note: null,
  customer_email: 'test-single@example.com',
  customer_phone: '+31612345678',
  company: '',
  first_name: 'Test',
  last_name: 'SingleProduct',
  shipping_street: 'Keizersgracht',
  shipping_house_number: '123',
  shipping_addition_address: '',
  shipping_zipcode: '1015 CJ',
  shipping_city: 'Amsterdam',
  shipping_region: 'Noord-Holland',
  shipping_countryid: 'NL',
  customer_order_id: 'SD-NL-O-TEST90001',
  order_items: JSON.stringify([
    {
      ean: '8059490072341',
      quantity: 1,
      supplier_sku: 'p-475771-3169',
      name: '2025-2026 Man City Long Sleeve Away Shirt',
      price: '89.9900',
    },
  ]),
};

// TEST-90002: Multi product (2 items), EUR, with VAT
const MOCK_DETAIL_90002 = {
  id: 90002,
  supplier_id: 1922,
  supplier_quote_id: 2,
  supplier_name: 'UKSS',
  order_type: 1,
  order_status: 20,
  reject_reason: null,
  delivery_cost: 18,
  external_order_id: null,
  direct_cost_price: 118.98,
  final_cost_price: 118.98,
  commission: 28.50,
  vat: 26.73,
  order_amount_org: 159.98,
  delivery_cost_org: 12.50,
  delivery_customer: 12.50,
  sdeal_discount: 0,
  vat_org: 26.73,
  indirect_discount: 0,
  expected_arrival_date: null,
  original_expected_arrival_date: [],
  confirmed_expected_arrival_date: null,
  payment_schedule: null,
  settle_payment_schedule: null,
  payment_date: null,
  settle_payment_date: null,
  finance_status: null,
  commission_status: null,
  note: null,
  customer_email: 'test-multi@example.com',
  customer_phone: '+49301234567',
  company: '',
  first_name: 'Test',
  last_name: 'MultiProduct',
  shipping_street: 'Berliner Strasse',
  shipping_house_number: '456',
  shipping_addition_address: 'Apt 7',
  shipping_zipcode: '10115',
  shipping_city: 'Berlin',
  shipping_region: 'Berlin',
  shipping_countryid: 'DE',
  customer_order_id: 'SD-DE-O-TEST90002',
  order_items: JSON.stringify([
    {
      ean: '1234567890123',
      quantity: 1,
      supplier_sku: 'p-496336-3431',
      name: 'Test Shirt A',
      price: '69.9900',
    },
    {
      ean: '9876543210987',
      quantity: 1,
      supplier_sku: 'p-475771-3169',
      name: '2025-2026 Man City Long Sleeve Away Shirt',
      price: '89.9900',
    },
  ]),
};

// TEST-90003: Single product for cancellation test
const MOCK_DETAIL_90003 = {
  id: 90003,
  supplier_id: 1922,
  supplier_quote_id: 3,
  supplier_name: 'UKSS',
  order_type: 1,
  order_status: 25, // CANCELED
  reject_reason: 'Out of stock',
  delivery_cost: 0,
  external_order_id: null,
  direct_cost_price: 14.99,
  final_cost_price: 14.99,
  commission: 4.00,
  vat: 8.15,
  order_amount_org: 17.99,
  delivery_cost_org: 0,
  delivery_customer: 0,
  sdeal_discount: 0,
  vat_org: 8.15,
  indirect_discount: 0,
  expected_arrival_date: null,
  original_expected_arrival_date: [],
  confirmed_expected_arrival_date: null,
  payment_schedule: null,
  settle_payment_schedule: null,
  payment_date: null,
  settle_payment_date: null,
  finance_status: null,
  commission_status: null,
  note: null,
  customer_email: 'test-cancel@example.com',
  customer_phone: '+33612345678',
  company: '',
  first_name: 'Test',
  last_name: 'CancelOrder',
  shipping_street: 'Rue de Rivoli',
  shipping_house_number: '789',
  shipping_addition_address: '',
  shipping_zipcode: '75001',
  shipping_city: 'Paris',
  shipping_region: 'Ile-de-France',
  shipping_countryid: 'FR',
  customer_order_id: 'SD-FR-O-TEST90003',
  order_items: JSON.stringify([
    {
      ean: '5555555555555',
      quantity: 1,
      supplier_sku: 'p-392371-3198',
      name: 'Test Accessory',
      price: '17.9900',
    },
  ]),
};

const MOCK_DETAILS: Record<number, any> = {
  90001: MOCK_DETAIL_90001,
  90002: MOCK_DETAIL_90002,
  90003: MOCK_DETAIL_90003,
};

// ─── Mock HTTP Server ────────────────────────────────────────────────

function startMockServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '';
      console.log(`[MOCK] ${req.method} ${url}`);

      res.setHeader('Content-Type', 'application/json');

      // List endpoint — matches any URL containing the date range pattern
      if (url.includes('from=') || url.includes('orders') && !url.match(/\/\d+$/)) {
        res.end(JSON.stringify(MOCK_LIST_RESPONSE));
        return;
      }

      // Detail endpoint — extract order ID from end of URL
      const idMatch = url.match(/\/(\d+)$/);
      if (idMatch) {
        const orderId = parseInt(idMatch[1]);
        const detail = MOCK_DETAILS[orderId];
        if (detail) {
          res.end(JSON.stringify(detail));
          return;
        }
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

// ─── Test Runner ─────────────────────────────────────────────────────

async function runTest() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SPORTDEAL PIPELINE E2E TEST');
  console.log('═══════════════════════════════════════════════════════\n');

  // Start mock server
  const { server, port } = await startMockServer();
  const mockBaseUrl = `http://127.0.0.1:${port}`;

  // Override config to point to mock server
  const origOrdersUrl = config.SPORTDEAL_ORDERS_API_URL;
  const origDetailUrl = config.SPORTDEAL_ORDER_PRODUCT_API_URL;
  const origApiKey = config.SPORTDEAL_API_KEY;

  (config as any).SPORTDEAL_ORDERS_API_URL = `${mockBaseUrl}/api/orders?from=%s&to=%s`;
  (config as any).SPORTDEAL_ORDER_PRODUCT_API_URL = `${mockBaseUrl}/api/orders/`;
  // Set a dummy API key if not already set (needed for HttpClient auth)
  if (!config.SPORTDEAL_API_KEY) {
    (config as any).SPORTDEAL_API_KEY = 'test-api-key-for-mock';
  }

  try {
    // ── Stage 1+2: Fetch & Insert ──────────────────────────────
    console.log('── STAGE 1+2: Fetch orders from mock API & insert into MOP ──\n');
    const fetchResult = await fetchSportdealOrders();
    console.log('Fetch result:', JSON.stringify(fetchResult, null, 2));
    console.log();

    if (!fetchResult.success || fetchResult.ordersInserted === 0) {
      console.error('❌ Stage 1+2 failed — no orders inserted');
      return;
    }
    console.log(`✅ Stage 1+2: ${fetchResult.ordersInserted} orders inserted into MOP\n`);

    // ── Stage 3: Process MOP → UKSS ─────────────────────────────
    console.log('── STAGE 3: Process marketplace orders to UKSS ──\n');
    const processResult = await processMarketplaceOrdersToUKSS(10);
    console.log('Process result:', JSON.stringify(processResult, null, 2));
    console.log();

    if (processResult.processed === 0) {
      console.warn('⚠ Stage 3: No orders processed (may have been grabbed by PHP cron)');
    } else {
      console.log(`✅ Stage 3: ${processResult.processed} orders processed to UKSS\n`);
    }

    // ── Verify: Check tax and currency for test orders ──────────
    console.log('── VERIFICATION: Checking DB for test orders ──\n');

    const testOrders = await prisma.$queryRawUnsafe<any[]>(`
      SELECT mo.mo_id, mo.mo_order_id, mo.mo_order_total, mo.mo_order_currency,
             mo.mo_ukss_conversion_rate, mo.mo_ukss_order_id
      FROM mo_marketplace_orders mo
      WHERE mo.mo_order_id IN ('90001', '90002', '90003')
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
        const marker = t.class === 'ot_tax' ? ' ← TAX ROW' : '';
        console.log(`  Order ${t.orders_id}: ${t.class} = ${t.value} (${t.title})${marker}`);
      }
      console.log();

      // Check MOP product VAT data
      const vatData = await prisma.$queryRawUnsafe<any[]>(`
        SELECT mop.mop_mo_id, mop.mop_order_id, mop.mop_product_sku,
               mop.mop_product_price, mop.mop_product_vat_amount
        FROM mop_marketplace_order_products mop
        WHERE mop.mop_order_id IN ('90001', '90002', '90003')
        ORDER BY mop.mop_order_id, mop.mop_id
      `);

      console.log('MOP product VAT data:');
      for (const v of vatData) {
        console.log(`  Order ${v.mop_order_id}: sku=${v.mop_product_sku}, price=${v.mop_product_price}, vat=${v.mop_product_vat_amount}`);
      }
    } else {
      console.log('⚠ No UKSS orders found for test orders (PHP cron may have processed them first)');
    }

    // ── Stage 4: Sync status ────────────────────────────────────
    console.log('\n── STAGE 4: Sync order status (UKSS → MOP) ──\n');
    const syncResult = await syncMarketplaceOrderStatus(20);
    console.log('Sync result:', JSON.stringify(syncResult, null, 2));
    console.log();

    console.log('═══════════════════════════════════════════════════════');
    console.log('  TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
    console.log('\nNext steps:');
    console.log('1. Compare test order UKSS data against a known PHP-processed order');
    console.log('2. Verify ot_tax row exists for orders with VAT data');
    console.log('3. Verify currency_value matches mo_ukss_conversion_rate');

  } finally {
    // Restore config
    (config as any).SPORTDEAL_ORDERS_API_URL = origOrdersUrl;
    (config as any).SPORTDEAL_ORDER_PRODUCT_API_URL = origDetailUrl;
    (config as any).SPORTDEAL_API_KEY = origApiKey;

    server.close();
    await prisma.$disconnect();
  }
}

runTest().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
