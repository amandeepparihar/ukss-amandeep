
Start coding and commit working code frequently. Each phase should result in functional, tested code that can be demonstrated. Use any required tool and mcp needed. 
Use github tasks to track all todos and tasks. 
URL: js-admin.veldev.com

# Project: Reusable Node.js Admin Panel Framework

## Overview

Build a production-ready, reusable admin panel framework that can be used as a foundation for multiple client projects. This framework should save 100-150 hours of development time per project by providing pre-built, configurable components for common admin panel needs.

The framework will be used by a team of 5 developers (primarily PHP background, expanding into Node.js/React) for diverse client projects including government IT systems, e-commerce platforms, and enterprise applications.

---

## Tech Stack (Fixed Decisions)

### Frontend
- **React 18+** with TypeScript
- **Shadcn/ui** for UI components (copy into project, not npm dependency)
- **Tailwind CSS** for styling
- **TanStack Query (React Query)** for server state management
- **Zustand** for client state management
- **React Hook Form + Zod** for form handling and validation
- **TanStack Table** for data tables
- **TipTap** for rich text editor
- **React Router v7** or **TanStack Router** for routing
- **Recharts** or **Tremor** for charts/dashboards

### Backend
- **Node.js** with TypeScript
- **Fastify** (preferred) or Express for HTTP server
- **Prisma** as ORM
- **PostgreSQL** as database
- **Redis** for caching, sessions, and queue backend
- **BullMQ** for job queues
- **Sharp** for image processing
- **Pino** for logging
- **Zod** for validation (shared schemas with frontend)

### Infrastructure
- **S3-compatible storage** (AWS S3 or MinIO) for file uploads
- **Docker** for containerization
- **Docker Compose** for local development

---

## Project Structure

Use a **monorepo** structure with the following packages:

```
/admin-framework
├── package.json                    # Root package.json with workspaces
├── turbo.json                      # Turborepo configuration
├── docker-compose.yml              # Local dev services (PostgreSQL, Redis, MinIO)
├── .env.example
│
├── /packages
│   ├── /ui                         # Shadcn components + extensions
│   │   ├── /src
│   │   │   ├── /components         # All UI components
│   │   │   ├── /hooks              # UI-related hooks
│   │   │   ├── /lib                # Utilities (cn, etc.)
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── /admin-components           # High-level admin components
│   │   ├── /src
│   │   │   ├── /forms              # Form field components
│   │   │   ├── /tables             # DataTable and related
│   │   │   ├── /layout             # App shell, sidebar, headers
│   │   │   ├── /feedback           # Dialogs, toasts, loading states
│   │   │   ├── /display            # Stats, badges, timelines
│   │   │   ├── /charts             # Dashboard chart components
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── /api-client                 # Frontend API integration
│   │   ├── /src
│   │   │   ├── /hooks              # useQuery/useMutation hooks
│   │   │   ├── /types              # API types (shared with backend)
│   │   │   ├── /services           # API service functions
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── /shared                     # Shared utilities and types
│   │   ├── /src
│   │   │   ├── /types              # Shared TypeScript types
│   │   │   ├── /schemas            # Shared Zod schemas
│   │   │   ├── /constants          # Shared constants
│   │   │   ├── /utils              # Shared utility functions
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── /backend-core               # Reusable backend modules
│       ├── /src
│       │   ├── /modules            # Feature modules
│       │   ├── /common             # Middleware, guards, decorators
│       │   ├── /services           # Core services
│       │   ├── /database           # Prisma setup, base repository
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── /apps
│   ├── /web                        # React admin application
│   │   ├── /src
│   │   │   ├── /pages              # Route pages
│   │   │   ├── /features           # Feature-specific components
│   │   │   ├── /providers          # Context providers
│   │   │   ├── /config             # App configuration
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   │
│   └── /api                        # Fastify API server
│       ├── /src
│       │   ├── /modules            # Feature modules (routes, controllers, services)
│       │   ├── /plugins            # Fastify plugins
│       │   ├── /workers            # BullMQ workers
│       │   ├── /config             # Configuration
│       │   ├── app.ts
│       │   └── server.ts
│       ├── /prisma
│       │   ├── schema.prisma
│       │   ├── /migrations
│       │   └── /seeds
│       ├── package.json
│       └── tsconfig.json
│
├── /tools
│   └── /cli                        # Scaffolding CLI tool
│       ├── /src
│       │   ├── /commands           # CLI commands
│       │   ├── /templates          # Code templates
│       │   └── index.ts
│       └── package.json
│
└── /docs                           # Documentation
    ├── /guides
    ├── /api-reference
    └── /examples
```

---

## Core Features to Implement

### 1. Authentication & Authorization Module

#### Features:
- JWT-based authentication with access + refresh tokens
- Role-Based Access Control (RBAC) with granular permissions
- Permission levels: view, create, edit, delete per module/resource
- Session management with device tracking
- Password policies (configurable strength, history)
- Two-factor authentication (TOTP)
- Password reset flow
- Account lockout after failed attempts
- Audit logging for all auth events

