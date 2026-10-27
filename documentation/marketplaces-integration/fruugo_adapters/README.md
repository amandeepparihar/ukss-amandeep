# Fruugo Adapter Documentation

This document describes the Fruugo marketplace adapter implementation in Stock2 (JS Admin).

## Overview

Fruugo is a **feed-based** marketplace that:
- Pulls product data via CSV file (FTP)
- Accepts inventory updates via REST API (XML)
- Provides SKU mappings via REST API (XML)

## Directory Structure

```
apps/api/src/modules/marketplaces/adapters/fruugo/
├── fruugo.adapter.ts      # Main adapter class
├── fruugo.config.ts       # Configuration loading from environment
├── fruugo.types.ts        # Type definitions
├── feed-generator.ts      # CSV product feed generation
├── inventory-sync.ts      # Inventory sync via API
├── sku-sync.ts           # SKU ID synchronization
└── index.ts              # Module exports
```

## Configuration

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `FRUUGO_API_ID` | Yes | API username (email) | `user@example.com` |
| `FRUUGO_API_PASSWORD` | Yes | API password | `secret123` |
| `FRUUGO_INVENTORY_URL` | Yes | Inventory update API URL | `https://www.fruugo.com/stockstatus-api/availability/update` |
| `FRUUGO_LISTINGS_URL` | Yes | Listings API URL | `https://www.fruugo.com/stockstatus-api/skus/get-all-skus?page=` |
| `FRUUGO_STORE_ID` | Yes | Store ID in UKSS | `95` |
| `FRUUGO_PTS_STATUS` | Yes | Product-to-store status filter | `1` |
| `FRUUGO_FEED_DIR` | Yes | Feed output directory | `/feeds/fruugo` (Docker) |
| `FRUUGO_CDN_URL` | Yes | CDN URL for images | `https://cdn1.uksoccershop.com` |
| `FRUUGO_INVENTORY_BATCH_SIZE` | No | Items per inventory API call | `100` |
| `FRUUGO_SKU_SYNC_BATCH_SIZE` | No | SKUs per batch | `5000` |
| `FRUUGO_PARALLEL_PAGES` | No | Parallel page fetches | `4` |
| `FRUUGO_API_TIMEOUT_MS` | No | API timeout | `30000` |
| `FRUUGO_EXCLUDED_MANUFACTURER_IDS` | No | Excluded manufacturer IDs | `1,2,3` |
| `FRUUGO_EXCLUDED_PRODUCT_TYPE_IDS` | No | Excluded product type IDs | `5,6` |
| `FRUUGO_KIDS_SIZE_GUIDES` | No | Kids size guides (0% VAT) | `kids-small,kids-medium` |

### Docker Volume Mapping

In `docker-compose.yml`:

```yaml
services:
  api:
    volumes:
      - D:/wamp64/www/zenc-ukss-production/Fruugo_product_feed:/feeds/fruugo
```

This maps the SMS Fruugo feed directory into the container at `/feeds/fruugo`.

## FruugoAdapter Class

```typescript
class FruugoAdapter extends BaseMarketplaceAdapter {
  readonly marketplaceId = 'fruugo';
  readonly name = 'Fruugo';
  readonly pattern = 'feed';

  // Capabilities
  getCapabilities(): MarketplaceCapabilities

  // Credential validation
  validateCredentials(): Promise<ValidationResult>

  // Product feed generation (CSV)
  generateProductFeed(options?: FruugoFeedOptions): Promise<FruugoFeedResult>

  // Inventory sync (XML API)
  syncInventory(options?: FruugoInventorySyncOptions): Promise<FruugoInventorySyncResult>

  // SKU ID sync (XML API)
  fetchSkuMappings(options?: FruugoSkuSyncOptions): Promise<FruugoSkuSyncResult>

  // Listing management (from base)
  populateListings(options?: { limit?: number; dryRun?: boolean }): Promise<PopulationResult>
  refreshListings(): Promise<RefreshResult>
  getListingCounts(): Promise<ListingCounts>
}
```

## CLI Commands

All commands are run inside the Docker container:

```bash
docker exec admin-api sh -c "node /app/dist/cli.js fruugo <command>"
```

### Available Commands

| Command | Description | Options |
|---------|-------------|---------|
| `status` | Show integration status | - |
| `validate` | Validate API credentials | - |
| `populate-listings` | Populate listings from UKSS | `--dry-run`, `--limit <n>` |
| `refresh-listings` | Refresh quantities/prices from UKSS | - |
| `listing-counts` | Show listing counts | - |
| `generate-feed` | Generate product feed CSV | `--dry-run`, `--skip-archive` |
| `sync-inventory` | Push inventory to Fruugo | `--full`, `--batch-size <n>`, `--dry-run` |
| `sync-skus` | Fetch SKU IDs from Fruugo | `--page-from <n>`, `--page-to <n>`, `--dry-run` |

### Command Examples

