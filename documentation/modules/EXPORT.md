# Export Module

## Overview

The Export module provides a complete solution for exporting data to multiple formats:
- **CSV** - For spreadsheet compatibility
- **Excel (XLSX)** - With formatting support
- **PDF** - For printable reports

Key features:
- Streaming exports for large datasets
- Filter preservation (exports what's displayed)
- Custom column selection
- PDF customization (title, subtitle, orientation)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXPORT SYSTEM                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Frontend                        Backend                         │
│  ────────                        ───────                         │
│                                                                  │
│  useExport() ──────────────────► POST /api/exports              │
│  {format, resource,              │                               │
│   filters, columns}              ▼                               │
│                                 Query Builder                    │
│                                 (same as DataTable)              │
│                                 │                               │
│                                 ▼                               │
│  File Download <──────────────── Stream Response                │
│                                 (chunked transfer)              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Files Overview

| File | Purpose |
|------|---------|
| `apps/api/src/modules/exports/exports.routes.ts` | API endpoints |
| `apps/api/src/modules/exports/export.service.ts` | Export logic |
| `apps/web/src/hooks/useExport.ts` | Frontend hook |
| `apps/web/src/components/export/ExportButton.tsx` | Export dropdown |
| `apps/web/src/components/export/ExportDialog.tsx` | Advanced options |

---

## Quick Start

### Basic Export from DataTable

```tsx
import { useExport } from '@/hooks/useExport';
import { useDataTable } from '@/components/data-table/useDataTable';

function OrdersPage() {
  const dataTable = useDataTable();
  const { exportData, isExporting } = useExport();

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    await exportData({
      format,
      resource: 'orders',
      filters: dataTable.queryParams.filters,
    });
  };

  return (
    <div>
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
  );
}
```

### Using ExportButton Component

```tsx
import { ExportButton } from '@/components/export/ExportButton';

function OrdersPage() {
  const dataTable = useDataTable();

  return (
    <ExportButton
      resource="orders"
      filters={dataTable.queryParams.filters}
      filename="orders-export"
    />
  );
}
```

---

## useExport Hook

### API Reference

```typescript
interface ExportOptions {
  format: 'csv' | 'xlsx' | 'pdf';
  resource: string;
  filters?: Record<string, unknown>;
  columns?: Array<{
    key: string;
    header: string;
    width?: number;
  }>;
  title?: string;       // For PDF header
  subtitle?: string;    // For PDF sub-header
  orientation?: 'portrait' | 'landscape';
  filename?: string;    // Custom filename
}

interface UseExport {
  exportData(options: ExportOptions): Promise<boolean>;
  getPreview(resource: string, filters?: object): Promise<data[]>;
  getAvailableResources(): Promise<resources[]>;
  isExporting: boolean;
}
```

### Usage Examples

```tsx
const { exportData, isExporting } = useExport();

// Basic CSV export
await exportData({
  format: 'csv',
  resource: 'users',
});

// Excel with custom columns
await exportData({
  format: 'xlsx',
  resource: 'orders',
  columns: [
    { key: 'orderNumber', header: 'Order #' },
    { key: 'customer.name', header: 'Customer' },
    { key: 'total', header: 'Total' },
    { key: 'status', header: 'Status' },
  ],
});

// PDF with title and landscape
await exportData({
  format: 'pdf',
  resource: 'reports',
  title: 'Monthly Sales Report',
  subtitle: 'January 2024',
  orientation: 'landscape',
  filters: { month: '2024-01' },
});

// With preserved filters from DataTable
await exportData({
  format: 'xlsx',
  resource: 'orders',
  filters: {
    status: 'pending,processing',
    dateFrom: '2024-01-01',
    dateTo: '2024-01-31',
  },
});
```

---

## Adding Export to a New Resource

### Step 1: Create Resource Handler (Backend)

```typescript
// apps/api/src/modules/exports/handlers/orders.handler.ts
import { prisma } from '@/lib/prisma';

export const ordersExportHandler = {
  // Define available columns
  columns: [
    { key: 'orderNumber', header: 'Order #', width: 15 },
    { key: 'customer.name', header: 'Customer', width: 25 },
    { key: 'status', header: 'Status', width: 12 },
    { key: 'total', header: 'Total', width: 12 },
    { key: 'createdAt', header: 'Date', width: 15 },
  ],

  // Query builder (SAME as DataTable endpoint)
  async getData(filters: any) {
    const where: any = {};

    if (filters.status) {
      where.status = { in: filters.status.split(',') };
    }

    if (filters.dateFrom) {
      where.createdAt = { ...where.createdAt, gte: new Date(filters.dateFrom) };
    }

    if (filters.dateTo) {
      where.createdAt = { ...where.createdAt, lte: new Date(filters.dateTo) };
    }

    // Return cursor for streaming
    return prisma.order.findMany({
      where,
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  // Format row for export
  formatRow(order: any) {
    return {
      orderNumber: order.orderNumber,
      'customer.name': order.customer?.name || '',
      status: order.status,
      total: formatCurrency(order.total),
      createdAt: formatDate(order.createdAt),
    };
  },
};
```

### Step 2: Register Handler

```typescript
// apps/api/src/modules/exports/export.service.ts
import { ordersExportHandler } from './handlers/orders.handler';
import { usersExportHandler } from './handlers/users.handler';

const resourceHandlers = {
  orders: ordersExportHandler,
  users: usersExportHandler,
  // Add your new handler
  products: productsExportHandler,
  invoices: invoicesExportHandler,
};

export function getHandler(resource: string) {
  const handler = resourceHandlers[resource];
  if (!handler) {
    throw new Error(`No export handler for resource: ${resource}`);
  }
  return handler;
}
```

### Step 3: Use in Frontend

```tsx
// Now you can export the new resource
await exportData({
  format: 'xlsx',
  resource: 'products',  // Your new resource
  filters: { category: 'electronics' },
});
```

---

## Streaming Export Implementation

### Why Streaming?

- **Memory efficient**: Doesn't load all data at once
- **Immediate feedback**: Download starts right away
- **Handles millions of rows**: No timeout issues

### Backend Implementation

```typescript
// apps/api/src/modules/exports/export.service.ts
import { PassThrough } from 'stream';
import ExcelJS from 'exceljs';

export async function exportToExcel(
  resource: string,
  filters: any,
  columns: Column[],
  reply: FastifyReply
) {
  const handler = getHandler(resource);

  // Set streaming headers
  reply.raw.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${resource}-export.xlsx"`,
    'Transfer-Encoding': 'chunked',
  });

  // Create streaming workbook
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: reply.raw,
  });
  const worksheet = workbook.addWorksheet(resource);

  // Add header row
  worksheet.columns = columns.map(col => ({
    header: col.header,
    key: col.key,
    width: col.width || 15,
  }));

  // Stream rows
  const data = await handler.getData(filters);
  for (const row of data) {
    const formatted = handler.formatRow(row);
    worksheet.addRow(formatted).commit();
  }

  // Finalize
  await worksheet.commit();
  await workbook.commit();
}