#### Database Schema (Prisma):
```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  password      String
  firstName     String
  lastName      String
  avatar        String?
  isActive      Boolean   @default(true)
  emailVerified Boolean   @default(false)
  twoFactorEnabled Boolean @default(false)
  twoFactorSecret String?
  
  roleId        String
  role          Role      @relation(fields: [roleId], references: [id])
  
  sessions      Session[]
  auditLogs     AuditLog[]
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime? // Soft delete
}

model Role {
  id          String       @id @default(cuid())
  name        String       @unique
  description String?
  isSystem    Boolean      @default(false) // Can't delete system roles
  
  permissions Permission[]
  users       User[]
  
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model Permission {
  id       String @id @default(cuid())
  resource String // e.g., "users", "orders", "reports"
  action   String // e.g., "view", "create", "edit", "delete"
  
  roleId   String
  role     Role   @relation(fields: [roleId], references: [id])
  
  @@unique([roleId, resource, action])
}

model Session {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  
  refreshToken String   @unique
  userAgent    String?
  ipAddress    String?
  deviceInfo   Json?
  
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  lastActiveAt DateTime @default(now())
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  user       User?    @relation(fields: [userId], references: [id])
  
  action     String   // e.g., "login", "logout", "create", "update", "delete"
  resource   String   // e.g., "user", "order"
  resourceId String?
  
  oldValues  Json?
  newValues  Json?
  metadata   Json?    // IP, user agent, etc.
  
  createdAt  DateTime @default(now())
}
```

#### Frontend Components:
- `<LoginPage />` - Login form with remember me, 2FA support
- `<ForgotPasswordPage />` - Password reset request
- `<ResetPasswordPage />` - Set new password
- `<ProfilePage />` - User profile with password change, 2FA setup
- `<SessionsPage />` - View/revoke active sessions
- `<PermissionGuard />` - Wrapper component for permission-based rendering
- `useAuth()` hook - Current user, permissions, login/logout functions
- `usePermission()` hook - Check specific permissions

#### API Endpoints:
```
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/refresh
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
POST   /api/auth/verify-email
POST   /api/auth/2fa/setup
POST   /api/auth/2fa/verify
DELETE /api/auth/2fa/disable
GET    /api/auth/sessions
DELETE /api/auth/sessions/:id
GET    /api/auth/me
PUT    /api/auth/me
PUT    /api/auth/me/password
```

---

### 2. Dynamic Menu System

#### Features:
- Menu configuration stored in database
- Nested menu support (unlimited depth, but recommend max 3)
- Permission-aware rendering
- Icons support (Lucide icons)
- Badge support for counts (e.g., "5 pending")
- Collapsible groups
- Menu ordering (drag-drop reorder in settings)
- External link support
- Active state highlighting based on current route

#### Database Schema:
```prisma
model MenuItem {
  id          String     @id @default(cuid())
  label       String
  icon        String?    // Lucide icon name
  path        String?    // Route path or external URL
  isExternal  Boolean    @default(false)
  
  parentId    String?
  parent      MenuItem?  @relation("MenuHierarchy", fields: [parentId], references: [id])
  children    MenuItem[] @relation("MenuHierarchy")
  
  permission  String?    // Required permission to see this item
  badgeKey    String?    // Key to fetch badge count from API
  
  sortOrder   Int        @default(0)
  isActive    Boolean    @default(true)
  
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}
```

#### Frontend Components:
- `<Sidebar />` - Main sidebar container
- `<SidebarMenu />` - Renders menu tree
- `<SidebarMenuItem />` - Individual menu item
- `<SidebarMenuGroup />` - Collapsible group
- `useSidebarMenu()` hook - Fetches and manages menu state

---

### 3. DataTable Component System

This is the most critical reusable component. Build a highly configurable data table.

#### Features:
- Column configuration (header, accessor, sortable, filterable, width, cell renderer)
- Server-side sorting with visual indicators
- Server-side pagination with page size options
- Server-side filtering:
  - Text search (contains, equals, starts with)
  - Number filters (equals, greater than, less than, between)
  - Date filters (equals, before, after, between)
  - Select filters (single, multi-select)
  - Boolean filters
- Global search across configured columns
- Column visibility toggle
- Column resizing
- Row selection (single, multi)
- Bulk actions on selected rows
- Row click action
- Row actions column (edit, delete, custom actions)
- Loading states
- Empty states
- Error states
- Export functionality (CSV, Excel)
- Refresh button
- URL state sync (filters, sort, page in URL)

#### Component API:
```tsx
interface Column<T> {
  key: string;
  header: string;
  accessor?: keyof T | ((row: T) => any);
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  filterType?: 'text' | 'number' | 'date' | 'select' | 'boolean' | 'dateRange';
  filterOptions?: { label: string; value: string }[]; // For select type
  filterOptionsUrl?: string; // Fetch options from API
  width?: number | string;
  minWidth?: number;
  maxWidth?: number;
  align?: 'left' | 'center' | 'right';
  hidden?: boolean;
  sticky?: 'left' | 'right';
}

interface DataTableProps<T> {
  // Data
  columns: Column<T>[];
  data: T[];
  totalCount: number;
  loading?: boolean;
  error?: Error | null;
  
  // Pagination
  pagination: {
    page: number;
    pageSize: number;
    pageSizeOptions?: number[];
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
  };
  
  // Sorting
  sorting?: {
    sortBy: string | null;
    sortOrder: 'asc' | 'desc';
    onSortChange: (column: string, order: 'asc' | 'desc') => void;
  };
  
  // Filtering
  filters?: {
    values: Record<string, any>;
    onChange: (filters: Record<string, any>) => void;
  };
  
  // Global search
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  
  // Selection
  selectable?: boolean;
  selectedRows?: T[];
  onSelectionChange?: (rows: T[]) => void;
  rowIdKey?: keyof T;
  
  // Actions
  onRowClick?: (row: T) => void;
  rowActions?: RowAction<T>[];
  bulkActions?: BulkAction<T>[];
  
  // Export
  exportable?: boolean;
  exportFormats?: ('csv' | 'excel')[];
  exportFilename?: string;
  onExport?: (format: 'csv' | 'excel', data: T[]) => void;
  
  // UI
  emptyState?: {
    title: string;
    description?: string;
    action?: React.ReactNode;
  };
  toolbar?: React.ReactNode; // Custom toolbar content
  showColumnToggle?: boolean;
  showRefresh?: boolean;
  onRefresh?: () => void;
  
  // URL sync
  syncWithUrl?: boolean;
}

interface RowAction<T> {
  label: string;
  icon?: React.ReactNode;
  onClick: (row: T) => void;
  visible?: (row: T) => boolean;
  disabled?: (row: T) => boolean;
  variant?: 'default' | 'destructive';
  permission?: string; // Required permission
}

interface BulkAction<T> {
  label: string;
  icon?: React.ReactNode;
  onClick: (rows: T[]) => void;
  variant?: 'default' | 'destructive';
  confirmMessage?: string;
  permission?: string;
}
```

