# eBay Reconciliation Dashboard — Design Spec

**Date:** 2026-07-17
**Status:** Approved design, pending implementation plan
**Owner:** Saurabh
**Related skill:** `.claude/skills/ebay-sync-rules/` (store 94 sync rules — read it before touching quantity logic)

## 1. Problem

The eBay account contains two populations of listings:

1. **Managed** — rows in `marketplace_listings` with `store_id = 94`; price and quantity are pushed by the marketplace-sync cron.
2. **Unmanaged** — listings Simon (the client) created and maintains directly on eBay. We have no record of them.

Nobody can currently answer: what is actually live on eBay, which of it do we control, and does our database agree with eBay? The existing tooling (`ebay reconcile-deleted`, `ebay relist-ended`, `EBAY_OVERSELL_SQL`) is CLI-only and stateless — it fixes specific failure modes but provides no standing visibility.

### Verified baseline (2026-07-17, live production data)

| Ledger | Count |
|---|---|
| `marketplace_listings` rows, store 94 (SKU level) | 116,108 |
| Distinct eBay ItemIDs among those rows | 31,024 |
| Rows by status | 115,178 confirmed / 882 deleted / 38 active / 10 suspended |
| Listings **Active on eBay** (GetMyeBaySelling ActiveList total) | **13,619** |
| Ended-unsold on eBay, last 30 days (UnsoldList) | 1,272 |

Our DB believes ~31k ItemIDs are live; eBay shows ~13.6k active. The overlap, the ~17k gap, and the count of Simon's listings inside the 13.6k are all unknown. Quantifying and continuously monitoring exactly that is the purpose of this dashboard.

## 2. Goals

1. **Managed vs unmanaged** — classify every listing active on eBay as cron-managed or Simon's, by presence of its ItemID in `marketplace_listings` (store 94). No other signal defines "managed".
2. **Listing status visibility** — per listing: our DB status vs eBay's actual state (active / absent-from-active = ended or removed), including false-delete detection.
3. **Total product audit** — a 1:1 ItemID-level and SKU-level diff between `marketplace_listings` and an eBay snapshot, with mismatch categories, drill-down, and export.
4. **Actionable v1** — remediation actions runnable from the dashboard, wrapping the existing battle-tested services, with verify-first guardrails and a full audit trail.

### Non-goals (v1)

- Importing Simon's listings into `marketplace_listings` / bringing them under sync.
- Automatic (unattended) remediation — every mutation is user-initiated.
- Marketplaces other than eBay. Tables carry `store_id` so the pattern can extend later, but all v1 logic is store 94.
- Editing listings (title/price changes) on eBay from the UI.

## 3. Architecture

**Approach:** persisted snapshot + precomputed diff. Each run stores raw eBay listing rows in a snapshot table and writes classified reconciliation results at the end of the run. The dashboard reads only precomputed results — instant server-side DataTables, internally consistent per run, with history for trends. (Read-time diffing was rejected: every page load would re-run a 13.6k × 116k join and results could shift mid-browse. Stateless Redis, as used by order reconciliation, was rejected: incompatible with server-side DataTables and acknowledge/action state.)

**New module:** `apps/api/src/modules/ebay-reconciliation/`

```
ebay-reconciliation/
├── ebay-reconciliation.routes.ts     # HTTP endpoints
├── ebay-reconciliation.service.ts    # orchestration, actions
├── ebay-snapshot.service.ts          # GetMyeBaySelling paging + persistence
├── ebay-classifier.ts                # pure classification logic (unit-tested)
├── ebay-reconciliation.query.ts      # single query builder for DataTable + export
└── ebay-reconciliation.schema.ts     # Zod schemas
```

Reuses:
- `lib/marketplaces/ebay/client.ts` — Trading API + Browse API calls, token handling, retries.
- `modules/ebay/ebay-reconcile.service.ts` (`reconcileEbayFalseDeletes`) — reactivate action.
- `modules/ebay/ebay-relist.service.ts` (`relistEndedEbayListings`) — relist action (already GetItem-verify-first and dedup-by-ItemID).
- `/demos` DataTable components on the frontend.

## 4. Snapshot job

