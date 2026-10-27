# ============================================
# API Dockerfile - Multi-stage build
# ============================================

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl openssl-dev

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl openssl-dev

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy source code
COPY . .

# Generate Prisma clients BEFORE building (both PostgreSQL and MySQL)
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npx prisma generate --schema=./prisma/schema.mysql.prisma

# Build shared package first, then API
WORKDIR /app
RUN pnpm --filter @admin/shared build
RUN pnpm --filter @admin/api build

# Stage 3: Production
FROM node:20-alpine AS production
WORKDIR /app

# Install OpenSSL for Prisma runtime
RUN apk add --no-cache openssl

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 api

# Copy built API
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/apps/api/prisma ./prisma

# Remove workspace dependency (already bundled by tsup)
RUN sed -i '/"@admin\/shared"/d' package.json

# Install production dependencies using npm (flat structure, Docker-friendly)
# Note: Scripts needed for native binaries (bcrypt, sharp)
RUN npm install --omit=dev

# Generate Prisma clients (both PostgreSQL and MySQL)
RUN npx prisma generate
RUN npx prisma generate --schema=./prisma/schema.mysql.prisma

# Create logs directory
RUN mkdir -p /app/logs /logs

# Set ownership
RUN chown -R api:nodejs /app /logs

USER api

EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000

CMD ["node", "dist/server.js"]
