# Marketplace Standardization: Implementation Plan

> **Date:** 2026-03-25
> **Origin:** Nitin Srivastava (Velocity) — Impromptu Google Meet, 14 mins
> **Branch:** `feature/marketplace-standardization` (cut from `main`)
> **Status:** Planned — not yet started

## Context

Nitin outlined a standardized marketplace product listing and sync architecture. The codebase is **80% aligned** — the `jsa_MarketplaceListing` table, nightly delta jobs, `lastSyncedPrice`/`lastSyncedQuantity` delta detection, and adapter pattern all exist. This plan covers the **remaining 20%**: adding `syncAllowed`, per-marketplace qualification functions, product creation method documentation, a dashboard, and the Debenhams adapter.

---

## Meeting Summary (Hindi → English)

### Architecture Nitin Described

1. **Marketplace Listing Table** — partitioned by marketplace (`storeId`), stores all products being sent to each marketplace. Even if the table grows large, queries are fast because they only hit one partition.

2. **Nightly Delta Job** — runs every night, checks which products qualify for each marketplace (based on rules), adds new qualifying products to the listing table. If 100 new products are added to UKSS today, the job picks up the qualifying ones and inserts them.

3. **Marketplace Product ID** — if `externalProductId` is NULL, the product hasn't been created on the marketplace yet. Some marketplaces (like Debenhams/Mirakl) require product creation + offer creation before price/inventory sync is possible.

4. **Sync Allowed Flag** — for marketplaces like Debenhams where you must create an offer before syncing price/inventory. A `syncAllowed` column (yes/no) controls whether the sync job should attempt to sync a listing. Default `true` for simple marketplaces (Fruugo, Sportdeal). Set to `false` for Debenhams until offer is confirmed.

5. **Delta Price/Inventory Sync** — `lastSyncedPrice` and `lastSyncedQuantity` columns track what was last sent. Compare with current `ukssPrice`/`ukssQuantity` (refreshed from NPV source tables). If different, sync needed.

6. **Product Creation Methods** — varies per marketplace:
   - **API**: Marketplace provides an API to create products (e.g., Mirakl P11)
   - **Feed**: Upload CSV/XML, marketplace processes it (e.g., Fruugo, Sportdeal)
   - **Manual**: No API/feed available, team member creates products on marketplace portal
   - Each marketplace adapter should document which method it uses, in code.

7. **Dashboard** — shows per-marketplace: how many products are in the listing table, how many are created on marketplace, how many are NOT yet created (backlog for manual work).

8. **Qualification Rules as Functions** — each marketplace gets its own function with readable rules. When a rule changes, update the function. AI can generate wiki documentation from the code.

9. **Standardization** — once Debenhams pattern works, create a skill/template for onboarding new marketplaces quickly.

### Key Decisions

- **Documentation lives in code**, not separate wikis. AI generates documentation from code functions.
- **Debenhams first** — implement the standard pattern for Debenhams, then replicate for other marketplaces.
- **Team member handles manual backlog** — dashboard shows what needs manual creation on marketplace portals.

---

## What Already Exists (no work needed)

| Requirement | Implementation |
|---|---|
| Listing table partitioned by marketplace | `jsa_MarketplaceListing` with `storeId` composite indexes |
| Nightly delta job | `sync-listings` CLI → `addNewFromUkss()` + `deactivateRemovedFromUkss()` + `refreshFromUkss()` |
| Marketplace product ID tracking | `externalSkuId` / `externalProductId` (nullable) |
| Delta sync via lastSyncedPrice/lastSyncedQuantity | `getChangedItems()` compares `ukssQuantity` vs `lastSyncedQuantity`, `ukssPrice` vs `lastSyncedPrice` |
| Adapter pattern | `BaseMarketplaceAdapter` with capabilities, config, CLI per marketplace |

### Notes for Nitin

1. **Physical MySQL partitioning is NOT needed** — composite indexes on `storeId` provide the same query isolation. Every query filters by `storeId` first, so MySQL only scans that marketplace's rows. Physical partitioning adds complexity with no benefit at current scale. Revisit at 500K+ rows per marketplace.

2. **Marketplaces that don't return product IDs** — already handled. `externalSkuId` is nullable. For SKU-based marketplaces, UKSS SKU itself serves as the identifier. `metadata` JSON column stores marketplace-specific identifiers.

3. **"Manual" product creation** — supported. Adapter declares `productCreation: false`. Dashboard shows the backlog. Team member works through it manually.

---

## Tasks (9 total)

### Task 1: Create branch from main

```bash
git checkout main && git pull && git checkout -b feature/marketplace-standardization
```

---

### Task 2: Add `syncAllowed` column to schema + update sync-tracker

**What:** Add `syncAllowed Boolean @default(true)` to `MarketplaceListing` model and update `sync-tracker.ts` to respect it.

**Files to modify:**

1. **`apps/api/prisma/schema.prisma`** (inside `model MarketplaceListing`)
   - Add after `delistedAt` field:
     ```prisma
     syncAllowed     Boolean   @default(true)   // Whether price/inventory sync is allowed (false for marketplaces requiring offer creation first)
     ```
   - Add index:
     ```prisma
     @@index([storeId, syncAllowed])
     ```

2. **`apps/api/src/modules/marketplaces/utils/sync-tracker.ts`**
   - `getChangedItems()`: Add `syncAllowed: true` to `where`
   - `getItemsForFullSync()`: Add `syncAllowed: true` to `where`
   - `getItemsToSync()`: Add `syncAllowed: true` for changed/full sync branches (NOT for new items)
   - `getSelectFields()`: Add `syncAllowed: true`
   - `getCounts()`: Add `syncNotAllowed` count (`isActive: true AND syncAllowed: false`)

