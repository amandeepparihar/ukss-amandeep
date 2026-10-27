# Admin Panel Framework Documentation

This folder contains all documentation for the reusable Node.js Admin Panel Framework.

## Structure

```
documentation/
├── README.md                         # This file - navigation guide
├── modules/                          # Module documentation (NEW)
│   ├── AUTHENTICATION.md             # Auth, JWT, 2FA, sessions
│   ├── ROLES-PERMISSIONS.md          # RBAC system
│   ├── DATATABLE.md                  # Server-side data tables
│   ├── NOTIFICATIONS.md              # Toast & panel notifications
│   ├── EXPORT.md                     # CSV, Excel, PDF exports
│   ├── SETTINGS.md                   # Application settings
│   ├── FILE-UPLOAD.md                # S3 file uploads
│   ├── AUDIT-LOGS.md                 # Activity logging
│   └── ANNOUNCEMENTS.md              # System announcements
├── audit/                            # Feature audit and test results
│   ├── README.md                     # Audit documentation guide
│   ├── features-inventory.csv        # All 98 implemented features
│   ├── test-cases.csv                # 110 test cases
│   ├── test-results.csv              # Test execution results
│   └── bugs-found.md                 # Discovered bugs
├── components/                       # Component documentation
│   └── COMPONENTS.md                 # Comprehensive component guide
├── requirement/                      # Requirements and specifications
│   └── admin-panel-prompt.md         # Original project requirements
├── todo/                             # Task tracking
│   ├── phase1-foundation.md          # Phase 1 tasks
│   └── implemented/                  # Completed tasks archive
├── SECURITY-AND-CODE-REVIEW.md       # Security audit and code review
├── testing-strategy.md               # Testing strategy and coverage
└── FEATURE-WISHLIST.md               # Potential future features
```

## Quick Links

### Module Documentation (Developer Guides)

These guides explain how to use each module when building new features:

| Module | Description | GitHub Issue |
|--------|-------------|--------------|
| [Authentication](./modules/AUTHENTICATION.md) | JWT, 2FA, sessions, password reset | [#26](https://github.com/velsof/js-admin-panel/issues/26) |
| [Roles & Permissions](./modules/ROLES-PERMISSIONS.md) | RBAC system, route protection | [#24](https://github.com/velsof/js-admin-panel/issues/24) |
| [DataTable](./modules/DATATABLE.md) | Server-side pagination, sorting, filtering | [#25](https://github.com/velsof/js-admin-panel/issues/25) |
| [Notifications](./modules/NOTIFICATIONS.md) | Toast messages, notification panel | [#27](https://github.com/velsof/js-admin-panel/issues/27) |
| [Export](./modules/EXPORT.md) | CSV, Excel, PDF streaming exports | [#29](https://github.com/velsof/js-admin-panel/issues/29) |
| [Settings](./modules/SETTINGS.md) | Application configuration, secrets | [#28](https://github.com/velsof/js-admin-panel/issues/28) |
| [File Upload](./modules/FILE-UPLOAD.md) | S3 storage, presigned URLs | [#30](https://github.com/velsof/js-admin-panel/issues/30) |
| [Audit Logs](./modules/AUDIT-LOGS.md) | Activity tracking, user actions | [#31](https://github.com/velsof/js-admin-panel/issues/31) |
| [Announcements](./modules/ANNOUNCEMENTS.md) | System banners, targeting | [#32](https://github.com/velsof/js-admin-panel/issues/32) |

### Other Documentation

- **[Feature Audit](./audit/README.md)** - Complete inventory of 98 features, 110 test cases, and bug reports
- **[Component Documentation](./components/COMPONENTS.md)** - How to use DataTable, Forms, FileUpload, Export, Notifications
- **[Security Review](./SECURITY-AND-CODE-REVIEW.md)** - Security audit findings and recommendations
- **[Testing Strategy](./testing-strategy.md)** - Testing approach and coverage plan
- **[Feature Wishlist](./FEATURE-WISHLIST.md)** - Potential features for future implementation

## Project Overview

This is a production-ready, reusable admin panel framework designed to save 100-150 hours of development time per project.

### Tech Stack

**Frontend:**
- React 18+ with TypeScript
- Shadcn/ui for UI components
- Tailwind CSS for styling
- TanStack Query for server state
- Zustand for client state
- React Hook Form + Zod for forms
- TanStack Table for data tables

**Backend:**
- Node.js with TypeScript
- Fastify for HTTP server
- Prisma as ORM
- **PostgreSQL or MySQL/MariaDB** as database (switchable via `DATABASE_PROVIDER`)
- Redis for caching and sessions
- BullMQ for job queues
- MinIO/S3 for file storage
- Pino for logging

### Key Features Implemented

1. **Authentication & Authorization**
   - JWT-based auth with refresh tokens (HTTP-only cookies)
   - 2FA with TOTP (authenticator apps)
   - Permission-based access control
   - Session management with revocation
   - Account lockout after failed attempts

2. **User Management**
   - CRUD operations for users
   - Role assignment
   - Profile management
   - Password change and reset

3. **Role & Permission System**
   - Dynamic roles with permissions
   - Resource:action based permissions
   - System roles protection

4. **DataTable Component**
   - Server-side pagination
   - Server-side sorting
   - Row selection (single/multi)
   - Bulk actions
   - Column filters
   - Column visibility toggle
   - Global search

5. **Form Components**
   - React Hook Form integration
   - Zod validation
   - Text, Select, Checkbox, Switch, Radio fields
   - Consistent error handling

6. **File Upload**
   - Drag and drop support
   - Image preview
   - File type validation
   - File size validation
   - S3-compatible storage

7. **Export Module**
   - CSV export
   - Excel export (xlsx)
   - PDF export with styling

8. **Notification System**
   - Toast notifications (sonner)
   - Notification panel
   - Read/unread tracking

## Getting Started

See the main project [README.md](../README.md) and [DOCKER.md](../DOCKER.md) for setup instructions.

### Database Selection

The framework supports both PostgreSQL and MySQL/MariaDB. Set the `DATABASE_PROVIDER` environment variable:

```bash
# PostgreSQL (default)
DATABASE_PROVIDER=postgresql

# MySQL/MariaDB
DATABASE_PROVIDER=mysql
```

Each database has its own Prisma schema:
- `apps/api/prisma/schema.prisma` - PostgreSQL
- `apps/api/prisma/schema.mysql.prisma` - MySQL/MariaDB

### Quick Start with Docker

```bash
# Development mode
docker-compose -f docker-compose.dev.yml up -d

# Seed database (PostgreSQL)
docker-compose -f docker-compose.dev.yml exec api sh -c \
  'cd /app/apps/api && DATABASE_URL="postgresql://admin:admin123@postgres:5432/admin_panel" npx tsx prisma/seeds/index.ts'

# Seed database (MySQL)
docker-compose -f docker-compose.dev.yml exec api sh -c \
  'cd /app/apps/api && DATABASE_PROVIDER=mysql MYSQL_DATABASE_URL="mysql://admin:admin123@mariadb:3306/admin_panel" npx tsx prisma/seeds/seed-mysql.ts'
```

**Default login:** admin@example.com / Admin@123

## Development Workflow

1. Check `todo/` folder for pending tasks
2. Create task files before starting major work
3. Update progress in task files
4. Archive completed tasks in `todo/implemented/`

## Key Directories

```
/apps/api/          # Backend Fastify application
  /src/
    /config/        # Configuration and environment
    /lib/           # Utilities (prisma, redis, logger, encryption)
    /modules/       # Feature modules (auth, users, roles, files, etc.)
    /plugins/       # Fastify plugins (auth, etc.)

/apps/web/          # Frontend React application
  /src/
    /components/    # UI components
    /hooks/         # Custom hooks
    /lib/           # Utilities
    /pages/         # Route pages
    /stores/        # Zustand stores

/packages/shared/   # Shared types, schemas, utilities
  /src/
    /schemas/       # Zod validation schemas
    /types/         # TypeScript types
    /constants/     # Shared constants
    /utils/         # Utility functions
```

## Security Notes

See [SECURITY-AND-CODE-REVIEW.md](./SECURITY-AND-CODE-REVIEW.md) for:
- Security best practices implemented
- Remaining security considerations
- Code review findings

## Contributing

1. Follow the existing code patterns
2. Add proper TypeScript types
3. Include tests for new features
4. Update documentation when adding features
