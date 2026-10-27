# Fruugo CLI Quick Reference

## All Commands

```bash
# Docker execution format
docker exec admin-api sh -c "node /app/dist/cli.js fruugo <command> [options]"
```

## Feed Generation

```bash
# Generate product feed (CSV)
fruugo generate-feed
fruugo generate-feed --dry-run              # Preview without writing
fruugo generate-feed --limit 5000           # Limit to 5000 products
fruugo generate-feed --chunk-size 5000      # Custom chunk size for streaming
fruugo generate-feed --skip-archive         # Don't archive old feed
```

## Inventory Sync

```bash
# Sync inventory to Fruugo API (delta - changed items only)
fruugo sync-inventory
fruugo sync-inventory --dry-run             # Preview without syncing
fruugo sync-inventory --full                # Full sync (all items)
fruugo sync-inventory --batch-size 100      # Custom batch size
```

## SKU Mapping

```bash
# Fetch SKU IDs from Fruugo
fruugo sync-skus
fruugo sync-skus --page-from 1 --page-to 100   # Specific page range
fruugo sync-skus --batch-size 1000             # Custom batch size
```

## Listing Management

```bash
# Initial setup (one-time)
fruugo populate-listings
fruugo populate-listings --dry-run          # Preview without creating
fruugo populate-listings --force            # Recreate all listings

# Update quantities and prices from SMS
fruugo refresh-listings

# Full sync: add new, deactivate removed, refresh existing
fruugo sync-listings
```

## Status & Validation

```bash
# Validate configuration
fruugo validate

# Show listing counts
fruugo listing-counts
```

## Environment Variables

```env
FRUUGO_STORE_ID=3
FRUUGO_FEED_DIR=/feeds/fruugo
FRUUGO_CDN_URL=https://cdn.uksoccershop.com/images
FRUUGO_API_URL=https://api.fruugo.com
FRUUGO_USERNAME=your_username
FRUUGO_PASSWORD=your_password

# Optional
CLI_TIMEOUT_MS=3600000     # 1 hour timeout
FEED_CHUNK_SIZE=10000      # Records per chunk
```

## Complete Workflow

```bash
# Daily operations
fruugo sync-listings            # Add new, deactivate removed, refresh
fruugo generate-feed            # Generate CSV for FTP
fruugo sync-inventory           # Push inventory changes to API

# Weekly operations
fruugo sync-skus                # Fetch SKU mappings from Fruugo
```