#### Usage Example:
```tsx
<DataTable
  columns={[
    { key: 'name', header: 'Name', sortable: true, filterable: true },
    { key: 'email', header: 'Email', sortable: true },
    { 
      key: 'status', 
      header: 'Status', 
      filterable: true,
      filterType: 'select',
      filterOptions: [
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
      ],
      cell: (row) => <StatusBadge status={row.status} />
    },
    { 
      key: 'createdAt', 
      header: 'Created', 
      sortable: true,
      filterable: true,
      filterType: 'dateRange',
      cell: (row) => formatDate(row.createdAt)
    },
  ]}
  data={users}
  totalCount={totalCount}
  loading={isLoading}
  pagination={{
    page,
    pageSize,
    onPageChange: setPage,
    onPageSizeChange: setPageSize,
  }}
  sorting={{
    sortBy,
    sortOrder,
    onSortChange: handleSort,
  }}
  filters={{
    values: filters,
    onChange: setFilters,
  }}
  search={{
    value: search,
    onChange: setSearch,
    placeholder: 'Search users...',
  }}
  selectable
  onSelectionChange={setSelectedUsers}
  rowActions={[
    { label: 'Edit', icon: <Pencil />, onClick: handleEdit },
    { label: 'Delete', icon: <Trash />, onClick: handleDelete, variant: 'destructive' },
  ]}
  bulkActions={[
    { label: 'Delete Selected', onClick: handleBulkDelete, variant: 'destructive', confirmMessage: 'Delete selected users?' },
    { label: 'Export Selected', onClick: handleExportSelected },
  ]}
  exportable
  exportFormats={['csv', 'excel']}
  syncWithUrl
/>
```

#### Backend API Contract:
All list endpoints should follow this standard request/response format:

**Request Query Parameters:**
```
GET /api/users?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc&search=john&filter[status]=active&filter[createdAt][gte]=2024-01-01
```

**Response Format:**
```json
{
  "data": [...],
  "meta": {
    "total": 150,
    "page": 1,
    "pageSize": 20,
    "totalPages": 8
  }
}
```

Create a `useDataTable()` hook that handles all the state management and API integration:
```tsx
const {
  data,
  totalCount,
  isLoading,
  error,
  page,
  pageSize,
  sortBy,
  sortOrder,
  filters,
  search,
  setPage,
  setPageSize,
  setSort,
  setFilters,
  setSearch,
  refresh,
} = useDataTable({
  endpoint: '/api/users',
  defaultSort: { field: 'createdAt', order: 'desc' },
  defaultPageSize: 20,
});
```

---

### 4. Form Builder System

Build a comprehensive set of form field components and a schema-driven form builder.

#### Form Field Components:

Each field component should:
- Integrate with React Hook Form
- Support Zod validation
- Show labels, descriptions, error messages
- Support required indicator
- Support disabled state
- Have consistent styling via Shadcn

**TextField**
```tsx
<TextField
  name="email"
  label="Email Address"
  placeholder="Enter email"
  description="We'll never share your email"
  type="email" // text, email, password, tel, url
  required
  disabled={false}
  maxLength={100}
  prefix={<Mail />}
  suffix={<span>@company.com</span>}
/>
```

**TextareaField**
```tsx
<TextareaField
  name="description"
  label="Description"
  placeholder="Enter description"
  rows={4}
  maxLength={500}
  showCharacterCount
  resize="vertical" // none, vertical, horizontal, both
/>
```

**NumberField**
```tsx
<NumberField
  name="price"
  label="Price"
  min={0}
  max={10000}
  step={0.01}
  prefix="$"
  suffix="USD"
  thousandSeparator
  decimalScale={2}
/>
```

**SelectField**
```tsx
<SelectField
  name="category"
  label="Category"
  placeholder="Select category"
  options={[
    { label: 'Electronics', value: 'electronics' },
    { label: 'Clothing', value: 'clothing' },
  ]}
  // OR fetch from API
  optionsUrl="/api/categories"
  optionLabelKey="name"
  optionValueKey="id"
  searchable
  clearable
/>
```

**AsyncSelectField** (for large datasets)
```tsx
<AsyncSelectField
  name="userId"
  label="User"
  placeholder="Search users..."
  searchUrl="/api/users/search"
  searchParamName="q"
  optionLabelKey="name"
  optionValueKey="id"
  minSearchLength={2}
  debounceMs={300}
  renderOption={(option) => (
    <div className="flex items-center gap-2">
      <Avatar src={option.avatar} />
      <span>{option.name}</span>
    </div>
  )}
/>
```

**MultiSelectField**
```tsx
<MultiSelectField
  name="tags"
  label="Tags"
  options={tags}
  maxSelected={5}
  creatable // Allow creating new options
  onCreateOption={handleCreateTag}
/>
```

**DateField**
```tsx
<DateField
  name="birthDate"
  label="Birth Date"
  minDate={new Date('1900-01-01')}
  maxDate={new Date()}
  format="dd/MM/yyyy"
  showYearDropdown
/>
```

