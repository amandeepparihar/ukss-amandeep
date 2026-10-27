# eBay Reconciliation Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the eBay reconciliation dashboard specced in `docs/superpowers/specs/2026-07-17-ebay-reconciliation-dashboard-design.md`: a daily snapshot of everything active on eBay, a precomputed diff against `marketplace_listings` (store 94), and an actionable UI (reactivate / relist / mark-gone / verify-oversell).

**Architecture:** New module `apps/api/src/modules/ebay-reconciliation/` + 4 new MySQL tables (`jsa_ebay_*`). A CLI/cron snapshot job sweeps `GetMyeBaySelling` ActiveList (variations included), classifies every (ItemID, SKU) pair with a pure classifier, Browse-verifies oversell suspects (capped), and persists results. Fastify routes serve a server-side DataTable + actions that wrap the existing verify-first services. React page under `/reports/ebay-reconciliation`.

**Tech Stack:** Fastify + Prisma (MySQL `schema.mysql.prisma`) + `ebay-api@9.4.0` SDK + Zod; React 18 + TanStack Query + `@/components/data-table`; vitest for tests.

## Global Constraints

- **Server-side DataTables only** — pagination/sorting/filtering computed in SQL; a single query builder powers both `/items` and `/items/export`.
- **All new tables use the `jsa_` prefix** (repo convention for Stock2-owned tables) and live in `apps/api/prisma/schema.mysql.prisma`.
- **Verify DB columns before raw SQL** — every `$queryRawUnsafe` column in this plan was verified against live `ukssmain` on 2026-07-17; if you deviate, re-verify via `INFORMATION_SCHEMA.COLUMNS`.
- **Collation:** `marketplace_listings.products_sku` is utf8mb4; `new_products_variations.npv_products_sku` is latin1 — ad-hoc joins between them MUST use `CONVERT(ml.products_sku USING latin1)`.
- **Do not edit the sync quantity arms** in `marketplace-sync.query.ts` (`ebayQuantityArms`, the SELECT/WHERE re-pick invariant). This plan only *reads* those builders and adds an optional candidates filter to `buildEbayRelistCandidatesQuery`.
- **Zod-validate every API input.** Route responses are wrapped `{ data: ... }` (repo convention).
- **Actions default to `dryRun: true`**; live mutations only on explicit `dryRun: false`.
- **Oversell truth = Browse API (buyer view), never GetItem/GetMyeBaySelling** (seller view) — per `.claude/skills/ebay-sync-rules/`.
- **eBay = `store_id 94`** (`config.EBAY_STORE_ID`); Out-of-Stock Control is ON, so hidden qty-0 listings stay in ActiveList — absence from ActiveList = genuinely ended.
- Store-94 scale (verified 2026-07-17): 116,108 SKU rows / 31,024 distinct ItemIDs in DB; 13,619 active listings on eBay (~69 pages at 200/page). Expect ~17k `managed_ghost` rows on the first run — that is correct behavior, not a bug.
- Test runner: `pnpm --filter @admin/api test` (vitest). Build: `pnpm build`. Lint: `pnpm lint`.
- Commit after every task; commit **only** the files listed in the task (the repo may carry unrelated in-flight changes).

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Create the feature branch from latest origin/main**

```bash
git fetch origin
git checkout -b feature/ebay-reconciliation-dashboard origin/main
```

If the working tree is dirty with unrelated changes (`git status` shows modified `apps/api/src/config/index.ts`, `apps/api/src/modules/reports/*`, `apps/web/src/pages/reports/MarketplaceSyncPerformance.tsx`, untracked `apps/api/src/modules/shopify-products-listing/`), prefer an isolated worktree (superpowers:using-git-worktrees) so those files stay untouched:

```bash
git worktree add ../ukss-recon-worktree -b feature/ebay-reconciliation-dashboard origin/main
cd ../ukss-recon-worktree && pnpm install
```

- [ ] **Step 2: Verify baseline is green**

Run: `pnpm --filter @admin/api test`
Expected: existing suite passes (e.g. `ebay-relist.service.test.ts` green).

---

### Task 1: Prisma models + shared types

**Files:**
- Modify: `apps/api/prisma/schema.mysql.prisma` (append after the `MarketplaceSyncStatus` enum block, ~line 1680)
- Create: `packages/shared/src/types/ebay-reconciliation.ts`
- Modify: `packages/shared/src/types/index.ts` (add one re-export line)

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `EbaySnapshotRun`, `EbayListingSnapshot`, `EbayReconciliationResult`, `EbayReconciliationAction`; enums `EbaySnapshotTrigger`, `EbaySnapshotRunStatus`, `EbayReconCategory`, `EbayReconActionStatus`. Shared types `EbayReconCategory` (string union), `EBAY_RECON_CATEGORIES`, `EbayReconRunSummary`, `EbayReconSummaryResponse`, `EbayReconItem`, `EbayReconItemsResponse`, `EbayReconActionOutcome`, `EbayReconActionResponse` — imported everywhere as `@admin/shared`.

**Deviation from spec §5 (deliberate):** child-table PKs are `Int` (AI, max ~2.1B), not `BIGINT` — Prisma returns `BigInt` for BIGINT columns, which breaks `JSON.stringify` in route responses. At ~130k result rows/run × 14 retained runs (purged), Int headroom is ample.

- [ ] **Step 1: Add the four models + enums to `schema.mysql.prisma`**

```prisma
// ============================================
// eBay Reconciliation Dashboard
// Spec: docs/superpowers/specs/2026-07-17-ebay-reconciliation-dashboard-design.md
// ============================================

// One row per snapshot run. The `running` status row doubles as the concurrency lock.
model EbaySnapshotRun {
  id                Int                   @id @default(autoincrement())
  storeId           Int                   @map("store_id")
  triggerSource     EbaySnapshotTrigger   @map("trigger_source")
  triggeredBy       String?               @map("triggered_by") @db.VarChar(100)
  status            EbaySnapshotRunStatus @default(running)
  startedAt         DateTime              @default(now()) @map("started_at")
  finishedAt        DateTime?             @map("finished_at")
  pagesFetched      Int                   @default(0) @map("pages_fetched")
  listingsFetched   Int                   @default(0) @map("listings_fetched")
  variationsFetched Int                   @default(0) @map("variations_fetched")
  summaryJson       String?               @map("summary_json") @db.Text
  errorMessage      String?               @map("error_message") @db.Text

  @@index([storeId, status], name: "idx_recon_run_store_status")
  @@index([storeId, startedAt], name: "idx_recon_run_store_started")
  @@map("jsa_ebay_snapshot_runs")
}

enum EbaySnapshotTrigger {
  cron
  manual
}

enum EbaySnapshotRunStatus {
  running
  completed
  failed
}

// Raw eBay state: one row per (run, ItemID, variation SKU); sku NULL for
// single-SKU listings without a seller SKU. utf8mb4 sku matches products_sku.
model EbayListingSnapshot {
  id           Int      @id @default(autoincrement())
  runId        Int      @map("run_id")
  itemId       String   @map("item_id") @db.VarChar(20)
  sku          String?  @db.VarChar(100)
  title        String   @db.VarChar(255)
  isVariation  Boolean  @default(false) @map("is_variation")
  price        Decimal? @db.Decimal(10, 2)
  currency     String?  @db.VarChar(3)
  qtyListed    Int      @default(0) @map("qty_listed")
  qtySold      Int      @default(0) @map("qty_sold")
  qtyAvailable Int      @default(0) @map("qty_available")

  @@index([runId, itemId], name: "idx_recon_snap_run_item")
  @@index([runId, sku], name: "idx_recon_snap_run_sku")
  @@map("jsa_ebay_listing_snapshots")
}

// Precomputed diff: one row per classified (ItemID, SKU) pair per run.
// The ONLY table the dashboard DataTable queries.
model EbayReconciliationResult {
  id                Int                @id @default(autoincrement())
  runId             Int                @map("run_id")
  storeId           Int                @map("store_id")
  itemId            String             @map("item_id") @db.VarChar(20)
  sku               String?            @db.VarChar(100)
  category          EbayReconCategory
  dbListingStatus   String?            @map("db_listing_status") @db.VarChar(20)
  dbLastSyncedQty   Int?               @map("db_last_synced_qty")
  dbLastSyncedPrice Decimal?           @map("db_last_synced_price") @db.Decimal(13, 2)
  dbErrorCode       String?            @map("db_error_code") @db.VarChar(50)
  ebayQtyAvailable  Int?               @map("ebay_qty_available")
  ebayPrice         Decimal?           @map("ebay_price") @db.Decimal(10, 2)
  ebayTitle         String?            @map("ebay_title") @db.VarChar(255)
  browseChecked     Boolean            @default(false) @map("browse_checked")
  browseStatus      String?            @map("browse_status") @db.VarChar(20)
  browseQty         Int?               @map("browse_qty")
  actionTaken       String?            @map("action_taken") @db.VarChar(30)
  actionAt          DateTime?          @map("action_at")
  actionBy          String?            @map("action_by") @db.VarChar(100)

  @@index([runId, category], name: "idx_recon_res_run_category")
  @@index([runId, itemId], name: "idx_recon_res_run_item")
  @@index([runId, sku], name: "idx_recon_res_run_sku")
  @@map("jsa_ebay_reconciliation_results")
}

enum EbayReconCategory {
  unmanaged
  status_mismatch
  managed_ghost
  unmatched_sku
  oversell_suspect
  qty_mismatch
  price_mismatch
  managed_ok
}

// Audit log of every UI/CLI-triggered reconciliation action. NEVER purged.
model EbayReconciliationAction {
  id          Int                       @id @default(autoincrement())
  runId       Int?                      @map("run_id")
  action      String                    @db.VarChar(30)
  itemIdsJson String                    @map("item_ids_json") @db.Text
  dryRun      Boolean                   @map("dry_run")
  requestedBy String                    @map("requested_by") @db.VarChar(100)
  requestedAt DateTime                  @default(now()) @map("requested_at")
  outcomeJson String?                   @map("outcome_json") @db.Text
  status      EbayReconActionStatus
  @@index([requestedAt], name: "idx_recon_action_requested")
  @@map("jsa_ebay_reconciliation_actions")
}

enum EbayReconActionStatus {
  completed
  failed
}
```

- [ ] **Step 2: Validate and push the schema**

Run: `DATABASE_PROVIDER=mysql npx prisma validate --schema apps/api/prisma/schema.mysql.prisma`
Expected: `The schema ... is valid`.

Run (against the dev/staging MySQL in `.env`): `DATABASE_PROVIDER=mysql pnpm db:push`
Expected: `Your database is now in sync with your Prisma schema` and the four `jsa_ebay_*` tables created. Verify:

```bash
mysql ... -e "SHOW TABLES LIKE 'jsa_ebay%';"
```

Expected: 4 tables.

- [ ] **Step 3: Create `packages/shared/src/types/ebay-reconciliation.ts`**

```typescript
/**
 * eBay Reconciliation Dashboard — shared API contract types.
 * Spec: docs/superpowers/specs/2026-07-17-ebay-reconciliation-dashboard-design.md
 */

export const EBAY_RECON_CATEGORIES = [
  'unmanaged',
  'status_mismatch',
  'managed_ghost',
  'unmatched_sku',
  'oversell_suspect',
  'qty_mismatch',
  'price_mismatch',
  'managed_ok',
] as const;

export type EbayReconCategory = (typeof EBAY_RECON_CATEGORIES)[number];

export interface EbayReconRunSummary {
  runId: number;
  status: 'running' | 'completed' | 'failed';
  triggerSource: 'cron' | 'manual';
  triggeredBy: string | null;
  startedAt: string;            // ISO
  finishedAt: string | null;    // ISO
  pagesFetched: number;
  listingsFetched: number;      // distinct ItemIDs on eBay
  variationsFetched: number;    // snapshot SKU-level rows
  errorMessage: string | null;
  categoryCounts: Partial<Record<EbayReconCategory, number>>;
  browseChecked: number;
  browseUnchecked: number;      // suspects beyond the per-run Browse cap
  oosControlAssumed: boolean;   // ghost classification soundness assumption
}

export interface EbayReconSummaryResponse {
  latestRun: EbayReconRunSummary | null;   // latest COMPLETED run
  runningRun: EbayReconRunSummary | null;  // in-flight run, if any
  previousRuns: EbayReconRunSummary[];     // most recent first, excludes latestRun
}

export interface EbayReconItem {
  id: number;
  runId: number;
  itemId: string;
  sku: string | null;
  category: EbayReconCategory;
  dbListingStatus: string | null;
  dbLastSyncedQty: number | null;
  dbLastSyncedPrice: number | null;
  dbErrorCode: string | null;
  ebayQtyAvailable: number | null;
  ebayPrice: number | null;
  ebayTitle: string | null;
  browseChecked: boolean;
  browseStatus: string | null;   // IN_STOCK / OUT_OF_STOCK / LIMITED_STOCK
  browseQty: number | null;
  actionTaken: string | null;
  actionAt: string | null;       // ISO
  actionBy: string | null;
}

export interface EbayReconItemsResponse {
  runId: number;
  rows: EbayReconItem[];
  total: number;
  page: number;
  totalPages: number;
}

export type EbayReconActionName = 'reactivate' | 'relist' | 'mark_gone' | 'verify_oversell';

export interface EbayReconActionOutcome {
  itemId: string;
  action: string;    // e.g. 'reactivate', 'relist', 'not-active:ended', 'marked-gone', 'IN_STOCK'
  rows?: number;     // marketplace_listings rows affected
  newItemId?: string;
  detail?: string;
}

export interface EbayReconActionResponse {
  action: EbayReconActionName;
  dryRun: boolean;
  requested: number;
  outcomes: EbayReconActionOutcome[];
}
```

- [ ] **Step 4: Re-export from `packages/shared/src/types/index.ts`**

Add one line alongside the existing re-exports (e.g. next to `export * from './sales-dashboard';`):

```typescript
export * from './ebay-reconciliation';
```

- [ ] **Step 5: Typecheck the workspace**

Run: `pnpm --filter @admin/shared build && pnpm --filter @admin/api exec tsc --noEmit -p tsconfig.json`
Expected: no errors; `@admin/shared` now exports the new types.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.mysql.prisma packages/shared/src/types/ebay-reconciliation.ts packages/shared/src/types/index.ts
git commit -m "feat(ebay-recon): add jsa_ebay_* reconciliation tables and shared API types"
```

---

### Task 2: Rule-target-zero constant + parity test

The oversell classification must mirror the sync's quantity arms (spec §6.2). Source of truth: `buildListingsNeedingSyncQuery` / `buildEbayRelistCandidatesQuery` in `apps/api/src/modules/marketplace-sync/marketplace-sync.query.ts`. We define our own SQL fragment and pin it to the sync builders with a parity test — if anyone changes the sync arms, this test fails and forces the reconciliation fragment to be updated too.

**Files:**
- Create: `apps/api/src/modules/ebay-reconciliation/ebay-rule-target.ts`
- Test: `apps/api/src/modules/ebay-reconciliation/ebay-rule-target.test.ts`

**Interfaces:**
- Consumes: `buildListingsNeedingSyncQuery(bestsellersOnly: boolean): string`, `buildEbayRelistCandidatesQuery(): string` from `../marketplace-sync/marketplace-sync.query`.
- Produces: `EBAY_RULE_TARGET_ZERO_SELECT: string` — a SQL boolean expression (aliased later as `rule_target_zero`) valid in a query that joins `marketplace_listings ml`, `new_products_variations npv` (LEFT), `new_products np` (LEFT). Used by Task 5's `getDbListingRows`.

- [ ] **Step 1: Write the failing parity test**

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-rule-target.test.ts
/**
 * Rule-parity guard (spec §6.2): the reconciliation "target quantity is 0"
 * conditions must mirror the eBay sync quantity arms. If the sync arms change,
 * this test MUST break so both places are updated together.
 */
import { describe, it, expect } from 'vitest';
import {
  buildListingsNeedingSyncQuery,
  buildEbayRelistCandidatesQuery,
} from '../marketplace-sync/marketplace-sync.query';
import { EBAY_RULE_TARGET_ZERO_SELECT } from './ebay-rule-target';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('EBAY_RULE_TARGET_ZERO_SELECT parity with sync arms', () => {
  const syncSql = norm(buildListingsNeedingSyncQuery(true));
  const relistSql = norm(buildEbayRelistCandidatesQuery());
  const ours = norm(EBAY_RULE_TARGET_ZERO_SELECT);

  // Each sync arm the reconciliation fragment must reproduce.
  it('covers the soft-deleted variant arm', () => {
    expect(syncSql).toContain("npv.npv_delete_status = '1'");
    expect(ours).toContain("npv.npv_delete_status = '1'");
  });

  it('covers the always-in-stock arm (npv source of truth, NOT products_barcodes)', () => {
    expect(syncSql).toContain("npv.npv_always_in_stock = 'Yes'");
    expect(ours).toContain("npv.npv_always_in_stock = 'Yes'");
    expect(ours).not.toContain('products_barcodes');
  });

  it('covers the no-FC-product arm', () => {
    expect(syncSql).toContain('npv.fc_product_id IS NULL OR npv.fc_product_id = 0');
    expect(ours).toContain('npv.fc_product_id IS NULL OR npv.fc_product_id = 0');
  });

  it('covers the non-bestseller arm (sync uses the bestsellers join; we test the same predicate)', () => {
    // The sync builders express "non-bestseller" via a join on
    // new_products.np_best_seller_lifetime > 0; our flat expression uses the
    // equivalent NULL/<=0 predicate directly.
    expect(syncSql).toContain('np_best_seller_lifetime > 0');
    expect(relistSql).toContain('np_best_seller_lifetime > 0');
    expect(ours).toContain('np.np_best_seller_lifetime IS NULL OR np.np_best_seller_lifetime <= 0');
  });

  it('exempts T-shirts (virtual_product_type_id = 4) exactly like the sync', () => {
    expect(syncSql).toContain('np.virtual_product_type_id = 4');
    expect(ours).toContain('np.virtual_product_type_id');
    expect(ours).toContain('<> 4');
  });

  it('covers the sold-out arm', () => {
    expect(ours).toContain('npv.npv_quantities <= 0');
  });

  it('treats a missing npv row as target-zero (cannot verify stock => do not sell)', () => {
    expect(ours).toContain('npv.npv_products_sku IS NULL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-rule-target.test.ts`
