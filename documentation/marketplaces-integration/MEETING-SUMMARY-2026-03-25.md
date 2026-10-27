# Marketplace Standardization — Meeting Summary

> **Date:** March 25, 2026
> **Speaker:** Nitin Srivastava (Velocity)
> **Attendee:** Saurabh Singh
> **Duration:** 14 minutes
> **Type:** Impromptu Google Meet

---

## Overview

Nitin outlined a standardized architecture for how we list products on marketplaces, track their creation status, and sync price/inventory. The goal is a **single, repeatable pattern** that works for all marketplaces — whether they use API, feed, or manual product creation. Debenhams (Mirakl) is the first marketplace to implement this pattern fully.

---

## Architecture

### 1. Marketplace Listing Table (Single Source of Truth)

All products being sent to any marketplace live in **one table** (`jsa_MarketplaceListing`), logically partitioned by marketplace via `storeId`. Each marketplace only queries its own partition, so the table can grow without performance issues.

**What it tracks per product:**
- UKSS SKU, current quantity, current price (refreshed from NPV tables)
- Marketplace product ID (null = not yet created on marketplace)
- Sync status (synced / pending / failed)
- Last synced price & quantity (for delta detection)
- Whether sync is allowed (new — explained below)

### 2. Nightly Job: Auto-Populate New Products

A scheduled job runs every night and:
1. Checks which UKSS products **qualify** for each marketplace (based on rules)
2. Finds products that qualify but are **not yet in the listing table** for that marketplace
3. Inserts them as new rows (delta — only new products, not all)

**Example:** If 100 new products are added to UKSS today and 40 qualify for Fruugo, those 40 get inserted into the listing table tonight.

### 3. Qualification Rules (Per Marketplace)

Each marketplace has its own qualification rules defined as **functions in code** — not in separate documentation. Anyone can open the function and read exactly what rules apply.

Rules are typically straightforward:
- Product must be active
- Product must have an image
- Product must be assigned to that marketplace's store
- Product must not be from excluded manufacturers/categories

### 4. Marketplace Product ID — Creation Tracking

When a product is first added to the listing table, its `marketplace_product_id` is **NULL**. This means it hasn't been created on the marketplace yet.

**How it gets created depends on the marketplace:**

| Method | Example | How It Works |
|--------|---------|-------------|
| **Feed** | Fruugo, Sportdeal | We generate a CSV/XML feed. Marketplace pulls it and auto-creates products. |
| **API** | Some marketplaces | We call their API to create the product. |
| **Manual** | Debenhams (partially) | A team member creates the product on the marketplace portal. |

For marketplaces where we can't programmatically create products, the code simply documents "this is manual" — and the **dashboard** (see below) shows the backlog of products that need manual creation.

### 5. Sync Allowed Flag (New — Critical for Debenhams)

Some marketplaces have a **multi-step process** before you can sync price/inventory:

**Debenhams example:**
1. Product must be created on Mirakl portal ✓
2. **Offer must be created** via API ✓
3. Only THEN can you sync price and inventory

Currently we only have `isActive` (should this product be listed?). We need a new flag: **`syncAllowed`** (can we actually sync price/inventory for this product?).

- Default: `true` (simple marketplaces like Fruugo/Sportdeal — no extra steps needed)
- Debenhams: starts as `false`, flipped to `true` after offer is confirmed
- Sync jobs only process items where `syncAllowed = true`

### 6. Delta Price & Inventory Sync

We already track:
- `lastSyncedPrice` — price we last sent to marketplace
- `lastSyncedQuantity` — quantity we last sent to marketplace

Compare these against current values from the NPV table (source of truth). If different → sync needed. This is already working for Fruugo and Sportdeal.

### 7. Dashboard

A dashboard showing per marketplace:
- How many products are in the listing table
- How many are **created** on the marketplace
- How many are **NOT created** yet (backlog)
- How many have `syncAllowed = false` (waiting for offer creation)
- How many are synced / failed

This gives visibility into the pipeline and helps the team manage manual work.

### 8. Documentation Strategy

**Key decision:** All rules and logic live **in code**, not in separate wikis or documents.

> "Documentation by developers is next to impossible, and quality doesn't come... So we reduce the dependency on them. We write rules as functions in code, and AI generates documentation from it." — Nitin

Benefits:
- Rules are always up to date (they ARE the code)
- AI can generate wiki pages from function descriptions
- Non-technical team members read the generated wiki
- No drift between documentation and implementation

---

## Workflow Summary

```
UKSS Products (NPV tables)
    │
    ▼
[Nightly Job] ── qualification rules per marketplace
    │
    ▼
Marketplace Listing Table (jsa_MarketplaceListing)
    │
    ├── marketplace_product_id = NULL?
    │       │
    │       ├── Feed marketplace → generate feed → marketplace auto-creates
    │       ├── API marketplace → call create API
    │       └── Manual marketplace → team member creates on portal
    │
    ├── syncAllowed = false?
    │       │
    │       └── Create offer first (e.g., Debenhams O11 API) → flip to true
    │
    └── syncAllowed = true + price/qty changed?
            │
            └── Sync price & inventory to marketplace
```

---

## Action Items

1. **Add `syncAllowed` column** to marketplace listing table (default `true`)
2. **Define qualification rules** as named functions per marketplace adapter
3. **Document product creation method** in each adapter ("feed", "API", or "manual")
4. **Build Debenhams adapter** following the standardized pattern (first API-based marketplace)
5. **Build dashboard** (API + UI) showing per-marketplace product pipeline status
6. **Create a skill/template** so future marketplaces can be onboarded quickly

---

## What's Already Built

~80% of this architecture is already in place:
- ✅ Marketplace listing table with storeId-based indexing
- ✅ Nightly delta job (addNewFromUkss, deactivateRemoved, refreshFromUkss)
- ✅ Delta detection (lastSyncedPrice/lastSyncedQuantity vs current)
- ✅ Adapter pattern (BaseMarketplaceAdapter with capabilities, config, CLI)
- ✅ Fruugo (feed/CSV) and Sportdeal (feed/XML) fully working
- ❌ `syncAllowed` flag — needs to be added
- ❌ Qualification rules as named functions — needs extraction from SQL
- ❌ Dashboard — CLI counts exist, needs API + UI
- ❌ Debenhams product listing adapter — order integration exists, product sync doesn't
