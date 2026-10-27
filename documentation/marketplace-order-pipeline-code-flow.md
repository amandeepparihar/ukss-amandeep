# Marketplace Order Pipeline — Code Flow Guide

**PRs:** #559 (Sportdeal gold standard), #560 (Stage 3 & 4 shared services)
**Branch:** `staging`

## How Orders Flow Through the System

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  SPORTDEAL API  │────▶│  MOP TABLES      │────▶│  UKSS ORDERS     │
│  (external)     │     │  (staging area)  │     │  (ZenCart tables) │
└─────────────────┘     └──────────────────┘     └──────────────────┘
   Stage 1: Fetch          Stage 2: Insert          Stage 3: Convert
                                                         │
┌─────────────────┐     ┌──────────────────┐             │
│  SPORTDEAL API  │◀────│  MOP TABLES      │◀────────────┘
│  (confirm/ship) │     │  (status update) │      Stage 4: Sync status
└─────────────────┘     └──────────────────┘
   Stage 5: Push           Stage 4 writes
```

**MOP = Marketplace Order Processing** (our staging tables: `mo_`, `mop_`, `mosh_`)
**UKSS = UK Soccer Shop** (ZenCart native tables: `orders`, `orders_products`, etc.)

---

## Stage 1+2: Fetch Orders & Insert into MOP

**What happens:** Call Sportdeal API → transform response → insert into MOP tables.

### Entry Point
```
CLI:  pnpm cli fetch-sportdeal-orders
API:  GET /api/sportdeal/getSportdealOrders
```

### Code Flow

```
fetch-sportdeal-orders.ts
  └─▶ fetchSportdealOrders()                    sportdeal-order-service.ts:115
        │
        ├─ getStoreDetails('Sportsdeal')         Gets store config (ID=127)
        ├─ getCurrencyDetails('EUR')             Gets conversion rate + symbol
        ├─ getLastFetchedOrderDate(127)          Date range for API query
        │
        ├─ HttpClient.get(listURL)               Sportdeal list endpoint
        │   └─ Returns: [{ id: 90001, delivery_cost: 9.47 }, ...]
        │
        ├─ FOR EACH order in list:
        │   ├─ getOrderStatus(orderId, 127)      Skip if already exists (duplicate)
        │   ├─ HttpClient.get(detailURL/90001)   Sportdeal detail endpoint
        │   │
        │   └─▶ transformSportdealOrder()        sportdeal-order-service.ts:314
        │        ├─ Parse order_items (JSON string → array)
        │        ├─ Country ISO → name ("NL" → "Netherlands")
        │        ├─ Distribute VAT proportionally across products
        │        ├─ Create 1 MOP record per unit (qty=3 → 3 records)
        │        └─ Return: TransformedOrder { Mo, Mop[], Mosh }
        │
        └─▶ insertMarketPlaceOrderDetails()      marketplace-orders-utils.ts:110
              └─ Prisma transaction:
                  ├─ INSERT mo_marketplace_orders (order header)
                  ├─ INSERT mop_marketplace_order_products (per product)
                  └─ INSERT mosh_marketplace_order_status_history (initial "Pending")
