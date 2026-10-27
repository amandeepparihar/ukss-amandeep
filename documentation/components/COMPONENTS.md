# Component Documentation

This document provides comprehensive documentation for all reusable components in the Admin Panel Framework.

## Table of Contents

1. [DataTable](#datatable)
2. [Form Components](#form-components)
3. [FileUpload](#fileupload)
4. [Export Module](#export-module)
5. [Notification System](#notification-system)
6. [Layout Components](#layout-components)

---

## DataTable

A powerful data table component with server-side pagination, sorting, filtering, row selection, and bulk actions.

### Location
`apps/web/src/components/data-table/`

### Basic Usage

```tsx
import { DataTable, useDataTable } from '@/components/data-table';
import { ColumnDef } from '@tanstack/react-table';

interface User {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'inactive';
}

const columns: ColumnDef<User>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
  },
  {
    accessorKey: 'email',
    header: 'Email',
  },
  {
    accessorKey: 'status',
    header: 'Status',
  },
];

function UsersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });

  return (
    <DataTable
      columns={columns}
      data={data?.items ?? []}
      isLoading={isLoading}
    />
  );
}
```

### Server-Side Pagination

```tsx
function UsersPage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });

  const { data, isLoading } = useQuery({
    queryKey: ['users', pagination],
    queryFn: () => fetchUsers({
      page: pagination.pageIndex + 1,
      limit: pagination.pageSize,
    }),
  });

  return (
    <DataTable
      columns={columns}
      data={data?.items ?? []}
      pageCount={data?.meta?.totalPages ?? 0}
      isLoading={isLoading}
      pagination={pagination}
      onPaginationChange={setPagination}
    />
  );
}
```

### Server-Side Sorting

```tsx
const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);

<DataTable
  columns={columns}
  data={data}
  sorting={sorting}
  onSortingChange={setSorting}
/>
```

### Row Selection

```tsx
const [selectedRows, setSelectedRows] = useState<User[]>([]);

<DataTable
  columns={columns}
  data={data}
  enableRowSelection
  enableMultiRowSelection
  onRowSelectionChange={setSelectedRows}
  getRowId={(row) => row.id}
/>
```

### Filterable Columns

```tsx
import { FilterableColumn } from '@/components/data-table';

const filterableColumns: FilterableColumn[] = [
  {
    id: 'status',
    title: 'Status',
    options: [
      { label: 'Active', value: 'active' },
      { label: 'Inactive', value: 'inactive' },
    ],
  },
  {
    id: 'role',
    title: 'Role',
    options: [
      { label: 'Admin', value: 'admin' },
      { label: 'User', value: 'user' },
    ],
  },
];

<DataTable
  columns={columns}
  data={data}
  filterableColumns={filterableColumns}
/>
```

### Bulk Actions

```tsx
import { BulkAction } from '@/components/data-table';
import { Trash2, Mail } from 'lucide-react';

const bulkActions: BulkAction<User>[] = [
  {
    label: 'Delete',
    icon: Trash2,
    variant: 'destructive',
    onClick: async (rows) => {
      await deleteUsers(rows.map(r => r.id));
    },
  },
  {
    label: 'Send Email',
    icon: Mail,
    onClick: async (rows) => {
      await sendBulkEmail(rows.map(r => r.email));
    },
    disabled: (rows) => rows.length > 50,
  },
];

<DataTable
  columns={columns}
  data={data}
  enableRowSelection
  bulkActions={bulkActions}
/>
```

### Global Search

```tsx
const [globalFilter, setGlobalFilter] = useState('');

<DataTable
  columns={columns}
  data={data}
  enableGlobalFilter
  globalFilter={globalFilter}
  onGlobalFilterChange={setGlobalFilter}
  searchPlaceholder="Search users..."
/>
```

### Column Visibility

```tsx
<DataTable
  columns={columns}
  data={data}
  enableColumnVisibility
/>
```

### Complete Example

```tsx
import { DataTable, BulkAction, FilterableColumn } from '@/components/data-table';
import { DataTableColumnHeader } from '@/components/data-table';
import { ColumnDef } from '@tanstack/react-table';
import { Checkbox } from '@/components/ui/checkbox';

const columns: ColumnDef<User>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
      />
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
  },
  {
    accessorKey: 'email',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Email" />
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={row.original.status === 'active' ? 'default' : 'secondary'}>
        {row.original.status}
      </Badge>
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => editUser(row.original)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => deleteUser(row.original.id)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
];
```

### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `columns` | `ColumnDef<TData>[]` | Required | Column definitions |
| `data` | `TData[]` | Required | Data to display |
| `pageCount` | `number` | - | Total page count for server-side pagination |
| `isLoading` | `boolean` | `false` | Show loading state |
| `pagination` | `{ pageIndex, pageSize }` | - | Controlled pagination state |
| `onPaginationChange` | `function` | - | Pagination change handler |
| `sorting` | `{ id, desc }[]` | - | Controlled sorting state |
| `onSortingChange` | `function` | - | Sorting change handler |
| `enableRowSelection` | `boolean` | `false` | Enable row selection |
| `enableMultiRowSelection` | `boolean` | `false` | Allow multiple row selection |
| `onRowSelectionChange` | `function` | - | Selection change handler |
| `enableColumnVisibility` | `boolean` | `false` | Show column visibility toggle |
| `enableGlobalFilter` | `boolean` | `false` | Enable search input |
| `globalFilter` | `string` | - | Controlled search value |
| `onGlobalFilterChange` | `function` | - | Search change handler |
| `searchPlaceholder` | `string` | `'Search...'` | Search input placeholder |
| `filterableColumns` | `FilterableColumn[]` | - | Column filter definitions |
| `bulkActions` | `BulkAction<TData>[]` | - | Bulk action buttons |
| `emptyState` | `ReactNode` | - | Custom empty state component |
| `getRowId` | `function` | - | Custom row ID getter |

---

## Form Components

A set of form field components that integrate with React Hook Form and Zod validation.

### Location
`apps/web/src/components/forms/`

### Available Components

- `Form` - Form wrapper with React Hook Form
- `TextField` - Text input field
- `TextareaField` - Multi-line text input
- `SelectField` - Dropdown select
- `CheckboxField` - Checkbox input
- `SwitchField` - Toggle switch
- `RadioGroupField` - Radio button group

### Basic Form Setup

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, TextField, SelectField, SwitchField } from '@/components/forms';
import { Button } from '@/components/ui/button';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  role: z.enum(['admin', 'user', 'viewer']),
  isActive: z.boolean(),
});

type FormData = z.infer<typeof schema>;

function UserForm() {
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      role: 'user',
      isActive: true,
    },
  });

  const onSubmit = async (data: FormData) => {
    await createUser(data);
  };

  return (
    <Form form={form} onSubmit={onSubmit}>
      <TextField
        name="name"
        label="Name"
        placeholder="Enter name"
        required
      />

      <TextField
        name="email"
        label="Email"
        type="email"
        placeholder="user@example.com"
        required
      />

      <SelectField
        name="role"
        label="Role"
        options={[
          { label: 'Admin', value: 'admin' },
          { label: 'User', value: 'user' },
          { label: 'Viewer', value: 'viewer' },
        ]}
      />

      <SwitchField
        name="isActive"
        label="Active"
        description="Enable to activate the user account"
      />

      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Saving...' : 'Save'}
      </Button>
    </Form>
  );
}
```

### TextField Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | Required | Field name (must match form schema) |
| `label` | `string` | - | Field label |
| `placeholder` | `string` | - | Input placeholder |
| `type` | `string` | `'text'` | Input type (text, email, password, etc.) |
| `required` | `boolean` | `false` | Show required indicator |
| `description` | `string` | - | Help text below the field |
| `disabled` | `boolean` | `false` | Disable the input |

### SelectField Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | Required | Field name |
| `label` | `string` | - | Field label |
| `options` | `{ label, value }[]` | Required | Select options |
| `placeholder` | `string` | `'Select...'` | Placeholder text |
| `required` | `boolean` | `false` | Show required indicator |
| `disabled` | `boolean` | `false` | Disable the select |

### RadioGroupField Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | Required | Field name |
| `label` | `string` | - | Field label |
| `options` | `{ label, value, description? }[]` | Required | Radio options |
| `orientation` | `'horizontal' \| 'vertical'` | `'vertical'` | Layout direction |
| `required` | `boolean` | `false` | Show required indicator |

### CheckboxField Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | Required | Field name |
| `label` | `string` | Required | Checkbox label |
| `description` | `string` | - | Help text |
| `disabled` | `boolean` | `false` | Disable the checkbox |

### SwitchField Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | Required | Field name |
| `label` | `string` | Required | Switch label |
| `description` | `string` | - | Help text |
| `disabled` | `boolean` | `false` | Disable the switch |

---

## FileUpload

A drag-and-drop file upload component with preview support.

### Location
`apps/web/src/components/file-upload/`

### Basic Usage

```tsx
import { FileUpload } from '@/components/file-upload';

