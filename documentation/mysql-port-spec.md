# MySQL/MariaDB Port Specification

## Overview
This admin panel now supports both PostgreSQL and MySQL/MariaDB databases. You can switch between them using environment variables.

## Supported Databases
- **PostgreSQL 16+** (default)
- **MySQL 8.0+**
- **MariaDB 10.3+** (tested with 10.11)

## Quick Start

### Option 1: Using PostgreSQL (Default)

```bash
# Start services
docker-compose -f docker-compose.dev.yml up postgres redis minio minio-init -d

# Generate Prisma client
cd apps/api
npm run db:generate
npm run db:push

# Start the app
npm run dev
```

### Option 2: Using MariaDB

```bash
# Start services (includes MariaDB)
docker-compose -f docker-compose.dev.yml up mariadb redis minio minio-init -d

# Set environment variables
export DATABASE_PROVIDER=mysql
export MYSQL_DATABASE_URL=mysql://admin:admin123@localhost:13306/admin_panel

# Generate MySQL Prisma client
cd apps/api
npm run db:generate:mysql
npm run db:push:mysql

# Start the app
npm run dev
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PROVIDER` | `postgresql` | `postgresql` or `mysql` |
| `DATABASE_URL` | - | PostgreSQL connection string |
| `MYSQL_DATABASE_URL` | - | MySQL/MariaDB connection string |

### Connection Strings

**PostgreSQL:**
```
postgresql://user:password@host:port/database
```

**MySQL/MariaDB:**
```
mysql://user:password@host:port/database
```

## NPM Scripts

### PostgreSQL (default)
```bash
npm run db:generate       # Generate Prisma client
npm run db:migrate        # Run migrations (dev)
npm run db:migrate:prod   # Run migrations (production)
npm run db:push           # Push schema changes
npm run db:studio         # Open Prisma Studio
npm run db:reset          # Reset database
npm run db:seed           # Seed database
```

### MySQL/MariaDB
```bash
npm run db:generate:mysql       # Generate MySQL Prisma client
npm run db:migrate:mysql        # Run migrations (dev)
npm run db:migrate:mysql:prod   # Run migrations (production)
npm run db:push:mysql           # Push schema changes
npm run db:studio:mysql         # Open Prisma Studio
npm run db:reset:mysql          # Reset database
```

### Both Databases
```bash
npm run db:generate:all   # Generate both clients
```

## Schema Differences

### PostgreSQL Schema
- Location: `apps/api/prisma/schema.prisma`
- Output: `@prisma/client` (default)
- Features: Native JSONB, arrays, enums

### MySQL Schema
- Location: `apps/api/prisma/schema.mysql.prisma`
- Output: `.prisma/client-mysql`
- Features: JSON (LONGTEXT), native enums

### Key Conversions

| PostgreSQL | MySQL/MariaDB | Notes |
|------------|---------------|-------|
| `String[]` | `Json` | Arrays stored as JSON |
| `Json` | `Json` | Stored as LONGTEXT in MariaDB |
| `@db.Text` | `@db.Text` | Same |
| `enum` | `enum` | Native support |
| `Decimal(10,2)` | `Decimal(10,2)` | Same |

## Docker Services

### Development (`docker-compose.dev.yml`)

| Service | Port | Purpose |
|---------|------|---------|
| postgres | 15432 | PostgreSQL database |
| mariadb | 13306 | MariaDB database |
| redis | 16379 | Cache & queues |
| minio | 19000, 19001 | S3-compatible storage |
| api | 4000 | Backend API |
| web | 3002 | Frontend |

### Production (`docker-compose.yml`)
MariaDB service is commented out by default. Uncomment to enable.

## Switching Databases at Runtime

The app uses dynamic imports to load the correct Prisma client:

```typescript
// apps/api/src/lib/prisma.ts
const databaseProvider = config.DATABASE_PROVIDER;

if (databaseProvider === 'mysql') {
  PrismaClientClass = require('.prisma/client-mysql').PrismaClient;
} else {
  PrismaClientClass = require('@prisma/client').PrismaClient;
}
```

## Performance Considerations

### MariaDB Optimizations
The Docker service includes these performance settings:
- `innodb-buffer-pool-size=256M`
- `innodb-log-file-size=64M`
- `utf8mb4_unicode_ci` collation

### Index Strategy
All 103 indexes from the PostgreSQL schema are preserved:
- Single column indexes for filtering
- Composite indexes for complex queries
- Unique constraints for data integrity

## Migration from PostgreSQL to MySQL

1. Export data from PostgreSQL
2. Start MariaDB service
3. Generate MySQL client
4. Push schema to MySQL
5. Import data
6. Update environment variables
7. Restart app

## Troubleshooting

### "Cannot find module '.prisma/client-mysql'"
Run `npm run db:generate:mysql` to generate the MySQL client.

### "Unknown database 'admin_panel'"
The database is created automatically by Docker. Wait for MariaDB to fully start.

### Connection refused on port 13306
MariaDB takes 10-15 seconds to initialize. Check with:
```bash
docker logs admin-mariadb
```

### JSON functions not working
Ensure you're using MariaDB 10.3+ or MySQL 8.0+. These versions support JSON functions like `JSON_EXTRACT`, `JSON_VALUE`, etc.

## Files Modified

| File | Change |
|------|--------|
| `apps/api/prisma/schema.mysql.prisma` | New MySQL schema |
| `apps/api/src/lib/prisma.ts` | Switchable client |
| `apps/api/src/config/index.ts` | DATABASE_PROVIDER config |
| `apps/api/package.json` | MySQL scripts |
| `docker-compose.dev.yml` | MariaDB service |
| `docker-compose.yml` | MariaDB service (commented) |
| `.env.example` | MariaDB variables |
