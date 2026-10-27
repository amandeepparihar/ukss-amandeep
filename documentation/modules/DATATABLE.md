# DataTable Module (Server-Side)

## Overview

The DataTable module provides a fully-featured, server-side paginated data table component. All heavy lifting (pagination, sorting, filtering, search) is done on the server to handle millions of records efficiently.

**Key Features:**
- Server-side pagination, sorting, and filtering
- Global search across columns
- Faceted filters with dropdown options
- Row selection (single/multi)
- Bulk actions on selected rows
- Column visibility toggle
- URL synchronization for bookmarkable states
- Loading and empty states
- Integration with export module

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 SERVER-SIDE DATATABLE FLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Frontend                        Backend                         │
│  ────────                        ───────                         │
│                                                                  │
│  useDataTable() ──────────────► API Endpoint                    │
│  {page, pageSize, sortBy,       │                               │
│   sortOrder, search, filters}   ▼                               │
│                                 Query Builder                    │
│                                 │                               │
│                                 ▼                               │
│  DataTable <────────────────── Response                         │
│  {data, pageCount, meta}        {data[], meta: {total, page}}   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Files Overview

| File | Purpose |
|------|---------|
| `components/data-table/DataTable.tsx` | Main component |
| `components/data-table/useDataTable.ts` | State management hook |
| `components/data-table/DataTablePagination.tsx` | Pagination controls |
| `components/data-table/DataTableToolbar.tsx` | Search and filters |
| `components/data-table/DataTableColumnHeader.tsx` | Sortable headers |
| `components/data-table/DataTableFacetedFilter.tsx` | Dropdown filters |

---

## Quick Start: Creating a New DataTable Page

### Step 1: Create the API Endpoint

```typescript
// apps/api/src/modules/orders/orders.routes.ts
import { FastifyInstance } from 'fastify';
import { prisma } from '@/lib/prisma';

export async function ordersRoutes(app: FastifyInstance) {
  app.get('/', {
    preHandler: [app.authenticate, app.requirePermission('orders:view')]
  }, async (request, reply) => {
    const {
      page = 1,
      pageSize = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      status,       // Filter by status
      customerId,   // Filter by customer
    } = request.query as any;

    // Build where clause
    const where: any = {};

    // Global search
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Status filter
    if (status) {
      where.status = { in: status.split(',') };
    }

    // Customer filter
    if (customerId) {
      where.customerId = customerId;
    }

    // Get total count
    const total = await prisma.order.count({ where });

    // Get paginated data
    const data = await prisma.order.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      data,
      meta: {
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(total / pageSize),
      },
    };
  });

  // Endpoint for filter dropdown options
  app.get('/filters', {
    preHandler: [app.authenticate]
  }, async () => {
    const statuses = await prisma.orderStatus.findMany();
    const customers = await prisma.customer.findMany({
      select: { id: true, name: true },
      take: 100,
    });

    return {
      data: {
        statuses: statuses.map(s => ({ label: s.name, value: s.id })),
        customers: customers.map(c => ({ label: c.name, value: c.id })),
      },
    };
  });
}
```

### Step 2: Create the Frontend Page