**Trigger paths (same service, same lock):**
- CLI: `pnpm cli ebay snapshot-listings [--dry-run]` — PM2 cron entry in `ecosystem.config.cjs`, daily.
- HTTP: `POST /api/ebay-reconciliation/refresh` — runs in-process, async (fire-and-return-run-id), consistent with the order-reconciliation module's in-process pattern. No BullMQ in v1.

**Run steps:**

1. **Acquire lock** — insert a `jsa_ebay_snapshot_runs` row with `status='running'`. If a `running` row younger than 2 hours exists, refuse (HTTP 409 / CLI exit non-zero). A `running` row older than 2 hours is marked `failed` (stale) and a new run may start.
2. **Sweep ActiveList** — `GetMyeBaySelling` with `ActiveList`, `EntriesPerPage=200` (~69 pages at current volume), `DetailLevel=ReturnAll` so variations are included. GetMyeBaySelling returns variations in bulk (GetSellerList does not — verified; do not switch). Persist one snapshot row per variation for multi-variation listings and one per item for single-SKU listings.
3. **Classify** — run the classifier (section 6) against `marketplace_listings` store 94; write `jsa_ebay_reconciliation_results` rows.
4. **Browse verification (oversell)** — for the oversell-suspect set only (section 6.3), call Browse API `get_item_by_legacy_id` / `get_items_by_item_group`, capped at **200 items per run** (configurable `EBAY_RECON_BROWSE_CAP`). Record buyer-facing `estimatedAvailabilityStatus` and `estimatedAvailableQuantity` on the result rows. Suspects beyond the cap are stored as `oversell_suspect` with `browse_checked = false` and logged (`log()` the dropped count — no silent truncation).
5. **Finalize** — write summary JSON (category counts) to the run row, set `status='completed'`, then purge snapshots + results of runs beyond the **14 most recent completed** runs. Action audit rows are never purged.

**Failure semantics:** any unrecovered API error aborts the run — mark the run `failed` with the error and page number, delete that run's partial snapshot/result rows. The dashboard always serves the latest **completed** run and shows its age prominently. A partial run must never masquerade as a complete snapshot (a half-swept ActiveList would misclassify everything unseen as `managed_ghost`).

**Interpretation guarantee:** store 94 has Out-of-Stock Control ON (verified via `GetUserPreferences`). Hidden qty-0 GTC listings therefore remain in state `Active` and appear in ActiveList. Consequently **absence from ActiveList = genuinely ended/removed**, which is what makes the `managed_ghost` classification sound. If OOS Control is ever turned off, this assumption breaks — the run stores the assumption in its summary and the dashboard footnotes it.

## 5. Data model (MySQL, `ukssmain`)

All tables live in the shared MySQL DB via `schema.mysql.prisma`. SKU columns use the same charset/collation as `marketplace_listings.products_sku` (utf8mb4) so snapshot↔listings joins need no conversion. Joins to `new_products_variations.npv_products_sku` (latin1) must use `CONVERT(... USING latin1)` — see the collation gotcha in the eBay skill.

### `jsa_ebay_snapshot_runs`

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK AI | run id |
| `store_id` | INT | 94 in v1 |
| `trigger_source` | ENUM('cron','manual') | |
| `triggered_by` | VARCHAR(100) NULL | admin email for manual runs |
| `status` | ENUM('running','completed','failed') | doubles as the concurrency lock |
| `started_at` / `finished_at` | DATETIME / NULL | |
| `pages_fetched` | INT | |
| `listings_fetched` / `variations_fetched` | INT | ItemID count / SKU-row count |
| `summary_json` | TEXT NULL | category counts, browse cap stats, OOS-control assumption |
| `error_message` | TEXT NULL | on failure, includes page number |

### `jsa_ebay_listing_snapshots`

One row per (run, ItemID, SKU). `sku` NULL for single-SKU listings without a seller SKU.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK AI | |
| `run_id` | INT FK → runs | |
| `item_id` | VARCHAR(20) | eBay ItemID |
| `sku` | VARCHAR(100) NULL | variation SKU (utf8mb4, matches `products_sku`) |
| `title` | VARCHAR(255) | |
| `is_variation` | TINYINT(1) | |
| `price` | DECIMAL(10,2) | current price |
| `currency` | VARCHAR(3) | |
| `qty_listed` | INT | eBay `Quantity` |
| `qty_sold` | INT | `SellingStatus.QuantitySold` |
| `qty_available` | INT | `qty_listed - qty_sold`, floored at 0 |