```

### Database Writes
| Table | What's stored |
|-------|---------------|
| `mo_marketplace_orders` | Order header: totals, currency, conversion rate, customer address, status |
| `mop_marketplace_order_products` | Per-product: SKU, price, VAT amount, quantity (1 per record) |
| `mosh_marketplace_order_status_history` | Initial entry: status="Pending", muosm_id=1 |

### Key Design Decisions
- **Rate limiting:** 120 req/min, 500ms between requests (Sportdeal API limit)
- **Retry:** 3 attempts with exponential backoff + jitter
- **VAT distribution:** Order-level VAT split across products by price ratio
- **1 record per unit:** qty=3 creates 3 `mop_` records (each with qty=1)

---

## Stage 3: Convert MOP → UKSS Orders

**What happens:** Read pending MOP orders → create ZenCart orders → link them back.

### Entry Point
```
CLI:  pnpm cli process-marketplace-orders [--limit 50]
API:  POST /api/marketplace-orders/process   { "limit": 50 }
```

### Code Flow

```
process-marketplace-orders.ts
  └─▶ processMarketplaceOrdersToUKSS(limit)     marketplace-orders.service.ts:291
        │
        ├─ getPendingMarketplaceOrders(limit)    WHERE mo_ukss_order_id IS NULL
        │
        ├─ FOR EACH pending order:
        │   │
        │   ├─ CURRENCY RESOLUTION (BUG 1 FIX)
        │   │   Uses moUkssConversionRate from MOP (rate at fetch time)
        │   │   Falls back to getCurrencyDetails() for legacy data
        │   │
        │   ├─▶ prepareOrderHeaderData()         marketplace-orders.service.ts:119
        │   │     Maps MOP fields → UKSS orders table fields
        │   │     Address: shipping → customer/delivery/billing (same)
        │   │     Status: orders_status = UkssOrderStatus.PROCESSING (2)
        │   │
        │   ├─ validateOrderData()               Checks required fields
        │   ├─ getMarketplaceOrderProducts()     Fetch MOP products
        │   │
        │   ├─ TAX CALCULATION (BUG 2 FIX)
        │   │   orderTax = SUM(mopProductVatAmount × quantity) / conversionRate
        │   │
        │   ├─ FOR EACH product: verify SKU exists
        │   │   getProductVariationDataFromSKU(sku)
        │   │   Skip ENTIRE order if ANY SKU missing
        │   │
        │   └─ PRISMA TRANSACTION (all-or-nothing):
        │       ├─ insertOrderHeader()           → orders table
        │       ├─ updateMarketplaceOrder()       Link mo → UKSS order
        │       ├─ FOR EACH product unit:
        │       │   ├─ insertOrderProduct()      → orders_products
        │       │   ├─ insertOrderProductAttribute() (size)
        │       │   └─ insertOrderProductAttribute() (personalization, if configured)
        │       ├─ insertOrderTotal() × 4:
        │       │   ├─ ot_subtotal (sort: 100)
        │       │   ├─ ot_shipping (sort: 200)
        │       │   ├─ ot_tax      (sort: 300)  ← NEW: only if tax > 0
        │       │   └─ ot_total    (sort: 999)
        │       ├─ insertOrderStatusHistory()    Initial "Processing" entry
        │       └─ updatePaypalOrderId()         Toffs only
```

### Bug Fixes in This Stage
| Bug | Before | After |
|-----|--------|-------|
| **Currency rate drift** | Fresh DB lookup (rate could change between Stage 1 and 3) | Uses `moUkssConversionRate` from MOP (locked at fetch time) |
| **Tax data lost** | `order_tax: 0`, no `ot_tax` row | Calculated from `mopProductVatAmount`, `ot_tax` row created |
| **Phantom products** | `quantity \|\| 1` (qty 0 → 1) | `quantity ?? 1` (qty 0 stays 0) |
| **Magic numbers** | `orders_status: '2'`, `timeout: 30000`, `products_options_id: 4` | Named constants from shared `constants.ts` |

### Database Writes
| Table | What's stored |
|-------|---------------|
| `orders` | ZenCart order header (customer, address, totals, status=Processing) |
| `orders_products` | Per-product (1 per unit): product ID, name, price in GBP |
| `orders_products_attributes` | Size attribute, personalization (name/number) |
| `orders_total` | Sub-Total, Shipping, Tax (new!), Total |
| `orders_status_history` | Initial "Processing" entry |
| `mo_marketplace_orders` | Updated: `mo_ukss_order_id` = new UKSS order ID |
| `mop_marketplace_order_products` | Updated: `mop_ukss_orders_products_id` = new UKSS product ID |

---

## Stage 4: Sync UKSS Status → MOP

**What happens:** Warehouse changes UKSS order status → Stage 4 translates to marketplace status → writes to MOP → Stage 5 pushes to API.

### Entry Point
```
CLI:  pnpm cli sync-order-status [--limit 20]
API:  POST /api/order-status-sync/sync   { "limit": 20 }
```

### Code Flow

```
sync-order-status.ts
  └─▶ syncMarketplaceOrderStatus(limit)          order-status-sync.service.ts:384
        │
        ├─▶ fetchOrderProductsForStatusSync()     Raw SQL: JOIN mop ← orders_products
        │     WHERE mop_ukss_orders_products_id IS SET
        │     AND status NOT IN ('Shipped','Cancelled','Return')
        │     Returns: product + box info, tracking, shipment_code
        │
        ├─ FOR EACH product:
        │   │
        │   ├─▶ fetchOrderStatusMapping(ordersId)
        │   │     Raw SQL: JOIN orders ← muosm (status mapping table)
        │   │     Translates UKSS status code → marketplace status string
        │   │     e.g. UKSS status 5 → "Shipped" for Sportdeal
        │   │
        │   ├─ DECISION TREE (BUG 3 FIX: else-if, not if/if/if):
        │   │
        │   │   if shouldCancelOrder()?        ← box1/2/3 = 'Cancelled'/'Rejected'
        │   │     action = CANCEL
        │   │
        │   │   else if shouldReturnOrder()?   ← return_chk='yes' AND store='Fruugo'
        │   │     action = RETURN
        │   │
        │   │   else if shouldShipOrder()?     ← tracking + shipment_code + status=5
        │   │     action = SHIP (with tracking info)
        │   │
        │   │   else if shouldConfirmOrder()?  ← box_number OR backorder, no tracking
        │   │     action = CONFIRM
        │   │
        │   └─ IF action matched (only ONE per product):
        │       ├─ updateMarketplaceOrderStatus()       → mo_marketplace_orders
        │       ├─ updateMarketplaceOrderProductStatus() → mop (sets api_response=WAITING)
        │       └─ insertStatusHistory()                 → mosh (audit trail)