```bash
# Check status
docker exec admin-api sh -c "node /app/dist/cli.js fruugo status"

# Populate listings (first time setup)
docker exec admin-api sh -c "node /app/dist/cli.js fruugo populate-listings --dry-run"
docker exec admin-api sh -c "node /app/dist/cli.js fruugo populate-listings"

# Check listing counts
docker exec admin-api sh -c "node /app/dist/cli.js fruugo listing-counts"

# Generate feed
docker exec admin-api sh -c "node /app/dist/cli.js fruugo generate-feed --dry-run"
docker exec admin-api sh -c "node /app/dist/cli.js fruugo generate-feed"

# Sync inventory (delta - only changes)
docker exec admin-api sh -c "node /app/dist/cli.js fruugo sync-inventory"

# Sync inventory (full - all items)
docker exec admin-api sh -c "node /app/dist/cli.js fruugo sync-inventory --full"

# Sync SKU IDs
docker exec admin-api sh -c "node /app/dist/cli.js fruugo sync-skus"
```

## Workflow

### Initial Setup

1. **Populate listings from UKSS:**
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js fruugo populate-listings"
   ```
   This queries products from SMS database and creates records in `jsa_marketplacelisting`.

2. **Generate product feed:**
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js fruugo generate-feed"
   ```
   Creates CSV file at `/feeds/fruugo/product_datafeed.csv` (mapped to SMS directory).

3. **Fruugo pulls the feed** via FTP from the configured directory.

### Ongoing Operations

1. **Refresh listings** (update quantities/prices from UKSS):
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js fruugo refresh-listings"
   ```

2. **Sync inventory** (push changes to Fruugo API):
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js fruugo sync-inventory"
   ```

3. **Sync SKU IDs** (get Fruugo's SKU IDs for our products):
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js fruugo sync-skus"
   ```

## Product Feed Generation

### Feed Format

The feed is a CSV file with the following columns:

| Column | Description | Example |
|--------|-------------|---------|
| ProductId | Product identifier | `p-233104` |
| SkuId | SKU identifier | `p-233104-25129` |
| EAN | Barcode | `5059734522727` |
| ISBN | ISBN (if applicable) | |
| Brand | Manufacturer name | `Libero Sportswear` |
| Manufacturer | Manufacturer | |
| Category | Fruugo category path | `"Clothing > Shirts"` |
| Imageurl1 | Product image URL | `https://cdn1.uksoccershop.com/...` |
| StockStatus | Stock status | `INSTOCK` or `OUTOFSTOCK` |
| StockQuantity | Available quantity | `10` |
| RestockDate | Expected restock date | |
| LeadTime | Days to ship | `4` |
| PackageWeight | Package weight | |
| Language | Content language | `en` |
| Title | Product title | `Rwanda 2022-2023 Away...` |
| Description | Product description | Cleaned HTML-free text |
| AttributeColor | Color | `White` |
| AttributeSize | Size | `Small 34-36 inch Chest` |
| Currency | Price currency | `GBP` |
| Country | Target country | |
| NormalPriceWithVAT | Price including VAT | `37.99` |
| VATRate | VAT percentage | `20` or `0` (kids) |

### Feed Query (Source: jsa_MarketplaceListing)

Products are queried from `jsa_MarketplaceListing` table (source of truth), joined with SMS tables for product details:

```sql
SELECT
  ml.ukssQuantity as fruugo_quantity,
  ml.ukssSku as npv_products_sku,
  ml.ukssPrice as products_price,
  np.products_image,
  np.fruugo_category_path,
  npv.npv_products_barcodes,
  npv.npv_products_name,
  np.products_description,
  np.np_color,
  np.np_sizeguide,
  pov.products_options_values_name,
  pov.shortname,
  np.specials_price,
  np.manufacturers_name,
  np.virtual_product_type_id
FROM jsa_MarketplaceListing ml
INNER JOIN new_products_variations npv ON npv.npv_products_sku = ml.ukssSku
INNER JOIN new_products np ON np.products_id = npv.npv_products_id
INNER JOIN products_options_values pov ON pov.products_options_values_id = npv.npv_size_options_value_id
WHERE ml.storeId = 95
  AND ml.marketplaceName = 'fruugo'
  AND ml.isActive = 1
ORDER BY np.products_id
```

**Key Point:** The feed generator uses `jsa_MarketplaceListing` as the source of truth. Only products in this table will be included in the feed. Use `populate-listings` to add products from SMS.

### Lead Time Calculation

| Condition | Lead Time |
|-----------|-----------|
| Airo Sportswear products | 10 days |
| Virtual product type 4 | 3 days |
| Default | 4 days |

### VAT Rate Calculation

| Condition | VAT Rate |
|-----------|----------|
| Kids size guide | 0% |
| Default | 20% |

## Inventory Sync

### API Endpoint

```
POST https://www.fruugo.com/stockstatus-api/availability/update
Content-Type: application/xml
Authorization: Basic {base64(apiId:apiPassword)}
```

### XML Format

```xml
<?xml version="1.0" encoding="UTF-8"?>
<inventory>
  <item>
    <skuId>p-233104-25129</skuId>
    <stockQuantity>10</stockQuantity>
    <stockStatus>INSTOCK</stockStatus>
  </item>
  <!-- more items -->
</inventory>
```

### Batch Processing

- Default batch size: 100 items per API request
- Configurable via `FRUUGO_INVENTORY_BATCH_SIZE`
- Uses retry with exponential backoff on failures

## SKU ID Sync

### Purpose

Fruugo assigns its own SKU IDs to products. This sync fetches those IDs and stores them in `externalSkuId` field in `jsa_marketplacelisting`.

### API Endpoint

```
GET https://www.fruugo.com/stockstatus-api/skus/get-all-skus?page=1
Authorization: Basic {base64(apiId:apiPassword)}
```

### Response Format (XML)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<skus xmlns="http://www.fruugo.com/api" numberOfPages="242">
  <sku fruugoSkuId="103119758" merchantSkuId="p-58424-27166">
    <itemsInStock>25</itemsInStock>
    <availability>INSTOCK</availability>
  </sku>
  <!-- more sku elements -->
</skus>
```

**Note:** The `numberOfPages` attribute is on the `<skus>` root element, not on individual SKU elements.

### Pagination

- Total pages obtained from `skus.@numberOfPages` attribute (e.g., 242 pages)
- Approximately 1000 SKUs per page
- Fetches pages in parallel (default: 4 concurrent)
- Updates `externalSkuId` in `jsa_marketplacelisting` table (not `new_products_variations.fruugo_sku_id`)

## Error Handling

### Retry Logic

- Max attempts: 3
- Base delay: 1000ms
- Max delay: 30000ms
- Jitter: enabled
- Retryable: 429, 500-504, timeout, network errors

### Error Tracking

Failed items are tracked in `jsa_marketplacelisting`:
- `lastSyncStatus = 'FAILED'`
- `retryCount` incremented
- `lastSyncError` contains error message

Items are retried until `retryCount >= 3`.

## Logs

Logs are written to:
```
apps/api/logs/marketplace-fruugo/log.txt
apps/api/logs/fruugo-cli/log.txt
```

Log format (JSON):
```json
{
  "level": 30,
  "time": 1769278818008,
  "module": "marketplace-fruugo",
  "msg": "Feed generation completed",
  "filePath": "/feeds/fruugo/product_datafeed.csv",
  "itemCount": 5921,
  "duration": 2671
}
```

## Known Limitations

1. **fruugo_category_path** - Currently disabled in feed query. Needs population in SMS database for proper Fruugo categorization.

2. **Price sync** - Not supported separately. Prices are included in the product feed.

3. **Order import** - Handled by separate order integration module, not this adapter.

## Troubleshooting

### Feed shows 0 products

Check the query conditions in SMS database:
```sql
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN np.products_status = '1' THEN 1 ELSE 0 END) as active,
  SUM(CASE WHEN npv.npv_products_barcodes IS NOT NULL THEN 1 ELSE 0 END) as has_ean