Expected: FAIL — `Cannot find module './ebay-rule-target'`.

- [ ] **Step 3: Write `ebay-rule-target.ts`**

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-rule-target.ts
/**
 * SQL boolean expression: "the eBay sync's rule-derived target quantity for this
 * SKU is 0" — i.e. the listing should NOT be advertising stock.
 *
 * MUST mirror the quantity arms in marketplace-sync.query.ts (ebayQuantityArms)
 * and the EBAY_OVERSELL_SQL conditions in reports/marketplace-sync.query.ts.
 * Parity is enforced by ebay-rule-target.test.ts — if that test fails, update
 * this fragment and the test TOGETHER with the sync arms, never independently.
 *
 * Valid inside a query with these aliases:
 *   marketplace_listings ml
 *   LEFT JOIN new_products_variations npv ON npv.npv_products_sku = CONVERT(ml.products_sku USING latin1)
 *   LEFT JOIN new_products np ON np.products_id = ml.products_id
 *
 * LEFT joins (unlike EBAY_OVERSELL_SQL's INNER) so managed rows with no npv
 * match still classify; a missing npv row means we cannot verify stock, which
 * for selling purposes is target-zero.
 *
 * T-shirts (virtual_product_type_id = 4) are print-on-demand and legitimately
 * stay at qty 1 — never target-zero (matches sync arm #3 evaluated first).
 */
export const EBAY_RULE_TARGET_ZERO_SELECT = `
  (
    (np.virtual_product_type_id IS NULL OR np.virtual_product_type_id <> 4)
    AND (
      npv.npv_products_sku IS NULL
      OR npv.npv_delete_status = '1'
      OR npv.npv_always_in_stock = 'Yes'
      OR npv.fc_product_id IS NULL OR npv.fc_product_id = 0
      OR np.np_best_seller_lifetime IS NULL OR np.np_best_seller_lifetime <= 0
      OR npv.npv_quantities <= 0
    )
  )
`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-rule-target.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ebay-reconciliation/ebay-rule-target.ts apps/api/src/modules/ebay-reconciliation/ebay-rule-target.test.ts
git commit -m "feat(ebay-recon): rule-target-zero SQL fragment with sync-arm parity test"
```

---

### Task 3: Pure classifier

**Files:**
- Create: `apps/api/src/modules/ebay-reconciliation/ebay-classifier.ts`
- Test: `apps/api/src/modules/ebay-reconciliation/ebay-classifier.test.ts`

**Interfaces:**
- Consumes: `EbayReconCategory` from `@admin/shared` (Task 1).
- Produces (used by Tasks 5/6):

```typescript
export interface ClassifierSnapshotRow {
  itemId: string; sku: string | null; title: string; isVariation: boolean;
  price: number | null; currency: string | null;
  qtyListed: number; qtySold: number; qtyAvailable: number;
}
export interface ClassifierDbRow {
  itemId: string; sku: string | null; listingStatus: string;
  lastSyncedQty: number | null; lastSyncedPrice: number | null;
  errorCode: string | null; ruleTargetZero: boolean;
}
export interface ClassifiedResult {
  itemId: string; sku: string | null; category: EbayReconCategory;
  dbListingStatus: string | null; dbLastSyncedQty: number | null;
  dbLastSyncedPrice: number | null; dbErrorCode: string | null;
  ebayQtyAvailable: number | null; ebayPrice: number | null; ebayTitle: string | null;
}
export function classifyListings(snapshot: ClassifierSnapshotRow[], db: ClassifierDbRow[]): ClassifiedResult[]
```

- [ ] **Step 1: Write the failing tests** (all spec §6.1/§10 cases)

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-classifier.test.ts
import { describe, it, expect } from 'vitest';
import {
  classifyListings,
  type ClassifierSnapshotRow,
  type ClassifierDbRow,
} from './ebay-classifier';

const snap = (o: Partial<ClassifierSnapshotRow> = {}): ClassifierSnapshotRow => ({
  itemId: '111', sku: 'SKU-A', title: 'Test shirt', isVariation: true,
  price: 19.99, currency: 'GBP', qtyListed: 1, qtySold: 0, qtyAvailable: 1, ...o,
});
const db = (o: Partial<ClassifierDbRow> = {}): ClassifierDbRow => ({
  itemId: '111', sku: 'SKU-A', listingStatus: 'confirmed',
  lastSyncedQty: 1, lastSyncedPrice: 19.99, errorCode: null, ruleTargetZero: false, ...o,
});
const only = (rows: ReturnType<typeof classifyListings>, cat: string) =>
  rows.filter((r) => r.category === cat);

describe('classifyListings', () => {
  it('flags eBay items with no DB row as unmanaged (one row per ItemID, eBay qty summed)', () => {
    const r = classifyListings(
      [snap({ itemId: '999', sku: 'S1', qtyAvailable: 1 }), snap({ itemId: '999', sku: 'S2', qtyAvailable: 2 })],
      [],
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ itemId: '999', sku: null, category: 'unmanaged', ebayQtyAvailable: 3, ebayTitle: 'Test shirt' });
    expect(r[0].dbListingStatus).toBeNull();
  });

  it('flags DB live rows absent from eBay as managed_ghost (one row per DB SKU row)', () => {
    const r = classifyListings([], [db({ sku: 'A' }), db({ sku: 'B', listingStatus: 'active' })]);
    expect(only(r, 'managed_ghost')).toHaveLength(2);
    expect(r[0].ebayQtyAvailable).toBeNull();
  });

  it('treats DB deleted/suspended rows absent from eBay as managed_ok (agreement)', () => {
    const r = classifyListings([], [db({ listingStatus: 'deleted' }), db({ listingStatus: 'suspended', sku: 'B' })]);
    expect(only(r, 'managed_ok')).toHaveLength(2);
  });

  it('flags status_mismatch when ALL DB rows for a live eBay item are deleted/suspended', () => {
    const r = classifyListings(
      [snap()],
      [db({ listingStatus: 'deleted', errorCode: '21916750' }), db({ sku: 'B', listingStatus: 'suspended' })],
    );
    expect(only(r, 'status_mismatch')).toHaveLength(2);
    expect(r[0].dbErrorCode).toBe('21916750');
  });

  it('flags a deleted DB SKU whose sibling is live as per-SKU status_mismatch, not item-level', () => {
    const r = classifyListings(
      [snap({ sku: 'A' }), snap({ sku: 'B' })],
      [db({ sku: 'A', listingStatus: 'deleted' }), db({ sku: 'B' })],
    );
    expect(only(r, 'status_mismatch').map((x) => x.sku)).toEqual(['A']);
    expect(only(r, 'managed_ok').map((x) => x.sku)).toEqual(['B']);
  });

  it('flags SKUs present on only one side as unmatched_sku', () => {
    const r = classifyListings(
      [snap({ sku: 'EBAY-ONLY' }), snap({ sku: 'BOTH' })],
      [db({ sku: 'BOTH' }), db({ sku: 'DB-ONLY' })],
    );
    const um = only(r, 'unmatched_sku');
    expect(um.map((x) => x.sku).sort()).toEqual(['DB-ONLY', 'EBAY-ONLY']);
    expect(only(r, 'managed_ok').map((x) => x.sku)).toEqual(['BOTH']);
  });

  it('flags oversell_suspect when rule target is 0 but eBay shows buyable — wins over qty_mismatch', () => {
    const r = classifyListings(
      [snap({ qtyAvailable: 1 })],
      [db({ ruleTargetZero: true, lastSyncedQty: 0 })],
    );
    expect(r[0].category).toBe('oversell_suspect');
  });

  it('does NOT flag rule-target-zero rows that eBay already shows unbuyable', () => {
    const r = classifyListings(
      [snap({ qtyListed: 1, qtySold: 1, qtyAvailable: 0 })],
      [db({ ruleTargetZero: true, lastSyncedQty: 0 })],
    );
    expect(r[0].category).toBe('managed_ok');
  });

  it('flags qty_mismatch only on buyability disagreement (XOR), not raw inequality', () => {
    // Sale between syncs: db pushed 1, buyer bought it -> eBay 0. Buyability disagrees -> flag.
    const disagree = classifyListings([snap({ qtyAvailable: 0, qtySold: 1 })], [db({ lastSyncedQty: 1 })]);
    expect(disagree[0].category).toBe('qty_mismatch');
    // Both buyable with different raw numbers -> NOT flagged.
    const agree = classifyListings([snap({ qtyAvailable: 3 })], [db({ lastSyncedQty: 1 })]);
    expect(agree[0].category).toBe('managed_ok');
  });

  it('flags price_mismatch beyond a 0.01 tolerance, never on NULL sides', () => {
    expect(classifyListings([snap({ price: 21.99 })], [db()])[0].category).toBe('price_mismatch');
    expect(classifyListings([snap({ price: 19.995 })], [db()])[0].category).toBe('managed_ok');
    expect(classifyListings([snap({ price: null })], [db()])[0].category).toBe('managed_ok');
    expect(classifyListings([snap()], [db({ lastSyncedPrice: null })])[0].category).toBe('managed_ok');
  });

  it('pairs a NULL-SKU snapshot row against a single DB row for the ItemID', () => {
    const r = classifyListings(
      [snap({ sku: null, isVariation: false })],
      [db({ sku: 'DB-SKU' })],
    );
    expect(r).toHaveLength(1);
    expect(r[0].category).toBe('managed_ok');
    expect(r[0].sku).toBe('DB-SKU'); // reported under the DB row's SKU
  });

  it('reports a NULL-SKU snapshot row as unmatched_sku when the ItemID has multiple DB rows', () => {
    const r = classifyListings(
      [snap({ sku: null, isVariation: false })],
      [db({ sku: 'A' }), db({ sku: 'B' })],
    );
    expect(only(r, 'unmatched_sku').some((x) => x.sku === null)).toBe(true);
  });

  it('classifies DB rows with non-live, non-dead statuses (inactive/draft/paused) absent from eBay as managed_ok', () => {
    const r = classifyListings([], [db({ listingStatus: 'inactive' })]);
    expect(r[0].category).toBe('managed_ok');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-classifier.test.ts`
Expected: FAIL — `Cannot find module './ebay-classifier'`.

- [ ] **Step 3: Implement `ebay-classifier.ts`**

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-classifier.ts
/**
 * Pure classifier for the eBay reconciliation dashboard (spec §6).
 *
 * Inputs: the full ActiveList snapshot (SKU-level) and all store-94
 * marketplace_listings rows (with a precomputed ruleTargetZero flag).
 * Output: one ClassifiedResult per (ItemID, SKU) pair, category precedence
 * per spec §6.1 — first match wins.
 *
 * No I/O here — keep this file pure so it stays trivially unit-testable.
 */
import type { EbayReconCategory } from '@admin/shared';

export interface ClassifierSnapshotRow {
  itemId: string;
  sku: string | null;
  title: string;
  isVariation: boolean;
  price: number | null;
  currency: string | null;
  qtyListed: number;
  qtySold: number;
  qtyAvailable: number;
}

export interface ClassifierDbRow {
  itemId: string;
  sku: string | null;
  listingStatus: string;
  lastSyncedQty: number | null;
  lastSyncedPrice: number | null;
  errorCode: string | null;
  ruleTargetZero: boolean;
}

export interface ClassifiedResult {
  itemId: string;
  sku: string | null;
  category: EbayReconCategory;
  dbListingStatus: string | null;
  dbLastSyncedQty: number | null;
  dbLastSyncedPrice: number | null;
  dbErrorCode: string | null;
  ebayQtyAvailable: number | null;
  ebayPrice: number | null;
  ebayTitle: string | null;
}

const LIVE_DB_STATUSES = new Set(['active', 'confirmed']);
const DEAD_DB_STATUSES = new Set(['deleted', 'suspended']);
const PRICE_TOLERANCE = 0.01;

const groupBy = <T>(rows: T[], key: (r: T) => string): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
};

const fromDb = (r: ClassifierDbRow) => ({
  dbListingStatus: r.listingStatus,
  dbLastSyncedQty: r.lastSyncedQty,
  dbLastSyncedPrice: r.lastSyncedPrice,
  dbErrorCode: r.errorCode,
});
const noDb = { dbListingStatus: null, dbLastSyncedQty: null, dbLastSyncedPrice: null, dbErrorCode: null };
const fromSnap = (s: ClassifierSnapshotRow) => ({
  ebayQtyAvailable: s.qtyAvailable,
  ebayPrice: s.price,
  ebayTitle: s.title,
});
const noSnap = { ebayQtyAvailable: null, ebayPrice: null, ebayTitle: null };

/** Spec §6.1 rows 2/5–8 precedence for a matched (dbRow, snapRow) pair. */
function classifyPair(dbRow: ClassifierDbRow, snapRow: ClassifierSnapshotRow): EbayReconCategory {
  if (DEAD_DB_STATUSES.has(dbRow.listingStatus)) return 'status_mismatch';
  if (dbRow.ruleTargetZero && snapRow.qtyAvailable > 0) return 'oversell_suspect';
  const dbBuyable = (dbRow.lastSyncedQty ?? 0) > 0;
  const ebayBuyable = snapRow.qtyAvailable > 0;
  if (dbBuyable !== ebayBuyable) return 'qty_mismatch';
  if (
    dbRow.lastSyncedPrice != null &&
    snapRow.price != null &&
    Math.abs(dbRow.lastSyncedPrice - snapRow.price) > PRICE_TOLERANCE
  ) {
    return 'price_mismatch';
  }
  return 'managed_ok';
}

