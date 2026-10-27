# Marketplace Integration - Base Setup

This document describes the base framework for marketplace integrations in Stock2 (JS Admin). The framework provides reusable utilities and patterns for integrating with various marketplaces like Fruugo, BaseLinker, OnBuy, Walmart, etc.

## Overview

The base framework follows an **Adapter Pattern** where each marketplace implements a common interface while using shared utilities for:
- HTTP requests with authentication
- Rate limiting
- Retry handling with exponential backoff
- Batch processing
- CSV/XML data formatting
- Database sync tracking

## Directory Structure

```
apps/api/src/modules/marketplaces/
├── adapters/
│   ├── base.adapter.ts        # Base adapter class
│   ├── types.ts               # Adapter interfaces and types
│   ├── fruugo/                # Fruugo-specific adapter (see fruugo_adapters docs)
│   └── sportdeal/             # Sportdeal-specific adapter (see sportdeal_adapters docs)
├── cli/
│   ├── index.ts               # CLI exports
│   ├── fruugo.commands.ts     # Fruugo CLI commands
│   └── sportdeal.commands.ts  # Sportdeal CLI commands
├── config/
│   └── types.ts               # Configuration types
├── utils/
│   ├── http-client.ts         # HTTP client with auth, rate limiting, retry
│   ├── auth-provider.ts       # Authentication providers (Basic, Token, OAuth2)
│   ├── rate-limiter.ts        # Rate limiting strategies
│   ├── retry-handler.ts       # Retry with exponential backoff
│   ├── batch-processor.ts     # Batch processing for large datasets
│   ├── sync-tracker.ts        # Database sync status tracking
│   ├── csv.utils.ts           # CSV generation utilities
│   ├── xml.utils.ts           # XML parsing/building utilities
│   ├── file.utils.ts          # File operations (temp files, archiving)
│   └── errors.ts              # Custom error classes
├── db/
│   └── index.ts               # Database model types
└── index.ts                   # Module exports
```

## Core Components

### 1. Base Marketplace Adapter

**File:** `adapters/base.adapter.ts`

The `BaseMarketplaceAdapter` abstract class provides common functionality for all marketplace adapters:

```typescript
export abstract class BaseMarketplaceAdapter implements MarketplaceAdapter {
  abstract readonly marketplaceId: string;
  abstract readonly name: string;
  abstract readonly pattern: IntegrationPattern;

  protected readonly config: MarketplaceConfig;
  protected readonly httpClient: HttpClient;
  protected readonly batchProcessor: BatchProcessor;
  protected readonly syncTracker: MarketplaceSyncTracker;
  protected readonly logger: Logger;

  abstract getCapabilities(): MarketplaceCapabilities;
  abstract validateCredentials(): Promise<ValidationResult>;
  abstract syncInventory(inventory: InventoryData[]): Promise<SyncResult>;
}
```

**Key Features:**
- Automatic initialization of HTTP client, batch processor, and sync tracker
- Helper methods for creating success/failure results
- Logging with timing measurements

### 2. Sync Tracker

**File:** `utils/sync-tracker.ts`

The `MarketplaceSyncTracker` class manages synchronization status for marketplace listings in the database.

**Database Tables:**
- `jsa_marketplacelisting` - Stores listing data and sync status
- `jsa_marketplacesynchistory` - Audit trail for sync operations

**Key Methods:**

```typescript
class MarketplaceSyncTracker {
  // Delta listing - get items never synced
  async getNewItems(options?: SyncQueryOptions): Promise<ListingForSync[]>

  // Get items with changes since last sync
  async getChangedItems(options?: SyncQueryOptions): Promise<ListingForSync[]>

  // Get all items for full sync
  async getItemsForFullSync(options?: SyncQueryOptions): Promise<ListingForSync[]>

  // Process sync results and update database
  async processResults(results: SyncItemResult[]): Promise<SyncResultSummary>

  // UKSS Population Methods
  async initializeFromUkss(options?: { limit?: number; dryRun?: boolean }): Promise<PopulationResult>
  async refreshFromUkss(): Promise<RefreshResult>
  async addNewFromUkss(): Promise<AddNewResult>
  async deactivateRemovedFromUkss(): Promise<DeactivateResult>

  // Get counts for monitoring
  async getCounts(): Promise<ListingCounts>
}
```

### 3. HTTP Client

**File:** `utils/http-client.ts`

HTTP client with built-in authentication, rate limiting, and retry logic.

```typescript
const client = new HttpClient({
  baseUrl: 'https://api.marketplace.com',
  auth: {
    type: 'basic',  // or 'token', 'oauth2'
    username: 'user',
    password: 'pass',
  },
  timeout: 30000,
  rateLimit: {
    strategy: 'burst',
    requestsPerMinute: 95,
    windowMs: 60000,
  },
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitter: true,
  },
});

const response = await client.get<DataType>('/endpoint');
const response = await client.post<DataType>('/endpoint', data);
```

### 4. Authentication Providers

**File:** `utils/auth-provider.ts`

Supports multiple authentication methods:

| Type | Description | Usage |
|------|-------------|-------|
| `basic` | HTTP Basic Auth | Fruugo, Sportdeal |
| `token` | Bearer token in header | BaseLinker (header) |
| `token-body` | Token in request body | BaseLinker (body param) |
| `oauth2` | OAuth 2.0 with token refresh | Walmart, OnBuy |

### 5. Rate Limiter

**File:** `utils/rate-limiter.ts`

Two rate limiting strategies:

**Fixed Delay:**
```typescript
const limiter = new RateLimiter({
  strategy: 'fixed',
  delayMs: 100,  // Wait 100ms between requests
});
```

**Burst and Wait (recommended for BaseLinker):**
```typescript
const limiter = new RateLimiter({
  strategy: 'burst',
  requestsPerMinute: 95,
  windowMs: 60000,  // 95 requests per 60 seconds
});
```

### 6. Batch Processor

**File:** `utils/batch-processor.ts`

Process large datasets in batches:

```typescript
const processor = new BatchProcessor({
  batchSize: 100,
  continueOnError: true,
  delayBetweenBatches: 0,
});

const result = await processor.process(items, async (batch) => {
  // Process batch
  return processedItems;
});
```

### 7. CSV Utilities

**File:** `utils/csv.utils.ts`

Generate CSV files for feed-based marketplaces:

```typescript
// Build CSV from 2D array
const csv = csvUtils.build(headers, rows);

// Write CSV to file
await csvUtils.writeFile(filePath, headers, rows);

// Build from objects
const csv = csvUtils.buildFromObjects(data, [
  { key: 'sku', header: 'SKU' },
  { key: 'name', header: 'Product Name' },
]);
```

### 8. File Utilities

**File:** `utils/file.utils.ts`

Safe file operations with temp file pattern:

```typescript
// Write with atomic move
await fileUtils.writeWithTemp(finalPath, content);

// Archive existing file
await fileUtils.archiveFile(filePath);

// Ensure directory exists
await fileUtils.ensureDir(dirPath);

// Move file
await fileUtils.moveFile(source, destination);
```

## Important: Data Source for Feeds

**The `jsa_MarketplaceListing` table is the SINGLE SOURCE OF TRUTH for all marketplace feeds.**

All feed generators (Fruugo, Sportdeal, etc.) query from this table, NOT directly from SMS tables. The workflow is:

```
SMS Tables (new_products, new_products_variations)
       │
       │  populate-listings / refresh-listings
       ▼
jsa_MarketplaceListing (Source of Truth)
       │
       │  generate-feed / generate-inventory
       ▼
Feed Files (CSV, XML)
```

This ensures:
- Consistent data across all feeds
- Centralized control over which products appear in each marketplace
- Change tracking via `lastSyncedQuantity`, `lastSyncedPrice`
- Error handling via `retryCount`, `lastSyncError`

See `WORKFLOW.md` for detailed data flow documentation.

## Database Schema

### jsa_marketplacelisting

| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR(25) | Primary key (format: `{marketplace}-{storeId}-{sku}`) |
| storeId | INT | Store ID (e.g., 95 for Fruugo) |
| marketplaceName | VARCHAR(191) | Marketplace identifier |
| ukssSku | VARCHAR(191) | UKSS SKU |
| ukssProductId | INT | UKSS Product ID |
| ukssQuantity | INT | Current quantity from UKSS |
| ukssPrice | DECIMAL(10,2) | Current price from UKSS |
| externalSkuId | VARCHAR(191) | Marketplace's SKU ID |
| externalProductId | VARCHAR(191) | Marketplace's product ID |
| isActive | TINYINT(1) | Active status |
| listedAt | DATETIME | First successful sync timestamp |
| delistedAt | DATETIME | Delisting timestamp |
| lastSyncStatus | ENUM | PENDING, SYNCING, SYNCED, FAILED |
| lastSyncedAt | DATETIME | Last sync attempt |
| retryCount | INT | Retry counter |
| lastSyncError | VARCHAR(500) | Last error message |
| lastSyncedQuantity | INT | Last synced quantity |
| lastSyncedPrice | DECIMAL(10,2) | Last synced price |
| priority | INT | Sync priority |
| metadata | JSON | Additional data |

### jsa_marketplacesynchistory

| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR(25) | Primary key |
| storeId | INT | Store ID |
| marketplaceName | VARCHAR(191) | Marketplace identifier |
| operation | VARCHAR(50) | Operation name |
| correlationId | VARCHAR(50) | Log correlation ID |
| startedAt | DATETIME | Job start time |
| completedAt | DATETIME | Job end time |
| durationMs | INT | Duration in milliseconds |
| status | ENUM | COMPLETED, COMPLETED_WITH_ERRORS, FAILED |
| totalItems | INT | Total items processed |
| newItemsListed | INT | New listings created |
| itemsUpdated | INT | Existing listings updated |
| itemsFailed | INT | Failed items |
| errorSummary | TEXT | Error summary |
| errorDetails | JSON | Detailed errors |
| triggeredBy | VARCHAR(50) | CLI, API, CRON |
| metadata | JSON | Additional data |

## CLI Commands

The CLI is accessible via:

```bash
# Inside Docker container
docker exec admin-api sh -c "node /app/dist/cli.js <command>"

# Development (apps/api directory)
pnpm cli <command>
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_PROVIDER` | Database type | `mysql` |
| `MYSQL_DATABASE_URL` | Database connection | `mysql://user:pass@host:3306/db` |

## Creating a New Marketplace Adapter

1. Create adapter directory: `adapters/{marketplace}/`
2. Create files:
   - `{marketplace}.adapter.ts` - Main adapter class
   - `{marketplace}.config.ts` - Configuration loading
   - `{marketplace}.types.ts` - Type definitions
   - `index.ts` - Exports
3. Extend `BaseMarketplaceAdapter`
4. Implement required methods
5. Add CLI commands in `cli/{marketplace}.commands.ts`
6. Register in `cli/index.ts`

See `fruugo_adapters` documentation for a complete example.
