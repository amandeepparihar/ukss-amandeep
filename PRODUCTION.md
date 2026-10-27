# Production Deployment Guide

This guide covers deploying the Admin Panel to a production environment.

---

## Deployment Options

| Method | Best For | Setup Time | Complexity |
|--------|----------|------------|------------|
| **[Docker (Full)](#docker-deployment-recommended)** | Teams, Easy deployment | 5 min | Low |
| **[PM2 (Native)](#native-pm2-deployment)** | Single server, Custom setup | 15 min | Medium |

---

## Docker Deployment (Recommended)

The easiest way to deploy. Everything runs in containers.

### Quick Start

```bash
# Clone repository
git clone https://github.com/velsof/js-admin-panel.git
cd js-admin-panel

# Configure environment
cp .env.example .env
# Edit .env with your settings (especially JWT_SECRET!)

# Build and start everything
docker-compose up -d --build

# Check status
docker-compose ps
```

**That's it!** Your app is running at:
- Frontend: http://localhost:3002
- API: http://localhost:4000

### For detailed Docker instructions, see [DOCKER.md](./DOCKER.md)

---

## Native PM2 Deployment

If you prefer running Node.js directly without Docker.

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- PM2 (`npm install -g pm2`)
- Docker & Docker Compose
- Apache or Nginx (for reverse proxy)

## 1. Clone & Install

```bash
git clone https://github.com/velsof/js-admin-panel.git
cd js-admin-panel
pnpm install
```

## 2. Start Dependencies

The application requires a database (PostgreSQL or MySQL/MariaDB), Redis, and MinIO (S3-compatible storage).

### Using Docker (Recommended)

```bash
docker-compose up -d
```

This starts:
| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL | 15432 | Database (default) |
| MariaDB/MySQL | 13306 | Database (alternative) |
| Redis | 16379 | Session/Cache/Queue |
| MinIO | 19000 | File storage (S3) |
| MinIO Console | 19001 | MinIO admin UI |

**Note:** Set `DATABASE_PROVIDER=mysql` in `.env` to use MySQL/MariaDB instead of PostgreSQL.

### Manual Setup (Alternative)

If not using Docker, install these services manually and update the connection strings in `.env`.

## 3. Environment Configuration

### API Configuration (`apps/api/.env`)

Copy the example and configure:

```bash
cp .env.example apps/api/.env
```

Edit `apps/api/.env`:

```env
# App
NODE_ENV=production
PORT=4000
HOST=0.0.0.0

# URLs (change to your domain)
APP_URL=https://your-domain.com
API_URL=https://your-domain.com

# Database Provider: 'postgresql' or 'mysql'
DATABASE_PROVIDER=mysql

# PostgreSQL (if DATABASE_PROVIDER=postgresql)
DATABASE_URL=postgresql://admin:admin123@localhost:15432/admin_panel

# MySQL/MariaDB (if DATABASE_PROVIDER=mysql)
MYSQL_DATABASE_URL=mysql://admin:admin123@localhost:13306/admin_panel

# Redis
REDIS_URL=redis://localhost:16379

# JWT - IMPORTANT: Generate a secure secret!
# Run: openssl rand -base64 48
JWT_SECRET=your-secure-secret-here
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# S3/MinIO Storage
S3_ENDPOINT=http://localhost:19000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=uploads
S3_REGION=us-east-1

# Email Configuration
EMAIL_PROVIDER=smtp
EMAIL_FROM=noreply@your-domain.com
EMAIL_FROM_NAME=Admin Panel

# SMTP Settings
SMTP_HOST=your-smtp-host.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password

# Optional: SendGrid (set EMAIL_PROVIDER=sendgrid)
SENDGRID_API_KEY=

# Optional: Twilio SMS
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Logging
LOG_LEVEL=info
```

### Frontend Configuration (`apps/web/.env`)

```bash
echo "VITE_API_URL=https://your-domain.com/api" > apps/web/.env
```

## 4. Database Setup

Run migrations and seed initial data:

### For PostgreSQL (default)
```bash
cd apps/api
pnpm prisma migrate deploy
pnpm prisma db seed
cd ../..
```

### For MySQL/MariaDB
```bash
cd apps/api
pnpm prisma db push --schema=./prisma/schema.mysql.prisma
DATABASE_PROVIDER=mysql npx tsx prisma/seeds/seed-mysql.ts
# Optional: Seed demo products for DataTable
DATABASE_PROVIDER=mysql npx tsx prisma/seeds/demo-data.ts 10000
cd ../..
```

Default admin credentials after seeding:
- Email: `admin@example.com`
- Password: `Admin@123`

**Important:** Change the admin password immediately after first login!

## 5. Build for Production

```bash
pnpm build
```

This compiles:
- API: TypeScript to JavaScript (`apps/api/dist/`)
- Web: React to static files (`apps/web/dist/`)

## 6. Start with PM2

```bash
# Start the applications
pm2 start ecosystem.config.cjs

# Save the process list
pm2 save

# Setup auto-start on server reboot
pm2 startup
# Run the command it outputs (requires sudo)
```

## 7. Reverse Proxy Configuration

### Apache

Create `/etc/apache2/sites-available/your-domain.conf`:

```apache
<VirtualHost *:80>
    ServerName your-domain.com
    RewriteEngine On
    RewriteRule ^(.*)$ https://%{HTTP_HOST}$1 [R=301,L]
</VirtualHost>

<VirtualHost *:443>
    ServerName your-domain.com

    SSLEngine on
    SSLCertificateFile /path/to/fullchain.pem
    SSLCertificateKeyFile /path/to/privkey.pem

    ProxyPreserveHost On

    # API routes
    ProxyPass /api http://127.0.0.1:4000/api
    ProxyPassReverse /api http://127.0.0.1:4000/api

    # Frontend
    ProxyPass / http://127.0.0.1:3002/
    ProxyPassReverse / http://127.0.0.1:3002/

    # WebSocket support (for dev mode HMR)
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:3002/$1 [P,L]
</VirtualHost>
```

Enable the site:

```bash
sudo a2ensite your-domain.conf
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite ssl
sudo systemctl reload apache2
```

### Nginx

Create `/etc/nginx/sites-available/your-domain`:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # API
    location /api {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/your-domain /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## PM2 Commands Reference

| Command | Description |
|---------|-------------|
| `pm2 list` | Show running processes |
| `pm2 logs` | View all logs |
| `pm2 logs js-admin-api` | View API logs only |
| `pm2 logs js-admin-web` | View web logs only |
| `pm2 restart all` | Restart all processes |
| `pm2 stop all` | Stop all processes |
| `pm2 delete all` | Remove all processes |
| `pm2 monit` | Real-time monitoring |

## Updating the Application

```bash
# Pull latest code
git pull origin main

# Install any new dependencies
pnpm install

# Rebuild
pnpm build

# Run database migrations (if any)
cd apps/api && pnpm prisma migrate deploy && cd ../..

# Restart PM2
pm2 restart all
```

## Troubleshooting

### Check if services are running

```bash
# PM2 processes
pm2 list

# Docker containers
docker-compose ps

# Test endpoints
curl http://localhost:3002/      # Frontend
curl http://localhost:4000/api/i18n/locales  # API
```

### View logs

```bash
# PM2 logs
pm2 logs --lines 100

# Log files
tail -f /tmp/js-admin-api-out.log
tail -f /tmp/js-admin-web-out.log
```

### Common Issues

1. **503 Service Unavailable**: PM2 processes not running. Run `pm2 start ecosystem.config.cjs`

2. **Database connection error**:
   - For PostgreSQL: Check PostgreSQL is running and `DATABASE_URL` is correct
   - For MySQL/MariaDB: Check MariaDB is running and `MYSQL_DATABASE_URL` is correct
   - Verify `DATABASE_PROVIDER` matches your database type

3. **Redis connection error**: Check Redis is running and `REDIS_URL` is correct

4. **File upload fails**: Check MinIO is running and S3 credentials are correct

## Security Checklist

- [ ] Change default admin password
- [ ] Generate secure JWT_SECRET (`openssl rand -base64 48`)
- [ ] Use HTTPS with valid SSL certificate
- [ ] Change default database password in production
- [ ] Configure firewall (only expose ports 80/443)
- [ ] Set `NODE_ENV=production`
- [ ] Review and configure CORS settings if needed
