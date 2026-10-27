# Sportdeal Order Integration — Gold Standard Refactoring

**Branch**: `refactor/sportdeal-order-integration`
**Created**: 2026-03-24
**Plan**: `.claude/plans/goofy-giggling-rivest.md`
**Audit Reference**: `documentation/marketplace-orders-complete-audit.md`, PR #552

## Purpose

Refactor Sportdeal order integration to be the gold standard template for all 5 marketplace order integrations. Uses existing `HttpClient`, `AuthProvider`, `RateLimiter`, `RetryHandler` from `modules/marketplaces/utils/`. Fixes 16 known bugs from the audit.

## Task Checklist

### Phase 0: Shared Infrastructure

- [x] **0.1** Create `serializeError()` utility → `lib/helpers/error-utils.ts`
- [x] **0.2** Create order status constants → `modules/marketplaces/orders/constants.ts`
- [x] **0.3** Create base order service types + helpers → `modules/marketplaces/orders/types.ts`, `base-order-service.ts`
- [x] **0.4** Create Sportdeal API types from production logs → `modules/sportdeal/sportdeal-api.types.ts`

### Phase 1: Refactor Order Fetching (Stage 1)

- [x] **1.1** Rewrite `sportdeal-order-service.ts` — HttpClient, bug fixes H2/H3/M1/M2/M9/Q5/Q6/Q8/D2/D3/D6
- [x] **1.2** Simplify `sportdeal-order-data.utils.ts` — retain helpers, move transformation to service
- [x] **1.3** Update Zod schemas → `sportdeal-schema.ts`
- [x] **1.4** Update CLI → `fetch-sportdeal-orders.ts`

### Phase 2: Refactor Status Push (Stage 5)

- [x] **2.1** Rewrite `sportdeal-status-update.service.ts` — HttpClient, RateLimiter
- [x] **2.2** Update CLI → `update-sportdeal-orders-status.ts` (no changes needed)

### Phase 3: Routes, Config, Documentation

- [x] **3.1** Update routes → `sportdeal-routes.ts`
- [x] **3.2** Update config → `config/index.ts` (new env vars: SPORTDEAL_CURRENCY, SPORTDEAL_SHIPPING_METHOD, SPORTDEAL_ALLOWED_STATUS_FOR_CONFIRMATION)
- [x] **3.3** Create this task tracking document
- [x] **3.4** Update Claude skill — deferred to after PR review
- [x] **3.5** Update base-resource.ts — use shared serializeError(), add duration timing

### Phase 4: Verification & Cleanup

- [x] **4.3** Build verification — `npx tsc --noEmit` passes, no "Sportsdeal" typos, no raw fetch() in sportdeal module
- [ ] **4.1** Test fetch on staging — requires deployment
- [ ] **4.2** Test status push on staging — requires deployment
- [ ] **4.4** Create PR to staging

## Progress Notes

### 2026-03-24: Session 1
- Created branch `refactor/sportdeal-order-integration` from main
- Phase 0: Created 5 new shared infrastructure files + updated base-resource.ts
  - `lib/helpers/error-utils.ts` — shared serializeError() with Pino-compatible output
  - `modules/marketplaces/orders/constants.ts` — OrderStatus, ApiResponseStatus, AUDIT_USER
  - `modules/marketplaces/orders/types.ts` — MarketplaceOrderConfig, FetchOrdersResult, TransformedOrder
  - `modules/marketplaces/orders/base-order-service.ts` — HttpClient factory, execution context, logging helpers
  - `modules/marketplaces/orders/index.ts` — barrel exports
  - `modules/sportdeal/sportdeal-api.types.ts` — verified against prod logs on 92.52.120.222
- Phase 1: Rewrote order fetch service
  - Replaced raw fetch() with HttpClient (auto retry, rate limit, duration logging)
  - Fixed bugs: H2 (VAT distribution), H3 (subtotal calc), Q5 (quantity 0), Q6 (var→const)
  - Fixed data gaps: D2 (customer_order_id as moOrderCustomerId), D3 (order.id as mopProductId), D6 (separate street/house_number)
  - Used shared constants (OrderStatus, AUDIT_USER, getCreatedByLabel)
  - Simplified data utils to just 2 helper functions
- Phase 2: Rewrote status push service
  - Replaced raw fetch() with HttpClient
  - Replaced hardcoded setTimeout(200) with RateLimiter (500ms fixed delay)
  - Used shared error serialization and notification helpers
- Phase 3: Updated routes, config, schemas
  - Added SPORTDEAL_CURRENCY, SPORTDEAL_SHIPPING_METHOD config vars
  - Added SPORTDEAL_ALLOWED_STATUS_FOR_CONFIRMATION (backward compat with typo'd SPORTSDEAL_)
  - Updated Zod schema to match richer FetchOrdersResult type
- All TypeScript type checks pass
- No "Sportsdeal" typos remain, no raw fetch() in sportdeal module

### Remaining (requires deployment)
- Test on staging server with real Sportdeal API
- Create PR to staging branch
- Update Claude skill after PR review