```

### Bug Fix: Priority Chain
```
BEFORE (Bug):                        AFTER (Fix):
  if (cancel) { write }               if (cancel) { write }
  if (return) { write }     ←ALL      else if (return) { write }     ←ONLY ONE
  if (ship)   { write }      RUN      else if (ship)   { write }      RUNS
  if (confirm){ write }               else if (confirm){ write }
```
A cancelled order previously got 4 DB writes. Now it gets 1.

### Key: `mop_api_response = 'Waiting'`
When Stage 4 updates a product's status, it sets `mop_api_response = 'Waiting'`. This is the **signal for Stage 5** to pick it up and push the status to the marketplace API.

---

## Stage 5: Push Status to Sportdeal API

**What happens:** Read MOP products with `api_response='Waiting'` → call Sportdeal API → mark as done.

### Entry Point
```
CLI:  pnpm cli update-sportdeal-orders-status
API:  POST /api/sportdeal/updateOrderStatus
```

### Code Flow

```
update-sportdeal-orders-status.ts
  └─▶ updateSportdealOrderStatusesToSportdeal()  sportdeal-status-update.service.ts:200
        │
        ├─ getOrderProductDetails([127])          WHERE mop_api_response='Waiting'
        ├─ Create HttpClient (reused for batch)
        ├─ Create RateLimiter (120 req/min)
        │
        ├─ processedOrders = Map()                Dedup: 1 API call per order
        │
        └─ FOR EACH product (with rate limiting):
            │
            └─▶ updateSportdealOrderStatus()      sportdeal-status-update.service.ts:116
                  │
                  ├─ IF orderId in processedOrders:
                  │     Skip API call, just mark product as Shipped
                  │
                  ├─ IF status = 'Confirmed':
                  │   └─▶ confirmSportdealOrder()  sportdeal-status-update.service.ts:54
                  │         HttpClient.get(confirmURL + orderId)
                  │         Mark ALL products for this order as Shipped
                  │         Add orderId to processedOrders
                  │
                  └─ ELSE (non-Confirmed status):
                        Mark as Cancelled + MANUAL_UPDATE
                        (no API call — needs human intervention)