Indexes: `(run_id, item_id)`, `(run_id, sku)`.

### `jsa_ebay_reconciliation_results`

One row per classified (ItemID, SKU) pair per run. This is the only table the DataTable queries.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK AI | |
| `run_id` | INT FK → runs | |
| `store_id` | INT | |
| `item_id` | VARCHAR(20) | |
| `sku` | VARCHAR(100) NULL | |
| `category` | ENUM (section 6) | |
| `db_listing_status` | VARCHAR(20) NULL | `marketplace_listings.marketplace_listing_status` |
| `db_last_synced_qty` / `db_last_synced_price` | INT / DECIMAL NULL | |
| `db_error_code` | VARCHAR(20) NULL | `api_last_error_code` (context for false-deletes) |
| `ebay_qty_available` / `ebay_price` | INT / DECIMAL NULL | NULL when absent from snapshot (ghosts) |
| `ebay_title` | VARCHAR(255) NULL | display for unmanaged rows |
| `browse_checked` | TINYINT(1) | oversell rows only |
| `browse_status` | ENUM('IN_STOCK','OUT_OF_STOCK','LIMITED_STOCK') NULL | buyer view |
| `browse_qty` | INT NULL | `estimatedAvailableQuantity` |
| `action_taken` | VARCHAR(30) NULL | last action applied to this row (denormalized from audit log) |
| `action_at` / `action_by` | DATETIME / VARCHAR(100) NULL | |

Indexes: `(run_id, category)`, `(run_id, item_id)`, `(run_id, sku)`.

### `jsa_ebay_reconciliation_actions` (audit log — never purged)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK AI | |
| `run_id` | INT NULL | run the user was viewing |
| `action` | ENUM('reactivate','relist','mark_gone','verify_oversell','refresh') | |
| `item_ids_json` | TEXT | targeted ItemIDs/SKUs |
| `dry_run` | TINYINT(1) | |
| `requested_by` | VARCHAR(100) | admin email from JWT |
| `requested_at` | DATETIME | |
| `outcome_json` | TEXT | per-item outcomes returned by the wrapped service |
| `status` | ENUM('completed','failed') | |

## 6. Classification

Pure function in `ebay-classifier.ts`: inputs are the snapshot rows for the run and the store-94 `marketplace_listings` rows; output is result rows. Match at **ItemID level first** (`marketplace_listings.marketplace_item_identifier`, indexed), then SKU level within matched ItemIDs. Snapshot rows with `sku = NULL` (single-SKU listings without a seller SKU) match at ItemID level only — SKU-level categories (4–7) require a non-NULL SKU on both sides; a NULL-SKU eBay item whose ItemID matches exactly one DB row is compared against that row, otherwise it is reported as `unmatched_sku`.

### 6.1 Categories (first match wins, evaluated per ItemID/SKU)

| # | Category | Condition |
|---|---|---|
| 1 | `unmanaged` | ItemID in snapshot, **no** `marketplace_listings` row with that `marketplace_item_identifier` (store 94). One result row per ItemID (SKU detail kept in snapshot table). Simon's listings. |
| 2 | `status_mismatch` | ItemID in snapshot **and** all DB rows for it are `deleted`/`suspended`. False-delete candidates (the `21916750` class — see skill: verify before acting). |
| 3 | `managed_ghost` | DB rows `active`/`confirmed` but ItemID **absent** from snapshot. Sound because OOS Control keeps hidden listings Active (section 4). Expected ~17k on first run. |
| 4 | `unmatched_sku` | ItemID matched, but the SKU exists on only one side (eBay variation with no DB row, or DB row whose SKU is missing from the eBay listing). |
| 5 | `oversell_suspect` | SKU matched, buyable on eBay (`qty_available > 0` — or Browse says IN_STOCK), while the **rule-derived target qty is 0** (same arms as `EBAY_OVERSELL_SQL`: soft-deleted variant, always-in-stock, no `fc_product_id`, non-bestseller, or `npv_quantities <= 0`; T-shirts `virtual_product_type_id = 4` excluded). This is the sell-what-we-can't-ship class. |
| 6 | `qty_mismatch` | SKU matched, **buyability disagrees**: `db_last_synced_qty > 0 XOR ebay_qty_available > 0`. Deliberately NOT raw inequality — sales between sync runs legitimately drop eBay's available count below `last_synced_quantity`; flagging that would be permanent noise. Exact values are shown as columns for every row regardless. |
| 7 | `price_mismatch` | SKU matched, `ABS(db_last_synced_price − ebay_price) > 0.01`, and neither side NULL. |
| 8 | `managed_ok` | Everything else that matched. |