```tsx
// apps/web/src/pages/orders/OrdersPage.tsx
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table/DataTable';
import { useDataTable } from '@/components/data-table/useDataTable';
import { DataTableColumnHeader } from '@/components/data-table/DataTableColumnHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';

// Define your data type
interface Order {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  customer: { id: string; name: string };
  createdAt: string;
}

export function OrdersPage() {
  // 1. Initialize the DataTable hook
  const dataTable = useDataTable({ pageSize: 20 });

  // 2. Fetch filter options from master tables
  const { data: filters } = useQuery({
    queryKey: ['order-filters'],
    queryFn: () => api.get('/orders/filters').then(res => res.data),
  });

  // 3. Fetch data with server-side params
  const { data, isLoading } = useQuery({
    queryKey: ['orders', dataTable.queryParams],
    queryFn: () => api.get('/orders', { params: dataTable.queryParams }).then(res => res.data),
  });

  // 4. Define columns
  const columns: ColumnDef<Order>[] = [
    {
      accessorKey: 'orderNumber',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Order #" />
      ),
    },
    {
      accessorKey: 'customer.name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Customer" />
      ),
      cell: ({ row }) => row.original.customer.name,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={getStatusVariant(row.original.status)}>
          {row.original.status}
        </Badge>
      ),
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: 'total',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Total" />
      ),
      cell: ({ row }) => formatCurrency(row.original.total),
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Date" />
      ),
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => viewOrder(row.original.id)}>
          View
        </Button>
      ),
    },
  ];

  // 5. Define filterable columns
  const filterableColumns = [
    {
      id: 'status',
      title: 'Status',
      options: filters?.statuses || [],
    },
  ];

  // 6. Render DataTable
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Orders</h1>
        <Button onClick={() => createOrder()}>Create Order</Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        pageCount={data?.meta?.totalPages || 0}
        isLoading={isLoading}
        // Pagination
        pagination={dataTable.pagination}
        onPaginationChange={dataTable.setPagination}
        // Sorting
        sorting={dataTable.sorting}
        onSortingChange={dataTable.setSorting}
        // Filtering
        columnFilters={dataTable.columnFilters}
        onColumnFiltersChange={dataTable.setColumnFilters}
        filterableColumns={filterableColumns}
        // Search
        globalFilter={dataTable.globalFilter}
        onGlobalFilterChange={dataTable.setGlobalFilter}
        searchPlaceholder="Search orders..."
        // Row selection (optional)
        enableRowSelection
        rowSelection={dataTable.rowSelection}
        onRowSelectionChange={dataTable.setRowSelection}
        // Bulk actions (optional)
        bulkActions={[
          {
            label: 'Export Selected',
            onClick: (rows) => exportOrders(rows.map(r => r.id)),
          },
          {
            label: 'Delete Selected',
            onClick: (rows) => deleteOrders(rows.map(r => r.id)),
            variant: 'destructive',
          },
        ]}
      />
    </div>
  );
}
```

---

## useDataTable Hook

The `useDataTable` hook manages all DataTable state and syncs with URL.

### Options

```typescript
interface UseDataTableOptions {
  pageSize?: number;       // Default: 10
  enableUrlSync?: boolean; // Default: true
}
```

### Return Value

```typescript
interface UseDataTableReturn {
  // State
  pagination: PaginationState;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  globalFilter: string;
  columnVisibility: VisibilityState;
  rowSelection: RowSelectionState;

  // Setters
  setPagination: (updater) => void;
  setSorting: (updater) => void;
  setColumnFilters: (updater) => void;
  setGlobalFilter: (value: string) => void;
  setColumnVisibility: (updater) => void;
  setRowSelection: (updater) => void;

  // Computed values for API calls
  queryParams: {
    page: number;
    pageSize: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    search?: string;
    filters: Record<string, string>;
  };

  // Utilities
  resetAll: () => void;
}
```

### URL Sync

When `enableUrlSync` is true (default), the hook syncs state with URL:

```
/orders?page=2&pageSize=20&sortBy=createdAt&sortOrder=desc&search=widget&status=pending,shipped
```

This allows users to bookmark/share filtered views.

---

## Adding Custom Column Renderers

### Status Badge

```tsx
{
  accessorKey: 'status',
  header: 'Status',
  cell: ({ row }) => {
    const status = row.original.status;
    const variants = {
      pending: 'warning',
      processing: 'default',
      shipped: 'info',
      delivered: 'success',
      cancelled: 'destructive',
    };
    return (
      <Badge variant={variants[status]}>
        {status}
      </Badge>
    );
  },
}
```

### Currency Formatting

```tsx
{
  accessorKey: 'amount',
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title="Amount" />
  ),
  cell: ({ row }) => {
    const amount = parseFloat(row.getValue('amount'));
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  },
}
```

### Date Formatting

```tsx
{
  accessorKey: 'createdAt',
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title="Created" />
  ),
  cell: ({ row }) => {
    return new Date(row.original.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  },
}
```

### Avatar with Name

```tsx
{
  accessorKey: 'user',
  header: 'User',
  cell: ({ row }) => {
    const user = row.original.user;
    return (
      <div className="flex items-center gap-2">
        <Avatar>
          <AvatarImage src={user.avatar} />
          <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
        </Avatar>
        <span>{user.name}</span>
      </div>
    );
  },
}
```