```

### Key Design Decisions
- **Dedup via Map:** Multiple products can belong to one order. Only 1 API call per order.
- **HttpClient reused:** Created once for the batch, not per-product (was a bug before).
- **Confirm = GET:** Sportdeal's confirm endpoint uses GET method (their API design, not ours).

---

## Shared Infrastructure

### Constants (`modules/marketplaces/orders/constants.ts`)

| Constant | Value | Used In |
|----------|-------|---------|
| `OrderStatus.SHIPPED` | `'Shipped'` | Stage 4 SQL filter, Stage 5 status |
| `OrderStatus.CANCELLED` | `'Cancelled'` | Stage 4 SQL filter |
| `OrderStatus.RETURN` | `'Return'` | Stage 4 Fruugo return handling |
| `ApiResponseStatus.WAITING` | `'Waiting'` | Stage 4 → 5 handoff signal |
| `UkssOrderStatus.PROCESSING` | `2` | Stage 3 initial status |
| `UkssOrderStatus.SHIPPED` | `5` | Stage 4 ship check |
| `OrderTotalClass.TAX` | `'ot_tax'` | Stage 3 tax row |
| `TRANSACTION_TIMEOUT_MS` | `30000` | Stage 3 Prisma transaction |
| `PERSONALIZE_OPTION_ID` | `4` | Stage 3 personalization |

### Error Handling (`lib/helpers/error-utils.ts`)

| Function | Purpose |
|----------|---------|
| `serializeError(error)` | Converts Error → plain object for Pino JSON logging |
| `getErrorMessage(error)` | Extracts message string from any error type |

### Execution Context (`modules/marketplaces/orders/base-order-service.ts`)

| Function | Purpose |
|----------|---------|
| `createExecutionContext(module)` | Creates `{ executionId, logger }` — unique ID per run for log tracing |
| `createOrderHttpClient(config)` | Factory for HttpClient with auth, rate limit, retry |

---

## Database Tables Reference

### MOP Tables (Staging Area)
| Table | Key Fields | Written By | Read By |
|-------|-----------|------------|---------|
| `mo_marketplace_orders` | mo_order_id, mo_order_status, mo_ukss_order_id, mo_ukss_conversion_rate | Stage 1+2, Stage 3 (link), Stage 4 (status) | Stage 3, Stage 4 |
| `mop_marketplace_order_products` | mop_order_id, mop_product_sku, mop_product_vat_amount, mop_api_response, mop_ukss_orders_products_id | Stage 1+2, Stage 3 (link), Stage 4 (status), Stage 5 (api_response) | Stage 3, Stage 4, Stage 5 |
| `mosh_marketplace_order_status_history` | mosh_mo_order_status, mosh_muosm_id | Stage 1+2 (initial), Stage 4 (updates) | — |

### UKSS Tables (ZenCart)
| Table | Key Fields | Written By | Read By |
|-------|-----------|------------|---------|
| `orders` | orders_id, order_tax, currency_value, orders_status | Stage 3 | Stage 4 |
| `orders_products` | orders_products_id, box_number, tracking_no, shipment_code | Stage 3 | Stage 4 |
| `orders_products_attributes` | products_options, products_options_values | Stage 3 | — |
| `orders_total` | class (ot_subtotal/ot_shipping/ot_tax/ot_total), value | Stage 3 | — |
| `orders_status_history` | orders_status_id, comments | Stage 3 | — |

### Mapping Table
| Table | Purpose | Read By |
|-------|---------|---------|
| `muosm_marketplcae_ukss_order_status_mappings` | Translates UKSS status code → marketplace status string | Stage 4 |

---

## How to Test

```bash
# Stage 1+2: Fetch from Sportdeal API
docker exec admin-staging-api node dist/cli/fetch-sportdeal-orders.js

# Stage 3: Convert MOP → UKSS (with tax calculation)
docker exec admin-staging-api node dist/cli/process-marketplace-orders.js --limit 10

# Stage 4: Sync UKSS status → MOP
docker exec admin-staging-api node dist/cli/sync-order-status.js --limit 20

# Stage 5: Push status to Sportdeal API
docker exec admin-staging-api node dist/cli/update-sportdeal-orders-status.js

# Full E2E test with mock API:
docker exec admin-staging-api node dist/cli/test-sportdeal-pipeline.js
```

### Verify in DB
```sql
-- Check tax rows (only created by new code)
SELECT COUNT(*) FROM orders_total WHERE class = 'ot_tax';

-- Compare conversion rates (should match)
SELECT mo.mo_ukss_conversion_rate, o.currency_value
FROM mo_marketplace_orders mo
JOIN orders o ON o.orders_id = mo.mo_ukss_order_id
WHERE mo.mo_order_currency = 'EUR'
ORDER BY mo.mo_id DESC LIMIT 5;
```