export async function exportToCSV(
  resource: string,
  filters: any,
  columns: Column[],
  reply: FastifyReply
) {
  const handler = getHandler(resource);

  reply.raw.writeHead(200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="${resource}-export.csv"`,
    'Transfer-Encoding': 'chunked',
  });

  // Write header
  const headerLine = columns.map(c => `"${c.header}"`).join(',');
  reply.raw.write(headerLine + '\n');

  // Stream rows
  const data = await handler.getData(filters);
  let rowCount = 0;

  for (const row of data) {
    const formatted = handler.formatRow(row);
    const line = columns.map(c => {
      const value = formatted[c.key];
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(',');

    reply.raw.write(line + '\n');
    rowCount++;

    // Flush every 1000 rows
    if (rowCount % 1000 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  reply.raw.end();
}
```

---

## PDF Export with Customization

### PDF Options

```typescript
interface PDFOptions {
  title?: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
  pageSize?: 'A4' | 'Letter';
  margins?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}
```

### Example PDF Export

```tsx
await exportData({
  format: 'pdf',
  resource: 'invoices',
  title: 'Invoice Report',
  subtitle: `Generated on ${new Date().toLocaleDateString()}`,
  orientation: 'landscape',
  columns: [
    { key: 'invoiceNumber', header: 'Invoice #', width: 80 },
    { key: 'customer', header: 'Customer', width: 150 },
    { key: 'amount', header: 'Amount', width: 80 },
    { key: 'status', header: 'Status', width: 80 },
    { key: 'dueDate', header: 'Due Date', width: 80 },
  ],
  filters: {
    status: 'unpaid',
    dateFrom: '2024-01-01',
  },
});
```

---

## Real-World Example: Invoice Export System

### Backend Handler

```typescript
// apps/api/src/modules/exports/handlers/invoices.handler.ts
export const invoicesExportHandler = {
  columns: [
    { key: 'invoiceNumber', header: 'Invoice #', width: 15 },
    { key: 'customer.name', header: 'Customer', width: 30 },
    { key: 'customer.email', header: 'Email', width: 25 },
    { key: 'items', header: 'Items', width: 10 },
    { key: 'subtotal', header: 'Subtotal', width: 12 },
    { key: 'tax', header: 'Tax', width: 12 },
    { key: 'total', header: 'Total', width: 12 },
    { key: 'status', header: 'Status', width: 12 },
    { key: 'dueDate', header: 'Due Date', width: 12 },
    { key: 'createdAt', header: 'Created', width: 12 },
  ],

  async getData(filters: any) {
    const where: any = {};

    if (filters.status) {
      where.status = { in: filters.status.split(',') };
    }

    if (filters.customerId) {
      where.customerId = filters.customerId;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }

    if (filters.overdue) {
      where.status = 'unpaid';
      where.dueDate = { lt: new Date() };
    }

    return prisma.invoice.findMany({
      where,
      include: {
        customer: { select: { name: true, email: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  formatRow(invoice: any) {
    return {
      invoiceNumber: invoice.invoiceNumber,
      'customer.name': invoice.customer?.name || '',
      'customer.email': invoice.customer?.email || '',
      items: invoice._count.items,
      subtotal: formatCurrency(invoice.subtotal),
      tax: formatCurrency(invoice.tax),
      total: formatCurrency(invoice.total),
      status: invoice.status.toUpperCase(),
      dueDate: formatDate(invoice.dueDate),
      createdAt: formatDate(invoice.createdAt),
    };
  },
};
```

### Frontend Page with Export

```tsx
// apps/web/src/pages/invoices/InvoicesPage.tsx
function InvoicesPage() {
  const dataTable = useDataTable();
  const { exportData, isExporting } = useExport();
  const { success } = useNotifications();

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    const exported = await exportData({
      format,
      resource: 'invoices',
      filters: dataTable.queryParams.filters,
      title: 'Invoices Report',
      subtitle: `Exported on ${new Date().toLocaleDateString()}`,
      columns: [
        { key: 'invoiceNumber', header: 'Invoice #' },
        { key: 'customer.name', header: 'Customer' },
        { key: 'total', header: 'Total' },
        { key: 'status', header: 'Status' },
        { key: 'dueDate', header: 'Due Date' },
      ],
    });

    if (exported) {
      success(`Invoices exported as ${format.toUpperCase()}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1>Invoices</h1>

        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={isExporting}>
                <Download className="h-4 w-4 mr-2" />
                {isExporting ? 'Exporting...' : 'Export'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport('csv')}>
                <FileText className="h-4 w-4 mr-2" />
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('xlsx')}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Export Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('pdf')}>
                <FileIcon className="h-4 w-4 mr-2" />
                Export PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        // ... rest of DataTable props
      />
    </div>
  );
}
```

---

## Export Selected Rows

```tsx
function InvoicesPage() {
  const dataTable = useDataTable();
  const { exportData } = useExport();

  const handleExportSelected = async (format: 'csv' | 'xlsx' | 'pdf') => {
    const selectedIds = Object.keys(dataTable.rowSelection)
      .filter(key => dataTable.rowSelection[key])
      .map(key => data?.data[parseInt(key)]?.id)
      .filter(Boolean);

    if (selectedIds.length === 0) {
      warning('Please select rows to export');
      return;
    }

    await exportData({
      format,
      resource: 'invoices',
      filters: { ids: selectedIds.join(',') },
    });
  };

  return (
    <DataTable
      enableRowSelection
      rowSelection={dataTable.rowSelection}
      onRowSelectionChange={dataTable.setRowSelection}
      bulkActions={[
        {
          label: 'Export Selected',
          icon: Download,
          onClick: () => handleExportSelected('xlsx'),
        },
      ]}
    />
  );
}
```

---

## Best Practices

### 1. Use Same Query Builder for Display and Export
```typescript
// Good: One query builder, two uses
const buildQuery = (filters) => {
  const where = {};
  // Build where clause
  return where;
};