**DateRangeField**
```tsx
<DateRangeField
  name="dateRange"
  label="Date Range"
  presets={[
    { label: 'Last 7 days', value: { from: subDays(new Date(), 7), to: new Date() } },
    { label: 'Last 30 days', value: { from: subDays(new Date(), 30), to: new Date() } },
  ]}
/>
```

**CheckboxField**
```tsx
<CheckboxField
  name="acceptTerms"
  label="I accept the terms and conditions"
/>
```

**CheckboxGroupField**
```tsx
<CheckboxGroupField
  name="permissions"
  label="Permissions"
  options={[
    { label: 'View', value: 'view' },
    { label: 'Create', value: 'create' },
    { label: 'Edit', value: 'edit' },
    { label: 'Delete', value: 'delete' },
  ]}
  layout="horizontal" // horizontal, vertical, grid
/>
```

**RadioGroupField**
```tsx
<RadioGroupField
  name="status"
  label="Status"
  options={[
    { label: 'Active', value: 'active', description: 'User can access the system' },
    { label: 'Inactive', value: 'inactive', description: 'User is disabled' },
  ]}
/>
```

**SwitchField**
```tsx
<SwitchField
  name="isPublished"
  label="Published"
  description="Make this visible to the public"
/>
```

**FileUploadField**
```tsx
<FileUploadField
  name="document"
  label="Document"
  accept=".pdf,.doc,.docx"
  maxSize={10 * 1024 * 1024} // 10MB
  uploadUrl="/api/files/upload"
  onUploadComplete={(file) => console.log(file)}
  showPreview
  previewType="file" // file, image
/>
```

**MultiFileUploadField**
```tsx
<MultiFileUploadField
  name="images"
  label="Images"
  accept="image/*"
  maxSize={5 * 1024 * 1024}
  maxFiles={10}
  uploadUrl="/api/files/upload"
  sortable // Drag to reorder
  showPreview
/>
```

**RichTextField** (TipTap-based)
```tsx
<RichTextField
  name="content"
  label="Content"
  placeholder="Enter content..."
  features={['bold', 'italic', 'underline', 'strike', 'heading', 'bulletList', 'orderedList', 'link', 'image']}
  // OR minimal mode
  features={['bold', 'italic', 'underline']} // Only basic formatting
  // Output format
  outputFormat="html" // html, json, text
  // For plain text with preserved newlines
  preserveNewlines={true}
  minHeight={200}
  maxHeight={500}
/>
```

**ColorField**
```tsx
<ColorField
  name="brandColor"
  label="Brand Color"
  format="hex" // hex, rgb, hsl
  showInput
  presetColors={['#FF0000', '#00FF00', '#0000FF']}
/>
```

**SliderField**
```tsx
<SliderField
  name="rating"
  label="Rating"
  min={0}
  max={100}
  step={1}
  showValue
  marks={[
    { value: 0, label: 'Poor' },
    { value: 50, label: 'Average' },
    { value: 100, label: 'Excellent' },
  ]}
/>
```

#### Form Builder Component (Schema-driven)

```tsx
const formSchema = [
  {
    type: 'text',
    name: 'firstName',
    label: 'First Name',
    required: true,
    colSpan: 6, // Grid column span (out of 12)
  },
  {
    type: 'text',
    name: 'lastName',
    label: 'Last Name',
    required: true,
    colSpan: 6,
  },
  {
    type: 'email',
    name: 'email',
    label: 'Email',
    required: true,
  },
  {
    type: 'select',
    name: 'role',
    label: 'Role',
    optionsUrl: '/api/roles',
    required: true,
    colSpan: 6,
  },
  {
    type: 'switch',
    name: 'isActive',
    label: 'Active',
    colSpan: 6,
  },
  {
    type: 'richtext',
    name: 'bio',
    label: 'Biography',
    features: ['bold', 'italic', 'link'],
  },
  {
    type: 'file',
    name: 'avatar',
    label: 'Avatar',
    accept: 'image/*',
    maxSize: 2 * 1024 * 1024,
  },
];

<FormBuilder
  schema={formSchema}
  defaultValues={user}
  onSubmit={handleSubmit}
  onCancel={() => navigate(-1)}
  submitLabel="Save User"
  loading={isSubmitting}
/>
```

#### Form Wrapper Component

```tsx
<Form
  schema={userSchema} // Zod schema for validation
  defaultValues={defaultValues}
  onSubmit={handleSubmit}
>
  <FormSection title="Basic Information" description="User's personal details">
    <FormGrid columns={2}>
      <TextField name="firstName" label="First Name" required />
      <TextField name="lastName" label="Last Name" required />
    </FormGrid>
    <TextField name="email" label="Email" type="email" required />
  </FormSection>
  
  <FormSection title="Role & Permissions">
    <SelectField name="role" label="Role" options={roles} />
    <CheckboxGroupField name="permissions" label="Additional Permissions" options={permissions} />
  </FormSection>
  
  <FormActions>
    <Button type="button" variant="outline" onClick={handleCancel}>Cancel</Button>
    <Button type="submit" loading={isSubmitting}>Save</Button>
  </FormActions>
</Form>
```

---

### 5. File Upload & Image Processing Module

#### Features:
- Single and multi-file upload
- Drag and drop support
- Upload progress tracking
- File type validation (by extension and MIME type)
- File size validation
- Image preview
- Image processing via Sharp:
  - Lossless compression
  - Resize with aspect ratio preservation
  - Format conversion (to WebP for web, preserve original)
  - Thumbnail generation (multiple sizes)
  - Metadata extraction
- Chunked upload for large files
- Direct-to-S3 upload with presigned URLs
- Virus scanning integration point (ClamAV)

