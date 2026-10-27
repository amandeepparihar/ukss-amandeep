# Marketplace Integration Workflow

Complete workflow documentation for marketplace integrations in Stock2.

## Table of Contents

1. [Overview](#overview)
2. [Data Flow Diagram](#data-flow-diagram)
3. [Environment Configuration](#environment-configuration)
4. [Complete Command Reference](#complete-command-reference)
5. [Workflow: Initial Setup](#workflow-initial-setup)
6. [Workflow: Ongoing Operations](#workflow-ongoing-operations)
7. [Workflow: Adding New Products](#workflow-adding-new-products)
8. [Cron Job Schedule](#cron-job-schedule)
9. [Troubleshooting](#troubleshooting)

---

## Overview

### Data Source: jsa_MarketplaceListing

**The `jsa_MarketplaceListing` table is the SINGLE SOURCE OF TRUTH for all marketplace feeds.**

All feed generators (Fruugo, Sportdeal, etc.) query from this table, NOT directly from SMS tables.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Listing** | A record in `jsa_MarketplaceListing` representing a product for a specific marketplace |
| **Sync** | Updating marketplace with current inventory/price data |
| **Feed** | Generated file (CSV/XML) that marketplace pulls or we push |
| **Delta Feed** | Only items that changed since last sync |
| **Full Feed** | All items, regardless of change status |

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          SMS DATABASE                                │
│  ┌──────────────────┐  ┌─────────────────────────┐                  │
│  │   new_products   │  │ new_products_variations │                  │
│  │   (master data)  │  │    (SKU-level data)     │                  │
│  └────────┬─────────┘  └───────────┬─────────────┘                  │
│           │                        │                                 │
└───────────┼────────────────────────┼─────────────────────────────────┘
            │                        │
            │   populate-listings    │   (one-time setup)
            │   sync-listings        │   (every 30 min)
            │   refresh-listings     │   (every 15 min)
            ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    jsa_MarketplaceListing                            │
│                   (SOURCE OF TRUTH FOR FEEDS)                        │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ id, storeId, marketplaceName, ukssSku, ukssProductId        │    │
│  │ ukssQuantity, ukssPrice, isActive                           │    │
│  │ lastSyncedQuantity, lastSyncedPrice, lastSyncedAt           │    │
│  │ lastSyncStatus, retryCount, lastSyncError                   │    │
│  │ externalSkuId (e.g., fruugo_sku_id)                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└───────────┬────────────────────────┬─────────────────────────────────┘
            │                        │
            │  generate-feed         │  generate-inventory
            │  (product feed)        │  (inventory feed)
            │                        │
            ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        FEED FILES                                    │
│                                                                      │
│  Fruugo:     /feeds/fruugo/product_datafeed.csv                     │
│  Sportdeal:  /feeds/sportdeal/product_feed.xml                      │
│              /feeds/sportdeal/inventory/inventory_feed.xml          │
│                                                                      │
└───────────┬────────────────────────┬─────────────────────────────────┘
            │                        │
            │  FTP Pull              │  API Push (sync-inventory)
            │  (Fruugo, Sportdeal)   │  (Fruugo API)
            ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       MARKETPLACES                                   │
│                                                                      │
│  ┌─────────┐  ┌────────────┐  ┌─────────┐  ┌──────────┐            │
│  │ Fruugo  │  │ Sportdeal  │  │  OnBuy  │  │ Walmart  │            │
│  └─────────┘  └────────────┘  └─────────┘  └──────────┘            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Environment Configuration

### Required Environment Variables

```env
# CLI Configuration
CLI_TIMEOUT_MS=3600000        # 1 hour timeout for CLI commands
FEED_CHUNK_SIZE=10000         # Records per chunk for streaming (adjustable)

# Fruugo Configuration
FRUUGO_STORE_ID=3
FRUUGO_FEED_DIR=/feeds/fruugo
FRUUGO_CDN_URL=https://cdn.uksoccershop.com/images
FRUUGO_API_URL=https://api.fruugo.com
FRUUGO_USERNAME=your_username
FRUUGO_PASSWORD=your_password

# Sportdeal Configuration
SPORTDEAL_STORE_ID=3
SPORTDEAL_FEED_DIR=/feeds/sportdeal
SPORTDEAL_CDN_URL=https://cdn.uksoccershop.com/images
```

---

## Complete Command Reference

### Fruugo Commands

| Command | Description | Options |
|---------|-------------|---------|
| `fruugo generate-feed` | Generate product CSV feed | `--dry-run`, `--skip-archive`, `--limit <n>`, `--chunk-size <n>` |
| `fruugo sync-inventory` | Push inventory to Fruugo API | `--full`, `--batch-size <n>`, `--dry-run` |
| `fruugo sync-skus` | Fetch SKU mappings from Fruugo | `--page-from <n>`, `--page-to <n>`, `--batch-size <n>` |
| `fruugo populate-listings` | Initial setup - populate from SMS | `--force`, `--dry-run` |
| `fruugo refresh-listings` | Update qty/price from SMS | |
| `fruugo sync-listings` | Full sync: add new, deactivate removed, refresh | |
| `fruugo validate` | Validate configuration | |
| `fruugo listing-counts` | Show listing statistics | |

### Sportdeal Commands

| Command | Description | Options |
|---------|-------------|---------|
| `sportdeal generate-feed` | Generate product XML feed | `--dry-run`, `--skip-archive`, `--limit <n>`, `--chunk-size <n>` |
| `sportdeal generate-inventory` | Generate inventory XML feed | `--full`, `--dry-run`, `--skip-archive`, `--chunk-size <n>` |
| `sportdeal populate-listings` | Initial setup - populate from SMS | `--force`, `--dry-run` |
| `sportdeal refresh-listings` | Update qty/price from SMS | |
| `sportdeal sync-listings` | Full sync: add new, deactivate removed, refresh | |
| `sportdeal validate` | Validate configuration | |
| `sportdeal listing-counts` | Show listing statistics | |

### Command Syntax (Docker)

```bash
# Fruugo
docker exec admin-api sh -c "node /app/dist/cli.js fruugo <command> [options]"

# Sportdeal
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal <command> [options]"
```

### Examples

```bash
# Generate Fruugo feed with 5000 products limit
docker exec admin-api sh -c "node /app/dist/cli.js fruugo generate-feed --limit 5000"

# Generate feed with custom chunk size (for memory-constrained environments)
docker exec admin-api sh -c "node /app/dist/cli.js fruugo generate-feed --chunk-size 5000"

# Dry run to see what would be generated
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-feed --dry-run"

# Full sync of listings (add new, deactivate removed, refresh existing)
docker exec admin-api sh -c "node /app/dist/cli.js fruugo sync-listings"
```

---

## Workflow: Initial Setup

### Step 1: Validate Configuration

```bash
# Fruugo
docker exec admin-api sh -c "node /app/dist/cli.js fruugo validate"

# Sportdeal
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal validate"
```

### Step 2: Populate Listings from SMS

This is a ONE-TIME operation to create initial records in `jsa_MarketplaceListing`.

```bash
# Fruugo
docker exec admin-api sh -c "node /app/dist/cli.js fruugo populate-listings"

# Sportdeal
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal populate-listings"
```

### Step 3: Verify Listing Counts

```bash
# Fruugo
docker exec admin-api sh -c "node /app/dist/cli.js fruugo listing-counts"

# Sportdeal
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal listing-counts"
```

Expected output:
```
Fruugo Listing Counts
=====================
Total: 150000
Active: 148500
New (never synced): 148500
Synced: 0
Failed: 0
```

### Step 4: Generate Initial Feed

```bash
# Fruugo (CSV)
docker exec admin-api sh -c "node /app/dist/cli.js fruugo generate-feed"

# Sportdeal (XML)
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-feed"
```

### Step 5: For Fruugo - Sync SKU IDs

After Fruugo processes your feed, fetch the SKU mappings:

```bash
docker exec admin-api sh -c "node /app/dist/cli.js fruugo sync-skus"
```

---

## Workflow: Ongoing Operations

### Daily/Scheduled Operations

| Operation | Command | Frequency | Description |
|-----------|---------|-----------|-------------|
| **Sync Listings** | `sync-listings` | Every 30 min | Add new products, deactivate removed, refresh qty/price |
| **Refresh Listings** | `refresh-listings` | Every 15 min | Update qty/price only (faster) |
| **Generate Feed** | `generate-feed` | Every 2-4 hours | Regenerate product feed |
| **Sync Inventory** | `sync-inventory` / `generate-inventory` | Every 15-30 min | Push inventory changes |

### Fruugo Workflow

```bash
# 1. Sync listings with SMS (add new, deactivate removed, refresh)
docker exec admin-api sh -c "node /app/dist/cli.js fruugo sync-listings"

# 2. Generate product feed (CSV for FTP)
docker exec admin-api sh -c "node /app/dist/cli.js fruugo generate-feed"

# 3. Sync inventory to Fruugo API (delta - only changed items)
docker exec admin-api sh -c "node /app/dist/cli.js fruugo sync-inventory"
```

### Sportdeal Workflow

```bash
# 1. Sync listings with SMS
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal sync-listings"

# 2. Generate product feed (XML)
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-feed"

# 3. Generate inventory feed (XML - delta)
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-inventory"

# Or for full inventory feed
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-inventory --full"
```

---

## Workflow: Adding New Products

When new products are added to SMS, they are NOT automatically in marketplace feeds. Here's how they get added:

### Automatic (via sync-listings)

The `sync-listings` command handles this automatically:

```bash
docker exec admin-api sh -c "node /app/dist/cli.js fruugo sync-listings"
```

This command:
1. **Adds new products** - Finds products in SMS that don't exist in `jsa_MarketplaceListing` and adds them
2. **Deactivates removed products** - Sets `isActive=0` for products removed from SMS
3. **Refreshes existing** - Updates `ukssQuantity` and `ukssPrice` for all active listings

### Manual Check

To verify new products were added:

```bash
# Check listing counts before
docker exec admin-api sh -c "node /app/dist/cli.js fruugo listing-counts"

# Run sync
docker exec admin-api sh -c "node /app/dist/cli.js fruugo sync-listings"

# Check listing counts after
docker exec admin-api sh -c "node /app/dist/cli.js fruugo listing-counts"
```

---

## Cron Job Schedule

Example Cronicle/cron schedule:

| Job | Schedule | Command |
|-----|----------|---------|
| Fruugo Sync Listings | */30 * * * * | `fruugo sync-listings` |
| Fruugo Generate Feed | 0 */4 * * * | `fruugo generate-feed` |
| Fruugo Sync Inventory | */15 * * * * | `fruugo sync-inventory` |
| Fruugo Sync SKUs | 0 2 * * * | `fruugo sync-skus` |
| Sportdeal Sync Listings | */30 * * * * | `sportdeal sync-listings` |
| Sportdeal Generate Feed | 0 */4 * * * | `sportdeal generate-feed` |
| Sportdeal Generate Inventory | */15 * * * * | `sportdeal generate-inventory` |

---

## Troubleshooting

### Out of Memory Errors

If feed generation fails with memory errors, reduce chunk size:

```bash
# Use smaller chunks for large datasets
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-feed --chunk-size 5000"
```

Or set environment variable globally:
```env
FEED_CHUNK_SIZE=5000
```

### Timeout Errors

For very large datasets, increase CLI timeout:

```env
CLI_TIMEOUT_MS=7200000  # 2 hours
```

### Checking Sync Status

Query the database to check sync status:

```sql
-- Items never synced
SELECT COUNT(*) FROM jsa_MarketplaceListing
WHERE marketplaceName = 'fruugo' AND lastSyncedAt IS NULL AND isActive = 1;

-- Failed syncs
SELECT COUNT(*) FROM jsa_MarketplaceListing
WHERE marketplaceName = 'fruugo' AND lastSyncStatus = 'FAILED';

-- Items with errors
SELECT ukssSku, lastSyncError, retryCount
FROM jsa_MarketplaceListing
WHERE marketplaceName = 'fruugo' AND lastSyncStatus = 'FAILED'
LIMIT 10;
```

### Verifying Feed Files

```bash
# Check Fruugo feed
docker exec admin-api sh -c "wc -l /feeds/fruugo/product_datafeed.csv"
docker exec admin-api sh -c "head -5 /feeds/fruugo/product_datafeed.csv"

# Check Sportdeal feed
docker exec admin-api sh -c "wc -l /feeds/sportdeal/product_feed.xml"
docker exec admin-api sh -c "head -20 /feeds/sportdeal/product_feed.xml"
```

---

## Summary: Quick Reference

### What Each Command Does

| Command | Purpose | Modifies jsa_MarketplaceListing | Generates File |
|---------|---------|--------------------------------|----------------|
| `populate-listings` | Initial setup | Creates records | No |
| `sync-listings` | Full sync with SMS | Creates/updates/deactivates records | No |
| `refresh-listings` | Update qty/price only | Updates ukssQuantity, ukssPrice | No |
| `generate-feed` | Product feed generation | No | Yes (CSV/XML) |
| `generate-inventory` | Inventory feed | Updates lastSyncedQuantity | Yes (XML) |
| `sync-inventory` | Push to API | Updates sync status | No |
| `sync-skus` | Fetch external IDs | Updates externalSkuId | No |

### The 3-Step Mental Model

1. **SMS → jsa_MarketplaceListing**: `sync-listings` or `refresh-listings`
2. **jsa_MarketplaceListing → Feed Files**: `generate-feed`, `generate-inventory`
3. **Feed Files → Marketplace**: FTP pull or API push (`sync-inventory`)