FROM product_to_stores pts
INNER JOIN new_products np ON np.products_id = pts.pts_product_id
INNER JOIN new_products_variations npv ON np.products_id = npv.npv_products_id
WHERE pts.pts_store_id = 95 AND pts.pts_status = 1;
```

### File not written to correct location

Ensure:
1. Docker volume is mapped: `D:/path/to/feed:/feeds/fruugo`
2. Environment variable: `FRUUGO_FEED_DIR=/feeds/fruugo`

### API authentication fails

1. Check `FRUUGO_API_ID` and `FRUUGO_API_PASSWORD`
2. Run validate command:
   ```bash
   docker exec admin-api sh -c "node /app/dist/cli.js fruugo validate"
   ```

### SKU sync shows 0 updates but many mappings fetched

This is normal if the products haven't been populated into `jsa_marketplacelisting` yet. The sync only updates listings that exist in the table:
1. Run `populate-listings` first to create listings
2. Then run `sync-skus` to update the `externalSkuId` field

## API Endpoint Reference

**Important:** The Fruugo API documentation may reference old endpoints. The correct endpoints discovered during implementation are:

| Operation | Correct Endpoint |
|-----------|------------------|
| Inventory Update | `https://www.fruugo.com/stockstatus-api/availability/update` |
| SKU Listings | `https://www.fruugo.com/stockstatus-api/skus/get-all-skus?page=N` |

**Note:** Old endpoints like `merchants/stockupdate` and `merchants/listings` may be deprecated.

## Implementation Notes

### SKU Storage Strategy

Stock2 stores Fruugo SKU IDs differently from SMS:

| System | Storage Location |
|--------|------------------|
| SMS | `new_products_variations.fruugo_sku_id` |
| Stock2 | `jsa_marketplacelisting.externalSkuId` |

This approach keeps Stock2 independent and doesn't require write access to SMS database tables.

### Inventory Sync Data Source

For inventory sync, the adapter uses data from `jsa_marketplacelisting` where:
- `marketplaceName = 'fruugo'`
- `externalSkuId IS NOT NULL` (has a Fruugo SKU ID)
- `ukssQuantity != lastSyncedQuantity` (has changed, for delta sync)