// DataTable endpoint
app.get('/orders', async (request) => {
  const where = buildQuery(request.query);
  return prisma.order.findMany({ where, skip, take });
});

// Export endpoint
app.post('/exports', async (request) => {
  const where = buildQuery(request.body.filters);
  return prisma.order.findMany({ where }); // No pagination for export
});
```

### 2. Filter Dropdown Options from Database
```typescript
// Always fetch from master tables, never hardcode
const { data: filters } = useQuery({
  queryKey: ['invoice-filters'],
  queryFn: () => api.get('/invoices/filters'),
});
```

### 3. Handle Large Exports
```typescript
// Stream for large datasets
if (rowCount > 10000) {
  return streamingExport(data, reply);
}

// Consider background job for very large exports
if (rowCount > 100000) {
  return enqueueExportJob(request.body);
}
```

### 4. Provide Feedback
```tsx
const handleExport = async () => {
  info('Preparing export...');
  const result = await exportData(options);
  if (result) {
    success('Export downloaded!');
  } else {
    error('Export failed');
  }
};
```

---

## Troubleshooting

### Export Times Out
- Check database indexes on filter columns
- Consider background job for large exports
- Increase server timeout

### Wrong Data in Export
- Ensure export uses same query builder as DataTable
- Check filter parsing in handler
- Verify `formatRow` function

### File Downloads with Wrong Name
- Set `Content-Disposition` header correctly
- Include timestamp in filename

---

## Related Files

| File | Description |
|------|-------------|
| `apps/api/src/modules/exports/` | Backend export module |
| `apps/web/src/hooks/useExport.ts` | Frontend hook |
| `apps/web/src/components/export/` | Export components |

---

## GitHub Issue
This documentation addresses: https://github.com/velsof/js-admin-panel/issues/29
