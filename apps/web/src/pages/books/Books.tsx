import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Download, Loader2, Upload, BookOpen } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data-table/DataTable';
import { DataTableColumnHeader } from '@/components/data-table';
import { useDataTable } from '@/components/data-table/useDataTable';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useNotifications } from '@/hooks/useNotifications';
import { usePermission } from '@/hooks/useAuth';
import { getApiError } from '@/lib/api';

import {
  useBooksList,
  useDeleteBook,
  exportBooks,
  type Book,
  type BookExportFormat,
} from './useBooks';
import { BulkUploadBooksDialog } from './BulkUploadBooksDialog';

export function Books() {
  const navigate = useNavigate();
  const [bookToDelete, setBookToDelete] = useState<Book | null>(null);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const { success, error: errorNotify } = useNotifications();
  const { can } = usePermission();
  const deleteBookMutation = useDeleteBook();

  const canCreate = can('books:create');
  const canEdit = can('books:edit');
  const canDelete = can('books:delete');

  const {
    pagination,
    setPagination,
    sorting,
    setSorting,
    globalFilter,
    setGlobalFilter,
    queryParams,
    resetAll,
  } = useDataTable({ pageSize: 10 });

  const params = {
    page: queryParams.page,
    pageSize: queryParams.limit,
    sortBy: queryParams.sortBy || 'updatedAt',
    sortOrder: queryParams.sortOrder || 'desc',
    search: queryParams.search,
  };

  const { data: booksData, isLoading } = useBooksList(params);

  const books = booksData?.data ?? [];
  const pageCount = booksData?.meta?.totalPages ?? 0;

  const columns = useMemo<ColumnDef<Book>[]>(
    () => [
      {
        id: 'cover',
        header: 'Cover',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.coverUrl ? (
            <img
              src={row.original.coverUrl}
              alt={row.original.bookName}
              className="h-12 w-9 rounded object-cover border"
            />
          ) : (
            <div className="flex h-12 w-9 items-center justify-center rounded border bg-muted">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </div>
          ),
      },
      {
        accessorKey: 'bookName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Book Name" />,
        cell: ({ cell }) => <p className="font-medium">{cell.getValue<string>()}</p>,
      },
      {
        accessorKey: 'authorName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Author" />,
        cell: ({ cell }) => <p>{cell.getValue<string>()}</p>,
      },
      {
        accessorKey: 'isbn',
        header: ({ column }) => <DataTableColumnHeader column={column} title="ISBN" />,
        cell: ({ cell }) => <p className="tabular-nums">{cell.getValue<string>()}</p>,
      },
      {
        accessorKey: 'quantity',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Available" />,
        cell: ({ cell }) => {
          const quantity = cell.getValue<number>();
          return (
            <p
              className={
                quantity > 0 ? 'tabular-nums' : 'tabular-nums text-destructive font-medium'
              }
            >
              {quantity}
            </p>
          );
        },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Added" />,
        cell: ({ cell }) => <p>{new Date(cell.getValue<string>()).toLocaleDateString()}</p>,
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                title="Edit"
                onClick={() => navigate(`/books/${row.original.id}`)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                title="Delete"
                onClick={() => setBookToDelete(row.original)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [navigate, canEdit, canDelete]
  );

  const handleExport = async (format: BookExportFormat) => {
    setIsExporting(true);

    try {
      await exportBooks({ search: params.search }, format);
      success('Export completed');
    } catch {
      errorNotify('Failed to export books');
    } finally {
      setIsExporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!bookToDelete) return;

    try {
      await deleteBookMutation.mutateAsync(bookToDelete.id);
      success('Book deleted successfully');
    } catch (err) {
      const apiError = getApiError(err);

      errorNotify(apiError.code === 'CONFLICT' ? apiError.message : 'Failed to delete book');
    } finally {
      setBookToDelete(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Books"
        description="Manage library books"
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Books' }]}
        actions={
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={isExporting}>
                  {isExporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  {isExporting ? 'Exporting...' : 'Export'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport('csv')}>Export CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('xlsx')}>
                  Export Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('pdf')}>Export PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {canCreate && (
              <Button variant="outline" onClick={() => setIsBulkOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Bulk Upload
              </Button>
            )}

            {canCreate && (
              <Button onClick={() => navigate('/books/create')}>
                <Plus className="mr-2 h-4 w-4" />
                Add Book
              </Button>
            )}
          </div>
        }
      />

      <DataTable<Book, any>
        columns={columns}
        data={books}
        pageCount={pageCount}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        getRowId={(row) => row.id}
        searchPlaceholder="Search by book name..."
        isFilteredExtra
        onReset={resetAll}
        resetLabel="Reset All Filters"
        emptyState={
          <div className="text-center py-8 text-muted-foreground">
            No books found matching the current filters.
          </div>
        }
        fillHeight
      />

      <Dialog open={!!bookToDelete} onOpenChange={(open) => !open && setBookToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Book</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{bookToDelete?.bookName}</strong>? Its issue
              history will be deleted too. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookToDelete(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              loading={deleteBookMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkUploadBooksDialog open={isBulkOpen} onOpenChange={setIsBulkOpen} />
    </div>
  );
}