#### Database Schema:
```prisma
model File {
  id           String   @id @default(cuid())
  
  filename     String   // Original filename
  mimeType     String
  size         Int      // Size in bytes
  
  storageKey   String   // S3 key
  storageUrl   String   // Full URL
  
  // For images
  width        Int?
  height       Int?
  thumbnails   Json?    // { small: url, medium: url, large: url }
  
  // Processing status
  status       FileStatus @default(PENDING)
  processedAt  DateTime?
  
  // Relations
  uploadedById String
  uploadedBy   User     @relation(fields: [uploadedById], references: [id])
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

enum FileStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}
```

#### API Endpoints:
```
POST   /api/files/upload              # Direct upload (small files)
POST   /api/files/upload/presigned    # Get presigned URL for S3
POST   /api/files/upload/complete     # Mark upload complete, trigger processing
GET    /api/files/:id                 # Get file details
DELETE /api/files/:id                 # Delete file
GET    /api/files/:id/download        # Download file
```

#### BullMQ Jobs:
```typescript
// Image processing job
interface ImageProcessingJob {
  fileId: string;
  operations: {
    compress: boolean;
    generateThumbnails: boolean;
    thumbnailSizes: { name: string; width: number; height: number }[];
    convertToWebP: boolean;
  };
}

// File cleanup job (delete orphaned files)
interface FileCleanupJob {
  olderThan: Date;
}
```

---

### 6. Notification Engine

A flexible, multi-channel notification system.

#### Features:
- Multiple channels: Email, SMS, Push, WhatsApp
- Template management with variable substitution
- Channel preference per user
- Delivery tracking and retry logic
- Rate limiting per channel
- Fallback chains (email fails → try SMS)
- Scheduling (send at specific time)
- Batching for bulk notifications
- Priority levels

#### Database Schema:
```prisma
model NotificationTemplate {
  id          String   @id @default(cuid())
  
  code        String   @unique // e.g., "welcome_email", "order_shipped"
  name        String
  description String?
  
  // Channel-specific content
  channels    NotificationTemplateChannel[]
  
  // Variables this template uses
  variables   String[] // e.g., ["userName", "orderNumber"]
  
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model NotificationTemplateChannel {
  id         String @id @default(cuid())
  
  templateId String
  template   NotificationTemplate @relation(fields: [templateId], references: [id])
  
  channel    NotificationChannel
  subject    String? // For email
  content    String  // Template content with {{variables}}
  
  @@unique([templateId, channel])
}

enum NotificationChannel {
  EMAIL
  SMS
  PUSH
  WHATSAPP
}

model Notification {
  id          String   @id @default(cuid())
  
  // Recipient
  userId      String?
  user        User?    @relation(fields: [userId], references: [id])
  
  // Or direct contact (for non-users)
  email       String?
  phone       String?
  deviceToken String?
  
  // Content
  templateId  String?
  template    NotificationTemplate? @relation(fields: [templateId], references: [id])
  
  channel     NotificationChannel
  subject     String?
  content     String
  
  // Status
  status      NotificationStatus @default(PENDING)
  sentAt      DateTime?
  deliveredAt DateTime?
  failedAt    DateTime?
  error       String?
  
  // Retry
  attempts    Int      @default(0)
  maxAttempts Int      @default(3)
  nextRetryAt DateTime?
  
  // Scheduling
  scheduledFor DateTime?
  
  // Priority
  priority    Int      @default(5) // 1 = highest
  
  // Metadata
  metadata    Json?
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum NotificationStatus {
  PENDING
  QUEUED
  SENT
  DELIVERED
  FAILED
  CANCELLED
}

model UserNotificationPreference {
  id        String @id @default(cuid())
  
  userId    String
  user      User   @relation(fields: [userId], references: [id])
  
  channel   NotificationChannel
  enabled   Boolean @default(true)
  
  // Quiet hours
  quietHoursStart String? // "22:00"
  quietHoursEnd   String? // "08:00"
  timezone        String?
  
  @@unique([userId, channel])
}
```

#### Notification Service API:
```typescript
interface SendNotificationRequest {
  // Recipient - one of these
  userId?: string;
  email?: string;
  phone?: string;
  deviceToken?: string;
  
  // Content - template or direct
  templateCode?: string;
  variables?: Record<string, any>;
  
  // Or direct content
  channel?: NotificationChannel;
  subject?: string;
  content?: string;
  
  // Options
  channels?: NotificationChannel[]; // Send to multiple channels
  priority?: number;
  scheduledFor?: Date;
  metadata?: Record<string, any>;
}

// Usage
await notificationService.send({
  userId: 'user123',
  templateCode: 'order_shipped',
  variables: {
    orderNumber: 'ORD-12345',
    trackingUrl: 'https://...',
  },
  channels: ['EMAIL', 'SMS', 'PUSH'],
});
```

#### BullMQ Queues:
```typescript
// Separate queues per channel for independent rate limiting
const emailQueue = new Queue('notifications:email');
const smsQueue = new Queue('notifications:sms');
const pushQueue = new Queue('notifications:push');
const whatsappQueue = new Queue('notifications:whatsapp');

// Workers with rate limiting
new Worker('notifications:sms', smsProcessor, {
  limiter: { max: 10, duration: 1000 }, // 10 SMS per second
});
```

#### Channel Adapters:
Implement adapter pattern for each channel:
```typescript
interface NotificationChannelAdapter {
  send(notification: Notification): Promise<SendResult>;
  checkDelivery?(notificationId: string): Promise<DeliveryStatus>;
}

class EmailAdapter implements NotificationChannelAdapter {
  // Use SendGrid, SES, Mailgun, etc.
}

class SMSAdapter implements NotificationChannelAdapter {
  // Use Twilio, MSG91, etc.
}

class PushAdapter implements NotificationChannelAdapter {
  // Use Firebase FCM
}

class WhatsAppAdapter implements NotificationChannelAdapter {
  // Use official WhatsApp API or Gupshup
}
```