### 6.2 Rule-parity requirement

Category 5 duplicates the quantity-target arms from `marketplace-sync.query.ts` (`ebayQuantityArms`) / `EBAY_OVERSELL_SQL`. These conditions **must stay mirror-identical** with the sync's arms — same discipline as the SELECT/WHERE re-pick invariant. The implementation must reference/share the existing SQL fragments rather than re-typing them, and a unit test must assert the classifier's arms match a fixture of the sync's rules.

### 6.3 Browse verification set

Suspects = category 5 rows plus category 6 rows where DB says 0 but eBay shows buyable. Browse (buyer view) is authoritative for "can a customer check out" — under OOS Control, a listing that is seller-side 0 can still be buyer-facing IN_STOCK (verified live on item 157464453533), and our sync is structurally incapable of clearing that with another zero-revise (`21917092` redundant). Rows Browse-confirmed IN_STOCK with UK stock 0 are the highest-severity finding on the dashboard.

## 7. API

All under `/api/ebay-reconciliation`. Read endpoints require `reports:view`; action endpoints require a new permission **`marketplace-sync:reconcile`** (seeded for Super Admin/Admin roles).

| Method & path | Purpose |
|---|---|
| `GET /summary` | Latest completed run: category counts, run age, trend vs previous runs (from `summary_json` history), OOS-control assumption note. |
| `GET /runs` | Run history (paginated). |
| `GET /items` | **Single server-side DataTable query builder** over `jsa_ebay_reconciliation_results` for the latest completed run: pagination, sorting, filters (category, search by ItemID/SKU/title, browse status, action state). |
| `GET /items/export` | Streaming CSV, **same query builder** as `/items` with the same filters (datatable-standards: one builder for display and export; download starts immediately). |
| `POST /refresh` | Trigger snapshot run. 409 if one is running. Returns run id; UI polls `GET /runs`. |
| `POST /actions/reactivate` | Body: `{ itemIds, dryRun }`. Wraps `reconcileEbayFalseDeletes` scoped to the given ItemIDs (service gains an optional itemIds filter). For `status_mismatch` rows. |
| `POST /actions/relist` | Body: `{ itemIds, dryRun }`. Wraps `relistEndedEbayListings` with `--item-ids` semantics — GetItem-verifies each ItemID first; active→reactivate, ended-with-stock→relist, gone→mark gone. For `managed_ghost` rows with stock. |
| `POST /actions/mark-gone` | Body: `{ itemIds, dryRun }`. **DB-only**: set the rows' `marketplace_listing_status='deleted'` (keeping error context) so the sync stops considering confirmed-dead ghosts. Never calls eBay. |
| `POST /actions/verify-oversell` | Body: `{ itemIds }`. Targeted Browse re-check; updates `browse_*` on result rows. Read-only against eBay. |

**Action semantics (uniform):**
- Zod-validated; `itemIds` capped at 500 per request.
- `dryRun: true` is the default and returns the per-item plan without mutating anything; the UI always shows this preview before offering the live run.
- Every invocation (dry or live) writes a `jsa_ebay_reconciliation_actions` row; live outcomes update `action_taken/at/by` on the result rows.
- Actions never bypass the wrapped services' guardrails — specifically, relist/reactivate keep their GetItem verify-first behavior (blind relists create duplicate listings; blind deletes on `21916750` kill live listings).

## 8. Frontend

New page `apps/web/src/pages/reports/EbayReconciliation.tsx`, route `/reports/ebay-reconciliation`, nav entry beside Marketplace Sync Performance. Gated on `reports:view`; action buttons render only with `marketplace-sync:reconcile`.

