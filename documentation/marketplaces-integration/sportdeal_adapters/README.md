# Sportdeal Adapter Documentation

This document describes the Sportdeal marketplace adapter implementation in Stock2 (JS Admin).

## Overview

Sportdeal is a **feed-based** marketplace that:
- Pulls product data via XML file (HTTP)
- Pulls inventory updates via XML file (HTTP)
- Does NOT have a direct API for real-time updates

## Directory Structure

```
apps/api/src/modules/marketplaces/adapters/sportdeal/
├── sportdeal.adapter.ts      # Main adapter class
├── sportdeal.config.ts       # Configuration loading from environment
├── sportdeal.types.ts        # Type definitions
├── feed-generator.ts         # XML product feed generation
├── inventory-feed.ts         # XML inventory feed generation
└── index.ts                  # Module exports
```

## Configuration

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SPORTDEAL_STORE_ID` | Yes | Store ID in UKSS | `127` |
| `SPORTDEAL_PTS_STATUS` | Yes | Product-to-store status filter | `1` |
| `SPORTDEAL_FEED_DIR` | Yes | Feed output directory | `/feeds/sportdeal` (Docker) |
| `SPORTDEAL_INVENTORY_FEED_DIR` | No | Inventory feed directory | `/feeds/sportdeal/inventory` |
| `SPORTDEAL_CDN_URL` | Yes | CDN URL for images | `https://cdn1.uksoccershop.com` |
| `SPORTDEAL_PRODUCT_FEED_FILENAME` | No | Product feed filename | `uksoccershop_products_UK.xml` |
| `SPORTDEAL_INVENTORY_FEED_FILENAME` | No | Inventory feed filename | `sportdeal_inventory.xml` |
| `SPORTDEAL_EXCLUDED_MANUFACTURER_IDS` | No | Excluded manufacturer IDs | `1,2,3` |
| `SPORTDEAL_IOSS_NUMBER` | No | IOSS number for EU | `IM1234567890` |

### Docker Volume Mapping

In `docker-compose.yml`:

```yaml
services:
  api:
    volumes:
      - D:/path/to/sportdeal/feeds:/feeds/sportdeal
```

This maps the Sportdeal feed directory into the container at `/feeds/sportdeal`.

## SportdealAdapter Class

```typescript
class SportdealAdapter extends BaseMarketplaceAdapter {
  readonly marketplaceId = 'sportdeal';
  readonly name = 'Sportdeal';
  readonly pattern = 'feed';

  // Capabilities
  getCapabilities(): MarketplaceCapabilities

  // Credential validation
  validateCredentials(): Promise<ValidationResult>

  // Product feed generation (XML)
  generateProductFeed(options?: SportdealFeedOptions): Promise<SportdealFeedResult>

  // Inventory feed generation (XML)
  generateInventoryFeed(options?: SportdealInventoryFeedOptions): Promise<SportdealInventoryFeedResult>

  // Listing management (from base)
  populateListings(options?: { limit?: number; dryRun?: boolean }): Promise<PopulationResult>
  refreshListings(): Promise<RefreshResult>
  getListingCounts(): Promise<ListingCounts>
}
```

## CLI Commands

All commands are run inside the Docker container:

```bash
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal <command>"
```

### Available Commands

| Command | Description | Options |
|---------|-------------|---------|
| `status` | Show integration status | - |
| `validate` | Validate configuration | - |
| `populate-listings` | Populate listings from UKSS | `--dry-run`, `--limit <n>` |
| `refresh-listings` | Refresh quantities/prices from UKSS | - |
| `listing-counts` | Show listing counts | - |
| `generate-feed` | Generate product feed XML | `--dry-run`, `--skip-archive`, `--limit <n>` |
| `generate-inventory` | Generate inventory feed XML | `--full`, `--dry-run`, `--skip-archive` |

### Command Examples

```bash
# Check status
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal status"

# Populate listings (first time setup)
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal populate-listings --dry-run"
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal populate-listings"

# Check listing counts
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal listing-counts"

# Generate product feed
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-feed --dry-run"
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-feed"

# Generate inventory feed (delta - only changes)
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-inventory"

# Generate inventory feed (full - all items)
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-inventory --full"
```

## Workflow

### Initial Setup

1. **Populate listings from UKSS:**
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js sportdeal populate-listings"
   ```
   This queries products from SMS database and creates records in `jsa_marketplacelisting`.

2. **Generate product feed:**
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-feed"
   ```
   Creates XML file at `/feeds/sportdeal/uksoccershop_products_UK.xml`.

3. **Generate inventory feed:**
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-inventory --full"
   ```
   Creates XML file at `/feeds/sportdeal/inventory/sportdeal_inventory.xml`.

4. **Sportdeal pulls the feeds** via HTTP from the configured URLs.

### Ongoing Operations

1. **Refresh listings** (update quantities/prices from UKSS):
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js sportdeal refresh-listings"
   ```

2. **Generate inventory feed** (delta - only changed items):
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-inventory"
   ```

3. **Regenerate product feed** (if product data changes):
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js sportdeal generate-feed"
   ```

## Product Feed Generation

### Feed Format

