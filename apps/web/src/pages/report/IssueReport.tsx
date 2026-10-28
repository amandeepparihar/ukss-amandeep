import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Search } from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data-table/DataTable';
import { DataTableColumnHeader } from '@/components/data-table';
import { useDataTable } from '@/components/data-table/useDataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNotifications } from '@/hooks/useNotifications';

import { useBookDateReport, type BookDateReportRow } from './useReports';

function toLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const today = () => toLocalDate(new Date());
const oneWeekAgo = () => toLocalDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

export function IssueReport() {
  const { error: errorNotify } = useNotifications();

  // what the inputs show
  const [dateOne, setDateOne] = useState(oneWeekAgo);
  const [dateTwo, setDateTwo] = useState(today);
  // what the table is showing, set by the search button
  const [range, setRange] = useState(() => ({ dateOne: oneWeekAgo(), dateTwo: today() }));

  const { pagination, setPagination, sorting, setSorting, queryParams, resetAll } = useDataTable({
    pageSize: 10,
  });

  const params = {
    dateOne: range.dateOne,
    dateTwo: range.dateTwo,
    page: queryParams.page,
    pageSize: queryParams.limit,
    sortBy: queryParams.sortBy || 'totalIssuedCount',
    sortOrder: queryParams.sortOrder || 'desc',
  };

  const { data: reportData, isLoading } = useBookDateReport(params);

  const rows = reportData?.data ?? [];
  const pageCount = reportData?.meta?.totalPages ?? 0;

  const handleSearch = () => {
    if (!dateOne || !dateTwo) {
      errorNotify('Pick both dates');
      return;
    }
    if (dateOne > dateTwo) {
      errorNotify('From date must be on or before To date');
      return;
    }

    setRange({ dateOne, dateTwo });
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleReset = () => {
    const from = oneWeekAgo();
    const to = today();
    setDateOne(from);
    setDateTwo(to);
    setRange({ dateOne: from, dateTwo: to });
    resetAll();
  };

  const columns = useMemo<ColumnDef<BookDateReportRow>[]>(
    () => [
      {
        accessorKey: 'bookName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Book Name" />,
        cell: ({ cell }) => <p className="font-medium">{cell.getValue<string>()}</p>,
      },
      {
        accessorKey: 'totalIssuedCount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Still Issued" />,
        cell: ({ cell }) => <p className="tabular-nums">{cell.getValue<number>()}</p>,
      },
      {
        accessorKey: 'totalReturnedCount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Returned" />,
        cell: ({ cell }) => <p className="tabular-nums">{cell.getValue<number>()}</p>,
      },
    ],
    []
  );

  const isDefaultRange = range.dateOne === oneWeekAgo() && range.dateTwo === today();

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Issue Report"
        description="Books issued between two dates, and how many of those came back."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Issue Report' }]}
      />

      <DataTable<BookDateReportRow, any>
        columns={columns}
        data={rows}
        pageCount={pageCount}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        enableGlobalFilter={false}
        toolbarLeft={
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={dateOne}
              max={dateTwo || today()}
              onChange={(e) => setDateOne(e.target.value)}
              className="w-[160px]"
              aria-label="From date"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              value={dateTwo}
              min={dateOne}
              max={today()}
              onChange={(e) => setDateTwo(e.target.value)}
              className="w-[160px]"
              aria-label="To date"
            />
            <Button variant="outline" size="icon" onClick={handleSearch} title="Search">
              <Search className="h-4 w-4" />
            </Button>
          </div>
        }
        getRowId={(row) => row.bookId}
        isFilteredExtra={!isDefaultRange}
        onReset={handleReset}
        resetLabel="Reset to Last 7 Days"
        emptyState={
          <div className="text-center py-8 text-muted-foreground">
            No books were issued in this date range.
          </div>
        }
        fillHeight
      />
    </div>
  );
}