3. **`apps/api/prisma/migrations/marketplace_tables.sql`** (if used for direct SQL)
   - `ALTER TABLE jsa_marketplacelisting ADD COLUMN syncAllowed TINYINT(1) NOT NULL DEFAULT 1;`

**Backward compatibility:** Default `true` — existing Fruugo/Sportdeal listings unaffected.

---

### Task 3: Add `productCreationMethod` and `QualificationConfig` to adapter types

**What:** Extend adapter interface so each marketplace documents its product creation method and qualification rules.

**Files to modify:**

1. **`apps/api/src/modules/marketplaces/adapters/types.ts`**
   - Add `QualificationConfig` interface:
     ```typescript
     export interface QualificationConfig {
       description: string;
       additionalWhereClauses?: string[];
       additionalJoins?: string[];
       params?: unknown[];
     }
     ```
   - Add to `MarketplaceAdapter` interface:
     ```typescript
     readonly productCreationMethod: string;
     getQualificationConfig(): QualificationConfig;
     ```

2. **`apps/api/src/modules/marketplaces/adapters/base.adapter.ts`**
   - Add abstract `productCreationMethod` and `getQualificationConfig()`

3. **Fruugo adapter** — implement with Fruugo-specific rules (excluded manufacturers, product types)

4. **Sportdeal adapter** — implement with Sportdeal-specific rules

---

### Task 4: Update `sync-tracker.ts` to accept `QualificationConfig`

**What:** Modify `initializeFromUkss()` and `addNewFromUkss()` to accept optional `QualificationConfig` and append its WHERE clauses to queries.

**File:** `apps/api/src/modules/marketplaces/utils/sync-tracker.ts`

---

### Task 5: Create Debenhams product listing adapter

**What:** Create `adapters/debenhams/` with adapter, config, types following the standardized pattern.

**Key details:**
- Store ID: **150** (production DB)
- API URL: `https://debenhamsuk-prod.mirakl.net`
- Auth: API key in Authorization header (no Bearer prefix)
- `productCreation: false` (manual on Mirakl portal)
- `syncAllowed = false` on initial insert, flipped to `true` after offer creation
- Inventory/price sync via Mirakl OF24 API (only where `syncAllowed = true`)
- Coexists with existing `modules/debenhams/` (orders) — don't modify order code

---

### Task 6: Create Debenhams CLI commands

**File:** `apps/api/src/modules/marketplaces/cli/debenhams.commands.ts`

**Commands:**
- `debenhams populate-listings [--dry-run] [--limit N]`
- `debenhams sync-listings`
- `debenhams create-offers [--dry-run] [--limit N]`
- `debenhams sync-inventory [--full] [--batch-size N]`
- `debenhams listing-counts`
- `debenhams show-config`

---

### Task 7: Create dashboard API endpoint

**Endpoint:** `GET /api/marketplaces/dashboard`

**Response:** Per-marketplace counts (total, active, notCreatedOnMarketplace, synced, failed, syncNotAllowed) + metadata (pattern, productCreationMethod, lastSync).

**Files:**
- `apps/api/src/modules/marketplaces/marketplace-dashboard.routes.ts`
- `apps/api/src/modules/marketplaces/marketplace-dashboard.service.ts`
- Register in `apps/api/src/app.ts`

---

### Task 8: Create dashboard UI page

**Page:** `/marketplace-dashboard` — card grid, one card per marketplace, color-coded count badges.

**Files:**
- `apps/web/src/pages/marketplace-dashboard/MarketplaceDashboardPage.tsx`
- Route in `apps/web/src/App.tsx`

---

### Task 9: Update marketplace-integration skill

**File:** `.claude/skills/marketplace-integration.md`

Add template adapter code, QualificationConfig template, decision tree (feed vs API vs manual), `syncAllowed` workflow, CLI command template.

---

## Execution Order & Dependencies

```
Task 1 (branch) ─── must be first
    │
    ├── Task 2 (schema + sync-tracker) ─── foundation
    │       │
    │       ├── Task 3 (adapter types) ─── parallel with Task 4
    │       ├── Task 4 (sync-tracker QualificationConfig) ─── parallel with Task 3
    │       │
    │       └── After 3+4: Task 5 (Debenhams adapter)
    │                │
    │                └── Task 6 (Debenhams CLI)
    │
    ├── Task 7 (dashboard API) ─── depends on Task 2
    │       │
    │       └── Task 8 (dashboard UI)
    │
    └── Task 9 (skill template) ─── last
```

**Parallelizable groups:**
- Group 1: Tasks 3 + 4 (after Task 2)
- Group 2: Tasks 5 + 7 (after Tasks 3+4, though 7 only needs Task 2)
- Group 3: Tasks 6 + 8 (after their dependencies)

---

## Verification Plan

1. `pnpm build` — no TypeScript errors
2. `DATABASE_PROVIDER=mysql pnpm db:push` — `syncAllowed` column created
3. `fruugo listing-counts` / `sportdeal listing-counts` — unchanged counts
4. `debenhams populate-listings --dry-run` — shows qualifying product count
5. Debenhams flow: populate → `syncAllowed=false` → create-offers → `syncAllowed=true` → sync-inventory
6. `GET /api/marketplaces/dashboard` — returns data for all 3 marketplaces
7. Dashboard UI — cards render with correct counts
8. Existing Sportdeal E2E test — no regression