---

### 7. Logging System

Comprehensive, configurable logging with Pino.

#### Features:
- Log levels: trace, debug, info, warn, error, fatal
- Per-module log level configuration
- Structured JSON logging
- Request context (request ID, user ID, session)
- Sensitive data redaction
- Multiple transports:
  - Console (pretty print for dev)
  - File rotation
  - External services (optional: ELK, Loki)
- Performance logging (API timing, DB queries)
- Error tracking with stack traces

#### Configuration:
```typescript
interface LogConfig {
  level: LogLevel;
  
  // Per-module overrides
  modules: Record<string, LogLevel>;
  
  // Redaction
  redact: string[]; // Paths to redact: ['password', 'token', 'req.headers.authorization']
  
  // Transports
  transports: {
    console: boolean;
    file: {
      enabled: boolean;
      path: string;
      maxSize: string; // '10M'
      maxFiles: number;
    };
  };
  
  // Request logging
  requestLogging: {
    enabled: boolean;
    excludePaths: string[]; // ['/health', '/metrics']
    logBody: boolean;
    logResponse: boolean;
  };
}
```

#### Usage:
```typescript
// Create module-specific logger
const logger = createLogger('users');

logger.info('User created', { userId: user.id, email: user.email });
logger.error('Failed to create user', { error, payload });

// Request logging middleware automatically logs:
// - Request: method, path, query, body, user, requestId
// - Response: statusCode, duration
// - Errors: full stack trace
```

#### Database Schema (for queryable logs):
```prisma
model SystemLog {
  id         String   @id @default(cuid())
  
  level      String   // info, warn, error, etc.
  module     String   // Module name
  message    String
  
  // Context
  requestId  String?
  userId     String?
  sessionId  String?
  
  // Data
  data       Json?
  error      Json?    // Stack trace, error details
  
  // Request context
  method     String?
  path       String?
  statusCode Int?
  duration   Int?     // ms
  ip         String?
  userAgent  String?
  
  createdAt  DateTime @default(now())
  
  @@index([level])
  @@index([module])
  @@index([userId])
  @@index([createdAt])
}
```

---

### 8. Export Module (CSV/Excel/PDF)

#### Features:
- Export data with same filters as table view
- Streaming for large datasets
- Background job for large exports
- Download link notification when ready
- CSV export (simple, fast)
- Excel export with formatting (ExcelJS)
- PDF export with templates (Puppeteer)

#### API Endpoints:
```
POST /api/exports
Body: {
  resource: 'users',
  format: 'excel',
  filters: { ... },
  columns: ['name', 'email', 'status', 'createdAt'],
  // For PDF
  template: 'user_list',
}

Response:
{
  exportId: 'exp_123',
  status: 'processing', // or 'completed' for small exports
  downloadUrl: '...',   // Available when completed
}

GET /api/exports/:id    # Check status, get download URL
```

#### BullMQ Job:
```typescript
interface ExportJob {
  exportId: string;
  resource: string;
  format: 'csv' | 'excel' | 'pdf';
  filters: Record<string, any>;
  columns: string[];
  template?: string; // For PDF
  userId: string;    // To notify when complete
}

// Worker processes export, uploads to S3, notifies user
```

#### PDF Templates:
Use HTML templates with Handlebars for PDF generation:
```html
<!-- templates/pdf/user_list.hbs -->
<!DOCTYPE html>
<html>
<head>
  <style>
    /* PDF-specific styles */
  </style>
</head>
<body>
  <header>
    <h1>User Report</h1>
    <p>Generated: {{formatDate now}}</p>
  </header>
  
  <table>
    <thead>
      <tr>
        {{#each columns}}
          <th>{{this.header}}</th>
        {{/each}}
      </tr>
    </thead>
    <tbody>
      {{#each data}}
        <tr>
          {{#each ../columns}}
            <td>{{lookup .. this.key}}</td>
          {{/each}}
        </tr>
      {{/each}}
    </tbody>
  </table>
  
  <footer>
    Page {{page}} of {{totalPages}}
  </footer>
</body>
</html>
```

---

### 9. Layout Components

#### AppShell
Main application wrapper:
```tsx
<AppShell
  sidebar={<Sidebar />}
  header={<Header />}
  footer={<Footer />} // Optional
>
  <Outlet />
</AppShell>
```

#### Sidebar
```tsx
<Sidebar
  collapsed={isCollapsed}
  onCollapse={setCollapsed}
  logo={<Logo />}
  collapsedLogo={<CollapsedLogo />}
  footer={<SidebarFooter />}
>
  <SidebarMenu items={menuItems} />
</Sidebar>
```

#### Header
```tsx
<Header
  showMenuToggle
  onMenuToggle={toggleSidebar}
>
  <HeaderSearch />
  <HeaderNav>
    <NotificationDropdown />
    <UserMenu />
  </HeaderNav>
</Header>
```

#### PageHeader
```tsx
<PageHeader
  title="Users"
  description="Manage system users"
  breadcrumbs={[
    { label: 'Home', href: '/' },
    { label: 'Users' },
  ]}
  actions={
    <>
      <Button variant="outline" onClick={handleExport}>Export</Button>
      <Button onClick={handleCreate}>Add User</Button>
    </>
  }
/>
```

#### ContentCard
```tsx
<ContentCard
  title="User Details"
  description="Basic information"
  headerAction={<Button size="sm">Edit</Button>}
  footer={<CardFooter>...</CardFooter>}
>
  {/* Content */}
</ContentCard>
```

