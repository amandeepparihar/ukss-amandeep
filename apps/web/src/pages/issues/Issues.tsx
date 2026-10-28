import { useMemo, useState } from 'react';
import { Plus, Undo2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data-table/DataTable';
import { DataTableColumnHeader } from '@/components/data-table';
import { useDataTable } from '@/components/data-table/useDataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { useNotifications } from '@/hooks/useNotifications';
import { usePermission } from '@/hooks/useAuth';
import { getApiError } from '@/lib/api';

import { useIssuesList, useReturnIssue, type Issue, type IssueStatus } from './useIssues';
import { IssueBookDialog } from './IssueBookDialog';

const STATUS_OPTIONS = [
  { value: 'ISSUED', label: 'Issued' },
  { value: 'RETURNED', label: 'Returned' },
];

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : '-');

export function Issues() {
  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [issueToReturn, setIssueToReturn] = useState<Issue | null>(null);
  const [status, setStatus] = useState('');

  const { success, error: errorNotify } = useNotifications();
  const { can } = usePermission();
  const returnIssueMutation = useReturnIssue();

  const canCreate = can('issues:create');
  const canReturn = can('issues:edit');

  const { pagination, setPagination, sorting, setSorting, queryParams, resetAll } = useDataTable({
    pageSize: 10,
  });

  // column ids are the same names the api sorts by, so no mapping is needed
  const params = {
    page: queryParams.page,
    pageSize: queryParams.limit,
    sortBy: queryParams.sortBy || 'createdAt',
    sortOrder: queryParams.sortOrder || 'desc',
    status: (status || undefined) as IssueStatus | undefined,
  };

  const { data: issuesData, isLoading } = useIssuesList(params);

  const issues = issuesData?.data ?? [];
  const pageCount = issuesData?.meta?.totalPages ?? 0;

  const handleStatusChange = (value: string) => {
    setStatus(value);
    // a new filter starts again from the first page
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleReset = () => {
    setStatus('');
    resetAll();
  };

  const columns = useMemo<ColumnDef<Issue>[]>(
    () => [
      {
        id: 'book',
        header: 'Book',
        enableSorting: false,
        cell: ({ row }) => <p className="font-medium">{row.original.book.bookName}</p>,
      },
      {
        id: 'student',
        header: 'Student',
        enableSorting: false,
        cell: ({ row }) => (
          <div>
            <p>{row.original.student.name}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              Roll {row.original.student.rollNo}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'issueDate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Issued On" />,
        cell: ({ row }) => <p>{formatDate(row.original.issueDate)}</p>,
      },
      {
        accessorKey: 'returnDate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Returned On" />,
        cell: ({ row }) => <p>{formatDate(row.original.returnDate)}</p>,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) =>
          row.original.status === 'ISSUED' ? (
            <Badge variant="warning">Issued</Badge>
          ) : (
            <Badge variant="success">Returned</Badge>
          ),
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        cell: ({ row }) =>
          canReturn && row.original.status === 'ISSUED' ? (
            <Button variant="outline" size="sm" onClick={() => setIssueToReturn(row.original)}>
              <Undo2 className="mr-2 h-4 w-4" />
              Return
            </Button>
          ) : null,
      },
    ],
    [canReturn]
  );

  const confirmReturn = async () => {
    if (!issueToReturn) return;

    try {
      await returnIssueMutation.mutateAsync(issueToReturn.id);
      success('Book returned successfully');
    } catch (err) {
      const apiError = getApiError(err);

      // "already returned" is worth showing as-is
      errorNotify(apiError.code === 'CONFLICT' ? apiError.message : 'Failed to return book');
    } finally {
      setIssueToReturn(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Issues"
        description="Books issued to students"
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Issues' }]}
        actions={
          canCreate && (
            <Button onClick={() => setIsIssueOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Issue Book
            </Button>
          )
        }
      />

      <DataTable<Issue, any>
        columns={columns}
        data={issues}
        pageCount={pageCount}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        enableGlobalFilter={false}
        toolbarLeft={
          <SearchableSelect
            value={status}
            onChange={handleStatusChange}
            options={STATUS_OPTIONS}
            allOption={{ value: '', label: 'All statuses' }}
            placeholder="Status"
          />
        }
        getRowId={(row) => row.id}
        isFilteredExtra={status !== ''}
        onReset={handleReset}
        resetLabel="Reset All Filters"
        emptyState={
          <div className="text-center py-8 text-muted-foreground">
            No issues found matching the current filters.
          </div>
        }
        fillHeight
      />

      <Dialog open={!!issueToReturn} onOpenChange={(open) => !open && setIssueToReturn(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return Book</DialogTitle>
            <DialogDescription>
              Mark <strong>{issueToReturn?.book.bookName}</strong> as returned by{' '}
              <strong>{issueToReturn?.student.name}</strong>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueToReturn(null)}>
              Cancel
            </Button>
            <Button onClick={confirmReturn} loading={returnIssueMutation.isPending}>
              Return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IssueBookDialog open={isIssueOpen} onOpenChange={setIsIssueOpen} />
    </div>
  );
}
