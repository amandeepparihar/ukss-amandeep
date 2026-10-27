# TODO: Orders Listing Page — finish search/filter parity

**Branch:** `feature/orders-listing-finish` (from `main`)
**Slice:** Phase 0 of the orders.php full-cutover migration roadmap.
**Plan (working copy):** `/tmp/2026-06-21-orders-listing-finish-plan.md` (not committed here per IP rule).
**Design (working copy):** `/tmp/2026-06-21-orders-listing-finish-design.md`

## Why
Parity audit found the listing page ~65% migrated. Backend query-builder + schema already
support every filter; only the React UI and URL-state plumbing are missing.

**PR:** #1038 (draft → main). Reviewed by Opus (REWORK → fixes applied → re-verified).

## Tasks
- [x] 1. Backend `GET /api/orders/filter-options` — returns size-type options only (783 rows, scoped `LIKE '%Size%'`)
- [x] 2. Extend `FilterState` + `OrdersPage` URL parse/sync (survive reload)
- [x] 3. Three search inputs: Toffs code, FS barcode, Product name/model (`ID:` prefix)
- [x] 4. `useOrderFilterOptions` hook + conditional Size dropdown (auto-clears when product filter clears)
- [x] 5. Filter-Products **cascade** popup (category→product→size) — built per operator request; faithful to legacy `aja_cat_updateproducts`/`aja_product_updatesize`; Apply matches legacy 3 modes (`orders_listing.php:909-917`)
- [x] 6. Comparison E2E — real staging fixtures wired (toffs `TOFFS7000`, fsb `5030260213044`, product `484783`, cascade cat `3`→prod `178`→size `2644`); confirmed zenc params
- [x] (review R1) tab-count fan-out fixed; all-783 size dropdown removed; dead `supplier` plumbing removed
- [x] (review R2) CRITICAL latent SQL bug fixed: `popupCategoryId` ptc join was emitted before the `op` join → 500; deferred until after `op`. Blank-name guard + schema `.positive()`

## H1 — RESOLVED
Earlier "category has no legacy equivalent" was WRONG. `orders_listing.php:909-917` supports product-only / category-only / both. Cascade now implements all faithfully.

## Remaining gates before PR ready-for-review (operator, on staging)
- Run `pnpm test:e2e e2e/comparison/09-listing-filters.spec.ts` (targets remote/staging)
- Confirm category-count semantic: legacy GROUPs by (order,product), Stock2 = COUNT(DISTINCT order). If distinct-orders is desired, convert the log-only category check to a hard assertion.
- Manual cross-check cascade + each filter vs legacy SMS (shared-DB rule)

## Out of scope (deferred to owning phases)
- Listing toolbar buttons (Suppliers→Ph2, Order Processing→Ph4, Add Wholesale→own feature)
- Right-panel action buttons (Buy From Retailer, processing actions, FC display)

## Verification gates
- `pnpm lint` + `pnpm build` clean
- Comparison E2E green (counts match legacy)
- Every filter survives page reload (URL state)
- Draft PR to `main` only — operator merges (auto-deploys to prod)