---

### 10. Feedback Components

#### ConfirmDialog
```tsx
<ConfirmDialog
  open={isOpen}
  onOpenChange={setIsOpen}
  title="Delete User"
  description="Are you sure you want to delete this user? This action cannot be undone."
  confirmLabel="Delete"
  confirmVariant="destructive"
  onConfirm={handleDelete}
  loading={isDeleting}
/>
```

#### Toast Notifications
Use Sonner for toast notifications:
```tsx
// Success
toast.success('User created successfully');

// Error
toast.error('Failed to create user', {
  description: error.message,
});

// With action
toast('User created', {
  action: {
    label: 'View',
    onClick: () => navigate(`/users/${user.id}`),
  },
});

// Promise toast
toast.promise(createUser(data), {
  loading: 'Creating user...',
  success: 'User created successfully',
  error: 'Failed to create user',
});
```

#### LoadingOverlay
```tsx
<LoadingOverlay loading={isLoading} label="Processing...">
  <Content />
</LoadingOverlay>
```

#### EmptyState
```tsx
<EmptyState
  icon={<Users />}
  title="No users found"
  description="Get started by creating your first user"
  action={<Button onClick={handleCreate}>Add User</Button>}
/>
```

#### ErrorBoundary
```tsx
<ErrorBoundary
  fallback={<ErrorState />}
  onError={(error) => logger.error(error)}
>
  <Component />
</ErrorBoundary>
```

---

### 11. Display Components

#### StatCard
```tsx
<StatCard
  title="Total Users"
  value={1234}
  change={12.5}
  changeType="increase"
  icon={<Users />}
  href="/users"
/>
```

#### InfoList (Key-Value Display)
```tsx
<InfoList
  items={[
    { label: 'Name', value: user.name },
    { label: 'Email', value: user.email },
    { label: 'Status', value: <StatusBadge status={user.status} /> },
    { label: 'Created', value: formatDate(user.createdAt) },
  ]}
  columns={2}
/>
```

#### StatusBadge
```tsx
<StatusBadge status="active" />
<StatusBadge status="pending" />
<StatusBadge status="inactive" />

// Custom statuses
<StatusBadge
  status={order.status}
  statusMap={{
    pending: { label: 'Pending', variant: 'warning' },
    processing: { label: 'Processing', variant: 'info' },
    shipped: { label: 'Shipped', variant: 'success' },
    cancelled: { label: 'Cancelled', variant: 'destructive' },
  }}
/>
```

#### Timeline
```tsx
<Timeline
  items={[
    {
      title: 'Order placed',
      description: 'Order #12345 was placed',
      timestamp: '2024-01-15T10:30:00Z',
      icon: <ShoppingCart />,
    },
    {
      title: 'Payment received',
      timestamp: '2024-01-15T10:32:00Z',
      icon: <CreditCard />,
    },
    // ...
  ]}
/>
```

---

### 12. Dashboard Components

#### DashboardGrid
```tsx
<DashboardGrid>
  <DashboardWidget colSpan={3}>
    <StatCard title="Users" value={1234} />
  </DashboardWidget>
  <DashboardWidget colSpan={3}>
    <StatCard title="Orders" value={567} />
  </DashboardWidget>
  <DashboardWidget colSpan={6}>
    <RevenueChart data={revenueData} />
  </DashboardWidget>
  <DashboardWidget colSpan={4}>
    <RecentOrders orders={orders} />
  </DashboardWidget>
  <DashboardWidget colSpan={8}>
    <SalesMap data={salesByRegion} />
  </DashboardWidget>
</DashboardGrid>
```

#### Chart Components (Recharts-based)
```tsx
<LineChart
  data={data}
  xAxis={{ key: 'date', label: 'Date' }}
  yAxis={{ label: 'Revenue' }}
  series={[
    { key: 'revenue', label: 'Revenue', color: '#3b82f6' },
    { key: 'profit', label: 'Profit', color: '#22c55e' },
  ]}
  height={300}
/>

<BarChart ... />
<PieChart ... />
<AreaChart ... />
```

---

### 13. Settings & Configuration

#### System Settings Schema:
```prisma
model SystemSetting {
  id        String   @id @default(cuid())
  
  key       String   @unique
  value     Json
  type      SettingType
  
  category  String   // e.g., 'general', 'email', 'security'
  label     String
  description String?
  
  isPublic  Boolean  @default(false) // Can be fetched without auth
  
  updatedAt DateTime @updatedAt
}

enum SettingType {
  STRING
  NUMBER
  BOOLEAN
  JSON
  SECRET // Encrypted
}
```

