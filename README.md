# Admin Panel Framework

A production-ready, reusable admin panel framework built with React, Node.js, and TypeScript. Designed to save 100-150 hours of development time per project.

## Tech Stack

### Frontend
- React 18+ with TypeScript
- Shadcn/ui for UI components
- Tailwind CSS for styling
- TanStack Query for server state
- Zustand for client state
- React Hook Form + Zod for forms
- React Router v6 for routing

### Backend
- Node.js with TypeScript
- Fastify for HTTP server
- Prisma as ORM
- **PostgreSQL or MySQL/MariaDB** as database (switchable via config)
- Redis for caching and sessions
- BullMQ for job queues
- Pino for logging

## Documentation

| Document | Description |
|----------|-------------|
| [DOCKER.md](./DOCKER.md) | Complete Docker guide for development and production |
| [documentation/](./documentation/) | Additional project documentation |

## Claude Code Integration

This project includes [Claude Code](https://claude.com/claude-code) configuration for AI-assisted development. All developers should use Claude Code to maintain consistent standards.

### Steering Documents

Steering documents in `.claude/steering/` define project standards that Claude Code follows:

| Document | Purpose |
|----------|---------|
| [product.md](.claude/steering/product.md) | Product vision, objectives, target users, and roadmap |
| [tech.md](.claude/steering/tech.md) | Technology stack, technical decisions, and constraints |
| [structure.md](.claude/steering/structure.md) | Project structure, coding conventions, and patterns |

**Read these documents** before contributing to understand the project's architecture and conventions.

### Available Commands

Run these commands in Claude Code to streamline development workflows:

#### Spec Workflow (Feature Development)

| Command | Description |
|---------|-------------|
| `/spec-steering-setup` | Create/update steering documents for project context |
| `/spec-create` | Create a new feature specification with requirements |
| `/spec-execute` | Execute tasks from an approved specification |
| `/spec-status` | Check status of current specifications |
| `/spec-list` | List all specifications in the project |
| `/interview` | Deep-dive interview to gather detailed requirements |

#### Bug Workflow

| Command | Description |
|---------|-------------|
| `/bug-create` | Create a new bug report with reproduction steps |
| `/bug-analyze` | Analyze a bug to identify root cause |
| `/bug-fix` | Fix a bug following RCA guidelines |
| `/bug-verify` | Verify a bug fix is complete |
| `/bug-status` | Check status of bug fixes |

### Workflow Example

**Adding a new feature:**
```bash
# 1. Create specification
/spec-create

# 2. (Optional) Deep-dive on requirements
/interview .claude/specs/my-feature/requirements.md

# 3. Execute the specification
/spec-execute .claude/specs/my-feature/
```

**Fixing a bug:**
```bash
# 1. Create bug report
/bug-create

# 2. Analyze root cause
/bug-analyze .claude/bugs/bug-123/

# 3. Fix the bug
/bug-fix .claude/bugs/bug-123/

# 4. Verify the fix
/bug-verify .claude/bugs/bug-123/
```

### Key Development Standards

These are enforced by Claude Code based on steering documents:

1. **Server-side DataTables only** - Never create client-side DataTables
2. **Match existing patterns** - Follow conventions established in the codebase
3. **Module organization** - Small features extend existing modules; large features get new modules
4. **Testing** - Unit tests for business logic, E2E tests for workflows
5. **Extension points** - Use hooks/plugins for customization, avoid modifying core code

## Getting Started

### Quick Start (Recommended)

For the easiest setup, use Docker. See [DOCKER.md](./DOCKER.md) for complete instructions.

**Development Mode:**
```bash
# Start all services with hot reload
docker-compose -f docker-compose.dev.yml up -d

# Seed the database (PostgreSQL - default)
docker-compose -f docker-compose.dev.yml exec api sh -c \
  'cd /app/apps/api && DATABASE_URL="postgresql://admin:admin123@postgres:5432/admin_panel" npx tsx prisma/seeds/index.ts'

# Seed the database (MySQL/MariaDB - if using DATABASE_PROVIDER=mysql)
docker-compose -f docker-compose.dev.yml exec api sh -c \
  'cd /app/apps/api && DATABASE_PROVIDER=mysql MYSQL_DATABASE_URL="mysql://admin:admin123@mariadb:3306/admin_panel" npx tsx prisma/seeds/seed-mysql.ts'
```

**Production Mode:**
```bash
# Build and start
docker-compose up -d --build

# Initialize database (see DOCKER.md for full instructions)
docker-compose exec api npx prisma db push --skip-generate
```

### Default Login

- Email: `admin@example.com`
- Password: `Admin@123`

### URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3002 |
| API | http://localhost:4000 |
| API Docs | http://localhost:4000/docs |
| MinIO Console | http://localhost:19001 |

### Environment Variables

Key environment variables that can be configured:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PROVIDER` | `postgresql` | Database type: `postgresql` or `mysql` |
| `API_URL` | `http://localhost:4000` | Public URL of the API (used for file upload URLs) |
| `VITE_API_URL` | `http://localhost:4000/api` | API URL for frontend |
| `STORAGE_PROVIDER` | `local` | Storage backend: `local` or `s3` |
| `JWT_SECRET` | - | Secret for JWT tokens (min 32 chars) |
| `POSTGRES_PASSWORD` | `admin123` | PostgreSQL password |
| `MYSQL_PASSWORD` | `admin123` | MySQL/MariaDB password |
| `REDIS_PASSWORD` | - | Redis password |

**Custom Domain Example:**
```bash
# Development
API_URL=https://your-domain.com/api docker-compose -f docker-compose.dev.yml up -d

# Production
API_URL=https://your-domain.com/api VITE_API_URL=https://your-domain.com/api docker-compose up -d --build
```

### Local Development (Without Docker)

<details>
<summary>Click to expand manual setup instructions</summary>

#### Prerequisites

- Node.js 18+
- pnpm 8+
- PostgreSQL 16+ **OR** MySQL 8+ / MariaDB 10.11+
- Redis 7+
- MinIO (optional, for file uploads)

#### Installation

1. Clone the repository:
```bash
git clone https://github.com/velsof/js-admin-panel.git
cd js-admin-panel
```

2. Install dependencies:
```bash
pnpm install --no-frozen-lockfile
```

3. Set up environment:
```bash
cp .env.example .env
# Edit .env with your database settings
```

4. Set up database:
```bash
# For PostgreSQL (default)
pnpm db:push
pnpm db:seed

# For MySQL/MariaDB
pnpm db:push:mysql
DATABASE_PROVIDER=mysql npx tsx apps/api/prisma/seeds/seed-mysql.ts
```

5. Start development servers:
```bash
pnpm dev
```

</details>

## Project Structure

```
/admin-framework
├── apps/
│   ├── api/              # Fastify API server
│   └── web/              # React admin application
├── packages/
│   ├── shared/           # Shared types, schemas, utilities
│   ├── ui/               # Shadcn UI components (coming soon)
│   ├── admin-components/ # Admin-specific components (coming soon)
│   ├── api-client/       # Frontend API hooks (coming soon)
│   └── backend-core/     # Reusable backend modules (coming soon)
├── tools/
│   └── cli/              # Scaffolding CLI (coming soon)
└── documentation/        # Project documentation
```

## Available Scripts

- `pnpm dev` - Start all development servers
- `pnpm build` - Build all packages
- `pnpm db:push` - Push Prisma schema to database
- `pnpm db:seed` - Seed database with initial data
- `pnpm db:studio` - Open Prisma Studio

## Features

### Phase 1 (Complete)
- [x] Monorepo setup with Turborepo
- [x] Docker Compose for local development
- [x] JWT authentication with refresh tokens
- [x] Role-based access control (RBAC)
- [x] User management
- [x] Role & Permission management
- [x] Dynamic menu system
- [x] Audit logging
- [x] React app with Shadcn/ui

### Phase 2 (Complete)
- [x] DataTable component with filtering/sorting/pagination
- [x] Form builder components (TextField, Select, Checkbox, etc.)
- [x] File upload module with S3/MinIO integration
- [x] Rich text editor (Tiptap)

### Phase 3 (Complete)
- [x] Notification system
- [x] Export module (CSV/Excel/PDF)
- [x] Dashboard & Reports

## License

MIT
# ukss-sms-js-admin