Layout:
1. **Header** — snapshot age badge (amber > 24h, red > 48h or last run failed), Refresh-now button (disabled while a run is in flight, with progress from `GET /runs` polling).
2. **Summary cards** — Active on eBay / Managed / Unmanaged (Simon) / Ghosts / Status mismatches / Oversell (Browse-confirmed vs unchecked shown separately). Each card filters the table on click.
3. **Reconciliation DataTable** — server-side (reuse `/demos` DataTable): ItemID (linked to ebay.co.uk item page), SKU, title, category badge, DB status, DB qty ↔ eBay qty, DB price ↔ eBay price, browse status, last action. Row checkboxes for bulk actions per category. CSV export button (streams from `/items/export`).
4. **Actions** — per-category bulk buttons (reactivate / relist / mark gone / verify oversell). Every action opens a confirmation dialog that first displays the **dry-run preview** returned by the API; the live run is a second explicit confirm.
5. **Run history panel** — last 14 runs with counts, trigger source, duration, failures.

Data fetching via TanStack Query hooks (`useEbayReconciliationSummary`, `useEbayReconciliationItems`, mutation hooks per action), matching `useMarketplaceSyncPerformance` conventions.

## 9. Error handling

- **Snapshot failures** — run marked `failed`, partial rows deleted, dashboard serves last completed run with staleness warning. Cron failure surfaces on next dashboard view (failed-run banner) — no silent staleness.
- **Token/rate limits** — inherited from `lib/marketplaces/ebay/client.ts` retry handling; unrecoverable errors abort the run.
- **Concurrent triggers** — run-row lock; manual trigger during cron run returns 409 with the running run's id.
- **Action partial failures** — wrapped services already return per-item outcomes; the API surfaces them verbatim, marks the audit row `completed` (with per-item failures in `outcome_json`) or `failed` (nothing attempted).

## 10. Testing

- **Classifier unit tests** (`ebay-classifier.test.ts`, style of `ebay-relist.service.test.ts`): fixture DB rows × fixture snapshot rows → expected categories. Cases: unmanaged item, ghost, false-delete, variation SKU on one side only, oversell arms (each of the five rules + T-shirt exemption), qty buyability XOR (including the sold-between-syncs non-flag), price tolerance, precedence order.
- **Rule-parity test** — asserts classifier oversell conditions equal the sync arms fixture (guards section 6.2).
- **Snapshot service test** — mocked multi-page GetMyeBaySelling responses (variation + non-variation items) → correct snapshot rows; abort-on-page-error deletes partial rows.
- **Route tests** — permissions (reports:view vs marketplace-sync:reconcile), 409 lock, dry-run default, itemIds cap.
- **CLI dry-run** — `pnpm cli ebay snapshot-listings --dry-run` prints classification counts without writing; used for the first production validation before the tables go live.

## 11. Rollout

1. Migrate tables (`DATABASE_PROVIDER=mysql pnpm db:push` staging → prod window).
2. Run CLI snapshot manually on staging (shared DB — counts should match the verified baseline above).
3. First production run + eyeball: does managed-on-eBay + unmanaged ≈ 13,619? Do ghosts ≈ the 31k − overlap gap? Spot-check 5 unmanaged ItemIDs with Simon to confirm they're his.
4. Enable daily PM2 cron; ship dashboard read-only endpoints first if the deploy is split, actions second.
5. Seed `marketplace-sync:reconcile` for admin roles.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| OOS Control gets turned off → ghost classification unsound | Assumption recorded per-run; dashboard footnote; (optionally later: GetUserPreferences check at run start) |
| Classifier arms drift from sync arms | Shared SQL fragments + rule-parity unit test (section 6.2) |
| Actions on stale snapshot rows | Wrapped services re-verify against live eBay (GetItem) before mutating; mark-gone is DB-only and reversible by the next reconcile run |
| First run floods dashboard with ~17k ghosts | Category filter defaults; bulk mark-gone (after relist-candidate check) is the designed cleanup path |
| Browse cap leaves suspects unchecked | `browse_checked=false` rows visibly counted as "unchecked", never reported as safe; targeted verify action available |