function UploadPage() {
  const handleUpload = async (files: File[]) => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    await api.post('/files/upload', formData);
  };

  return (
    <FileUpload
      onUpload={handleUpload}
      accept="image/*"
      multiple
      maxSize={5 * 1024 * 1024} // 5MB
      maxFiles={5}
    />
  );
}
```

### With Custom Labels

```tsx
<FileUpload
  onUpload={handleUpload}
  accept=".pdf,.doc,.docx"
  label="Upload Documents"
  description="Drag and drop PDF or Word documents"
  maxSize={10 * 1024 * 1024}
/>
```

### Image-Only Upload

```tsx
<FileUpload
  onUpload={handleUpload}
  accept="image/jpeg,image/png,image/gif"
  label="Upload Profile Picture"
  maxFiles={1}
/>
```

### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onUpload` | `(files: File[]) => void \| Promise<void>` | Required | Upload handler |
| `accept` | `string` | - | Accepted file types (MIME types or extensions) |
| `multiple` | `boolean` | `false` | Allow multiple files |
| `maxSize` | `number` | `10485760` (10MB) | Max file size in bytes |
| `maxFiles` | `number` | `10` | Maximum number of files |
| `disabled` | `boolean` | `false` | Disable the upload |
| `className` | `string` | - | Additional CSS classes |
| `label` | `string` | `'Upload files'` | Drop zone label |
| `description` | `string` | - | Drop zone description |

