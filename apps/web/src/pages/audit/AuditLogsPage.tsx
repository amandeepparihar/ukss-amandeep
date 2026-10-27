import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, FileText, User, Clock } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable, DataTableColumnHeader, useDataTable, type FilterableColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

interface AuditLog {
  id: string;
  userId: string | null;
  user: {
    id: string;
    email: string;
    name: string;
  } | null;
  action: string;
  resource: string;
  resourceId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const actionColors: Record<string, string> = {
  create: 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-300 dark:hover:bg-green-900',
  update: 'bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-900',
  delete: 'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-900',
  login: 'bg-purple-100 text-purple-800 hover:bg-purple-100 dark:bg-purple-900 dark:text-purple-300 dark:hover:bg-purple-900',
  logout: 'bg-gray-100 text-gray-800 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-900',
};

export function AuditLogsPage() {
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const {
    pagination,
    setPagination,
    sorting,
    setSorting,
    globalFilter,
    setGlobalFilter,
    columnFilters,
    setColumnFilters,
    queryParams,
  } = useDataTable({ pageSize: 20 });

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', queryParams],
    queryFn: async () => {
      const params: Record<string, unknown> = {
        page: queryParams.page,
        pageSize: queryParams.limit,
        sortBy: queryParams.sortBy || 'createdAt',
        sortOrder: queryParams.sortOrder || 'desc',
        search: queryParams.search,
      };

      // Add filters
      if (queryParams.filters?.action?.length) {
        params.action = queryParams.filters.action[0];
      }
      if (queryParams.filters?.resource?.length) {
        params.resource = queryParams.filters.resource[0];
      }

      const response = await api.get('/audit-logs', { params });
      return response.data;
    },
  });

  const logs: AuditLog[] = data?.data || [];
  const pageCount = data?.meta?.totalPages || 0;

  const columns = useMemo<ColumnDef<AuditLog>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Time" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm" title={new Date(row.getValue('createdAt')).toLocaleString()}>
              {formatDistanceToNow(new Date(row.getValue('createdAt')), { addSuffix: true })}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'user',
        header: ({ column }) => <DataTableColumnHeader column={column} title="User" />,
        cell: ({ row }) => {
          const user = row.original.user;
          return (
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="font-medium">{user?.name || 'System'}</div>
                <div className="text-xs text-muted-foreground">{user?.email || '-'}</div>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'action',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Action" />,
        cell: ({ row }) => {
          const action = row.getValue('action') as string;
          return (
            <Badge className={actionColors[action] || 'bg-gray-100 text-gray-800'}>
              {action.charAt(0).toUpperCase() + action.slice(1)}
            </Badge>
          );
        },
        enableColumnFilter: false,
      },
      {
        accessorKey: 'resource',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Resource" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="capitalize">{row.getValue('resource')}</span>
          </div>
        ),
        enableColumnFilter: false,
      },
      {
        accessorKey: 'resourceId',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Resource ID" />,
        cell: ({ row }) => (
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
            {row.getValue('resourceId') || '-'}
          </code>
        ),
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedLog(row.original)}
          >
            <Eye className="h-4 w-4 mr-1" />
            View
          </Button>
        ),
      },
    ],
    []
  );

  const filterableColumns: FilterableColumn[] = [
    {
      id: 'action',
      title: 'Action',
      options: [
        { label: 'Create', value: 'create' },
        { label: 'Update', value: 'update' },
        { label: 'Delete', value: 'delete' },
        { label: 'Login', value: 'login' },
        { label: 'Logout', value: 'logout' },
      ],
    },
    {
      id: 'resource',
      title: 'Resource',
      options: [
        { label: 'User', value: 'user' },
        { label: 'Role', value: 'role' },
        { label: 'Session', value: 'session' },
      ],
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Audit Logs"
        description="View system activity and track changes"
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Audit Logs' }]}
      />

      <DataTable
        columns={columns}
        data={logs}
        pageCount={pageCount}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        enableGlobalFilter
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        columnFilters={columnFilters}
        onColumnFiltersChange={setColumnFilters}
        searchPlaceholder="Search logs..."
        filterableColumns={filterableColumns}
        getRowId={(row) => row.id}
        fillHeight
      />

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Audit Log Details</DialogTitle>
            <DialogDescription>
              {selectedLog && new Date(selectedLog.createdAt).toLocaleString()}
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">User</label>
                  <p className="font-medium">{selectedLog.user?.name || 'System'}</p>
                  <p className="text-sm text-muted-foreground">{selectedLog.user?.email || '-'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Action</label>
                  <div className="mt-1">
                    <Badge className={actionColors[selectedLog.action] || 'bg-gray-100'}>
                      {selectedLog.action.charAt(0).toUpperCase() + selectedLog.action.slice(1)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Resource</label>
                  <p className="font-medium capitalize">{selectedLog.resource}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Resource ID</label>
                  <code className="text-sm bg-muted px-1.5 py-0.5 rounded">
                    {selectedLog.resourceId || '-'}
                  </code>
                </div>
              </div>

              {selectedLog.oldValues && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Previous Values</label>
                  <pre className="mt-1 p-3 bg-muted rounded-md text-sm overflow-x-auto">
                    {JSON.stringify(selectedLog.oldValues, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.newValues && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">New Values</label>
                  <pre className="mt-1 p-3 bg-muted rounded-md text-sm overflow-x-auto">
                    {JSON.stringify(selectedLog.newValues, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.metadata && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Metadata</label>
                  <pre className="mt-1 p-3 bg-muted rounded-md text-sm overflow-x-auto">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