### Actions Column with Dropdown

```tsx
{
  id: 'actions',
  cell: ({ row }) => {
    const order = row.original;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => viewOrder(order.id)}>
            View Details
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editOrder(order.id)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => deleteOrder(order.id)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
}
```

---

## Adding Filterable Columns

### Simple Status Filter

```tsx
const filterableColumns = [
  {
    id: 'status',
    title: 'Status',
    options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Processing', value: 'processing' },
      { label: 'Shipped', value: 'shipped' },
      { label: 'Delivered', value: 'delivered' },
    ],
  },
];
```

### Dynamic Filter from API

```tsx
// Fetch filter options
const { data: filters } = useQuery({
  queryKey: ['order-filters'],
  queryFn: () => api.get('/orders/filters'),
});

const filterableColumns = [
  {
    id: 'status',
    title: 'Status',
    options: filters?.data?.statuses || [],
  },
  {
    id: 'customerId',
    title: 'Customer',
    options: filters?.data?.customers || [],
  },
  {
    id: 'categoryId',
    title: 'Category',
    options: filters?.data?.categories || [],
  },
];
```

### Backend Filter Handler

```typescript
// Handle multiple filter values (comma-separated)
app.get('/orders', async (request) => {
  const { status, customerId, categoryId } = request.query;

  const where: any = {};

  // Multi-select filter (status=pending,shipped)
  if (status) {
    where.status = { in: status.split(',') };
  }

  // Single-select filter
  if (customerId) {
    where.customerId = customerId;
  }

  // Nested relation filter
  if (categoryId) {
    where.product = { categoryId };
  }

  // ... rest of query
});
```

---

## Implementing Bulk Actions

```tsx
<DataTable
  // Enable row selection
  enableRowSelection
  rowSelection={dataTable.rowSelection}
  onRowSelectionChange={dataTable.setRowSelection}

  // Define bulk actions
  bulkActions={[
    {
      label: 'Export Selected',
      icon: Download,
      onClick: async (selectedRows) => {
        const ids = selectedRows.map(r => r.id);
        await api.post('/orders/export', { ids });
        toast.success('Export started');
      },
    },
    {
      label: 'Mark as Shipped',
      icon: Package,
      onClick: async (selectedRows) => {
        const ids = selectedRows.map(r => r.id);
        await api.post('/orders/bulk-update', { ids, status: 'shipped' });
        queryClient.invalidateQueries(['orders']);
        toast.success(`${ids.length} orders updated`);
      },
    },
    {
      label: 'Delete Selected',
      icon: Trash,
      variant: 'destructive',
      onClick: async (selectedRows) => {
        const ids = selectedRows.map(r => r.id);
        if (confirm(`Delete ${ids.length} orders?`)) {
          await api.delete('/orders/bulk', { data: { ids } });
          queryClient.invalidateQueries(['orders']);
          toast.success(`${ids.length} orders deleted`);
        }
      },
    },
  ]}
/>
```

---

## Integrating with Export Module

```tsx
import { useExport } from '@/hooks/useExport';

function OrdersPage() {
  const { exportData, isExporting } = useExport();
  const dataTable = useDataTable();

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    await exportData({
      format,
      resource: 'orders',
      filters: dataTable.queryParams.filters,
      columns: [
        { key: 'orderNumber', header: 'Order #' },
        { key: 'customer.name', header: 'Customer' },
        { key: 'status', header: 'Status' },
        { key: 'total', header: 'Total' },
        { key: 'createdAt', header: 'Date' },
      ],
    });
  };

  return (
    <div>
      <div className="flex gap-2">
        <Button onClick={() => handleExport('csv')} disabled={isExporting}>
          Export CSV
        </Button>
        <Button onClick={() => handleExport('xlsx')} disabled={isExporting}>
          Export Excel
        </Button>
        <Button onClick={() => handleExport('pdf')} disabled={isExporting}>
          Export PDF
        </Button>
      </div>

      <DataTable {...props} />
    </div>
  );
}
```

---

## Real-World Example: Products DataTable

### Complete Implementation