### Features

- Drag and drop support
- File type validation
- File size validation
- Image preview thumbnails
- Progress indication
- Remove files before upload
- Automatic file icon detection

---

## Export Module

Components for exporting data to CSV, Excel, and PDF formats.

### Location
`apps/web/src/components/export/`

### Components

- `ExportButton` - Simple export button
- `ExportDialog` - Full export dialog with options

### ExportButton Usage

```tsx
import { ExportButton } from '@/components/export';

<ExportButton
  data={users}
  filename="users"
  columns={[
    { key: 'name', header: 'Full Name' },
    { key: 'email', header: 'Email Address' },
    { key: 'createdAt', header: 'Created Date' },
  ]}
/>
```

### ExportDialog Usage

```tsx
import { ExportDialog } from '@/components/export';

const [isOpen, setIsOpen] = useState(false);

<ExportDialog
  open={isOpen}
  onOpenChange={setIsOpen}
  data={users}
  filename="users-export"
  columns={[
    { key: 'id', header: 'ID', width: 100 },
    { key: 'name', header: 'Full Name', width: 200 },
    { key: 'email', header: 'Email', width: 250 },
    { key: 'status', header: 'Status', width: 100 },
    { key: 'createdAt', header: 'Created', width: 150 },
  ]}
  title="Export Users"
/>
```

### Column Definition

```typescript
interface ExportColumn {
  key: string;      // Property key in data objects
  header: string;   // Column header text
  width?: number;   // Column width for PDF/Excel
  format?: (value: any) => string; // Custom formatter
}
```

### Custom Formatting

```tsx
<ExportDialog
  data={orders}
  columns={[
    { key: 'id', header: 'Order ID' },
    {
      key: 'total',
      header: 'Total',
      format: (value) => `$${value.toFixed(2)}`
    },
    {
      key: 'createdAt',
      header: 'Date',
      format: (value) => new Date(value).toLocaleDateString()
    },
  ]}
/>
```

### ExportButton Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `object[]` | Required | Data to export |
| `filename` | `string` | `'export'` | Output filename |
| `columns` | `ExportColumn[]` | Required | Column definitions |
| `format` | `'csv' \| 'xlsx' \| 'pdf'` | `'csv'` | Export format |
| `disabled` | `boolean` | `false` | Disable the button |

### ExportDialog Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | Required | Dialog open state |
| `onOpenChange` | `function` | Required | Open state handler |
| `data` | `object[]` | Required | Data to export |
| `filename` | `string` | `'export'` | Output filename |
| `columns` | `ExportColumn[]` | Required | Column definitions |
| `title` | `string` | `'Export Data'` | Dialog title |
| `trigger` | `ReactNode` | - | Custom trigger element |

---

## Notification System

A comprehensive notification system with toast notifications and a notification panel.

### Location
- `apps/web/src/components/notifications/` - UI components
- `apps/web/src/stores/notificationStore.ts` - State management

