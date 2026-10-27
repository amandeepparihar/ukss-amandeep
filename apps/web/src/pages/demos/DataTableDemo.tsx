import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Download, FileSpreadsheet, FileText, Search, X } from 'lucide-react';
import { DataTable, DataTableColumnHeader, useDataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';

/**
 * SERVER-SIDE DATATABLE WITH MANUAL FILTERS
 *
 * For large datasets (millions of rows):
 * - Use a Search button instead of auto-search
 * - Use dropdown filters that apply on button click
 * - All operations happen server-side
 */

const statusColors: Record<string, string> = {
  green: 'bg-green-100 text-green-800 hover:bg-green-100',
  yellow: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100',
  gray: 'bg-gray-100 text-gray-800 hover:bg-gray-100',
  red: 'bg-red-100 text-red-800 hover:bg-red-100',
};

export function DataTableDemo() {
  const { success, error } = useNotifications();
  const [isExporting, setIsExporting] = useState(false);

  // Filter state (not applied until user clicks Search)
  // Note: Using 'all' as placeholder value since Radix Select doesn't allow empty string
  const [searchInput, setSearchInput] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Applied filters (these trigger the query)
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedCategory, setAppliedCategory] = useState<string>('');
  const [appliedStatus, setAppliedStatus] = useState<string>('');

  // Table state
  const {
    pagination,
    setPagination,
    sorting,
    setSorting,
  } = useDataTable({ pageSize: 20 });

  // Fetch filter options from database
  const { data: stats } = useQuery({
    queryKey: ['demo-stats'],
    queryFn: async () => {
      const res = await api.get('/demo/products/stats');
      return res.data.data;
    },
  });

  // Fetch products - only when applied filters change
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['demo-products', pagination, sorting, appliedSearch, appliedCategory, appliedStatus],
    queryFn: async () => {
      const sortBy = sorting[0]?.id || 'createdAt';
      const sortOrder = sorting[0]?.desc ? 'desc' : 'asc';

      const params: Record<string, any> = {
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        sortBy,
        sortOrder,
      };

      if (appliedSearch) params.search = appliedSearch;
      if (appliedCategory) params.categoryId = appliedCategory;
      if (appliedStatus) params.statusId = appliedStatus;

      const res = await api.get('/demo/products', { params });
      return res.data;
    },
  });

  // Apply filters (convert 'all' to empty string for API)
  const handleApplyFilters = () => {
    setAppliedSearch(searchInput);
    setAppliedCategory(categoryFilter === 'all' ? '' : categoryFilter);
    setAppliedStatus(statusFilter === 'all' ? '' : statusFilter);
    // Reset to first page when filters change
    setPagination({ pageIndex: 0, pageSize: pagination.pageSize });
  };

  // Clear all filters
  const handleClearFilters = () => {
    setSearchInput('');
    setCategoryFilter('all');
    setStatusFilter('all');
    setAppliedSearch('');
    setAppliedCategory('');
    setAppliedStatus('');
    setPagination({ pageIndex: 0, pageSize: pagination.pageSize });
  };

  // Check if any filter is applied
  const hasFilters = appliedSearch || appliedCategory || appliedStatus;

  // Export with same filters
  const handleExport = async (format: 'csv' | 'excel') => {
    setIsExporting(true);
    try {
      const sortBy = sorting[0]?.id || 'createdAt';
      const sortOrder = sorting[0]?.desc ? 'desc' : 'asc';

      const params: Record<string, any> = { format, sortBy, sortOrder };
      if (appliedSearch) params.search = appliedSearch;
      if (appliedCategory) params.categoryId = appliedCategory;
      if (appliedStatus) params.statusId = appliedStatus;

      const res = await api.get('/demo/products/export', {
        params,
        responseType: 'blob',
      });

      const blob = new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `products.${format === 'excel' ? 'xlsx' : 'csv'}`;
      link.click();
      window.URL.revokeObjectURL(url);

      success('Export Complete', { message: `Exported ${data?.meta?.total || 0} records` });
    } catch {
      error('Export Failed', { message: 'Please try again' });
    } finally {
      setIsExporting(false);
    }
  };

  // Column definitions
  const columns = useMemo<ColumnDef<any>[]>(() => [
    {
      accessorKey: 'sku',
      header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
      cell: ({ row }) => <code className="text-xs bg-muted px-1 py-0.5 rounded">{row.getValue('sku')}</code>,
    },
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => <div className="font-medium max-w-[250px] truncate">{row.getValue('name')}</div>,
    },
    {
      accessorKey: 'category',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
      cell: ({ row }) => <Badge variant="outline">{row.original.category?.name}</Badge>,
    },
    {
      accessorKey: 'price',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Price" />,
      cell: ({ row }) => <div className="font-medium">${(row.getValue('price') as number).toFixed(2)}</div>,
    },
    {
      accessorKey: 'stock',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Stock" />,
      cell: ({ row }) => {
        const stock = row.getValue('stock') as number;
        return <div className={stock === 0 ? 'text-red-500 font-medium' : ''}>{stock === 0 ? 'Out of stock' : stock.toLocaleString()}</div>;
      },
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => {
        const status = row.original.status;
        return <Badge className={statusColors[status?.color] || statusColors.gray}>{status?.label}</Badge>;
      },
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
      cell: ({ row }) => new Date(row.getValue('createdAt')).toLocaleDateString(),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => {
              navigator.clipboard.writeText(row.original.id);
              success('Copied', { message: `ID: ${row.original.id}` });
            }}>
              Copy ID
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              success('View Product', { message: `${row.original.name} (${row.original.sku})` });
            }}>
              View
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              success('Edit Product', { message: `Editing ${row.original.name}` });
            }}>
              Edit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], [success]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">DataTable Demo</h1>
        <p className="text-muted-foreground">
          Server-side pagination, sorting, filtering, and export for large datasets.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Products ({data?.meta?.total?.toLocaleString() || 0})</CardTitle>
              <CardDescription>
                {isFetching && !isLoading ? 'Updating...' : 'Filter options from database. Click Search to apply.'}
              </CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={isExporting}>
                  <Download className="h-4 w-4 mr-2" />
                  {isExporting ? 'Exporting...' : 'Export'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleExport('csv')}>
                  <FileText className="mr-2 h-4 w-4" /> CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('excel')}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap gap-4 p-4 bg-muted/50 rounded-lg">
            {/* Search Input */}
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground mb-1 block">Search</Label>
              <Input
                placeholder="Search by name, SKU..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
                className="h-9"
              />
            </div>

            {/* Category Filter */}
            <div className="w-[180px]">
              <Label className="text-xs text-muted-foreground mb-1 block">Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {stats?.categories?.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label} ({c.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div className="w-[180px]">
              <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {stats?.statuses?.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label} ({s.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Action Buttons */}
            <div className="flex items-end gap-2">
              <Button onClick={handleApplyFilters} className="h-9">
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
              {hasFilters && (
                <Button variant="outline" onClick={handleClearFilters} className="h-9">
                  <X className="h-4 w-4 mr-2" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Data Table */}
          <DataTable
            columns={columns}
            data={data?.data || []}
            pageCount={data?.meta?.totalPages || 0}
            isLoading={isLoading}
            pagination={pagination}
            onPaginationChange={setPagination}
            sorting={sorting}
            onSortingChange={setSorting}
            enableGlobalFilter={false}
            enableRowSelection
            getRowId={(row) => row.id}
          />
        </CardContent>
      </Card>
    </div>
  );
}