```tsx
// apps/web/src/pages/products/ProductsPage.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table/DataTable';
import { useDataTable } from '@/components/data-table/useDataTable';
import { DataTableColumnHeader } from '@/components/data-table/DataTableColumnHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { usePermission } from '@/hooks/useAuth';
import { useExport } from '@/hooks/useExport';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Plus, Download, Trash, Edit, Eye } from 'lucide-react';
import { ProductFormDialog } from './ProductFormDialog';

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  status: 'active' | 'inactive' | 'out_of_stock';
  category: { id: string; name: string };
  image?: string;
  createdAt: string;
}

export function ProductsPage() {
  // Permissions
  const canCreate = usePermission('products:create');
  const canEdit = usePermission('products:edit');
  const canDelete = usePermission('products:delete');
  const canExport = usePermission('products:export');

  // State
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  // DataTable hook
  const dataTable = useDataTable({ pageSize: 25 });

  // Query client for cache invalidation
  const queryClient = useQueryClient();

  // Export hook
  const { exportData, isExporting } = useExport();

  // Fetch filter options from master tables
  const { data: filters } = useQuery({
    queryKey: ['product-filters'],
    queryFn: async () => {
      const res = await api.get('/products/filters');
      return res.data;
    },
  });

  // Fetch products
  const { data, isLoading } = useQuery({
    queryKey: ['products', dataTable.queryParams],
    queryFn: async () => {
      const res = await api.get('/products', { params: dataTable.queryParams });
      return res.data;
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.delete('/products/bulk', { data: { ids } }),
    onSuccess: () => {
      queryClient.invalidateQueries(['products']);
      dataTable.setRowSelection({});
    },
  });

  // Column definitions
  const columns: ColumnDef<Product>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Product" />
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={row.original.image} />
            <AvatarFallback>{row.original.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-sm text-muted-foreground">{row.original.sku}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'category.name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Category" />
      ),
      cell: ({ row }) => row.original.category.name,
    },
    {
      accessorKey: 'price',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Price" />
      ),
      cell: ({ row }) => formatCurrency(row.original.price),
    },
    {
      accessorKey: 'stock',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Stock" />
      ),
      cell: ({ row }) => {
        const stock = row.original.stock;
        return (
          <span className={stock < 10 ? 'text-destructive font-medium' : ''}>
            {stock}
          </span>
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.original.status;
        const variants = {
          active: 'success',
          inactive: 'secondary',
          out_of_stock: 'destructive',
        };
        return <Badge variant={variants[status]}>{status.replace('_', ' ')}</Badge>;
      },
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => viewProduct(row.original.id)}>
            <Eye className="h-4 w-4" />
          </Button>
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setEditingProduct(row.original);
                setIsFormOpen(true);
              }}
            >
              <Edit className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  // Filterable columns (populated from master tables)
  const filterableColumns = [
    {
      id: 'status',
      title: 'Status',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
        { label: 'Out of Stock', value: 'out_of_stock' },
      ],
    },
    {
      id: 'categoryId',
      title: 'Category',
      options: filters?.categories || [],
    },
  ];

  // Bulk actions
  const bulkActions = [];

  if (canExport) {
    bulkActions.push({
      label: 'Export Selected',
      icon: Download,
      onClick: async (rows: Product[]) => {
        await exportData({
          format: 'xlsx',
          resource: 'products',
          filters: { ids: rows.map(r => r.id).join(',') },
        });
      },
    });
  }

  if (canDelete) {
    bulkActions.push({
      label: 'Delete Selected',
      icon: Trash,
      variant: 'destructive',
      onClick: async (rows: Product[]) => {
        if (confirm(`Delete ${rows.length} products?`)) {
          await deleteMutation.mutateAsync(rows.map(r => r.id));
        }
      },
    });
  }

  // Export handlers
  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    await exportData({
      format,
      resource: 'products',
      filters: dataTable.queryParams.filters,
      title: 'Products Report',
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-muted-foreground">
            Manage your product inventory
          </p>
        </div>
        <div className="flex gap-2">
          {canExport && (
            <Button variant="outline" onClick={() => handleExport('xlsx')} disabled={isExporting}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => { setEditingProduct(null); setIsFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Product
            </Button>
          )}
        </div>
      </div>

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={data?.data || []}
        pageCount={data?.meta?.totalPages || 0}
        isLoading={isLoading}
        // Pagination
        pagination={dataTable.pagination}
        onPaginationChange={dataTable.setPagination}
        // Sorting
        sorting={dataTable.sorting}
        onSortingChange={dataTable.setSorting}
        // Filtering
        columnFilters={dataTable.columnFilters}
        onColumnFiltersChange={dataTable.setColumnFilters}
        filterableColumns={filterableColumns}
        // Search
        globalFilter={dataTable.globalFilter}
        onGlobalFilterChange={dataTable.setGlobalFilter}
        searchPlaceholder="Search products..."
        // Row selection
        enableRowSelection
        rowSelection={dataTable.rowSelection}
        onRowSelectionChange={dataTable.setRowSelection}
        // Bulk actions
        bulkActions={bulkActions}
        // Empty state
        emptyState={
          <div className="text-center py-10">
            <p className="text-muted-foreground">No products found</p>
            {canCreate && (
              <Button className="mt-4" onClick={() => setIsFormOpen(true)}>
                Add your first product
              </Button>
            )}
          </div>
        }
      />

      {/* Form Dialog */}
      <ProductFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        product={editingProduct}
        onSuccess={() => {
          setIsFormOpen(false);
          queryClient.invalidateQueries(['products']);
        }}
      />
    </div>
  );
}
```

