import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Loader2 } from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data-table/DataTable';
import { DataTableColumnHeader } from '@/components/data-table';
import { useDataTable } from '@/components/data-table/useDataTable';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  useBookReport,
  useBookStudents,
  type BookReportRow,
  type BookStudentsKind,
} from './useReports';

interface OpenPanel {
  book: BookReportRow;
  kind: BookStudentsKind;
}

export function BookReport() {
  const [panel, setPanel] = useState<OpenPanel | null>(null);

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
    sortBy: queryParams.sortBy || 'issuedCount',
    sortOrder: queryParams.sortOrder || 'desc',
    search: queryParams.search,
  };

  const { data: reportData, isLoading } = useBookReport(params);

  const rows = reportData?.data ?? [];
  const pageCount = reportData?.meta?.totalPages ?? 0;

  const { data: students = [], isLoading: isStudentsLoading } = useBookStudents(
    panel?.book.id,
    panel?.kind ?? 'issued'
  );

  const columns = useMemo<ColumnDef<BookReportRow>[]>(
    () => [
      {
        accessorKey: 'bookName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Book Name" />,
        cell: ({ cell }) => <p className="font-medium">{cell.getValue<string>()}</p>,
      },
      {
        accessorKey: 'issuedCount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Issued" />,
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            className="tabular-nums"
            onClick={() => setPanel({ book: row.original, kind: 'issued' })}
          >
            {row.original.issuedCount}
          </Button>
        ),
      },
      {
        accessorKey: 'quantity',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Available" />,
        cell: ({ cell }) => <p className="tabular-nums">{cell.getValue<number>()}</p>,
      },
      {
        accessorKey: 'lateCount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Late (3+ days)" />,
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            className={
              row.original.lateCount > 0 ? 'tabular-nums text-destructive' : 'tabular-nums'
            }
            disabled={row.original.lateCount === 0}
            onClick={() => setPanel({ book: row.original, kind: 'late' })}
          >
            {row.original.lateCount}
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Book Report"
        description="Books on loan right now. Click a count to see the students."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Book Report' }]}
      />

      <DataTable<BookReportRow, any>
        columns={columns}
        data={rows}
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
            No books are on loan right now.
          </div>
        }
        fillHeight
      />

      <Dialog open={!!panel} onOpenChange={(open) => !open && setPanel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {panel?.kind === 'late' ? 'Late students' : 'Issued to'}: {panel?.book.bookName}
            </DialogTitle>
            <DialogDescription>
              {panel?.kind === 'late'
                ? 'Students who have had this book for more than 3 days.'
                : 'Students who have this book right now.'}
            </DialogDescription>
          </DialogHeader>

          {isStudentsLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading students...
            </div>
          ) : students.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No students found.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Roll No</th>
                    <th className="px-3 py-2 text-left font-medium">Issued On</th>
                    <th className="px-3 py-2 text-left font-medium">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.id} className="border-t">
                      <td className="px-3 py-2">{student.name}</td>
                      <td className="px-3 py-2 tabular-nums">{student.rollNo}</td>
                      <td className="px-3 py-2">
                        {new Date(student.issueDate).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {Math.floor(
                          (Date.now() - new Date(student.issueDate).getTime()) /
                            (24 * 60 * 60 * 1000)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