### Toast Notifications

Uses `sonner` for toast notifications:

```tsx
import { toast } from 'sonner';

// Success
toast.success('User created successfully');

// Error
toast.error('Failed to save changes');

// Warning
toast.warning('Please review your input');

// Info
toast.info('New features available');

// With description
toast.success('Changes saved', {
  description: 'Your profile has been updated',
});

// With action
toast.error('Failed to delete', {
  action: {
    label: 'Retry',
    onClick: () => deleteUser(),
  },
});

// Promise-based (auto-handles loading/success/error)
toast.promise(saveUser(data), {
  loading: 'Saving...',
  success: 'User saved!',
  error: 'Failed to save user',
});
```

### Notification Panel

A persistent notification center:

```tsx
import { NotificationPanel } from '@/components/notifications';
import { useNotificationStore } from '@/stores/notificationStore';

// In your layout
function Layout() {
  const { isOpen, togglePanel } = useNotificationStore();

  return (
    <div>
      <Header>
        <NotificationBell onClick={togglePanel} />
      </Header>
      <NotificationPanel />
      <main>{children}</main>
    </div>
  );
}
```

### Adding Notifications

```tsx
import { useNotificationStore } from '@/stores/notificationStore';

function SomeComponent() {
  const { addNotification } = useNotificationStore();

  const handleAction = () => {
    addNotification({
      title: 'New Order',
      message: 'Order #123 has been placed',
      type: 'info',
      link: '/orders/123',
    });
  };
}
```

### Notification Types

```typescript
interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: Date;
  link?: string; // Optional link for click action
}
```

### Notification Store API

```typescript
const {
  notifications,      // All notifications
  unreadCount,        // Number of unread notifications
  isOpen,             // Panel open state
  togglePanel,        // Toggle panel visibility
  openPanel,          // Open panel
  closePanel,         // Close panel
  addNotification,    // Add new notification
  markAsRead,         // Mark notification as read
  markAllAsRead,      // Mark all as read
  removeNotification, // Remove notification
  clearAll,           // Clear all notifications
} = useNotificationStore();
```

---

## Layout Components

Components for building the application layout.

### Location
`apps/web/src/components/layout/`

### Available Components

- `AppLayout` - Main application shell
- `Sidebar` - Navigation sidebar
- `Header` - Top header bar
- `PageHeader` - Page title and actions

### AppLayout

The main layout wrapper:

```tsx
import { AppLayout } from '@/components/layout';

function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/users" element={<Users />} />
      </Routes>
    </AppLayout>
  );
}
```

### PageHeader

Standard page header with title and actions:

```tsx
import { PageHeader } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

function UsersPage() {
  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage user accounts"
        actions={
          <Button onClick={openCreateModal}>
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        }
      />
      <UserList />
    </div>
  );
}
```

### PageHeader Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | Required | Page title |
| `description` | `string` | - | Page description |
| `actions` | `ReactNode` | - | Action buttons |
| `breadcrumbs` | `{ label, href }[]` | - | Breadcrumb items |

---

## Best Practices

### 1. Form Validation

Always use Zod schemas for type-safe validation:

```tsx
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
```

### 2. Loading States

Always show loading states:

```tsx
<DataTable
  data={data}
  isLoading={isLoading}
  // ... other props
/>
```

### 3. Error Handling

Use toast for error feedback:

```tsx
const mutation = useMutation({
  mutationFn: createUser,
  onError: (error) => {
    toast.error(getApiError(error).message);
  },
});
```

### 4. Optimistic Updates

For better UX, use optimistic updates:

```tsx
const queryClient = useQueryClient();

const mutation = useMutation({
  mutationFn: updateUser,
  onMutate: async (newData) => {
    await queryClient.cancelQueries(['users']);
    const previous = queryClient.getQueryData(['users']);
    queryClient.setQueryData(['users'], (old) => /* update */);
    return { previous };
  },
  onError: (err, variables, context) => {
    queryClient.setQueryData(['users'], context?.previous);
  },
  onSettled: () => {
    queryClient.invalidateQueries(['users']);
  },
});
```

### 5. Accessibility

- Use proper labels for form fields
- Include ARIA attributes where needed
- Ensure keyboard navigation works

---

## Related Documentation

- [Security Review](../SECURITY-AND-CODE-REVIEW.md)
- [Testing Strategy](../testing-strategy.md)
- [API Documentation](/api/docs) (Swagger)
