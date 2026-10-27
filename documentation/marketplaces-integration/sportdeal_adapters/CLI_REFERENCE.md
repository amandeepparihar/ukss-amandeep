# Sportdeal CLI Quick Reference

## All Commands

```bash
# Docker execution format
docker exec admin-api sh -c "node /app/dist/cli.js sportdeal <command> [options]"
```

## Feed Generation

```bash
# Generate product feed (XML)
sportdeal generate-feed
sportdeal generate-feed --dry-run           # Preview without writing
sportdeal generate-feed --limit 5000        # Limit to 5000 products
sportdeal generate-feed --chunk-size 5000   # Custom chunk size for streaming
sportdeal generate-feed --skip-archive      # Don't archive old feed
```

## Inventory Feed

```bash
# Generate inventory feed (XML - delta, changed items only)
sportdeal generate-inventory

# Generate full inventory feed (all items)
sportdeal generate-inventory --full

# Other options
sportdeal generate-inventory --dry-run           # Preview without writing
sportdeal generate-inventory --skip-archive      # Don't archive old feed
sportdeal generate-inventory --chunk-size 5000   # Custom chunk size (for --full)
```

## Listing Management

```bash
# Initial setup (one-time)
sportdeal populate-listings
sportdeal populate-listings --dry-run       # Preview without creating
sportdeal populate-listings --force         # Recreate all listings

# Update quantities and prices from SMS
sportdeal refresh-listings

# Full sync: add new, deactivate removed, refresh existing
sportdeal sync-listings
```

## Status & Validation

```bash
# Validate configuration
sportdeal validate

# Show listing counts
sportdeal listing-counts
```

## Environment Variables

```env
SPORTDEAL_STORE_ID=3
SPORTDEAL_FEED_DIR=/feeds/sportdeal
SPORTDEAL_CDN_URL=https://cdn.uksoccershop.com/images

# Optional
CLI_TIMEOUT_MS=3600000     # 1 hour timeout
FEED_CHUNK_SIZE=10000      # Records per chunk
```

## Feed Output Locations

| Feed Type | Default Location |
|-----------|------------------|
| Product Feed | `{SPORTDEAL_FEED_DIR}/product_feed.xml` |
| Inventory Feed | `{SPORTDEAL_FEED_DIR}/inventory/inventory_feed.xml` |
| Archive | `{SPORTDEAL_FEED_DIR}/Archive/` |

## Complete Workflow

```bash
# Daily operations
sportdeal sync-listings            # Add new, deactivate removed, refresh
sportdeal generate-feed            # Generate product XML
sportdeal generate-inventory       # Generate inventory XML (delta)

# Weekly operations (or as needed)
sportdeal generate-inventory --full    # Full inventory refresh
```

## Streaming for Large Datasets

Sportdeal supports streaming for large datasets (475K+ products):

```bash
# Uses FEED_CHUNK_SIZE env (default: 10000)
sportdeal generate-feed

# Override chunk size for memory-constrained environments
sportdeal generate-feed --chunk-size 5000
```

Streaming:
- Processes records in chunks to avoid memory issues
- Writes to temp file, then renames atomically
- Logs progress every 10 chunks
- Aborts and cleans up on error