The product feed is an XML file with the following structure:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<root>
  <product>
    <sku>p-286-1</sku>
    <barcode>5059734522727</barcode>
    <name>Yugoslavia home 02/03</name>
    <description>Brand new, official Yugoslavia national team jersey...</description>
    <brand>Lotto</brand>
    <price>39.99</price>
    <special_price>25.00</special_price>
    <quantity>20</quantity>
    <size>Small Adults</size>
    <color>N/A</color>
    <gender>Unisex</gender>
    <season>None</season>
    <image>https://cdn1.uksoccershop.com/yugoslavia_home_2004.jpg</image>
    <category>Football</category>
  </product>
  <!-- more products -->
</root>
```

### Feed Fields

| Field | Description | Example |
|-------|-------------|---------|
| sku | UKSS SKU | `p-286-1` |
| barcode | EAN barcode | `5059734522727` |
| name | Product name | `Yugoslavia home 02/03` |
| description | Cleaned description (no HTML) | `Brand new, official...` |
| brand | Manufacturer name | `Lotto` |
| price | Regular price | `39.99` |
| special_price | Sale price (if any) | `25.00` |
| quantity | Available quantity | `20` |
| size | Size (max 50 chars) | `Small Adults` |
| color | Color | `N/A` |
| gender | Gender | `Unisex` |
| season | Season | `None` |
| image | Full image URL | `https://cdn1...` |
| category | Product category | `Football` |

### Feed Query (Source: jsa_MarketplaceListing)

Products are queried from `jsa_MarketplaceListing` table:

```sql
SELECT
  ml.ukssSku as npv_products_sku,
  ml.ukssQuantity as npv_quantities,
  ml.ukssPrice as products_price,
  npv.npv_products_barcodes,
  npv.npv_products_name,
  np.products_image,
  np.products_description,
  np.np_color,
  np.np_gender,
  np.np_season,
  np.manufacturers_name,
  np.specials_price,
  pov.products_options_values_name,
  pov.shortname
FROM jsa_MarketplaceListing ml
INNER JOIN new_products_variations npv ON npv.npv_products_sku = ml.ukssSku
INNER JOIN new_products np ON np.products_id = npv.npv_products_id
INNER JOIN products_options_values pov ON pov.products_options_values_id = npv.npv_size_options_value_id
WHERE ml.storeId = 127
  AND ml.marketplaceName = 'sportdeal'
  AND ml.isActive = 1
ORDER BY np.products_id
```

**Key Point:** The feed generator uses `jsa_MarketplaceListing` as the source of truth, joining with SMS tables only for product details.

## Inventory Feed Generation

### Feed Format

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<root>
  <product>
    <sku>p-286-1</sku>
    <barcode>5059734522727</barcode>
    <quantity>20</quantity>
    <price>39.99</price>
    <special_price>25.00</special_price>
  </product>
  <!-- more products -->
</root>
```

### Delta vs Full Feed

| Mode | Command | Use Case |
|------|---------|----------|
| Delta | `generate-inventory` | Regular updates (only changed items) |
| Full | `generate-inventory --full` | Initial setup, periodic full refresh |

### Change Detection

Delta feed includes items where:
- `lastSyncedQuantity IS NULL` (never synced)
- `ukssQuantity != lastSyncedQuantity` (quantity changed)

### After Feed Generation

After successful generation, the adapter updates `jsa_MarketplaceListing`:

```sql
UPDATE jsa_MarketplaceListing
SET lastSyncedQuantity = ukssQuantity,
    lastSyncedAt = NOW(),
    lastSyncStatus = 'SYNCED'
WHERE storeId = 127
  AND marketplaceName = 'sportdeal'
  AND ukssSku IN (<synced_skus>)
```

## Output Files

| File | Path | Description |
|------|------|-------------|
| Product Feed | `/feeds/sportdeal/uksoccershop_products_UK.xml` | Full product catalog |
| Inventory Feed | `/feeds/sportdeal/inventory/sportdeal_inventory.xml` | Inventory and price updates |
| Archive | `/feeds/sportdeal/Archive/` | Archived previous feeds |
| Inventory Archive | `/feeds/sportdeal/inventory/Archive/` | Archived inventory feeds |

## Logs

Logs are written to:
```
apps/api/logs/marketplace-sportdeal/log.txt
apps/api/logs/sportdeal-cli/log.txt
```

Log format (JSON):
```json
{
  "level": 30,
  "time": 1769442247091,
  "module": "marketplace-sportdeal",
  "msg": "Feed generation completed",
  "filePath": "/feeds/sportdeal/uksoccershop_products_UK.xml",
  "itemCount": 602,
  "duration": 8492
}
```

## Troubleshooting

### Feed shows 0 products

1. Check if listings exist in `jsa_MarketplaceListing`:
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js sportdeal listing-counts"
   ```

2. If no listings, run populate:
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js sportdeal populate-listings"
   ```

### File not written to correct location

1. Ensure Docker volume is mapped correctly
2. Check environment variable: `SPORTDEAL_FEED_DIR=/feeds/sportdeal`
3. Verify directory permissions

### Inventory feed has no changes

If delta inventory feed shows 0 items:
1. Run refresh to update quantities: `sportdeal refresh-listings`
2. Or generate full feed: `sportdeal generate-inventory --full`

## Comparison with SMS Implementation

| Feature | SMS | Stock2 |
|---------|-----|--------|
| Data Source | Direct query from SMS tables | `jsa_MarketplaceListing` table |
| Tracking | `sportdeal_quantity` in `new_products_variations` | `lastSyncedQuantity` in `jsa_MarketplaceListing` |
| Feed Format | XML | XML (same format) |
| Output Location | Same | Same (via Docker volume) |