export function classifyListings(
  snapshot: ClassifierSnapshotRow[],
  db: ClassifierDbRow[],
): ClassifiedResult[] {
  const snapByItem = groupBy(snapshot, (r) => r.itemId);
  const dbByItem = groupBy(db, (r) => r.itemId);
  const results: ClassifiedResult[] = [];

  // --- ItemIDs live on eBay ---
  for (const [itemId, snapRows] of snapByItem) {
    const dbRows = dbByItem.get(itemId);

    if (!dbRows) {
      // Spec §6.1 #1: not ours — one row per ItemID, eBay quantities aggregated.
      results.push({
        itemId,
        sku: null,
        category: 'unmanaged',
        ...noDb,
        ebayQtyAvailable: snapRows.reduce((sum, r) => sum + r.qtyAvailable, 0),
        ebayPrice: snapRows[0].price,
        ebayTitle: snapRows[0].title,
      });
      continue;
    }

    // Spec §6.1 #2: live on eBay but our DB thinks the whole listing is gone.
    if (dbRows.every((r) => DEAD_DB_STATUSES.has(r.listingStatus))) {
      const snapBySku = new Map(snapRows.filter((s) => s.sku).map((s) => [s.sku as string, s]));
      for (const dbRow of dbRows) {
        const match = dbRow.sku ? snapBySku.get(dbRow.sku) : undefined;
        results.push({
          itemId,
          sku: dbRow.sku,
          category: 'status_mismatch',
          ...fromDb(dbRow),
          ...(match ? fromSnap(match) : { ...fromSnap(snapRows[0]), ebayQtyAvailable: snapRows.reduce((s, r) => s + r.qtyAvailable, 0) }),
        });
      }
      continue;
    }

    // SKU-level matching within a matched ItemID.
    const snapBySku = new Map(snapRows.filter((s) => s.sku !== null).map((s) => [s.sku as string, s]));
    const dbBySku = new Map(dbRows.filter((d) => d.sku !== null).map((d) => [d.sku as string, d]));
    const nullSnapRows = snapRows.filter((s) => s.sku === null);
    const pairedDbSkus = new Set<string>();

    for (const [sku, snapRow] of snapBySku) {
      const dbRow = dbBySku.get(sku);
      if (!dbRow) {
        results.push({ itemId, sku, category: 'unmatched_sku', ...noDb, ...fromSnap(snapRow) });
        continue;
      }
      pairedDbSkus.add(sku);
      results.push({ itemId, sku, category: classifyPair(dbRow, snapRow), ...fromDb(dbRow), ...fromSnap(snapRow) });
    }

    // NULL-SKU snapshot rows (single-SKU listings without a seller SKU):
    // pair with the ItemID's single DB row when unambiguous, else unmatched.
    for (const snapRow of nullSnapRows) {
      const unpaired = dbRows.filter((d) => !(d.sku && pairedDbSkus.has(d.sku)));
      if (dbRows.length === 1 && unpaired.length === 1) {
        const dbRow = unpaired[0];
        if (dbRow.sku) pairedDbSkus.add(dbRow.sku);
        results.push({
          itemId,
          sku: dbRow.sku,
          category: classifyPair(dbRow, snapRow),
          ...fromDb(dbRow),
          ...fromSnap(snapRow),
        });
      } else {
        results.push({ itemId, sku: null, category: 'unmatched_sku', ...noDb, ...fromSnap(snapRow) });
      }
    }

    // DB SKUs missing from the eBay listing.
    for (const dbRow of dbRows) {
      if (dbRow.sku === null || pairedDbSkus.has(dbRow.sku)) {
        if (dbRow.sku === null && dbRows.length === 1 && nullSnapRows.length === 1) continue; // already paired above
        if (dbRow.sku !== null) continue;
      }
      if (dbRow.sku !== null && !snapBySku.has(dbRow.sku)) {
        results.push({ itemId, sku: dbRow.sku, category: 'unmatched_sku', ...fromDb(dbRow), ...noSnap });
      }
    }
  }

  // --- DB ItemIDs absent from eBay ---
  for (const [itemId, dbRows] of dbByItem) {
    if (snapByItem.has(itemId)) continue;
    for (const dbRow of dbRows) {
      results.push({
        itemId,
        sku: dbRow.sku,
        // Spec §6.1 #3: DB thinks it is live but eBay does not list it (ghost).
        // Dead or dormant DB statuses absent from eBay are agreement -> managed_ok.
        category: LIVE_DB_STATUSES.has(dbRow.listingStatus) ? 'managed_ghost' : 'managed_ok',
        ...fromDb(dbRow),
        ...noSnap,
      });
    }
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-classifier.test.ts`
Expected: PASS (13 tests). If the NULL-SKU or unmatched-DB-SKU loops double-emit rows, fix the pairing bookkeeping until the exact expected row counts pass — the tests pin them.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ebay-reconciliation/ebay-classifier.ts apps/api/src/modules/ebay-reconciliation/ebay-classifier.test.ts
git commit -m "feat(ebay-recon): pure (ItemID, SKU) classifier with spec §6.1 precedence"
```

---

### Task 4: eBay client additions — ActiveList iterator, parser, Browse availability

**Files:**
- Modify: `apps/api/src/lib/marketplaces/ebay/client.ts` (add two methods inside `class EbayClient`, next to `getActiveItemIds` at ~line 919)
- Create: `apps/api/src/modules/ebay-reconciliation/ebay-snapshot.parse.ts`
- Test: `apps/api/src/modules/ebay-reconciliation/ebay-snapshot.parse.test.ts`

**Interfaces:**
- Consumes: `ClassifierSnapshotRow` (Task 3), existing `this.api` (ebay-api SDK), `this.getEbaySiteId(storeId)`, module-local `toArrayEbay`.
- Produces:
  - `EbayClient.iterateActiveListings(storeId: number, entriesPerPage?: number): AsyncGenerator<{ pageNumber: number; totalPages: number; totalEntries: number; items: unknown[] }>`
  - `EbayClient.getBrowseAvailability(storeId: number, itemId: string, variationSku?: string): Promise<{ status: string; qty: number | null } | null>`
  - `parseActiveListingItem(item: unknown): ClassifierSnapshotRow[]` (pure, one call per raw ActiveList item).

- [ ] **Step 1: Write the failing parser tests**

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-snapshot.parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseActiveListingItem } from './ebay-snapshot.parse';

describe('parseActiveListingItem', () => {
  it('returns one row per variation with qtyAvailable = Quantity - QuantitySold floored at 0', () => {
    const rows = parseActiveListingItem({
      ItemID: '157464453533',
      Title: 'Retro Shirt',
      Variations: {
        Variation: [
          { SKU: 'SH-M', Quantity: 1, SellingStatus: { QuantitySold: 0 }, StartPrice: { value: 24.99, currencyID: 'GBP' } },
          { SKU: 'SH-L', Quantity: 1, SellingStatus: { QuantitySold: 2 }, StartPrice: { value: 24.99, currencyID: 'GBP' } },
        ],
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ itemId: '157464453533', sku: 'SH-M', isVariation: true, price: 24.99, currency: 'GBP', qtyAvailable: 1 });
    expect(rows[1].qtyAvailable).toBe(0); // 1 - 2 floored
  });

  it('handles a single Variation object (eBay XML->JSON collapses one-element arrays)', () => {
    const rows = parseActiveListingItem({
      ItemID: '111', Title: 'T',
      Variations: { Variation: { SKU: 'ONLY', Quantity: 3, SellingStatus: { QuantitySold: 1 }, StartPrice: 9.5 } },
    });
    expect(rows).toEqual([expect.objectContaining({ sku: 'ONLY', qtyAvailable: 2, price: 9.5 })]);
  });

  it('returns one item-level row for non-variation listings, sku null when no seller SKU', () => {
    const rows = parseActiveListingItem({
      ItemID: '222', Title: 'Plain', Quantity: 5,
      SellingStatus: { QuantitySold: 1, CurrentPrice: { value: '12.50', currencyID: 'GBP' } },
    });
    expect(rows).toEqual([
      expect.objectContaining({ itemId: '222', sku: null, isVariation: false, qtyListed: 5, qtySold: 1, qtyAvailable: 4, price: 12.5, currency: 'GBP' }),
    ]);
  });

  it('uses the item SKU when present and tolerates missing price/quantity fields', () => {
    const rows = parseActiveListingItem({ ItemID: '333', Title: 'Bare', SKU: 'BARE-1' });
    expect(rows).toEqual([
      expect.objectContaining({ sku: 'BARE-1', price: null, currency: null, qtyListed: 0, qtySold: 0, qtyAvailable: 0 }),
    ]);
  });

  it('returns [] for an item with no ItemID and truncates 300-char titles to 255', () => {
    expect(parseActiveListingItem({ Title: 'no id' })).toEqual([]);
    const rows = parseActiveListingItem({ ItemID: '444', Title: 'x'.repeat(300) });
    expect(rows[0].title).toHaveLength(255);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-snapshot.parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ebay-snapshot.parse.ts`**

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-snapshot.parse.ts
/**
 * Pure parsing of GetMyeBaySelling ActiveList items into snapshot rows.
 * Defensive: the ebay-api SDK's XML->JSON gives single objects for one-element
 * arrays and money as either a scalar or { value, currencyID }.
 */
import type { ClassifierSnapshotRow } from './ebay-classifier';

const toArr = <T>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

const toInt = (v: unknown): number => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
};

const money = (p: unknown): number | null => {
  if (p === undefined || p === null) return null;
  const raw = typeof p === 'object' ? (p as any).value ?? (p as any)['#text'] : p;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const currencyOf = (p: unknown): string | null => {
  if (p === null || typeof p !== 'object') return null;
  const c = (p as any).currencyID ?? (p as any)['@_currencyID'];
  return c ? String(c).slice(0, 3) : null;
};

const strOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s.length > 0 ? s : null;
};

export function parseActiveListingItem(item: unknown): ClassifierSnapshotRow[] {
  const it = item as any;
  const itemId = String(it?.ItemID ?? '').trim();
  if (!itemId) return [];
  const title = String(it?.Title ?? '').slice(0, 255);

  const variations = toArr(it?.Variations?.Variation);
  if (variations.length > 0) {
    return variations.map((v: any) => {
      const qtyListed = toInt(v?.Quantity);
      const qtySold = toInt(v?.SellingStatus?.QuantitySold);
      const price = v?.StartPrice;
      return {
        itemId,
        sku: strOrNull(v?.SKU),
        title,
        isVariation: true,
        price: money(price),
        currency: currencyOf(price),
        qtyListed,
        qtySold,
        qtyAvailable: Math.max(0, qtyListed - qtySold),
      };
    });
  }

  const qtyListed = toInt(it?.Quantity);
  const qtySold = toInt(it?.SellingStatus?.QuantitySold);
  const price = it?.SellingStatus?.CurrentPrice ?? it?.StartPrice ?? it?.BuyItNowPrice ?? null;
  return [
    {
      itemId,
      sku: strOrNull(it?.SKU),
      title,
      isVariation: false,
      price: money(price),
      currency: currencyOf(price),
      qtyListed,
      qtySold,
      qtyAvailable: Math.max(0, qtyListed - qtySold),
    },
  ];
}
```

- [ ] **Step 4: Run parser tests to verify they pass**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-snapshot.parse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the two client methods** inside `class EbayClient` in `apps/api/src/lib/marketplaces/ebay/client.ts`, directly after `getActiveItemIds` (before the class's closing brace at ~line 945):

```typescript
  /**
   * Page through GetMyeBaySelling ActiveList yielding RAW items (variations
   * included via DetailLevel ReturnAll). Read-only; token must already be set.
   * Used by the reconciliation snapshot job — parsing happens in
   * modules/ebay-reconciliation/ebay-snapshot.parse.ts so it stays unit-testable.
   */
  async *iterateActiveListings(
    storeId: number,
    entriesPerPage: number = 200
  ): AsyncGenerator<{ pageNumber: number; totalPages: number; totalEntries: number; items: unknown[] }> {
    this.api.config.siteId = this.getEbaySiteId(storeId);
    let pageNumber = 1;
    let totalPages = 1;

    do {
      const resp = await this.api.trading.GetMyeBaySelling({
        ActiveList: { Include: true, Pagination: { EntriesPerPage: entriesPerPage, PageNumber: pageNumber } },
        DetailLevel: 'ReturnAll',
      });
      const active = resp?.ActiveList;
      totalPages = parseInt(String(active?.PaginationResult?.TotalNumberOfPages ?? '1'), 10) || 1;
      const totalEntries = parseInt(String(active?.PaginationResult?.TotalNumberOfEntries ?? '0'), 10) || 0;
      yield { pageNumber, totalPages, totalEntries, items: toArrayEbay<unknown>(active?.ItemArray?.Item) };
      pageNumber += 1;
    } while (pageNumber <= totalPages);
  }

  /**
   * BUYER-facing availability via the Browse API (get_item_by_legacy_id).
   * This is the ONLY authoritative oversell check — under OutOfStockControl a
   * seller-side-0 variation can still be IN_STOCK to buyers (see
   * .claude/skills/ebay-sync-rules). Returns null when the item/SKU cannot be
   * resolved (treat as "unchecked", never as "safe").
   */
  async getBrowseAvailability(
    storeId: number,
    itemId: string,
    variationSku?: string
  ): Promise<{ status: string; qty: number | null } | null> {
    this.api.config.siteId = this.getEbaySiteId(storeId);
    try {
      const params: Record<string, string> = { legacy_item_id: itemId };
      if (variationSku) params.legacy_variation_sku = variationSku;
      const res = await this.api.buy.browse.getItemByLegacyId(params as any);
      const ea = toArrayEbay<any>(res?.estimatedAvailabilities)[0];
      if (!ea) return null;
      return {
        status: String(ea.estimatedAvailabilityStatus ?? 'UNKNOWN'),
        qty: ea.estimatedAvailableQuantity != null ? Number(ea.estimatedAvailableQuantity) : null,
      };
    } catch (error) {
      getLogger().warn(
        { storeId, itemId, variationSku, error: error instanceof Error ? error.message : String(error) },
        'Browse getItemByLegacyId failed — availability unchecked'
      );
      return null;
    }
  }
```

**Implementation note (verify on first live call, Task 12):** Browse is a RESTful Buy API — the SDK mints an application (client-credentials) token for it automatically. If the first live call fails with an OAuth scope error, set `this.api.OAuth2.setScope(['https://api.ebay.com/oauth/api_scope'])` before the call and re-verify. Do not silently swallow a scope failure — it would leave every suspect "unchecked".

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @admin/api exec tsc --noEmit -p tsconfig.json`
Expected: no errors (if `this.api.buy` lacks typings for `getItemByLegacyId` params, the `as any` cast on params covers it).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/marketplaces/ebay/client.ts apps/api/src/modules/ebay-reconciliation/ebay-snapshot.parse.ts apps/api/src/modules/ebay-reconciliation/ebay-snapshot.parse.test.ts
git commit -m "feat(ebay-recon): ActiveList iterator, snapshot parser, Browse availability check"
```

---

### Task 5: Reconciliation DB layer

**Files:**
- Create: `apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.db.ts`
- Test: `apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.db.test.ts`
- Modify: `apps/api/src/config/index.ts` (add `EBAY_RECON_BROWSE_CAP`)

**Interfaces:**
- Consumes: Prisma models from Task 1 (`prisma.ebaySnapshotRun`, `prisma.ebayListingSnapshot`, `prisma.ebayReconciliationResult`, `prisma.ebayReconciliationAction` — via `import { prisma } from '../../lib/prisma'`), `EBAY_RULE_TARGET_ZERO_SELECT` (Task 2), `ClassifierDbRow`/`ClassifiedResult` (Task 3), `ClassifierSnapshotRow` (Task 3).
- Produces (used by Tasks 6–9):

```typescript
export class SnapshotRunInProgressError extends Error { constructor(public runId: number) }
export const STALE_RUN_MS: number  // 2h
export function isRunStale(startedAt: Date, now: Date): boolean
export async function acquireSnapshotRun(storeId: number, trigger: 'cron' | 'manual', triggeredBy?: string): Promise<number>
export async function insertSnapshotRows(runId: number, rows: ClassifierSnapshotRow[]): Promise<number>
export async function getDbListingRows(storeId: number): Promise<ClassifierDbRow[]>
export type ResultWithBrowse = ClassifiedResult & { browseChecked?: boolean; browseStatus?: string | null; browseQty?: number | null }
export async function insertResults(runId: number, storeId: number, rows: ResultWithBrowse[]): Promise<number>
export interface RunCounts { pagesFetched: number; listingsFetched: number; variationsFetched: number; summaryJson: string }
export async function completeRun(runId: number, counts: RunCounts): Promise<void>
export async function failRun(runId: number, errorMessage: string): Promise<void>  // deletes partial child rows
export async function purgeOldRuns(storeId: number, keepCompleted: number): Promise<number>
export async function getLatestCompletedRunId(storeId: number): Promise<number | null>
export async function updateResultBrowse(resultId: number, status: string | null, qty: number | null): Promise<void>
export async function markResultsActioned(runId: number, itemIds: string[], action: string, actionBy: string): Promise<number>
export async function insertActionLog(entry: { runId: number | null; action: string; itemIds: string[]; dryRun: boolean; requestedBy: string; outcomeJson: string; status: 'completed' | 'failed' }): Promise<void>
export async function markEbayListingsGone(storeId: number, itemIds: string[], runId: number | null): Promise<number>
export function chunk<T>(rows: T[], size: number): T[][]
```

- [ ] **Step 1: Write failing tests for the pure pieces** (`chunk`, `isRunStale`) and the `markEbayListingsGone` SQL shape:

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.db.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger-context', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { chunk, isRunStale, STALE_RUN_MS } from './ebay-reconciliation.db';

describe('chunk', () => {
  it('splits rows into fixed-size chunks with a smaller tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 100)).toEqual([]);
  });
});

describe('isRunStale', () => {
  it('is stale strictly after 2 hours', () => {
    const started = new Date('2026-07-17T00:00:00Z');
    expect(isRunStale(started, new Date(started.getTime() + STALE_RUN_MS - 1))).toBe(false);
    expect(isRunStale(started, new Date(started.getTime() + STALE_RUN_MS + 1))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-reconciliation.db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ebay-reconciliation.db.ts`**

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.db.ts
/**
 * DB layer for the eBay reconciliation dashboard. All writes for snapshot runs,
 * results, the action audit log, and the mark-gone mutation live here.
 */
import { prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import { EBAY_RULE_TARGET_ZERO_SELECT } from './ebay-rule-target';
import type { ClassifierDbRow, ClassifierSnapshotRow, ClassifiedResult } from './ebay-classifier';

export const STALE_RUN_MS = 2 * 60 * 60 * 1000; // spec §4: stale lock takeover after 2h
const INSERT_CHUNK = 1000;

export class SnapshotRunInProgressError extends Error {
  constructor(public runId: number) {
    super(`eBay snapshot run ${runId} is already in progress`);
    this.name = 'SnapshotRunInProgressError';
  }
}

export function isRunStale(startedAt: Date, now: Date): boolean {
  return now.getTime() - startedAt.getTime() > STALE_RUN_MS;
}

export function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** The `running` row is the lock. Stale (>2h) running rows are failed and superseded. */
export async function acquireSnapshotRun(
  storeId: number,
  trigger: 'cron' | 'manual',
  triggeredBy?: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const running = await tx.ebaySnapshotRun.findFirst({ where: { storeId, status: 'running' } });
    if (running) {
      if (!isRunStale(running.startedAt, new Date())) throw new SnapshotRunInProgressError(running.id);
      await tx.ebaySnapshotRun.update({
        where: { id: running.id },
        data: { status: 'failed', finishedAt: new Date(), errorMessage: 'Stale: exceeded 2h without finishing; superseded by a new run' },
      });
      await tx.ebayListingSnapshot.deleteMany({ where: { runId: running.id } });
      await tx.ebayReconciliationResult.deleteMany({ where: { runId: running.id } });
    }
    const run = await tx.ebaySnapshotRun.create({
      data: { storeId, triggerSource: trigger, triggeredBy: triggeredBy ?? null, status: 'running' },
    });
    return run.id;
  });
}

export async function insertSnapshotRows(runId: number, rows: ClassifierSnapshotRow[]): Promise<number> {
  let inserted = 0;
  for (const batch of chunk(rows, INSERT_CHUNK)) {
    const res = await prisma.ebayListingSnapshot.createMany({
      data: batch.map((r) => ({
        runId,
        itemId: r.itemId,
        sku: r.sku,
        title: r.title,
        isVariation: r.isVariation,
        price: r.price,
        currency: r.currency,
        qtyListed: r.qtyListed,
        qtySold: r.qtySold,
        qtyAvailable: r.qtyAvailable,
      })),
    });
    inserted += res.count;
  }
  return inserted;
}

/**
 * All store-94 listing rows with an ItemID, plus the precomputed
 * rule_target_zero flag (shared arms — see ebay-rule-target.ts).
 * Collation: products_sku (utf8mb4) -> CONVERT(... USING latin1) for the npv join.
 */
export async function getDbListingRows(storeId: number): Promise<ClassifierDbRow[]> {
  const sql = `
    SELECT
      ml.marketplace_item_identifier AS item_id,
      ml.products_sku                AS sku,
      ml.marketplace_listing_status  AS listing_status,
      ml.last_synced_quantity        AS last_synced_qty,
      ml.last_synced_price           AS last_synced_price,
      ml.api_last_error_code         AS error_code,
      ${EBAY_RULE_TARGET_ZERO_SELECT} AS rule_target_zero
    FROM marketplace_listings ml
    LEFT JOIN new_products_variations npv
      ON npv.npv_products_sku = CONVERT(ml.products_sku USING latin1)
    LEFT JOIN new_products np
      ON np.products_id = ml.products_id
    WHERE ml.store_id = ?
      AND ml.marketplace_item_identifier IS NOT NULL
      AND ml.marketplace_item_identifier != ''
  `;
  const rows = await prisma.$queryRawUnsafe<any[]>(sql, storeId);
  return rows.map((r) => ({
    itemId: String(r.item_id),
    sku: r.sku != null && String(r.sku).length > 0 ? String(r.sku) : null,
    listingStatus: String(r.listing_status),
    lastSyncedQty: r.last_synced_qty != null ? Number(r.last_synced_qty) : null,
    lastSyncedPrice: r.last_synced_price != null ? Number(r.last_synced_price) : null,
    errorCode: r.error_code != null && String(r.error_code).length > 0 ? String(r.error_code) : null,
    ruleTargetZero: Number(r.rule_target_zero ?? 0) === 1,
  }));
}

/**
 * ClassifiedResult optionally enriched with the in-run Browse verification
 * (the snapshot service checks suspects BEFORE persisting, so browse state
 * rides along on the insert — no post-insert id round-trip needed).
 */
export type ResultWithBrowse = ClassifiedResult & {
  browseChecked?: boolean;
  browseStatus?: string | null;
  browseQty?: number | null;
};

export async function insertResults(runId: number, storeId: number, rows: ResultWithBrowse[]): Promise<number> {
  let inserted = 0;
  for (const batch of chunk(rows, INSERT_CHUNK)) {
    const res = await prisma.ebayReconciliationResult.createMany({
      data: batch.map((r) => ({
        runId,
        storeId,
        itemId: r.itemId,
        sku: r.sku,
        category: r.category,
        dbListingStatus: r.dbListingStatus,
        dbLastSyncedQty: r.dbLastSyncedQty,
        dbLastSyncedPrice: r.dbLastSyncedPrice,
        dbErrorCode: r.dbErrorCode,
        ebayQtyAvailable: r.ebayQtyAvailable,
        ebayPrice: r.ebayPrice,
        ebayTitle: r.ebayTitle,
        browseChecked: r.browseChecked ?? false,
        browseStatus: r.browseStatus ?? null,
        browseQty: r.browseQty ?? null,
      })),
    });
    inserted += res.count;
  }
  return inserted;
}

export interface RunCounts {
  pagesFetched: number;
  listingsFetched: number;
  variationsFetched: number;
  summaryJson: string;
}

export async function completeRun(runId: number, counts: RunCounts): Promise<void> {
  await prisma.ebaySnapshotRun.update({
    where: { id: runId },
    data: { status: 'completed', finishedAt: new Date(), ...counts },
  });
}

/** Abort: a partial snapshot must never masquerade as complete (spec §4). */
export async function failRun(runId: number, errorMessage: string): Promise<void> {
  await prisma.$transaction([
    prisma.ebayListingSnapshot.deleteMany({ where: { runId } }),
    prisma.ebayReconciliationResult.deleteMany({ where: { runId } }),
    prisma.ebaySnapshotRun.update({
      where: { id: runId },
      data: { status: 'failed', finishedAt: new Date(), errorMessage: errorMessage.slice(0, 5000) },
    }),
  ]);
}

/** Purge child rows of completed runs beyond the newest `keepCompleted`. Run metadata stays. */
export async function purgeOldRuns(storeId: number, keepCompleted: number): Promise<number> {
  const keep = await prisma.ebaySnapshotRun.findMany({
    where: { storeId, status: 'completed' },
    orderBy: { startedAt: 'desc' },
    take: keepCompleted,
    select: { id: true },
  });
  const keepIds = keep.map((r) => r.id);
  const stale = await prisma.ebaySnapshotRun.findMany({
    where: { storeId, status: 'completed', id: { notIn: keepIds } },
    select: { id: true },
  });
  if (stale.length === 0) return 0;
  const staleIds = stale.map((r) => r.id);
  await prisma.$transaction([
    prisma.ebayListingSnapshot.deleteMany({ where: { runId: { in: staleIds } } }),
    prisma.ebayReconciliationResult.deleteMany({ where: { runId: { in: staleIds } } }),
  ]);
  getLogger().info({ storeId, purgedRuns: staleIds.length }, 'eBay recon: purged old snapshot child rows');
  return staleIds.length;
}

export async function getLatestCompletedRunId(storeId: number): Promise<number | null> {
  const run = await prisma.ebaySnapshotRun.findFirst({
    where: { storeId, status: 'completed' },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  return run?.id ?? null;
}

export async function updateResultBrowse(resultId: number, status: string | null, qty: number | null): Promise<void> {
  await prisma.ebayReconciliationResult.update({
    where: { id: resultId },
    data: { browseChecked: true, browseStatus: status, browseQty: qty },
  });
}

/** Denormalize the last action onto the result rows the user acted on. */
export async function markResultsActioned(
  runId: number,
  itemIds: string[],
  action: string,
  actionBy: string,
): Promise<number> {
  const res = await prisma.ebayReconciliationResult.updateMany({
    where: { runId, itemId: { in: itemIds } },
    data: { actionTaken: action, actionAt: new Date(), actionBy },
  });
  return res.count;
}

export async function insertActionLog(entry: {
  runId: number | null;
  action: string;
  itemIds: string[];
  dryRun: boolean;
  requestedBy: string;
  outcomeJson: string;
  status: 'completed' | 'failed';
}): Promise<void> {
  await prisma.ebayReconciliationAction.create({
    data: {
      runId: entry.runId,
      action: entry.action,
      itemIdsJson: JSON.stringify(entry.itemIds),
      dryRun: entry.dryRun,
      requestedBy: entry.requestedBy,
      outcomeJson: entry.outcomeJson,
      status: entry.status,
    },
  });
}

/**
 * DB-only ghost cleanup (spec §7 mark-gone): confirmed-dead ghosts stop being
 * considered by the sync. Terminal-status convention matches the sync's
 * terminal handling: status deleted, last_sync_status success, retry 0, error
 * kept for audit (marker code so the origin is traceable).
 */
export async function markEbayListingsGone(storeId: number, itemIds: string[], runId: number | null): Promise<number> {
  if (itemIds.length === 0) return 0;
  const placeholders = itemIds.map(() => '?').join(',');
  const sql = `
    UPDATE marketplace_listings
    SET marketplace_listing_status = 'deleted',
        last_sync_status = 'success',
        retry_count = 0,
        api_last_error_code = 'RECON_MARK_GONE',
        api_last_error_message = CONCAT('[EBAY_RECON] marked gone via reconciliation run ', ?)
    WHERE store_id = ?
      AND marketplace_item_identifier IN (${placeholders})
      AND marketplace_listing_status IN ('active','confirmed')
  `;
  const affected = await (prisma.$executeRawUnsafe as (q: string, ...v: unknown[]) => Promise<number>)(
    sql,
    String(runId ?? 'manual'),
    storeId,
    ...itemIds,
  );
  getLogger().info({ storeId, itemIds: itemIds.length, affected, runId }, 'eBay recon: marked ghosts gone');
  return Number(affected);
}
```

- [ ] **Step 4: Add `EBAY_RECON_BROWSE_CAP` to the config schema** in `apps/api/src/config/index.ts`, next to the other `MARKETPLACE_EBAY_*` keys:

```typescript
  EBAY_RECON_BROWSE_CAP: z.coerce.number().int().min(0).default(200),
```

(Also add `EBAY_RECON_BROWSE_CAP=200` to `.env.example` if the repo keeps one.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ && pnpm --filter @admin/api exec tsc --noEmit -p tsconfig.json`
Expected: all ebay-reconciliation tests PASS; no type errors. (Requires `pnpm --filter @admin/api exec prisma generate --schema prisma/schema.mysql.prisma` if the client wasn't regenerated after Task 1.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.db.ts apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.db.test.ts apps/api/src/config/index.ts
git commit -m "feat(ebay-recon): DB layer — run lock, snapshot/result persistence, purge, mark-gone"
```

---

### Task 6: Snapshot service + CLI command + PM2 cron entry

**Files:**
- Create: `apps/api/src/modules/ebay-reconciliation/ebay-snapshot.service.ts`
- Test: `apps/api/src/modules/ebay-reconciliation/ebay-snapshot.service.test.ts`
- Modify: `apps/api/src/modules/marketplaces/cli/ebay.commands.ts` (add `snapshot-listings` command)
- Modify: `ecosystem.config.cjs` (add daily cron entry)

**Interfaces:**
- Consumes: Task 4 client methods (`iterateActiveListings`, `getBrowseAvailability`, `fetchAccessToken`), Task 3 `classifyListings`, Task 4 `parseActiveListingItem`, Task 5 DB functions, `config.EBAY_RECON_BROWSE_CAP`, `config.EBAY_STORE_ID`.
- Produces (used by Tasks 7/9 and CLI):

```typescript
export interface EbaySnapshotOptions { storeId: number; trigger: 'cron' | 'manual'; triggeredBy?: string; dryRun?: boolean }
export interface EbaySnapshotResult {
  runId: number | null; dryRun: boolean; pages: number;
  listingsFetched: number; variationRows: number;
  categoryCounts: Record<string, number>; browseChecked: number; browseUnchecked: number;
}
export async function runEbaySnapshot(opts: EbaySnapshotOptions): Promise<EbaySnapshotResult>          // awaits the full run (CLI)
export async function startEbaySnapshotAsync(storeId: number, triggeredBy: string): Promise<number>    // acquires lock, returns runId, continues in background (HTTP refresh)
export const KEEP_COMPLETED_RUNS = 14
```

- [ ] **Step 1: Write the failing service tests** (mock style mirrors `ebay-relist.service.test.ts`)

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-snapshot.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({
  config: { EBAY_STORE_ID: 94, EBAY_RECON_BROWSE_CAP: 2 },
}));
vi.mock('../../lib/logger-context', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const fetchAccessToken = vi.fn().mockResolvedValue('token');
const getBrowseAvailability = vi.fn().mockResolvedValue({ status: 'IN_STOCK', qty: 1 });
let activePages: { pageNumber: number; totalPages: number; totalEntries: number; items: unknown[] }[] = [];
async function* iterateActiveListings() {
  for (const p of activePages) {
    if ((p as any).throwError) throw new Error('eBay 500 on page ' + p.pageNumber);
    yield p;
  }
}
vi.mock('../../lib/marketplaces/ebay/client', () => ({
  createEbayClient: () => ({ fetchAccessToken, iterateActiveListings, getBrowseAvailability }),
}));

const acquireSnapshotRun = vi.fn().mockResolvedValue(7);
const insertSnapshotRows = vi.fn().mockResolvedValue(0);
const getDbListingRows = vi.fn().mockResolvedValue([]);
const insertResults = vi.fn().mockResolvedValue(0);
const completeRun = vi.fn().mockResolvedValue(undefined);
const failRun = vi.fn().mockResolvedValue(undefined);
const purgeOldRuns = vi.fn().mockResolvedValue(0);
// Full mock (no importOriginal — the real module pulls in the Prisma client).
// The service's `type ResultWithBrowse` import is type-only and erased at runtime.
vi.mock('./ebay-reconciliation.db', () => ({
  acquireSnapshotRun: (...a: unknown[]) => acquireSnapshotRun(...a),
  insertSnapshotRows: (...a: unknown[]) => insertSnapshotRows(...a),
  getDbListingRows: (...a: unknown[]) => getDbListingRows(...a),
  insertResults: (...a: unknown[]) => insertResults(...a),
  completeRun: (...a: unknown[]) => completeRun(...a),
  failRun: (...a: unknown[]) => failRun(...a),
  purgeOldRuns: (...a: unknown[]) => purgeOldRuns(...a),
}));

import { runEbaySnapshot } from './ebay-snapshot.service';

const ebayItem = (itemId: string, sku: string, qty = 1) => ({
  ItemID: itemId, Title: `Item ${itemId}`, SKU: sku, Quantity: qty, SellingStatus: { QuantitySold: 0 },
});
const dbRow = (o: Record<string, unknown> = {}) => ({
  itemId: '1', sku: 'S1', listingStatus: 'confirmed', lastSyncedQty: 1,
  lastSyncedPrice: null, errorCode: null, ruleTargetZero: false, ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  activePages = [{ pageNumber: 1, totalPages: 1, totalEntries: 1, items: [ebayItem('1', 'S1')] }];
  getDbListingRows.mockResolvedValue([dbRow()]);
});

describe('runEbaySnapshot', () => {
  it('persists snapshot rows + results, completes the run, purges old runs', async () => {
    const res = await runEbaySnapshot({ storeId: 94, trigger: 'cron' });
    expect(acquireSnapshotRun).toHaveBeenCalledWith(94, 'cron', undefined);
    expect(insertSnapshotRows).toHaveBeenCalledWith(7, expect.arrayContaining([expect.objectContaining({ itemId: '1', sku: 'S1' })]));
    expect(insertResults).toHaveBeenCalledWith(7, 94, expect.arrayContaining([expect.objectContaining({ category: 'managed_ok' })]));
    expect(completeRun).toHaveBeenCalledWith(7, expect.objectContaining({ listingsFetched: 1, variationsFetched: 1 }));
    expect(purgeOldRuns).toHaveBeenCalledWith(94, 14);
    expect(res.runId).toBe(7);
    expect(res.categoryCounts.managed_ok).toBe(1);
  });

  it('dry-run: classifies and reports but never acquires a lock or writes', async () => {
    const res = await runEbaySnapshot({ storeId: 94, trigger: 'cron', dryRun: true });
    expect(acquireSnapshotRun).not.toHaveBeenCalled();
    expect(insertSnapshotRows).not.toHaveBeenCalled();
    expect(insertResults).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
    expect(res.runId).toBeNull();
    expect(res.categoryCounts.managed_ok).toBe(1);
  });

  it('marks the run failed and deletes partial rows when a page fetch throws', async () => {
    activePages = [
      { pageNumber: 1, totalPages: 2, totalEntries: 400, items: [ebayItem('1', 'S1')] },
      Object.assign({ pageNumber: 2, totalPages: 2, totalEntries: 400, items: [] }, { throwError: true }),
    ];
    await expect(runEbaySnapshot({ storeId: 94, trigger: 'cron' })).rejects.toThrow('eBay 500');
    expect(failRun).toHaveBeenCalledWith(7, expect.stringContaining('eBay 500'));
    expect(insertResults).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
  });

  it('Browse-checks oversell suspects up to the cap and counts the unchecked remainder', async () => {
    activePages = [{
      pageNumber: 1, totalPages: 1, totalEntries: 3,
      items: [ebayItem('1', 'S1'), ebayItem('2', 'S2'), ebayItem('3', 'S3')],
    }];
    getDbListingRows.mockResolvedValue([
      dbRow({ itemId: '1', sku: 'S1', ruleTargetZero: true, lastSyncedQty: 0 }),
      dbRow({ itemId: '2', sku: 'S2', ruleTargetZero: true, lastSyncedQty: 0 }),
      dbRow({ itemId: '3', sku: 'S3', ruleTargetZero: true, lastSyncedQty: 0 }),
    ]);
    const res = await runEbaySnapshot({ storeId: 94, trigger: 'cron' });
    expect(getBrowseAvailability).toHaveBeenCalledTimes(2); // cap = 2 from config mock
    expect(res.browseChecked).toBe(2);
    expect(res.browseUnchecked).toBe(1);
    // browse fields ride along on the inserted results
    const inserted = insertResults.mock.calls[0][2] as Array<Record<string, unknown>>;
    expect(inserted.filter((r) => r.browseChecked === true)).toHaveLength(2);
    expect(inserted.filter((r) => r.browseStatus === 'IN_STOCK')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-snapshot.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ebay-snapshot.service.ts`**

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-snapshot.service.ts
/**
 * eBay reconciliation snapshot job (spec §4).
 *
 * Sweeps GetMyeBaySelling ActiveList (variations included), classifies every
 * (ItemID, SKU) pair against marketplace_listings store 94, Browse-verifies
 * oversell suspects (capped), persists snapshot + results, purges old runs.
 *
 * Failure semantics: any unrecovered error aborts the run — failRun() deletes
 * the partial child rows so a half sweep can never masquerade as a complete
 * snapshot (everything unseen would misclassify as managed_ghost).
 *
 * OOS-control assumption: store 94 has Out-of-Stock Control ON, so hidden
 * qty-0 listings remain in ActiveList and absence == genuinely ended. Recorded
 * in the run summary for the dashboard footnote.
 */
import { config } from '../../config';
import { getLogger } from '../../lib/logger-context';
import { createEbayClient } from '../../lib/marketplaces/ebay/client';
import { classifyListings, type ClassifierSnapshotRow } from './ebay-classifier';
import { parseActiveListingItem } from './ebay-snapshot.parse';
import {
  acquireSnapshotRun,
  insertSnapshotRows,
  getDbListingRows,
  insertResults,
  completeRun,
  failRun,
  purgeOldRuns,
  type ResultWithBrowse,
} from './ebay-reconciliation.db';

export const KEEP_COMPLETED_RUNS = 14;

export interface EbaySnapshotOptions {
  storeId: number;
  trigger: 'cron' | 'manual';
  triggeredBy?: string;
  /** When true: fetch + classify + report counts, but acquire no lock and write nothing. */
  dryRun?: boolean;
}

export interface EbaySnapshotResult {
  runId: number | null;
  dryRun: boolean;
  pages: number;
  listingsFetched: number;   // distinct ItemIDs seen on eBay
  variationRows: number;     // SKU-level snapshot rows
  categoryCounts: Record<string, number>;
  browseChecked: number;
  browseUnchecked: number;
}

export async function runEbaySnapshot(opts: EbaySnapshotOptions): Promise<EbaySnapshotResult> {
  const dryRun = opts.dryRun ?? false;
  const runId = dryRun ? null : await acquireSnapshotRun(opts.storeId, opts.trigger, opts.triggeredBy);
  return executeSnapshot(runId, opts.storeId, dryRun);
}

/** HTTP refresh path: acquire the lock NOW (409 surface), finish in background. */
export async function startEbaySnapshotAsync(storeId: number, triggeredBy: string): Promise<number> {
  const runId = await acquireSnapshotRun(storeId, 'manual', triggeredBy);
  void executeSnapshot(runId, storeId, false).catch((error) => {
    // executeSnapshot already failRun()s; this guard only prevents an unhandled rejection.
    getLogger().error({ runId, storeId, error }, 'eBay recon: background snapshot run failed');
  });
  return runId;
}

async function executeSnapshot(runId: number | null, storeId: number, dryRun: boolean): Promise<EbaySnapshotResult> {
  const logger = getLogger();
  try {
    const client = createEbayClient('ebay');
    await client.fetchAccessToken(`EBAY_SNAPSHOT_${storeId}`);

    // 1. Sweep ActiveList.
    const snapshotRows: ClassifierSnapshotRow[] = [];
    const itemIds = new Set<string>();
    let pages = 0;
    for await (const page of client.iterateActiveListings(storeId)) {
      pages = page.totalPages;
      for (const raw of page.items) {
        for (const row of parseActiveListingItem(raw)) {
          snapshotRows.push(row);
          itemIds.add(row.itemId);
        }
      }
      logger.info({ runId, storeId, page: page.pageNumber, of: page.totalPages, rows: snapshotRows.length }, 'eBay recon: page swept');
    }
    if (runId !== null) await insertSnapshotRows(runId, snapshotRows);

    // 2. Classify.
    const dbRows = await getDbListingRows(storeId);
    const results: ResultWithBrowse[] = classifyListings(snapshotRows, dbRows);

    // 3. Browse verification (buyer view) for the suspect set, capped (spec §6.3).
    const suspects = results.filter(
      (r) =>
        r.category === 'oversell_suspect' ||
        (r.category === 'qty_mismatch' && (r.dbLastSyncedQty ?? 0) === 0 && (r.ebayQtyAvailable ?? 0) > 0),
    );
    const cap = config.EBAY_RECON_BROWSE_CAP;
    const toCheck = suspects.slice(0, cap);
    for (const suspect of toCheck) {
      const avail = await client.getBrowseAvailability(storeId, suspect.itemId, suspect.sku ?? undefined);
      suspect.browseChecked = true;
      suspect.browseStatus = avail?.status ?? null;
      suspect.browseQty = avail?.qty ?? null;
    }
    const browseUnchecked = suspects.length - toCheck.length;
    if (browseUnchecked > 0) {
      logger.warn({ runId, storeId, browseUnchecked, cap }, 'eBay recon: Browse cap reached — remaining suspects left UNCHECKED (not safe)');
    }

    // 4. Finalize.
    const categoryCounts: Record<string, number> = {};
    for (const r of results) categoryCounts[r.category] = (categoryCounts[r.category] ?? 0) + 1;
    const summary = {
      categoryCounts,
      browseChecked: toCheck.length,
      browseUnchecked,
      oosControlAssumed: true,
      activeListingsOnEbay: itemIds.size,
    };
    if (runId !== null) {
      await insertResults(runId, storeId, results);
      await completeRun(runId, {
        pagesFetched: pages,
        listingsFetched: itemIds.size,
        variationsFetched: snapshotRows.length,
        summaryJson: JSON.stringify(summary),
      });
      await purgeOldRuns(storeId, KEEP_COMPLETED_RUNS);
    }

    const result: EbaySnapshotResult = {
      runId,
      dryRun,
      pages,
      listingsFetched: itemIds.size,
      variationRows: snapshotRows.length,
      categoryCounts,
      browseChecked: toCheck.length,
      browseUnchecked,
    };
    logger.info({ ...result }, dryRun ? 'eBay recon snapshot (dry-run) complete' : 'eBay recon snapshot complete');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId !== null) await failRun(runId, message);
    throw error;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-snapshot.service.test.ts`
Expected: PASS (4 tests). NOTE: this depends on Task 5's `insertResults` accepting `ResultWithBrowse` (browse fields persisted) — the Task 5 code already does.

- [ ] **Step 5: Add the CLI command** to `apps/api/src/modules/marketplaces/cli/ebay.commands.ts` (after the `reconcile-deleted` command, inside `registerEbayCommands`); add the import at the top:

```typescript
import { runEbaySnapshot } from '../../ebay-reconciliation/ebay-snapshot.service';
```

```typescript
  // Reconciliation snapshot: sweep everything active on eBay, classify against
  // marketplace_listings, persist for the dashboard. Writes unless --dry-run.
  ebay
    .command('snapshot-listings')
    .description('Snapshot all active eBay listings and reconcile against marketplace_listings (dashboard data). Use --dry-run to print counts without writing.')
    .option('--store-id <id>', 'Store ID to process (defaults to EBAY_STORE_ID)', (v) => parseInt(v, 10))
    .option('--dry-run', 'Fetch + classify + print category counts; no DB writes', false)
    .action(async (opts: { storeId?: number; dryRun?: boolean }) => {
      const storeId = opts.storeId ?? config.EBAY_STORE_ID;
      const dryRun = !!opts.dryRun;

      console.log('\neBay reconciliation snapshot');
      console.log(`  Store ID: ${storeId}`);
      console.log(`  Environment: ${isEbaySandboxEnvironment() ? 'SANDBOX' : 'LIVE'}`);
      console.log(`  Mode: ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE (persist snapshot + results)'}\n`);

      try {
        const r = await runEbaySnapshot({ storeId, trigger: 'cron', dryRun });
        console.log('─'.repeat(78));
        console.log(`  Run ID:                 ${r.runId ?? '(dry-run)'}`);
        console.log(`  Pages swept:            ${r.pages}`);
        console.log(`  Active ItemIDs on eBay: ${r.listingsFetched}`);
        console.log(`  Snapshot rows (SKUs):   ${r.variationRows}`);
        console.log(`  Browse checked:         ${r.browseChecked} (unchecked suspects: ${r.browseUnchecked})`);
        console.log('  Categories:');
        for (const [cat, count] of Object.entries(r.categoryCounts).sort((a, b) => b[1] - a[1])) {
          console.log(`    ${cat.padEnd(18)} ${count}`);
        }
        console.log('─'.repeat(78));
        process.exit(0);
      } catch (error) {
        const err = error as Error;
        console.error(`\n✗ Error: ${err.message}`);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
      }
    });
```

- [ ] **Step 6: Add the PM2 cron entry** to `ecosystem.config.cjs` `apps` array (daily 06:00, one-shot process):

```javascript
    {
      name: 'ebay-recon-snapshot',
      cwd: './apps/api',
      script: 'dist/cli.js',
      args: 'ebay snapshot-listings',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: false,           // one-shot job, NOT a server
      cron_restart: '0 6 * * *',    // daily 06:00 server time
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' },
      error_file: '/tmp/ebay-recon-snapshot-error.log',
      out_file: '/tmp/ebay-recon-snapshot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
```

- [ ] **Step 7: Smoke-test the CLI wiring (no eBay call)**

Run: `pnpm --filter @admin/api exec tsx src/cli.ts ebay snapshot-listings --help`
Expected: help text prints the new command with `--store-id` and `--dry-run` options.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/ebay-reconciliation/ebay-snapshot.service.ts apps/api/src/modules/ebay-reconciliation/ebay-snapshot.service.test.ts apps/api/src/modules/marketplaces/cli/ebay.commands.ts ecosystem.config.cjs
git commit -m "feat(ebay-recon): snapshot job service, ebay snapshot-listings CLI, daily PM2 cron"
```

---

### Task 7: Items/summary query builder + read routes + registration

**Files:**
- Create: `apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.query.ts`
- Create: `apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.routes.ts`
- Test: `apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.query.test.ts`
- Modify: `apps/api/src/app.ts` (register the module)

**Interfaces:**
- Consumes: Task 5 `getLatestCompletedRunId`, Task 6 `startEbaySnapshotAsync` + `SnapshotRunInProgressError` (Task 5), shared types (Task 1), `prisma`, `config.EBAY_STORE_ID`.
- Produces:

```typescript
// query file
export interface ReconItemsParams {
  runId: number; page: number; limit: number;
  sortBy?: string; sortOrder?: 'asc' | 'desc';
  categories?: string[]; search?: string; browseStatus?: string[];
}
export function buildItemsWhere(p: Pick<ReconItemsParams, 'runId' | 'categories' | 'search' | 'browseStatus'>): { where: string; values: unknown[] }
export function buildOrderBy(sortBy?: string, sortOrder?: 'asc' | 'desc'): string
export async function getReconciliationItems(p: ReconItemsParams): Promise<EbayReconItemsResponse>
export async function* iterateAllItems(p: Omit<ReconItemsParams, 'page' | 'limit'>): AsyncGenerator<EbayReconItem[]>   // keyset batches of 5000 for CSV
export async function getReconciliationSummary(storeId: number): Promise<EbayReconSummaryResponse>
// routes file
export const ebayReconciliationRoutes: FastifyPluginAsync
```

- [ ] **Step 1: Write failing builder tests**

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.query.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger-context', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { buildItemsWhere, buildOrderBy } from './ebay-reconciliation.query';

describe('buildItemsWhere', () => {
  it('always scopes to the run', () => {
    const { where, values } = buildItemsWhere({ runId: 5 });
    expect(where).toContain('r.run_id = ?');
    expect(values).toEqual([5]);
  });

  it('adds category IN with one placeholder per value', () => {
    const { where, values } = buildItemsWhere({ runId: 5, categories: ['unmanaged', 'managed_ghost'] });
    expect(where).toContain('r.category IN (?,?)');
    expect(values).toEqual([5, 'unmanaged', 'managed_ghost']);
  });

  it('adds a 3-column LIKE search', () => {
    const { where, values } = buildItemsWhere({ runId: 5, search: 'abc' });
    expect(where).toContain('r.item_id LIKE ?');
    expect(where).toContain('r.sku LIKE ?');
    expect(where).toContain('r.ebay_title LIKE ?');
    expect(values).toEqual([5, '%abc%', '%abc%', '%abc%']);
  });
});

describe('buildOrderBy', () => {
  it('whitelists sort columns and falls back to id', () => {
    expect(buildOrderBy('ebayQtyAvailable', 'desc')).toBe('ORDER BY r.ebay_qty_available DESC, r.id ASC');
    expect(buildOrderBy('evil;DROP TABLE', 'desc')).toBe('ORDER BY r.id DESC, r.id ASC');
    expect(buildOrderBy(undefined, undefined)).toBe('ORDER BY r.id ASC, r.id ASC');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-reconciliation.query.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ebay-reconciliation.query.ts`**

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.query.ts
/**
 * Read queries for the reconciliation dashboard. ONE builder powers both the
 * server-side DataTable (/items) and the CSV export (/items/export) — the
 * datatable-standards rule. Reads only jsa_ebay_* tables (precomputed diff).
 */
import { prisma } from '../../lib/prisma';
import type {
  EbayReconItem,
  EbayReconItemsResponse,
  EbayReconRunSummary,
  EbayReconSummaryResponse,
} from '@admin/shared';

const num = (v: unknown): number => Number((v as number | bigint | string) ?? 0);

/** UI sort key -> physical column. Anything else falls back to id (SQL-injection guard). */
const SORTABLE: Record<string, string> = {
  id: 'id',
  itemId: 'item_id',
  sku: 'sku',
  category: 'category',
  dbListingStatus: 'db_listing_status',
  dbLastSyncedQty: 'db_last_synced_qty',
  ebayQtyAvailable: 'ebay_qty_available',
  ebayPrice: 'ebay_price',
  browseStatus: 'browse_status',
  actionAt: 'action_at',
};

export interface ReconItemsParams {
  runId: number;
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  categories?: string[];
  search?: string;
  browseStatus?: string[];
}

export function buildItemsWhere(
  p: Pick<ReconItemsParams, 'runId' | 'categories' | 'search' | 'browseStatus'>,
): { where: string; values: unknown[] } {
  const conds: string[] = ['r.run_id = ?'];
  const values: unknown[] = [p.runId];
  if (p.categories && p.categories.length > 0) {
    conds.push(`r.category IN (${p.categories.map(() => '?').join(',')})`);
    values.push(...p.categories);
  }
  if (p.browseStatus && p.browseStatus.length > 0) {
    conds.push(`r.browse_status IN (${p.browseStatus.map(() => '?').join(',')})`);
    values.push(...p.browseStatus);
  }
  if (p.search && p.search.trim().length > 0) {
    conds.push('(r.item_id LIKE ? OR r.sku LIKE ? OR r.ebay_title LIKE ?)');
    const term = `%${p.search.trim()}%`;
    values.push(term, term, term);
  }
  return { where: conds.join(' AND '), values };
}

export function buildOrderBy(sortBy?: string, sortOrder?: 'asc' | 'desc'): string {
  const col = SORTABLE[sortBy ?? ''] ?? 'id';
  const dir = sortOrder === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY r.${col} ${dir}, r.id ASC`;
}

const SELECT_COLS = `
  r.id, r.run_id, r.item_id, r.sku, r.category,
  r.db_listing_status, r.db_last_synced_qty, r.db_last_synced_price, r.db_error_code,
  r.ebay_qty_available, r.ebay_price, r.ebay_title,
  r.browse_checked, r.browse_status, r.browse_qty,
  r.action_taken, r.action_at, r.action_by
`;

const rowToItem = (r: any): EbayReconItem => ({
  id: num(r.id),
  runId: num(r.run_id),
  itemId: String(r.item_id),
  sku: r.sku != null ? String(r.sku) : null,
  category: r.category,
  dbListingStatus: r.db_listing_status ?? null,
  dbLastSyncedQty: r.db_last_synced_qty != null ? num(r.db_last_synced_qty) : null,
  dbLastSyncedPrice: r.db_last_synced_price != null ? Number(r.db_last_synced_price) : null,
  dbErrorCode: r.db_error_code ?? null,
  ebayQtyAvailable: r.ebay_qty_available != null ? num(r.ebay_qty_available) : null,
  ebayPrice: r.ebay_price != null ? Number(r.ebay_price) : null,
  ebayTitle: r.ebay_title ?? null,
  browseChecked: Boolean(r.browse_checked),
  browseStatus: r.browse_status ?? null,
  browseQty: r.browse_qty != null ? num(r.browse_qty) : null,
  actionTaken: r.action_taken ?? null,
  actionAt: r.action_at ? new Date(r.action_at).toISOString() : null,
  actionBy: r.action_by ?? null,
});

export async function getReconciliationItems(p: ReconItemsParams): Promise<EbayReconItemsResponse> {
  const { where, values } = buildItemsWhere(p);
  const orderBy = buildOrderBy(p.sortBy, p.sortOrder);
  const offset = (p.page - 1) * p.limit;

  const countSql = `SELECT COUNT(*) AS total FROM jsa_ebay_reconciliation_results r WHERE ${where}`;
  const rowsSql = `SELECT ${SELECT_COLS} FROM jsa_ebay_reconciliation_results r WHERE ${where} ${orderBy} LIMIT ? OFFSET ?`;

  const [countRows, rows] = await Promise.all([
    prisma.$queryRawUnsafe<{ total: unknown }[]>(countSql, ...values),
    prisma.$queryRawUnsafe<any[]>(rowsSql, ...values, p.limit, offset),
  ]);
  const total = num(countRows[0]?.total);
  return {
    runId: p.runId,
    rows: rows.map(rowToItem),
    total,
    page: p.page,
    totalPages: Math.max(1, Math.ceil(total / p.limit)),
  };
}

/** Keyset batches for the streaming CSV export — same WHERE as /items. */
export async function* iterateAllItems(
  p: Omit<ReconItemsParams, 'page' | 'limit'>,
): AsyncGenerator<EbayReconItem[]> {
  const { where, values } = buildItemsWhere(p);
  const batchSize = 5000;
  let lastId = 0;
  for (;;) {
    const sql = `SELECT ${SELECT_COLS} FROM jsa_ebay_reconciliation_results r WHERE ${where} AND r.id > ? ORDER BY r.id ASC LIMIT ?`;
    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...values, lastId, batchSize);
    if (rows.length === 0) return;
    lastId = num(rows[rows.length - 1].id);
    yield rows.map(rowToItem);
    if (rows.length < batchSize) return;
  }
}

const runToSummary = (run: any): EbayReconRunSummary => {
  let parsed: any = {};
  try {
    parsed = run.summaryJson ? JSON.parse(run.summaryJson) : {};
  } catch {
    parsed = {};
  }
  return {
    runId: run.id,
    status: run.status,
    triggerSource: run.triggerSource,
    triggeredBy: run.triggeredBy ?? null,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    pagesFetched: run.pagesFetched,
    listingsFetched: run.listingsFetched,
    variationsFetched: run.variationsFetched,
    errorMessage: run.errorMessage ?? null,
    categoryCounts: parsed.categoryCounts ?? {},
    browseChecked: parsed.browseChecked ?? 0,
    browseUnchecked: parsed.browseUnchecked ?? 0,
    oosControlAssumed: parsed.oosControlAssumed ?? true,
  };
};

export async function getReconciliationSummary(storeId: number): Promise<EbayReconSummaryResponse> {
  const runs = await prisma.ebaySnapshotRun.findMany({
    where: { storeId },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  const latestCompleted = runs.find((r) => r.status === 'completed') ?? null;
  const running = runs.find((r) => r.status === 'running') ?? null;
  return {
    latestRun: latestCompleted ? runToSummary(latestCompleted) : null,
    runningRun: running ? runToSummary(running) : null,
    previousRuns: runs
      .filter((r) => r.id !== latestCompleted?.id && r.status !== 'running')
      .slice(0, 14)
      .map(runToSummary),
  };
}
```

- [ ] **Step 4: Run builder tests to verify they pass**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-reconciliation.query.test.ts`
Expected: PASS (5 tests).

**Deviation from spec §7 (deliberate):** no separate `GET /runs` endpoint — run history is served inside `GET /summary` (`previousRuns`, capped at 14, matching retention), which is the only consumer. Add a dedicated `/runs` later only if pagination of history is ever needed.

- [ ] **Step 5: Implement the read routes in `ebay-reconciliation.routes.ts`** (action routes are added in Task 9 — leave the marked slot):

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.routes.ts
/**
 * eBay Reconciliation Dashboard API (spec §7).
 * Reads require reports:view; POSTs (refresh + actions) require marketplace-sync:reconcile.
 * Responses wrapped { data: ... } per repo convention.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../config';
import { EBAY_RECON_CATEGORIES } from '@admin/shared';
import {
  getReconciliationItems,
  getReconciliationSummary,
  iterateAllItems,
} from './ebay-reconciliation.query';
import { getLatestCompletedRunId, SnapshotRunInProgressError } from './ebay-reconciliation.db';
import { startEbaySnapshotAsync } from './ebay-snapshot.service';

/** "a,b" | ["a","b"] | undefined -> validated string[] | undefined */
const csvArray = (allowed: readonly string[]) =>
  z.preprocess(
    (v) => (v == null ? undefined : Array.isArray(v) ? v : String(v).split(',').filter(Boolean)),
    z.array(z.enum(allowed as [string, ...string[]])).optional(),
  );

const itemsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().max(40).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  category: csvArray(EBAY_RECON_CATEGORIES),
  browseStatus: csvArray(['IN_STOCK', 'OUT_OF_STOCK', 'LIMITED_STOCK'] as const),
  search: z.string().max(100).optional(),
  runId: z.coerce.number().int().positive().optional(),
});

const exportQuerySchema = itemsQuerySchema.omit({ page: true, limit: true });

const csvEscape = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function requesterEmail(request: FastifyRequest): string {
  const user = request.user as { email?: string } | undefined;
  return user?.email ?? 'unknown';
}

export const ebayReconciliationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/summary', { preHandler: [app.requirePermission('reports', 'view')] }, async () => ({
    data: await getReconciliationSummary(config.EBAY_STORE_ID),
  }));

  app.get('/items', { preHandler: [app.requirePermission('reports', 'view')] }, async (request, reply) => {
    const parsed = itemsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const q = parsed.data;
    const runId = q.runId ?? (await getLatestCompletedRunId(config.EBAY_STORE_ID));
    if (runId === null) return reply.code(404).send({ error: 'No completed reconciliation run yet — trigger a snapshot first' });
    return {
      data: await getReconciliationItems({
        runId,
        page: q.page,
        limit: q.limit,
        sortBy: q.sortBy,
        sortOrder: q.sortOrder,
        categories: q.category,
        browseStatus: q.browseStatus,
        search: q.search,
      }),
    };
  });

  app.get('/items/export', { preHandler: [app.requirePermission('reports', 'view')] }, async (request, reply) => {
    const parsed = exportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const q = parsed.data;
    const runId = q.runId ?? (await getLatestCompletedRunId(config.EBAY_STORE_ID));
    if (runId === null) return reply.code(404).send({ error: 'No completed reconciliation run yet' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ebay-reconciliation-run-${runId}.csv"`,
    });
    reply.raw.write(
      'item_id,sku,category,db_status,db_qty,db_price,db_error_code,ebay_qty,ebay_price,ebay_title,browse_checked,browse_status,browse_qty,action_taken,action_at,action_by\n',
    );
    for await (const batch of iterateAllItems({
      runId,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
      categories: q.category,
      browseStatus: q.browseStatus,
      search: q.search,
    })) {
      const lines = batch
        .map((r) =>
          [
            r.itemId, r.sku, r.category, r.dbListingStatus, r.dbLastSyncedQty, r.dbLastSyncedPrice,
            r.dbErrorCode, r.ebayQtyAvailable, r.ebayPrice, r.ebayTitle, r.browseChecked,
            r.browseStatus, r.browseQty, r.actionTaken, r.actionAt, r.actionBy,
          ]
            .map(csvEscape)
            .join(','),
        )
        .join('\n');
      reply.raw.write(lines + '\n');
    }
    reply.raw.end();
    return reply;
  });

  app.post('/refresh', { preHandler: [app.requirePermission('marketplace-sync', 'reconcile')] }, async (request, reply) => {
    try {
      const runId = await startEbaySnapshotAsync(config.EBAY_STORE_ID, requesterEmail(request));
      return { data: { runId } };
    } catch (error) {
      if (error instanceof SnapshotRunInProgressError) {
        return reply.code(409).send({ error: 'A snapshot run is already in progress', runId: error.runId });
      }
      throw error;
    }
  });

  // --- Action routes (reactivate / relist / mark-gone / verify-oversell) are registered in Task 9 ---
};
```

- [ ] **Step 6: Register in `apps/api/src/app.ts`** — add the import next to the other module imports (~line 55) and the registration next to `ebayRoutes` (~line 358):

```typescript
import { ebayReconciliationRoutes } from './modules/ebay-reconciliation/ebay-reconciliation.routes';
```

```typescript
  await app.register(ebayReconciliationRoutes, { prefix: '/api/ebay-reconciliation' });
```

- [ ] **Step 7: Typecheck + boot check**

Run: `pnpm --filter @admin/api exec tsc --noEmit -p tsconfig.json`
Expected: clean. Then start the API (`pnpm --filter @admin/api dev`) and:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/ebay-reconciliation/summary
```

Expected: `401` (auth required — route registered).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.query.ts apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.query.test.ts apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.routes.ts apps/api/src/app.ts
git commit -m "feat(ebay-recon): summary/items query builder, read routes, streaming CSV export"
```

---

### Task 8: Action services (reactivate / relist-ghosts / mark-gone / verify-oversell)

**Files:**
- Create: `apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.service.ts`
- Test: `apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.service.test.ts`
- Modify: `apps/api/src/modules/marketplace-sync/marketplace-sync.query.ts` (`buildEbayRelistCandidatesQuery` gains an optional ghost filter — the quantity arms are NOT touched)
- Modify: `apps/api/src/modules/marketplace-sync/marketplace-sync.db.ts` (add `getEbayGhostRelistCandidates`)
- Modify: `apps/api/src/modules/ebay/ebay-relist.service.ts` (accept a `candidates` override)
- Modify: `apps/api/src/modules/ebay/ebay-relist.service.test.ts` (one new regression test)

**Interfaces:**
- Consumes: `createEbayClient` (`getItemListingStatus`, `getBrowseAvailability`, `fetchAccessToken`), `reactivateEbayFalseDeletes` (marketplace-sync.db), `relistEndedEbayListings` + `EbayRelistCandidate` (ebay-relist.service), Task 5 `markEbayListingsGone` / `updateResultBrowse`, `config.MARKETPLACE_EBAY_MAX_QUANTITY_CAP`, `prisma`.
- Produces (used by Task 9 routes):

```typescript
export interface ReconActionOptions { storeId: number; itemIds: string[]; dryRun: boolean }
export async function reactivateVerifiedItems(opts: ReconActionOptions): Promise<EbayReconActionOutcome[]>
export async function relistGhostItems(opts: ReconActionOptions): Promise<EbayReconActionOutcome[]>
export async function markGoneItems(opts: ReconActionOptions & { runId: number | null }): Promise<EbayReconActionOutcome[]>
export async function verifyOversellItems(opts: { storeId: number; runId: number; itemIds: string[] }): Promise<EbayReconActionOutcome[]>
// marketplace-sync.query.ts
export function buildEbayRelistCandidatesQuery(opts?: { ghostItemIdCount?: number }): string
// marketplace-sync.db.ts
export async function getEbayGhostRelistCandidates(storeId: number, itemIds: string[], maxQuantityCap: number): Promise<EbayRelistCandidate[]>
// ebay-relist.service.ts — RelistJobOptions gains:
//   candidates?: EbayRelistCandidate[]   // skip getEbayRelistCandidates, use these
```

- [ ] **Step 1: Write the failing service tests**

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({
  config: { EBAY_STORE_ID: 94, MARKETPLACE_EBAY_MAX_QUANTITY_CAP: 1, EBAY_RECON_BROWSE_CAP: 200 },
}));
vi.mock('../../lib/logger-context', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const getItemListingStatus = vi.fn();
const getBrowseAvailability = vi.fn();
const fetchAccessToken = vi.fn().mockResolvedValue('token');
vi.mock('../../lib/marketplaces/ebay/client', () => ({
  createEbayClient: () => ({ fetchAccessToken, getItemListingStatus, getBrowseAvailability }),
}));

const reactivateEbayFalseDeletes = vi.fn().mockResolvedValue(2);
const getEbayGhostRelistCandidates = vi.fn().mockResolvedValue([]);
vi.mock('../marketplace-sync/marketplace-sync.db', () => ({
  reactivateEbayFalseDeletes: (...a: unknown[]) => reactivateEbayFalseDeletes(...a),
  getEbayGhostRelistCandidates: (...a: unknown[]) => getEbayGhostRelistCandidates(...a),
}));

const relistEndedEbayListings = vi.fn();
vi.mock('../ebay/ebay-relist.service', () => ({
  relistEndedEbayListings: (...a: unknown[]) => relistEndedEbayListings(...a),
}));

const markEbayListingsGone = vi.fn().mockResolvedValue(3);
const updateResultBrowse = vi.fn().mockResolvedValue(undefined);
const countGhostRowsForItems = vi.fn().mockResolvedValue(3);
const getResultRowsForVerify = vi.fn().mockResolvedValue([]);
vi.mock('./ebay-reconciliation.db', () => ({
  markEbayListingsGone: (...a: unknown[]) => markEbayListingsGone(...a),
  updateResultBrowse: (...a: unknown[]) => updateResultBrowse(...a),
  countGhostRowsForItems: (...a: unknown[]) => countGhostRowsForItems(...a),
  getResultRowsForVerify: (...a: unknown[]) => getResultRowsForVerify(...a),
}));

import {
  reactivateVerifiedItems,
  relistGhostItems,
  markGoneItems,
  verifyOversellItems,
} from './ebay-reconciliation.service';

beforeEach(() => vi.clearAllMocks());

describe('reactivateVerifiedItems', () => {
  it('verifies each ItemID first; reactivates only listings ACTIVE on eBay', async () => {
    getItemListingStatus.mockImplementation(async (_s: number, id: string) => (id === '1' ? 'active' : 'ended'));
    const outcomes = await reactivateVerifiedItems({ storeId: 94, itemIds: ['1', '2'], dryRun: false });
    expect(reactivateEbayFalseDeletes).toHaveBeenCalledTimes(1);
    expect(reactivateEbayFalseDeletes).toHaveBeenCalledWith(94, ['1']);
    expect(outcomes).toEqual([
      expect.objectContaining({ itemId: '1', action: 'reactivate' }),
      expect.objectContaining({ itemId: '2', action: 'not-active:ended' }),
    ]);
  });

  it('dry-run verifies (read-only GetItem) but never writes', async () => {
    getItemListingStatus.mockResolvedValue('active');
    const outcomes = await reactivateVerifiedItems({ storeId: 94, itemIds: ['1'], dryRun: true });
    expect(getItemListingStatus).toHaveBeenCalled();
    expect(reactivateEbayFalseDeletes).not.toHaveBeenCalled();
    expect(outcomes[0].action).toBe('reactivate');
  });
});

describe('relistGhostItems', () => {
  it('fetches ghost candidates and delegates to relistEndedEbayListings with the override', async () => {
    const candidates = [{ marketplace_listings_id: 1, marketplace_item_identifier: '10', products_sku: 'S', price_adjustment: 0, current_price: 9.99, specials_status: null, specials_price: null, normalized_quantity: 1 }];
    getEbayGhostRelistCandidates.mockResolvedValue(candidates);
    relistEndedEbayListings.mockResolvedValue({ outcomes: [{ itemId: '10', rows: 1, action: 'relist', dryRun: true }] });
    const outcomes = await relistGhostItems({ storeId: 94, itemIds: ['10', '11'], dryRun: true });
    expect(getEbayGhostRelistCandidates).toHaveBeenCalledWith(94, ['10', '11'], 1);
    expect(relistEndedEbayListings).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 94, dryRun: true, itemIds: ['10', '11'], candidates }),
    );
    // '11' had no sellable candidate -> reported, not silently dropped
    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: '10', action: 'relist' }),
        expect.objectContaining({ itemId: '11', action: 'skipped', detail: expect.stringContaining('no sellable stock') }),
      ]),
    );
  });
});

describe('markGoneItems', () => {
  it('dry-run counts affected rows without writing', async () => {
    const outcomes = await markGoneItems({ storeId: 94, itemIds: ['5'], dryRun: true, runId: 3 });
    expect(markEbayListingsGone).not.toHaveBeenCalled();
    expect(countGhostRowsForItems).toHaveBeenCalledWith(94, ['5']);
    expect(outcomes[0]).toMatchObject({ action: 'would-mark-gone', rows: 3 });
  });

  it('live marks rows gone (DB-only, never calls eBay)', async () => {
    const outcomes = await markGoneItems({ storeId: 94, itemIds: ['5'], dryRun: false, runId: 3 });
    expect(markEbayListingsGone).toHaveBeenCalledWith(94, ['5'], 3);
    expect(getItemListingStatus).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ action: 'marked-gone', rows: 3 });
  });
});

describe('verifyOversellItems', () => {
  it('Browse-checks each result row and persists the buyer-facing status', async () => {
    getResultRowsForVerify.mockResolvedValue([
      { id: 100, itemId: '1', sku: 'A' },
      { id: 101, itemId: '1', sku: 'B' },
    ]);
    getBrowseAvailability
      .mockResolvedValueOnce({ status: 'IN_STOCK', qty: 1 })
      .mockResolvedValueOnce(null); // unresolvable -> unchecked, never "safe"
    const outcomes = await verifyOversellItems({ storeId: 94, runId: 3, itemIds: ['1'] });
    expect(updateResultBrowse).toHaveBeenCalledWith(100, 'IN_STOCK', 1);
    expect(updateResultBrowse).toHaveBeenCalledWith(101, null, null);
    expect(outcomes).toEqual([
      expect.objectContaining({ itemId: '1', action: 'IN_STOCK' }),
      expect.objectContaining({ itemId: '1', action: 'unresolved' }),
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @admin/api exec vitest run src/modules/ebay-reconciliation/ebay-reconciliation.service.test.ts`
Expected: FAIL — module not found (and two missing db helpers).

- [ ] **Step 3: Add the two small db helpers** to `apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.db.ts`:

```typescript
/** Dry-run preview for mark-gone: how many live rows the UPDATE would touch. */
export async function countGhostRowsForItems(storeId: number, itemIds: string[]): Promise<number> {
  if (itemIds.length === 0) return 0;
  const placeholders = itemIds.map(() => '?').join(',');
  const rows = await prisma.$queryRawUnsafe<{ total: unknown }[]>(
    `SELECT COUNT(*) AS total FROM marketplace_listings
     WHERE store_id = ? AND marketplace_item_identifier IN (${placeholders})
       AND marketplace_listing_status IN ('active','confirmed')`,
    storeId,
    ...itemIds,
  );
  return Number(rows[0]?.total ?? 0);
}

/** Result rows eligible for a targeted Browse re-check. */
export async function getResultRowsForVerify(
  runId: number,
  itemIds: string[],
): Promise<{ id: number; itemId: string; sku: string | null }[]> {
  const rows = await prisma.ebayReconciliationResult.findMany({
    where: { runId, itemId: { in: itemIds }, category: { in: ['oversell_suspect', 'qty_mismatch'] } },
    select: { id: true, itemId: true, sku: true },
  });
  return rows.map((r) => ({ id: r.id, itemId: r.itemId, sku: r.sku }));
}
```

- [ ] **Step 4: Extend `buildEbayRelistCandidatesQuery`** in `apps/api/src/modules/marketplace-sync/marketplace-sync.query.ts`. Change ONLY the signature, the doc comment's placeholder list, and the status WHERE block — the quantity CASE/arms stay byte-identical:

```typescript
/**
 * `?` placeholders, in order: maxQuantityCap ×3 (quantity CASE), storeId,
 * [ghost ItemIDs... when opts.ghostItemIdCount is set], limit.
 */
export function buildEbayRelistCandidatesQuery(opts?: { ghostItemIdCount?: number }): string {
```

and replace the two status lines inside the WHERE:

```typescript
  const statusWhere =
    opts?.ghostItemIdCount && opts.ghostItemIdCount > 0
      ? `ml.marketplace_listing_status IN ('active','confirmed')
        AND ml.marketplace_item_identifier IN (${Array(opts.ghostItemIdCount).fill('?').join(',')})`
      : `ml.marketplace_listing_status = 'deleted'
        AND ml.api_last_error_code = '21916750'`;
```

then in the template swap:

```
        AND ml.marketplace_listing_status = 'deleted'
        AND ml.api_last_error_code = '21916750'
```

for:

```
        AND ${statusWhere}
```

- [ ] **Step 5: Add `getEbayGhostRelistCandidates`** to `apps/api/src/modules/marketplace-sync/marketplace-sync.db.ts`, next to `getEbayRelistCandidates`. First extract the row mapper from `getEbayRelistCandidates` into a module-level helper and reuse it in both (DRY):

```typescript
const mapRelistCandidateRow = (r: any): EbayRelistCandidate => ({
  marketplace_listings_id: Number(r.marketplace_listings_id),
  marketplace_item_identifier: String(r.marketplace_item_identifier),
  products_sku: String(r.products_sku),
  price_adjustment: Number(r.price_adjustment ?? 0),
  current_price: Number(r.current_price ?? 0),
  specials_status: r.specials_status ?? null,
  specials_price: r.specials_price !== null && r.specials_price !== undefined ? Number(r.specials_price) : null,
  normalized_quantity: Number(r.normalized_quantity),
});

/**
 * Relist candidates for GHOST rows (live in DB, absent from eBay's ActiveList):
 * same quantity arms and normalized_quantity > 0 filter as the 21916750 path,
 * but scoped to explicit ItemIDs with live DB status. Ghosts without sellable
 * stock are correctly excluded here — mark-gone is their cleanup path.
 */
export async function getEbayGhostRelistCandidates(
  storeId: number,
  itemIds: string[],
  maxQuantityCap: number,
): Promise<EbayRelistCandidate[]> {
  if (itemIds.length === 0) return [];
  const query = buildEbayRelistCandidatesQuery({ ghostItemIdCount: itemIds.length });
  const rows = await (prisma.$queryRawUnsafe as <T = unknown>(q: string, ...v: any[]) => Promise<T>)<any[]>(
    query,
    maxQuantityCap,
    maxQuantityCap,
    maxQuantityCap,
    storeId,
    ...itemIds,
    itemIds.length * 50, // generous limit: every variation row of every requested ItemID
  );
  return rows.map(mapRelistCandidateRow);
}
```

- [ ] **Step 6: Add the `candidates` override to `ebay-relist.service.ts`** — in `RelistJobOptions`:

```typescript
  /** If set, use these candidates instead of querying (ghost-relist path). */
  candidates?: EbayRelistCandidate[];
```

and in `relistEndedEbayListings` replace the fetch line:

```typescript
  const candidates = opts.candidates ?? (await getEbayRelistCandidates(storeId, maxQuantityCap, limit));
```

Add one regression test to `ebay-relist.service.test.ts` (inside the existing `describe`, reusing its mocks):

```typescript
  it('uses the candidates override without querying the deleted-ended set', async () => {
    getItemListingStatus.mockResolvedValue('active');
    const candidates = [candidate({ marketplace_item_identifier: '77' })]; // reuse the file's existing candidate fixture helper
    const result = await relistEndedEbayListings({ storeId: 94, dryRun: true, limit: 10, candidates });
    expect(getEbayRelistCandidates).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ itemId: '77', action: 'reactivate' });
  });
```

(If the test file's fixture helper has a different name, follow its existing convention — the assertion pair is what matters.)

- [ ] **Step 7: Implement `ebay-reconciliation.service.ts`**

```typescript
// apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.service.ts
/**
 * Dashboard actions (spec §7). Every action is verify-first and dry-run-first:
 *  - reactivate: GetItem-verify ACTIVE before restoring rows (false-delete fix)
 *  - relist:     delegates to relistEndedEbayListings (GetItem-verify inside)
 *  - mark-gone:  DB-only; never calls eBay
 *  - verify-oversell: Browse (buyer view) re-check; read-only against eBay
 */
import { config } from '../../config';
import { getLogger } from '../../lib/logger-context';
import { createEbayClient } from '../../lib/marketplaces/ebay/client';
import {
  reactivateEbayFalseDeletes,
  getEbayGhostRelistCandidates,
} from '../marketplace-sync/marketplace-sync.db';
import { relistEndedEbayListings } from '../ebay/ebay-relist.service';
import {
  markEbayListingsGone,
  countGhostRowsForItems,
  getResultRowsForVerify,
  updateResultBrowse,
} from './ebay-reconciliation.db';
import type { EbayReconActionOutcome } from '@admin/shared';

export interface ReconActionOptions {
  storeId: number;
  itemIds: string[];
  dryRun: boolean;
}

export async function reactivateVerifiedItems(opts: ReconActionOptions): Promise<EbayReconActionOutcome[]> {
  const { storeId, itemIds, dryRun } = opts;
  const client = createEbayClient('ebay');
  await client.fetchAccessToken(`EBAY_RECON_REACTIVATE_${storeId}`);

  const outcomes: EbayReconActionOutcome[] = [];
  for (const itemId of itemIds) {
    const status = await client.getItemListingStatus(storeId, itemId);
    if (status === 'active') {
      if (!dryRun) await reactivateEbayFalseDeletes(storeId, [itemId]);
      outcomes.push({ itemId, action: 'reactivate' });
    } else {
      // Not live on eBay: reactivating would put a dead listing back in the
      // sync set — refuse, report what eBay said instead.
      outcomes.push({ itemId, action: `not-active:${status}` });
    }
  }
  getLogger().info({ storeId, dryRun, requested: itemIds.length }, 'eBay recon action: reactivate');
  return outcomes;
}

export async function relistGhostItems(opts: ReconActionOptions): Promise<EbayReconActionOutcome[]> {
  const { storeId, itemIds, dryRun } = opts;
  const maxQuantityCap = config.MARKETPLACE_EBAY_MAX_QUANTITY_CAP ?? 0;
  const candidates = await getEbayGhostRelistCandidates(storeId, itemIds, maxQuantityCap);

  const result = await relistEndedEbayListings({ storeId, dryRun, limit: itemIds.length, itemIds, candidates });
  const outcomes: EbayReconActionOutcome[] = result.outcomes.map((o) => ({
    itemId: o.itemId,
    action: o.action,
    rows: o.rows,
    newItemId: o.newItemId,
    detail: o.errorMessage,
  }));

  // ItemIDs with no sellable candidate (rule target 0 / no stock): report, never drop silently.
  const covered = new Set(candidates.map((c) => c.marketplace_item_identifier));
  for (const itemId of itemIds) {
    if (!covered.has(itemId)) {
      outcomes.push({ itemId, action: 'skipped', detail: 'no sellable stock (rule target 0) — use mark-gone instead' });
    }
  }
  return outcomes;
}

export async function markGoneItems(opts: ReconActionOptions & { runId: number | null }): Promise<EbayReconActionOutcome[]> {
  const { storeId, itemIds, dryRun, runId } = opts;
  if (dryRun) {
    const rows = await countGhostRowsForItems(storeId, itemIds);
    return [{ itemId: itemIds.join(','), action: 'would-mark-gone', rows }];
  }
  const rows = await markEbayListingsGone(storeId, itemIds, runId);
  return [{ itemId: itemIds.join(','), action: 'marked-gone', rows }];
}

export async function verifyOversellItems(opts: {
  storeId: number;
  runId: number;
  itemIds: string[];
}): Promise<EbayReconActionOutcome[]> {
  const { storeId, runId, itemIds } = opts;
  const client = createEbayClient('ebay');
  await client.fetchAccessToken(`EBAY_RECON_VERIFY_${storeId}`);

  const rows = await getResultRowsForVerify(runId, itemIds);
  const outcomes: EbayReconActionOutcome[] = [];
  for (const row of rows) {
    const avail = await client.getBrowseAvailability(storeId, row.itemId, row.sku ?? undefined);
    await updateResultBrowse(row.id, avail?.status ?? null, avail?.qty ?? null);
    outcomes.push({
      itemId: row.itemId,
      action: avail?.status ?? 'unresolved',
      detail: row.sku ?? undefined,
    });
  }
  return outcomes;
}
```

- [ ] **Step 8: Run all API tests**

Run: `pnpm --filter @admin/api test`
Expected: all PASS — including the untouched relist suite (the candidates override must not change existing behavior) and the new service tests.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.service.ts apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.service.test.ts apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.db.ts apps/api/src/modules/marketplace-sync/marketplace-sync.query.ts apps/api/src/modules/marketplace-sync/marketplace-sync.db.ts apps/api/src/modules/ebay/ebay-relist.service.ts apps/api/src/modules/ebay/ebay-relist.service.test.ts
git commit -m "feat(ebay-recon): verify-first action services (reactivate/relist-ghosts/mark-gone/verify-oversell)"
```

---

### Task 9: Action routes + audit log wiring + permission seed

**Files:**
- Modify: `apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.routes.ts` (replace the Task 7 placeholder comment)
- Modify: `apps/api/prisma/seeds/seed-mysql.ts` (seed `marketplace-sync:reconcile`)

**Interfaces:**
- Consumes: Task 8 action services, Task 5 `insertActionLog` / `markResultsActioned`, `requesterEmail` (Task 7).
- Produces: `POST /api/ebay-reconciliation/actions/{reactivate|relist|mark-gone|verify-oversell}`, each returning `{ data: EbayReconActionResponse }`; permission `marketplace-sync:reconcile` for Super Admin + Admin.

- [ ] **Step 1: Replace the action-routes placeholder in `ebay-reconciliation.routes.ts`** with:

```typescript
  // ---------- Actions (spec §7): dry-run default, audited, verify-first ----------
  const actionBodySchema = z.object({
    itemIds: z.array(z.string().min(3).max(20)).min(1).max(500),
    dryRun: z.boolean().default(true),
    runId: z.coerce.number().int().positive().optional(),
  });

  type ActionName = 'reactivate' | 'relist' | 'mark_gone' | 'verify_oversell';
  const registerAction = (
    path: string,
    action: ActionName,
    exec: (args: { itemIds: string[]; dryRun: boolean; runId: number | null }) => Promise<import('@admin/shared').EbayReconActionOutcome[]>,
  ) => {
    app.post(path, { preHandler: [app.requirePermission('marketplace-sync', 'reconcile')] }, async (request, reply) => {
      const parsed = actionBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const { itemIds, dryRun } = parsed.data;
      const runId = parsed.data.runId ?? null;
      const requestedBy = requesterEmail(request);
      try {
        const outcomes = await exec({ itemIds, dryRun, runId });
        await insertActionLog({ runId, action, itemIds, dryRun, requestedBy, outcomeJson: JSON.stringify(outcomes), status: 'completed' });
        if (!dryRun && runId !== null) await markResultsActioned(runId, itemIds, action, requestedBy);
        return { data: { action, dryRun, requested: itemIds.length, outcomes } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await insertActionLog({ runId, action, itemIds, dryRun, requestedBy, outcomeJson: JSON.stringify({ error: message }), status: 'failed' });
        throw error;
      }
    });
  };

  registerAction('/actions/reactivate', 'reactivate', ({ itemIds, dryRun }) =>
    reactivateVerifiedItems({ storeId: config.EBAY_STORE_ID, itemIds, dryRun }));

  registerAction('/actions/relist', 'relist', ({ itemIds, dryRun }) =>
    relistGhostItems({ storeId: config.EBAY_STORE_ID, itemIds, dryRun }));

  registerAction('/actions/mark-gone', 'mark_gone', ({ itemIds, dryRun, runId }) =>
    markGoneItems({ storeId: config.EBAY_STORE_ID, itemIds, dryRun, runId }));

  registerAction('/actions/verify-oversell', 'verify_oversell', async ({ itemIds, runId }) => {
    const effectiveRunId = runId ?? (await getLatestCompletedRunId(config.EBAY_STORE_ID));
    if (effectiveRunId === null) return [];
    return verifyOversellItems({ storeId: config.EBAY_STORE_ID, runId: effectiveRunId, itemIds });
  });
```

Add the imports at the top of the routes file:

```typescript
import { insertActionLog, markResultsActioned } from './ebay-reconciliation.db';
import {
  reactivateVerifiedItems,
  relistGhostItems,
  markGoneItems,
  verifyOversellItems,
} from './ebay-reconciliation.service';
```

- [ ] **Step 2: Seed the permission** in `apps/api/prisma/seeds/seed-mysql.ts`, following the existing multi-role upsert pattern (~line 157, next to the COO-report block):

```typescript
  // eBay reconciliation dashboard actions (reads use reports:view)
  for (const role of [superAdminRole, adminRole]) {
    await prisma.permission.upsert({
      where: { roleId_resource_action: { roleId: role.id, resource: 'marketplace-sync', action: 'reconcile' } },
      update: {},
      create: { roleId: role.id, resource: 'marketplace-sync', action: 'reconcile' },
    });
  }
```

- [ ] **Step 3: Apply the seed and verify**

Run: `DATABASE_PROVIDER=mysql npx tsx apps/api/prisma/seeds/seed-mysql.ts`
Expected: completes without error (all upserts idempotent). Verify:

```bash
mysql ... -e "SELECT resource, action FROM jsa_permissions WHERE resource='marketplace-sync' AND action='reconcile';"
```

Expected: 2 rows (Super Admin + Admin roles).

- [ ] **Step 4: Typecheck + manual smoke**

Run: `pnpm --filter @admin/api exec tsc --noEmit -p tsconfig.json`
Expected: clean. With the API running and a valid admin JWT:

```bash
curl -s -X POST http://localhost:4000/api/ebay-reconciliation/actions/mark-gone \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"itemIds":["000000000000"],"dryRun":true}'
```

Expected: `{"data":{"action":"mark_gone","dryRun":true,"requested":1,"outcomes":[{"itemId":"000000000000","action":"would-mark-gone","rows":0}]}}` and one new row in `jsa_ebay_reconciliation_actions`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ebay-reconciliation/ebay-reconciliation.routes.ts apps/api/prisma/seeds/seed-mysql.ts
git commit -m "feat(ebay-recon): audited action routes behind marketplace-sync:reconcile permission"
```

---

### Task 10: Frontend hooks

**Files:**
- Create: `apps/web/src/pages/reports/hooks/useEbayReconciliation.ts`

**Interfaces:**
- Consumes: `api` (`@/lib/api`), shared types (`@admin/shared`), TanStack Query.
- Produces (used by Task 11):

```typescript
export function useEbayReconSummary()                         // GET /ebay-reconciliation/summary, refetch 30s while a run is in flight
export function useEbayReconItems(params: EbayReconItemsParams)  // GET /ebay-reconciliation/items
export function useEbayReconRefresh()                         // POST /ebay-reconciliation/refresh
export function useEbayReconAction()                          // POST /ebay-reconciliation/actions/:action
export function downloadEbayReconCsv(params): Promise<void>   // GET /items/export as blob download
export interface EbayReconItemsParams { page: number; limit: number; sortBy?: string; sortOrder?: 'asc' | 'desc'; category?: string[]; search?: string }
```

- [ ] **Step 1: Implement the hooks file** (conventions from `useMarketplaceSyncPerformance.ts` / `useMarketplaceSales.ts`):

```typescript
// apps/web/src/pages/reports/hooks/useEbayReconciliation.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  EbayReconActionName,
  EbayReconActionResponse,
  EbayReconItemsResponse,
  EbayReconSummaryResponse,
} from '@admin/shared';

export interface EbayReconItemsParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  category?: string[];
  search?: string;
}

export function useEbayReconSummary() {
  return useQuery({
    queryKey: ['ebay-recon-summary'],
    queryFn: async () =>
      (await api.get<{ data: EbayReconSummaryResponse }>('/ebay-reconciliation/summary')).data.data,
    staleTime: 0,
    refetchOnWindowFocus: false,
    // Poll while a snapshot run is in flight so the header progress updates.
    refetchInterval: (query) => (query.state.data?.runningRun ? 30_000 : false),
  });
}

export function useEbayReconItems(params: EbayReconItemsParams) {
  return useQuery({
    queryKey: ['ebay-recon-items', params],
    queryFn: async () =>
      (
        await api.get<{ data: EbayReconItemsResponse }>('/ebay-reconciliation/items', {
          params: { ...params, category: params.category?.join(',') || undefined },
        })
      ).data.data,
    staleTime: 0,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev, // keep rows while paging
  });
}

export function useEbayReconRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.post<{ data: { runId: number } }>('/ebay-reconciliation/refresh')).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ebay-recon-summary'] }),
  });
}

export interface EbayReconActionInput {
  action: EbayReconActionName;
  itemIds: string[];
  dryRun: boolean;
  runId?: number;
}

const ACTION_PATHS: Record<EbayReconActionName, string> = {
  reactivate: 'reactivate',
  relist: 'relist',
  mark_gone: 'mark-gone',
  verify_oversell: 'verify-oversell',
};

export function useEbayReconAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, ...body }: EbayReconActionInput) =>
      (
        await api.post<{ data: EbayReconActionResponse }>(
          `/ebay-reconciliation/actions/${ACTION_PATHS[action]}`,
          body,
        )
      ).data.data,
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) {
        qc.invalidateQueries({ queryKey: ['ebay-recon-items'] });
        qc.invalidateQueries({ queryKey: ['ebay-recon-summary'] });
      }
    },
  });
}

export async function downloadEbayReconCsv(params: Omit<EbayReconItemsParams, 'page' | 'limit'>): Promise<void> {
  const res = await api.get('/ebay-reconciliation/items/export', {
    params: { ...params, category: params.category?.join(',') || undefined },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ebay-reconciliation.csv';
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Typecheck the web app**

Run: `pnpm --filter @admin/web exec tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/reports/hooks/useEbayReconciliation.ts
git commit -m "feat(ebay-recon): frontend data hooks for summary, items, refresh, actions, CSV"
```

---

### Task 11: Dashboard page, route, sidebar entry

**Files:**
- Create: `apps/web/src/pages/reports/ebay-reconciliation/EbayReconciliationPage.tsx`
- Create: `apps/web/src/pages/reports/ebay-reconciliation/ReconActionDialog.tsx`
- Modify: `apps/web/src/App.tsx` (lazy import + route)
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (menu entry)

**Interfaces:**
- Consumes: Task 10 hooks, `DataTable`/`useDataTable` from `@/components/data-table`, `usePermission` from `@/hooks/useAuth`, shadcn UI primitives (`@/components/ui/*` — match the imports used by `MarketplaceSyncPerformance.tsx`), shared types.
- Produces: route `/reports/ebay-reconciliation` (gated `reports:view`), default-exported page component.

- [ ] **Step 1: Create `ReconActionDialog.tsx`** — the two-step (dry-run preview → live confirm) dialog every action goes through:

```tsx
// apps/web/src/pages/reports/ebay-reconciliation/ReconActionDialog.tsx
/**
 * Two-step action dialog (spec §8): step 1 shows the DRY-RUN plan returned by
 * the API; the live run is a second explicit confirmation. Never fires a live
 * mutation without a previewed dry-run in the same dialog session.
 */
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEbayReconAction } from '../hooks/useEbayReconciliation';
import type { EbayReconActionName, EbayReconActionResponse } from '@admin/shared';

const ACTION_LABELS: Record<EbayReconActionName, string> = {
  reactivate: 'Reactivate false-deletes (verifies each ItemID is live on eBay first)',
  relist: 'Relist ghosts with stock (GetItem-verified; live listings are reactivated, never duplicated)',
  mark_gone: 'Mark gone in DB only (sync stops considering these rows; eBay is never called)',
  verify_oversell: 'Re-check buyer-facing availability via the Browse API (read-only)',
};

interface Props {
  action: EbayReconActionName | null;
  itemIds: string[];
  runId?: number;
  onClose: () => void;
}

export function ReconActionDialog({ action, itemIds, runId, onClose }: Props) {
  const mutation = useEbayReconAction();
  const [preview, setPreview] = useState<EbayReconActionResponse | null>(null);
  const [liveResult, setLiveResult] = useState<EbayReconActionResponse | null>(null);

  // Fetch the dry-run preview whenever the dialog opens for an action.
  useEffect(() => {
    setPreview(null);
    setLiveResult(null);
    if (action && itemIds.length > 0) {
      mutation.mutate({ action, itemIds, dryRun: true, runId }, { onSuccess: setPreview });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, itemIds.join(',')]);

  if (!action) return null;
  const isReadOnly = action === 'verify_oversell';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirm: {action.replace('_', ' ')}</DialogTitle>
          <DialogDescription>{ACTION_LABELS[action]} — {itemIds.length} ItemID(s) selected.</DialogDescription>
        </DialogHeader>

        {mutation.isPending && !preview && <p className="text-sm text-muted-foreground">Running dry-run preview…</p>}
        {mutation.isError && <p className="text-sm text-destructive">Failed: {(mutation.error as Error).message}</p>}

        {(liveResult ?? preview) && (
          <div className="max-h-64 overflow-y-auto rounded border p-2 text-sm font-mono">
            <p className="mb-2 font-sans font-medium">
              {liveResult ? 'Live result' : 'Dry-run plan'} — {(liveResult ?? preview)!.outcomes.length} outcome(s)
            </p>
            {(liveResult ?? preview)!.outcomes.map((o, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <Badge variant="outline">{o.action}</Badge>
                <span>{o.itemId}</span>
                {o.newItemId && <span className="text-muted-foreground">→ {o.newItemId}</span>}
                {o.rows !== undefined && <span className="text-muted-foreground">({o.rows} rows)</span>}
                {o.detail && <span className="text-muted-foreground truncate">{o.detail}</span>}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {!liveResult && preview && !isReadOnly && (
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({ action, itemIds, dryRun: false, runId }, { onSuccess: setLiveResult })
              }
            >
              Apply live to eBay/DB
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `EbayReconciliationPage.tsx`**

```tsx
// apps/web/src/pages/reports/ebay-reconciliation/EbayReconciliationPage.tsx
/**
 * eBay Reconciliation Dashboard (spec §8): snapshot age + summary cards +
 * server-side reconciliation DataTable + verify-first bulk actions + run history.
 */
import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { RefreshCw, Download, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, useDataTable } from '@/components/data-table';
import { usePermission } from '@/hooks/useAuth';
import {
  useEbayReconSummary,
  useEbayReconItems,
  useEbayReconRefresh,
  downloadEbayReconCsv,
} from '../hooks/useEbayReconciliation';
import { ReconActionDialog } from './ReconActionDialog';
import type { EbayReconActionName, EbayReconCategory, EbayReconItem } from '@admin/shared';

const CATEGORY_BADGES: Record<EbayReconCategory, { label: string; className: string }> = {
  unmanaged: { label: 'Unmanaged (client)', className: 'bg-blue-100 text-blue-800' },
  status_mismatch: { label: 'Status mismatch', className: 'bg-red-100 text-red-800' },
  managed_ghost: { label: 'Ghost (not on eBay)', className: 'bg-amber-100 text-amber-800' },
  unmatched_sku: { label: 'Unmatched SKU', className: 'bg-purple-100 text-purple-800' },
  oversell_suspect: { label: 'Oversell suspect', className: 'bg-red-200 text-red-900' },
  qty_mismatch: { label: 'Qty mismatch', className: 'bg-orange-100 text-orange-800' },
  price_mismatch: { label: 'Price mismatch', className: 'bg-yellow-100 text-yellow-800' },
  managed_ok: { label: 'OK', className: 'bg-green-100 text-green-800' },
};

/** Which bulk action makes sense per category filter (spec §8 point 4). */
const CATEGORY_ACTIONS: Partial<Record<EbayReconCategory, EbayReconActionName[]>> = {
  status_mismatch: ['reactivate'],
  managed_ghost: ['relist', 'mark_gone'],
  oversell_suspect: ['verify_oversell'],
  qty_mismatch: ['verify_oversell'],
};

const ageOf = (iso: string): { text: string; tone: 'ok' | 'warn' | 'bad' } => {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 24) return { text: `${Math.round(hours)}h ago`, tone: 'ok' };
  if (hours < 48) return { text: `${Math.round(hours)}h ago`, tone: 'warn' };
  return { text: `${Math.round(hours / 24)}d ago`, tone: 'bad' };
};

export default function EbayReconciliationPage() {
  const { can } = usePermission();
  const canAct = can('marketplace-sync:reconcile');

  const [categoryFilter, setCategoryFilter] = useState<EbayReconCategory | null>(null);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<{ action: EbayReconActionName; itemIds: string[] } | null>(null);

  const summary = useEbayReconSummary();
  const refresh = useEbayReconRefresh();
  const { pagination, setPagination, sorting, setSorting, queryParams } = useDataTable({ pageSize: 25 });

  const items = useEbayReconItems({
    page: queryParams.page,
    limit: queryParams.limit,
    sortBy: queryParams.sortBy,
    sortOrder: queryParams.sortOrder,
    search: queryParams.search,
    category: categoryFilter ? [categoryFilter] : undefined,
  });

  const latest = summary.data?.latestRun ?? null;
  const running = summary.data?.runningRun ?? null;
  const selectedItemIds = useMemo(() => {
    const byRowId = new Map((items.data?.rows ?? []).map((r) => [String(r.id), r.itemId]));
    return [...new Set(Object.keys(rowSelection).filter((k) => rowSelection[k]).map((k) => byRowId.get(k)).filter(Boolean))] as string[];
  }, [rowSelection, items.data]);

  const columns: ColumnDef<EbayReconItem>[] = useMemo(
    () => [
      {
        accessorKey: 'itemId',
        header: 'eBay ItemID',
        cell: ({ row }) => (
          <a
            href={`https://www.ebay.co.uk/itm/${row.original.itemId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {row.original.itemId}
            <ExternalLink className="h-3 w-3" />
          </a>
        ),
      },
      { accessorKey: 'sku', header: 'SKU', cell: ({ row }) => row.original.sku ?? '—' },
      {
        accessorKey: 'category',
        header: 'Category',
        cell: ({ row }) => {
          const b = CATEGORY_BADGES[row.original.category];
          return <Badge className={b.className}>{b.label}</Badge>;
        },
      },
      { accessorKey: 'dbListingStatus', header: 'DB status', cell: ({ row }) => row.original.dbListingStatus ?? '—' },
      {
        id: 'qty',
        header: 'Qty (DB ↔ eBay)',
        cell: ({ row }) => `${row.original.dbLastSyncedQty ?? '—'} ↔ ${row.original.ebayQtyAvailable ?? '—'}`,
      },
      {
        id: 'price',
        header: 'Price (DB ↔ eBay)',
        cell: ({ row }) => `${row.original.dbLastSyncedPrice ?? '—'} ↔ ${row.original.ebayPrice ?? '—'}`,
      },
      {
        accessorKey: 'browseStatus',
        header: 'Buyer view',
        cell: ({ row }) => {
          const r = row.original;
          if (!r.browseChecked) return <span className="text-muted-foreground">unchecked</span>;
          if (r.browseStatus === 'IN_STOCK') return <Badge className="bg-red-200 text-red-900">IN_STOCK ({r.browseQty ?? '?'})</Badge>;
          return <span>{r.browseStatus ?? 'unresolved'}</span>;
        },
      },
      {
        accessorKey: 'actionTaken',
        header: 'Last action',
        cell: ({ row }) =>
          row.original.actionTaken ? `${row.original.actionTaken} · ${row.original.actionBy ?? ''}` : '—',
      },
      { accessorKey: 'ebayTitle', header: 'Title', cell: ({ row }) => <span className="block max-w-[240px] truncate">{row.original.ebayTitle ?? '—'}</span> },
    ],
    [],
  );

  const cards: { key: EbayReconCategory | null; label: string; value: number | string }[] = [
    { key: null, label: 'Active on eBay', value: latest?.listingsFetched ?? '—' },
    { key: 'unmanaged', label: 'Unmanaged (client)', value: latest?.categoryCounts.unmanaged ?? 0 },
    { key: 'managed_ghost', label: 'Ghosts', value: latest?.categoryCounts.managed_ghost ?? 0 },
    { key: 'status_mismatch', label: 'Status mismatches', value: latest?.categoryCounts.status_mismatch ?? 0 },
    { key: 'oversell_suspect', label: 'Oversell suspects', value: latest?.categoryCounts.oversell_suspect ?? 0 },
    { key: 'qty_mismatch', label: 'Qty mismatches', value: latest?.categoryCounts.qty_mismatch ?? 0 },
  ];

  const availableActions = categoryFilter ? CATEGORY_ACTIONS[categoryFilter] ?? [] : [];

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">eBay Reconciliation</h1>
          {latest ? (
            <p className="text-sm text-muted-foreground">
              Snapshot run #{latest.runId} ·{' '}
              <Badge
                variant="outline"
                className={
                  ageOf(latest.startedAt).tone === 'ok'
                    ? 'text-green-700'
                    : ageOf(latest.startedAt).tone === 'warn'
                      ? 'text-amber-700'
                      : 'text-red-700'
                }
              >
                {ageOf(latest.startedAt).text}
              </Badge>{' '}
              · {latest.variationsFetched} SKUs across {latest.listingsFetched} listings
              {latest.browseUnchecked > 0 && (
                <span className="ml-2 text-amber-700">{latest.browseUnchecked} oversell suspects UNCHECKED (Browse cap)</span>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No completed snapshot yet — trigger a refresh.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => downloadEbayReconCsv({ category: categoryFilter ? [categoryFilter] : undefined, search: queryParams.search })}>
            <Download className="mr-1 h-4 w-4" /> CSV
          </Button>
          {canAct && (
            <Button onClick={() => refresh.mutate()} disabled={!!running || refresh.isPending}>
              <RefreshCw className={`mr-1 h-4 w-4 ${running ? 'animate-spin' : ''}`} />
              {running ? `Run #${running.runId} in progress…` : 'Refresh now'}
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards — click filters the table */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        {cards.map((c) => (
          <Card
            key={c.label}
            className={`cursor-pointer ${categoryFilter === c.key && c.key !== null ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setCategoryFilter(c.key === categoryFilter ? null : c.key)}
          >
            <CardHeader className="p-3 pb-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-1 text-xl font-semibold">{c.value}</CardContent>
          </Card>
        ))}
      </div>

      {/* Bulk action bar */}
      {canAct && availableActions.length > 0 && (
        <div className="flex items-center gap-2 rounded border bg-muted/40 p-2 text-sm">
          <span>{selectedItemIds.length} ItemID(s) selected</span>
          {availableActions.map((a) => (
            <Button
              key={a}
              size="sm"
              variant="outline"
              disabled={selectedItemIds.length === 0}
              onClick={() => setDialog({ action: a, itemIds: selectedItemIds.slice(0, 500) })}
            >
              {a.replace('_', ' ')}
            </Button>
          ))}
        </div>
      )}

      {/* Reconciliation table (server-side) */}
      <DataTable
        columns={columns}
        data={items.data?.rows ?? []}
        pageCount={items.data?.totalPages ?? 0}
        isLoading={items.isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        enableGlobalFilter
        searchPlaceholder="Search ItemID / SKU / title…"
        enableRowSelection={canAct}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        getRowId={(row) => String(row.id)}
      />

      {/* Run history */}
      <Card>
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm">Run history</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 text-sm">
          {(summary.data?.previousRuns ?? []).length === 0 && <p className="text-muted-foreground">No previous runs.</p>}
          {(summary.data?.previousRuns ?? []).map((r) => (
            <div key={r.runId} className="flex items-center gap-3 border-b py-1 last:border-0">
              <Badge variant={r.status === 'completed' ? 'outline' : 'destructive'}>{r.status}</Badge>
              <span>#{r.runId}</span>
              <span className="text-muted-foreground">{new Date(r.startedAt).toLocaleString()}</span>
              <span className="text-muted-foreground">{r.triggerSource}{r.triggeredBy ? ` · ${r.triggeredBy}` : ''}</span>
              <span>{r.listingsFetched} listings</span>
              {r.errorMessage && <span className="truncate text-red-700">{r.errorMessage}</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      {dialog && (
        <ReconActionDialog
          action={dialog.action}
          itemIds={dialog.itemIds}
          runId={items.data?.runId}
          onClose={() => {
            setDialog(null);
            setRowSelection({});
          }}
        />
      )}
    </div>
  );
}
```

**Note:** the global search box in `DataTable` feeds `queryParams.search` via `useDataTable` — confirm the hook wires `enableGlobalFilter` input into `queryParams.search` (it does for `UsersPage`); if this repo's variant exposes it differently, follow `UsersPage.tsx`'s exact wiring.

- [ ] **Step 3: Register route in `apps/web/src/App.tsx`** — lazy import next to the other report pages (~line 39):

```typescript
const EbayReconciliationPage = lazy(() => import('@/pages/reports/ebay-reconciliation/EbayReconciliationPage'));
```

Route next to `reports/sales-performance` (~line 152):

```tsx
<Route path="reports/ebay-reconciliation" element={<LazyPage><EbayReconciliationPage /></LazyPage>} />
```

- [ ] **Step 4: Add the sidebar entry** in `apps/web/src/components/layout/Sidebar.tsx` `menuItems` array, after the Sales Performance entry (~line 74). Import an icon already used in the file's style (e.g. `ListChecks` from `lucide-react`):

```typescript
  {
    label: 'eBay Reconciliation',
    icon: <ListChecks className="h-5 w-5" />,
    path: '/reports/ebay-reconciliation',
    permission: 'reports:view',
  },
```

- [ ] **Step 5: Build + manual verification**

Run: `pnpm --filter @admin/web exec tsc --noEmit -p tsconfig.json && pnpm build`
Expected: clean build.

Then `pnpm dev`, log in as `admin@example.com`, open `http://localhost:3002/reports/ebay-reconciliation` and verify: sidebar entry visible; page renders "No completed snapshot yet" (before any run) or the summary cards; table paginates/sorts server-side (watch the network tab — every interaction hits `/api/ebay-reconciliation/items`); action buttons hidden for users without `marketplace-sync:reconcile`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/reports/ebay-reconciliation/ apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(ebay-recon): reconciliation dashboard page with summary cards, server-side table, verify-first actions"
```

---

### Task 12: End-to-end verification + rollout (spec §11)

**Files:** none (verification + deployment)

- [ ] **Step 1: Full green sweep**

```bash
pnpm --filter @admin/api test && pnpm lint && pnpm build
```

Expected: all pass.

- [ ] **Step 2: Staging dry-run (read-only, safe)** — uses `.env.staging` credentials (shared production DB, read-only against eBay):

```bash
cd apps/api && npx tsx src/cli.ts ebay snapshot-listings --dry-run
```

Expected sanity checks against the verified baseline (2026-07-17):
- `Active ItemIDs on eBay` ≈ 13,600 (was 13,619)
- `Pages swept` ≈ 69
- `managed_ghost` ≈ 17,000 ItemID-level DB rows' worth (31,024 DB ItemIDs − overlap)
- `unmanaged` = the count of Simon's listings — record this number, it is the first time anyone has it
- `unmanaged + (managed ItemIDs matched)` ≈ `Active ItemIDs on eBay`

If `managed_ghost` ≈ 31k (i.e. nearly ALL DB items look absent), STOP — the ItemID match key is broken (check `marketplace_item_identifier` values against snapshot ItemIDs before proceeding).

- [ ] **Step 3: First persisted run + dashboard check on staging**

```bash
DATABASE_PROVIDER=mysql pnpm db:push          # staging window
npx tsx apps/api/prisma/seeds/seed-mysql.ts   # permission seed
npx tsx src/cli.ts ebay snapshot-listings     # live persist
```

Then open the staging dashboard: summary cards populated, table drill-down per category, CSV export downloads, refresh returns 409 while a run is in flight. Spot-check 5 `unmanaged` ItemIDs with Simon (open the eBay links) to confirm they are his.

- [ ] **Step 4: Verify one action end-to-end (dry-run only on staging)** — pick one `status_mismatch` row, run Reactivate → confirm the dialog shows the dry-run plan and `jsa_ebay_reconciliation_actions` records it.

- [ ] **Step 5: Use the superpowers:verification-before-completion skill**, then **superpowers:finishing-a-development-branch** — open the PR to `main` titled `feat: eBay reconciliation dashboard (managed vs unmanaged listings, status audit, oversell verification)` referencing the spec, with the dry-run counts from Step 2 pasted into the PR body as evidence.

- [ ] **Step 6: Production rollout order** (after merge, per spec §11): `db:push` prod window → deploy → seed permission → one manual `ebay snapshot-listings` run → verify dashboard → enable the `ebay-recon-snapshot` PM2 app (`pm2 start ecosystem.config.cjs --only ebay-recon-snapshot`).
