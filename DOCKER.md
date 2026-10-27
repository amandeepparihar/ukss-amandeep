# Docker Guide for Admin Panel

A beginner-friendly guide to running the Admin Panel with Docker.

## Table of Contents

1. [What is Docker?](#what-is-docker)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Development Mode](#development-mode)
5. [Production Mode](#production-mode)
6. [Security Configuration](#security-configuration)
7. [Essential Commands](#essential-commands)
8. [Common Issues & Solutions](#common-issues--solutions)
9. [Debugging Guide](#debugging-guide)
10. [Tips & Best Practices](#tips--best-practices)

---

## What is Docker?

Docker is a tool that packages your application and all its dependencies into a "container" - think of it as a lightweight virtual machine. This means:

- **Same environment everywhere**: No more "it works on my machine" problems
- **Easy setup**: One command starts everything
- **Isolation**: Each service runs in its own container

### Key Concepts

| Term | What it means |
|------|---------------|
| **Image** | A template/blueprint for creating containers (like a class in programming) |
| **Container** | A running instance of an image (like an object in programming) |
| **Volume** | Persistent storage that survives container restarts |
| **docker-compose** | Tool to run multiple containers together |

---

## Prerequisites

### 1. Install Docker

**Windows/Mac:**
1. Download [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. Install and start Docker Desktop
3. Verify installation: `docker --version`

**Linux (Ubuntu/Debian):**
```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Add your user to docker group (to run without sudo)
sudo usermod -aG docker $USER

# Log out and log back in, then verify
docker --version
```

### 2. Install Docker Compose

Docker Desktop includes docker-compose. For Linux:
```bash
sudo apt install docker-compose-plugin
docker compose version
```

---

## Quick Start

### Development Mode (Recommended for coding)

```bash
# Clone the repository
git clone https://github.com/velsof/js-admin-panel.git
cd js-admin-panel

# Start everything (first time takes 2-5 minutes)
docker-compose -f docker-compose.dev.yml up

# Open in browser
# Frontend: http://localhost:3002
# API: http://localhost:4000
```

**That's it!** Code changes will automatically reflect (hot reload).

### Production Mode

```bash
# Build and start production containers
docker-compose up -d --build

# Check if everything is running
docker-compose ps
```

---

## Development Mode

Development mode mounts your source code into the containers. This means:
- Code changes reflect immediately (hot reload)
- No need to rebuild containers when you change code
- Perfect for day-to-day development

### Starting Development Environment

```bash
# Start all services
docker-compose -f docker-compose.dev.yml up

# Or run in background (detached mode)
docker-compose -f docker-compose.dev.yml up -d

# Watch logs while running in background
docker-compose -f docker-compose.dev.yml logs -f
```

### Stopping Development Environment

```bash
# Stop containers (keeps data)
docker-compose -f docker-compose.dev.yml down

# Stop and remove all data (fresh start)
docker-compose -f docker-compose.dev.yml down -v
```

### Seeding the Database (Development)

After starting the development environment for the first time, seed the database with demo data:

```bash
# For PostgreSQL (default)
docker-compose -f docker-compose.dev.yml exec api sh -c \
  'cd /app/apps/api && DATABASE_URL="postgresql://admin:admin123@postgres:5432/admin_panel" npx tsx prisma/seeds/index.ts'

# For MySQL/MariaDB (if DATABASE_PROVIDER=mysql in .env)
docker-compose -f docker-compose.dev.yml exec api sh -c \
  'cd /app/apps/api && DATABASE_PROVIDER=mysql MYSQL_DATABASE_URL="mysql://admin:admin123@mariadb:3306/admin_panel" npx tsx prisma/seeds/seed-mysql.ts'

# Seed demo products for DataTable (10,000 products) - MySQL
docker-compose -f docker-compose.dev.yml exec api sh -c \
  'cd /app/apps/api && DATABASE_PROVIDER=mysql MYSQL_DATABASE_URL="mysql://admin:admin123@mariadb:3306/admin_panel" npx tsx prisma/seeds/demo-data.ts 10000'
```

**Default login credentials after seeding:**
- Email: `admin@example.com`
- Password: `Admin@123`

**What gets seeded:**
| Data | Count |
|------|-------|
| Roles | 3 (super-admin, admin, user) |
| Permissions | 76 |
| Admin User | 1 |
| Menu Items | 8 |
| System Settings | 5 |
| Demo Categories | 8 |
| Demo Statuses | 4 |
| Demo Products | 10,000 |

### Making Code Changes (Hot Reload)

The development environment supports **instant hot reload** - your changes appear automatically without rebuilding containers.

#### How It Works

| Component | Technology | Reload Time |
|-----------|------------|-------------|
| API (Backend) | tsx watch | ~2-3 seconds |
| Web (Frontend) | Vite HMR | ~1-2 seconds |

#### Step-by-Step Guide

**1. Start the development environment:**
```bash
docker-compose -f docker-compose.dev.yml up -d
```

**2. Open the application:**
- Frontend: http://localhost:3002
- API: http://localhost:4000
- API Docs: http://localhost:4000/docs  

**3. Make code changes:**

For **API changes** (backend):
```bash
# Edit any file in apps/api/src/
# Example: apps/api/src/app.ts

# The API will automatically restart
# Check logs to confirm:
docker-compose -f docker-compose.dev.yml logs -f api
```

For **Web changes** (frontend):
```bash
# Edit any file in apps/web/src/
# Example: apps/web/src/components/layout/Sidebar.tsx

# Vite will hot-reload the browser automatically
# Check logs to confirm:
docker-compose -f docker-compose.dev.yml logs -f web
```

**4. Verify your changes:**
- Frontend changes: Browser updates automatically (no refresh needed)
- API changes: Test with curl or refresh the browser

#### Example: Testing Hot Reload

```bash
# Terminal 1: Watch API logs
docker-compose -f docker-compose.dev.yml logs -f api

# Terminal 2: Watch Web logs
docker-compose -f docker-compose.dev.yml logs -f web

# Terminal 3: Make a change and see it reflected
# Edit apps/api/src/app.ts - you'll see "Server running" in Terminal 1
# Edit apps/web/src/App.tsx - you'll see "hmr update" in Terminal 2
```

#### What Gets Hot Reloaded

| Change Type | Hot Reload? | Notes |
|-------------|-------------|-------|
| TypeScript/JavaScript files | ✅ Yes | Instant reload |
| React components | ✅ Yes | State preserved with HMR |
| CSS/Tailwind styles | ✅ Yes | Instant update |
| Prisma schema | ❌ No | Run `docker-compose exec api npx prisma generate` |
| package.json dependencies | ❌ No | Restart container: `docker-compose -f docker-compose.dev.yml restart api` |
| Environment variables | ❌ No | Restart container |

#### Troubleshooting Hot Reload

**Changes not appearing?**
```bash
# Check if the container detected the change
docker-compose -f docker-compose.dev.yml logs --tail=20 api
docker-compose -f docker-compose.dev.yml logs --tail=20 web

# Force restart if needed
docker-compose -f docker-compose.dev.yml restart api web
```

**API crashes after change?**
```bash
# Check error logs
docker-compose -f docker-compose.dev.yml logs -f api

# The API will auto-restart on syntax errors
# Fix the error and save - it will restart again
```

No rebuild needed!

---

## Production Mode

Production mode builds optimized Docker images. Use this for:
- Deploying to servers
- Testing production builds locally
- CI/CD pipelines

### Building Production Images

```bash
# Build and start
docker-compose up -d --build

# Just build without starting
docker-compose build
```

### First-Time Setup (Database Initialization)

After starting containers for the first time, initialize the database:

#### For PostgreSQL (default)

```bash
# 1. Apply database schema
docker-compose exec api npx prisma db push --skip-generate

# 2. Create admin user (generates bcrypt hash and inserts via SQL)
HASH=$(docker-compose exec -T api node -e "require('bcrypt').hash('Admin@123',12).then(h=>console.log(h))" | tr -d '\r')

docker-compose exec -T postgres psql -U admin -d admin_panel << EOF
-- Create super-admin role
INSERT INTO "Role" (id, name, description, "isSystem", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'super-admin', 'Super Administrator', true, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

-- Create admin user
INSERT INTO "User" (id, email, password, "firstName", "lastName", "roleId", "isActive", "emailVerified", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'admin@example.com', '${HASH}', 'Super', 'Admin', id, true, true, NOW(), NOW()
FROM "Role" WHERE name = 'super-admin'
ON CONFLICT (email) DO NOTHING;
EOF
```

#### For MySQL/MariaDB (if DATABASE_PROVIDER=mysql)

```bash
# 1. Apply database schema
docker-compose exec api npx prisma db push --schema=./prisma/schema.mysql.prisma --skip-generate

# 2. Run the seed script (recommended - creates all roles, users, menu items, settings)
docker-compose exec api sh -c \
  'DATABASE_PROVIDER=mysql MYSQL_DATABASE_URL="mysql://admin:admin123@mariadb:3306/admin_panel" npx tsx prisma/seeds/seed-mysql.ts'

# 3. Seed demo data for DataTable (optional - 10,000 products)
docker-compose exec api sh -c \
  'DATABASE_PROVIDER=mysql MYSQL_DATABASE_URL="mysql://admin:admin123@mariadb:3306/admin_panel" npx tsx prisma/seeds/demo-data.ts 10000'
```

**Default admin credentials:**
- Email: `admin@example.com`
- Password: `Admin@123`

> **Important:** Change the admin password immediately after first login!

### Updating Production Deployment

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose up -d --build

# Or rebuild specific service
docker-compose up -d --build api
```

### Environment Variables

Create a `.env` file for production settings:

```bash
cp .env.example .env
# Edit .env with your settings
nano .env
```

Important variables to change:
```env
JWT_SECRET=<generate with: openssl rand -base64 48>
POSTGRES_PASSWORD=<strong-password>
MINIO_ROOT_PASSWORD=<strong-password>
VITE_API_URL=https://your-domain.com/api
```

---

## Security Configuration

This section covers security requirements for production deployments.

### Required Environment Variables

**Create a `.env` file with secure values before deploying to production:**

```bash
# Generate secure passwords (using hex for URL-safe characters)
openssl rand -hex 24  # For general passwords (48 chars)
openssl rand -hex 32  # For JWT_SECRET (64 chars)
```

> **Note:** Use `-hex` instead of `-base64` to avoid special characters (`/`, `+`, `=`) that can break Redis URLs.

```env
# Database Provider (choose one: postgresql or mysql)
DATABASE_PROVIDER=mysql

# PostgreSQL (if using DATABASE_PROVIDER=postgresql)
POSTGRES_USER=admin
POSTGRES_PASSWORD=<generated-password>
POSTGRES_DB=admin_panel

# MySQL/MariaDB (if using DATABASE_PROVIDER=mysql)
MYSQL_USER=admin
MYSQL_PASSWORD=<generated-password>
MYSQL_DATABASE=admin_panel

# Redis (REQUIRED - change from default)
REDIS_PASSWORD=<generated-password>

# MinIO/S3 (REQUIRED - change from defaults)
MINIO_ROOT_USER=<your-admin-user>
MINIO_ROOT_PASSWORD=<generated-password>

# JWT (REQUIRED - must be at least 32 characters)
JWT_SECRET=<generated-48-char-secret>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# App URLs (REQUIRED for production)
APP_URL=https://your-domain.com
VITE_API_URL=https://your-domain.com/api
```

### Security Features Implemented

| Feature | Description |
|---------|-------------|
| **Redis Authentication** | Redis requires password authentication |
| **No External DB Ports** | Database ports (PostgreSQL, Redis, MinIO) are not exposed externally |
| **Security Headers** | Nginx adds X-Frame-Options, X-Content-Type-Options, XSS-Protection, Referrer-Policy |
| **No New Privileges** | Containers cannot gain additional privileges |
| **Read-only Filesystem** | API container uses read-only filesystem with tmpfs for temp files |
| **Non-root Users** | Services run as non-root users where possible |
| **Hidden Server Tokens** | Nginx version hidden from responses |
| **Pinned Image Versions** | All Docker images use pinned versions for reproducibility |

### Production Security Checklist

Before deploying to production, verify:

- [ ] Changed `POSTGRES_PASSWORD` from default
- [ ] Changed `REDIS_PASSWORD` from default
- [ ] Changed `MINIO_ROOT_PASSWORD` from default
- [ ] Set `JWT_SECRET` to a secure 48+ character value
- [ ] Set `VITE_API_URL` to your actual domain
- [ ] Reviewed and updated `EMAIL_*` variables if using email features
- [ ] Set up HTTPS/TLS termination (reverse proxy or load balancer)
- [ ] Configured firewall rules to restrict access
- [ ] Set up log aggregation and monitoring

### Enabling External Database Access (Development Only)

If you need to access databases externally during development, uncomment the port mappings in `docker-compose.yml`:

```yaml
postgres:
  ports:
    - '15432:5432'  # Uncomment for external access

redis:
  ports:
    - '16379:6379'  # Uncomment for external access

minio:
  ports:
    - '19000:9000'  # API access
    - '19001:9001'  # Console access
```

**Never expose database ports in production environments.**

---

## Essential Commands

### Container Management

```bash
# List running containers
docker-compose ps

# Start containers
docker-compose up -d

# Stop containers
docker-compose down

# Restart a specific service
docker-compose restart api

# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f api
```

### Debugging Commands

```bash
# Enter a running container (like SSH)
docker-compose exec api sh
docker-compose exec web sh

# Run a command in container
docker-compose exec api npm run prisma:studio

# Check container resource usage
docker stats
```

### Cleanup Commands

```bash
# Remove stopped containers
docker-compose down

# Remove containers AND volumes (DATABASE DATA WILL BE LOST!)
docker-compose down -v

# Remove all unused Docker data
docker system prune

# Remove everything including images (full reset)
docker system prune -a
```

---

## Common Issues & Solutions

### 1. "Port already in use"

**Error:** `Bind for 0.0.0.0:4000 failed: port is already allocated`

**Cause:** Another application is using the port.

**Solutions:**
```bash
# Option 1: Find and kill the process using the port
# On Linux/Mac:
lsof -i :4000
kill -9 <PID>

# On Windows:
netstat -ano | findstr :4000
taskkill /PID <PID> /F

# Option 2: Change the port in docker-compose.yml
# Change '4000:4000' to '4001:4000'
```

### 2. "Container keeps restarting"

**Cause:** Application is crashing inside the container.

**Solutions:**
```bash
# Check logs to see the error
docker-compose logs api

# Common fixes:
# - Database not ready: Wait or check postgres is healthy
# - Missing env vars: Check .env file
# - Port conflict: Change ports
```

### 3. "Cannot connect to database"

**Error:** `ECONNREFUSED` or `Connection refused`

**Cause:** Database container not ready or wrong connection string.

**Solutions:**
```bash
# Check if postgres is running
docker-compose ps postgres

# Wait for postgres to be healthy
docker-compose logs postgres

# Restart everything
docker-compose down && docker-compose up -d
```

### 4. "node_modules issues" or "Module not found"

**Cause:** Dependencies not installed in container.

**Solutions:**
```bash
# For development mode - rebuild containers
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.dev.yml up --build

# For production mode
docker-compose down
docker-compose up -d --build
```

### 5. "Disk space full"

**Cause:** Docker images and volumes taking too much space.

**Solutions:**
```bash
# Check Docker disk usage
docker system df

# Clean up unused resources
docker system prune

# Remove all unused images (more aggressive)
docker image prune -a

# Nuclear option - remove EVERYTHING
docker system prune -a --volumes
```

### 6. "Changes not reflecting" (Development mode)

**Cause:** Volume mount not working properly.

**Solutions:**
```bash
# Restart containers
docker-compose -f docker-compose.dev.yml restart

# If still not working, recreate containers
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.dev.yml up

# Check if file is being watched
docker-compose -f docker-compose.dev.yml logs -f api
```

### 7. "Permission denied"

**Error:** `EACCES: permission denied`

**Solutions:**
```bash
# On Linux, fix ownership
sudo chown -R $USER:$USER .

# Or run Docker with your user
# Add to docker-compose.yml under the service:
# user: "${UID}:${GID}"
```

### 8. "Image build fails"

**Solutions:**
```bash
# Build with no cache (fresh build)
docker-compose build --no-cache

# Check the specific error in build output
docker-compose build api 2>&1 | tail -50
```

---

## Debugging Guide

### Step 1: Check Container Status

```bash
docker-compose ps
```

Look for:
- **Status**: Should be "Up" or "running"
- **Health**: Should be "healthy"
- **Ports**: Should show port mappings

### Step 2: Check Logs

```bash
# All services
docker-compose logs

# Specific service with follow
docker-compose logs -f api

# Last 100 lines
docker-compose logs --tail=100 api
```

### Step 3: Enter the Container

```bash
# Get a shell inside the container
docker-compose exec api sh

# Now you can run commands inside:
ls -la
cat /app/package.json
node --version
```

### Step 4: Check Network

```bash
# List networks
docker network ls

# Inspect network
docker network inspect admin-network

# Test connectivity between containers
docker-compose exec api ping postgres
```

### Step 5: Check Volumes

```bash
# List volumes
docker volume ls

# Inspect volume
docker volume inspect js-admin-panel_postgres_data
```

### Step 6: Check Resource Usage

```bash
# CPU and memory usage
docker stats

# Disk usage
docker system df
```

### Step 7: Inspect Container Details

```bash
# Get full container info
docker inspect admin-api

# Get just the IP address
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' admin-api
```

---

## Tips & Best Practices

### 1. Use Aliases for Common Commands

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
alias dc='docker-compose'
alias dcup='docker-compose up -d'
alias dcdown='docker-compose down'
alias dclogs='docker-compose logs -f'
alias dcdev='docker-compose -f docker-compose.dev.yml'
```

Then use: `dcdev up` instead of `docker-compose -f docker-compose.dev.yml up`

### 2. Development Workflow

```bash
# Morning: Start your environment
docker-compose -f docker-compose.dev.yml up -d

# During day: Code normally, changes auto-reload

# End of day: Stop containers
docker-compose -f docker-compose.dev.yml down
```

### 3. Database Access

```bash
# Open Prisma Studio (database GUI)
docker-compose exec api npx prisma studio

# Connect directly to PostgreSQL
docker-compose exec postgres psql -U admin -d admin_panel

# Connect directly to MySQL/MariaDB
docker-compose exec mariadb mysql -u admin -padmin123 admin_panel
```

### 4. Running Tests

```bash
# Run E2E tests
docker-compose -f docker-compose.dev.yml exec web pnpm test:e2e

# Run API tests
docker-compose -f docker-compose.dev.yml exec api pnpm test
```

### 5. Fresh Start

When things are really broken:

```bash
# Nuclear reset (DELETES ALL DATA)
docker-compose down -v
docker system prune -a
docker-compose up -d --build
```

---

## Service Ports Reference

| Service | Internal Port | External Port | URL |
|---------|---------------|---------------|-----|
| Web (Frontend) | 80 | 3002 | http://localhost:3002 |
| API (Backend) | 4000 | 4000 | http://localhost:4000 |
| PostgreSQL | 5432 | 15432 | localhost:15432 |
| MariaDB/MySQL | 3306 | 13306 | localhost:13306 |
| Redis | 6379 | 16379 | localhost:16379 |
| MinIO (S3) | 9000 | 19000 | http://localhost:19000 |
| MinIO Console | 9001 | 19001 | http://localhost:19001 |

---

## Getting Help

1. Check this guide first
2. Look at container logs: `docker-compose logs`
3. Search the error message online
4. Ask in team chat with:
   - The command you ran
   - The full error message
   - Output of `docker-compose ps`