#### Feature Flags:
```prisma
model FeatureFlag {
  id          String   @id @default(cuid())
  
  key         String   @unique
  name        String
  description String?
  
  enabled     Boolean  @default(false)
  
  // Optional: enable for specific users/roles
  rules       Json?    // { users: [], roles: [], percentage: 10 }
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

#### Settings UI:
- Grouped settings by category
- Type-appropriate input fields
- Save confirmation
- Reset to default option

---

### 14. Multi-tenancy Support (Optional but Recommended)

If enabled, add tenant isolation:

```prisma
model Tenant {
  id        String   @id @default(cuid())
  
  name      String
  slug      String   @unique
  domain    String?  @unique // Custom domain
  
  settings  Json?    // Tenant-specific settings
  branding  Json?    // Logo, colors, etc.
  
  isActive  Boolean  @default(true)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// Add tenantId to all relevant models
model User {
  // ...
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
}
```

Middleware automatically filters by tenant based on:
- Subdomain (tenant1.app.com)
- Custom domain (tenant1.com)
- Header (X-Tenant-ID)

---

### 15. CLI Scaffolding Tool

Create a CLI that generates boilerplate:

```bash
# Generate new module
npx admin-cli generate:module products

# Generates:
# - /apps/api/src/modules/products/
#   - products.controller.ts
#   - products.service.ts
#   - products.routes.ts
#   - products.schema.ts (Zod)
#   - products.types.ts
# - /apps/web/src/pages/products/
#   - index.tsx (list page)
#   - [id].tsx (detail page)
#   - create.tsx
#   - [id]/edit.tsx
# - Prisma model stub

# Generate form field component
npx admin-cli generate:field phone-input

# Generate notification channel adapter
npx admin-cli generate:notification-channel telegram
```

---

### 16. API Conventions

Standardize all API responses:

#### Success Response:
```json
{
  "data": { ... },
  "meta": { ... }
}
```

#### List Response:
```json
{
  "data": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
}
```

#### Error Response:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "Invalid email format" }
    ]
  }
}
```

#### HTTP Status Codes:
- 200: Success
- 201: Created
- 204: No Content (delete)
- 400: Bad Request (validation)
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 409: Conflict
- 422: Unprocessable Entity
- 500: Internal Server Error

---

### 17. Testing Setup

#### Backend:
- **Vitest** for unit tests
- **Supertest** for API integration tests
- Factory functions for test data
- Database transactions for test isolation

#### Frontend:
- **Vitest** + **React Testing Library** for component tests
- **MSW** (Mock Service Worker) for API mocking
- **Playwright** for E2E tests

#### Test Utilities:
```typescript
// Backend test factory
const user = await factory.user.create({
  role: 'admin',
});

// Frontend mock
server.use(
  rest.get('/api/users', (req, res, ctx) => {
    return res(ctx.json({ data: mockUsers, meta: { total: 10 } }));
  })
);
```

---

## Implementation Order

Build in this order to have working pieces as you go:

### Phase 1: Foundation (Week 1-2)
1. Monorepo setup with Turborepo
2. Docker Compose for local dev (PostgreSQL, Redis, MinIO)
3. Prisma setup with base models (User, Role, Permission, Session)
4. Fastify server with basic middleware
5. Auth module (login, JWT, refresh tokens)
6. Basic Shadcn setup in frontend
7. AppShell, Sidebar, Header components
8. Auth pages (Login, Forgot Password)

### Phase 2: Core Components (Week 3-4)
1. DataTable component (full featured)
2. useDataTable hook with API integration
3. Form field components (start with Text, Select, Textarea)
4. Form component with React Hook Form + Zod
5. User management CRUD (use as test case)
6. Role & Permission management
7. Menu system

### Phase 3: File & Media (Week 5)
1. File upload module (backend)
2. S3 integration
3. Image processing with Sharp (BullMQ job)
4. FileUploadField, MultiFileUploadField components
5. RichTextField with TipTap

### Phase 4: Notifications (Week 6)
1. Notification templates (backend)
2. Notification service
3. BullMQ queues per channel
4. Email adapter (pick one provider: SendGrid/SES)
5. SMS adapter (pick one: MSG91/Twilio)
6. Notification preferences UI

### Phase 5: Export & Logging (Week 7)
1. Logging system with Pino
2. Audit log implementation
3. CSV export
4. Excel export with ExcelJS
5. PDF export with Puppeteer
6. Export job queue

### Phase 6: Dashboard & Polish (Week 8)
1. Dashboard components (StatCard, Charts)
2. Dashboard page
3. System settings UI
4. Profile page
5. CLI scaffolding tool
6. Documentation

### Phase 7: Testing & Hardening (Week 9-10)
1. Unit tests for critical services
2. API integration tests
3. Component tests for form fields and DataTable
4. E2E tests for critical flows
5. Performance optimization
6. Security audit

---

## Environment Variables

```env
# App
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:4000

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/admin

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# S3
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=uploads
S3_REGION=us-east-1

# Email (SendGrid example)
SENDGRID_API_KEY=
EMAIL_FROM=noreply@example.com

# SMS (Twilio example)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Logging
LOG_LEVEL=debug
```

---

## Notes for Development

1. **Type Safety First**: Use TypeScript strictly. Shared types between frontend and backend via `@admin/shared` package.

2. **Error Handling**: All errors should be typed and have consistent structure. Create custom error classes.

3. **Validation**: Use Zod schemas shared between frontend and backend for consistent validation.

4. **API Documentation**: Generate OpenAPI spec from route definitions. Consider using Fastify's built-in schema support.

5. **Code Style**: Use ESLint + Prettier with consistent config across all packages.

6. **Git Hooks**: Use Husky + lint-staged for pre-commit checks.

7. **Commits**: Follow conventional commits for changelog generation.

8. **Documentation**: Every component should have:
   - TypeScript types (self-documenting)
   - Usage examples
   - Props table

---

## Success Criteria

The framework is successful when:

1. A new developer can set up the dev environment in < 30 minutes
2. Creating a new CRUD module takes < 2 hours (vs. 15+ hours currently)
3. All form fields work consistently with validation
4. DataTable handles 10,000+ rows smoothly (with server-side pagination)
5. Notifications send reliably with retry handling
6. File uploads work with progress and processing
7. The framework can be used for 3+ different client projects without major modifications
8. Total time saved per project: 80-120 hours

---

## Reference Projects

Look at these for inspiration (but don't copy):
- Refine (https://refine.dev) - Architecture patterns
- React Admin (https://marmelab.com/react-admin/) - API conventions
- Shadcn/ui (https://ui.shadcn.com) - Component patterns
- TanStack Table examples - Table implementation
- BullMQ examples - Queue patterns

---