---

## Backend API Pattern

### Standard List Endpoint

```typescript
// Standard pattern for all list endpoints
app.get('/', async (request) => {
  const {
    page = 1,
    pageSize = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    search,
    ...filters
  } = request.query;

  // 1. Build where clause
  const where = buildWhereClause(search, filters);

  // 2. Get total count
  const total = await prisma.model.count({ where });

  // 3. Get paginated data
  const data = await prisma.model.findMany({
    where,
    include: { /* relations */ },
    orderBy: { [sortBy]: sortOrder },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  // 4. Return standardized response
  return {
    data,
    meta: {
      total,
      page: Number(page),
      pageSize: Number(pageSize),
      totalPages: Math.ceil(total / pageSize),
    },
  };
});
```

---

## Best Practices

### 1. Always Use Server-Side Processing
```typescript
// Good: Server does the work
const { data } = useQuery({
  queryKey: ['orders', dataTable.queryParams],
  queryFn: () => api.get('/orders', { params: dataTable.queryParams }),
});

// Bad: Client-side filtering
const { data } = useQuery({ queryKey: ['orders'], queryFn: () => api.get('/orders') });
const filtered = data.filter(d => d.status === 'active'); // Don't do this!
```

### 2. Fetch Filter Options from Database
```typescript
// Good: Dropdown options from master table
const { data: filters } = useQuery({
  queryKey: ['filters'],
  queryFn: () => api.get('/orders/filters'),
});

// Bad: Hardcoded options
const statusOptions = ['pending', 'shipped', 'delivered']; // Don't do this!
```

### 3. Use Consistent Column IDs
```typescript
// The column id should match the API filter parameter
{
  accessorKey: 'status',  // This becomes the filter key
  // API will receive: ?status=pending,shipped
}
```

### 4. Handle Loading States
```tsx
<DataTable
  isLoading={isLoading}
  data={data?.data || []}  // Always provide empty array fallback
/>
```

### 5. Provide Empty States
```tsx
<DataTable
  emptyState={
    <div className="text-center py-10">
      <p>No data found</p>
      <Button onClick={handleCreate}>Create First Item</Button>
    </div>
  }
/>
```

---

## Troubleshooting

### Filters Not Working
1. Ensure column `id` matches the query parameter name
2. Check backend is parsing the filter correctly
3. Verify filter options have correct `value` properties

### Sorting Not Working
1. Ensure column has `accessorKey` set
2. Backend must support the `sortBy` and `sortOrder` params
3. Check if the field is sortable in the database

### Pagination Reset on Filter
This is expected behavior. When filters change, we reset to page 1.

### URL Not Updating
Ensure `enableUrlSync: true` in `useDataTable` options (default).

---

## Related Files

| File | Description |
|------|-------------|
| `components/data-table/` | All DataTable components |
| `pages/users/UsersPage.tsx` | Example implementation |
| `pages/audit/AuditLogsPage.tsx` | Another example |

---

## GitHub Issue
This documentation addresses: https://github.com/velsof/js-admin-panel/issues/25
