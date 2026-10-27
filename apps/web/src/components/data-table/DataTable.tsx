import { useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type RowSelectionState,
  type PaginationState,
  type Row,
} from '@tanstack/react-table';
import { Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTablePagination } from './DataTablePagination';
import { DataTableToolbar } from './DataTableToolbar';
import type { FilterableColumn, BulkAction } from './types';

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  pageCount?: number;
  isLoading?: boolean;
  // Server-side state
  pagination?: PaginationState;
  onPaginationChange?: (pagination: PaginationState) => void;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  // Features
  // `true` makes every row selectable. Pass a predicate to make selection per-row —
  // rows it returns false for render no checkbox at all and are skipped by "select all",
  // so an action that cannot apply to them simply cannot be aimed at them.
  enableRowSelection?: boolean | ((row: Row<TData>) => boolean);
  enableMultiRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (visibility: VisibilityState) => void;
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
  // Global filter
  enableGlobalFilter?: boolean;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  // Toolbar
  searchPlaceholder?: string;
  filterableColumns?: FilterableColumn[];
  // Bulk actions
  bulkActions?: BulkAction<TData>[];
  // Empty state
  emptyState?: React.ReactNode;
  // Row ID
  getRowId?: (row: TData) => string;
  // Row class name (for per-row styling, e.g. color coding)
  rowClassName?: (row: TData) => string | undefined;
  // Extra content rendered on the left side of the toolbar (same row as View button)
  toolbarLeft?: React.ReactNode;
  // Called when the toolbar's Reset button is clicked, in addition to the
  // built-in column-filter/global-filter reset (e.g. to clear filter state
  // that lives outside the table, like a custom combobox).
  onReset?: () => void;
  // Extra condition (outside table state) that should also count as
  // "filtered" for the purpose of showing the Reset button.
  isFilteredExtra?: boolean;
  // Label for the toolbar's Reset button. Defaults to 'Reset'.
  resetLabel?: string;
  // Opt-in: fill the parent's height and scroll the table body internally
  // (instead of growing the page). The parent must be a flex column with a
  // bounded height (e.g. `flex h-full flex-col`). Default off — no effect on
  // existing tables.
  // Opt-in: fill the parent's height and scroll the table body internally.
  // The parent must be a flex column with bounded height (e.g. 'flex h-full flex-col').
  fillHeight?: boolean;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  pageCount,
  isLoading = false,
  pagination: externalPagination,
  onPaginationChange,
  sorting: externalSorting,
  onSortingChange,
  enableRowSelection = false,
  enableMultiRowSelection = true,
  rowSelection: externalRowSelection,
  onRowSelectionChange,
  columnVisibility: externalColumnVisibility,
  onColumnVisibilityChange,
  columnFilters: externalColumnFilters,
  onColumnFiltersChange,
  enableGlobalFilter = true,
  globalFilter: externalGlobalFilter,
  onGlobalFilterChange,
  searchPlaceholder,
  filterableColumns,
  bulkActions,
  emptyState,
  getRowId,
  rowClassName,
  toolbarLeft,
  onReset,
  isFilteredExtra,
  resetLabel,
  fillHeight = false,
}: DataTableProps<TData, TValue>) {
  // Internal state for uncontrolled mode
  const [internalPagination, setInternalPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const [internalColumnFilters, setInternalColumnFilters] = useState<ColumnFiltersState>([]);
  const [internalColumnVisibility, setInternalColumnVisibility] = useState<VisibilityState>({});
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({});
  const [internalGlobalFilter, setInternalGlobalFilter] = useState('');

  // Use external state if provided, otherwise use internal state
  const pagination = externalPagination ?? internalPagination;
  const sorting = externalSorting ?? internalSorting;
  const columnFilters = externalColumnFilters ?? internalColumnFilters;
  const columnVisibility = externalColumnVisibility ?? internalColumnVisibility;
  const rowSelection = externalRowSelection ?? internalRowSelection;
  const globalFilter = externalGlobalFilter ?? internalGlobalFilter;

  // A predicate prop is usually an inline arrow, so memoise on whether selection is on at
  // all rather than on the prop itself — otherwise the column list is rebuilt every render.
  // The cell reads row.getCanSelect(), which consults the live table option, so the memo
  // does not need the predicate in its closure.
  const rowSelectionEnabled = !!enableRowSelection;

  // Prepend checkbox column if row selection is enabled
  const tableColumns = useMemo(() => {
    if (!rowSelectionEnabled) return columns;

    const selectColumn: ColumnDef<TData, TValue> = {
      id: 'select',
      // Also hidden when nothing on the page is selectable (e.g. the list is filtered to
      // rows the predicate excludes) — "select all" would otherwise render but do nothing,
      // because toggleAllPageRowsSelected skips rows that fail getCanSelect().
      header: ({ table }) =>
        enableMultiRowSelection && table.getRowModel().rows.some((row) => row.getCanSelect()) ? (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
            className="translate-y-[2px]"
          />
        ) : null,
      // Nothing rendered for a row the predicate excludes — a disabled checkbox would still
      // read as "selectable once something changes", which is not the case here.
      cell: ({ row }) =>
        row.getCanSelect() ? (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
            className="translate-y-[2px]"
          />
        ) : null,
      enableSorting: false,
      enableHiding: false,
    };

    return [selectColumn, ...columns];
  }, [columns, rowSelectionEnabled, enableMultiRowSelection]);

  // Determine if we're in controlled or uncontrolled mode for each feature
  const isServerSidePagination = pageCount !== undefined;
  const isServerSideSorting = !!onSortingChange;
  const isServerSideFiltering = !!onColumnFiltersChange;

  const table = useReactTable({
    data,
    columns: tableColumns,
    pageCount,
    state: {
      pagination,
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
    },
    onPaginationChange: (updater) => {
      const newState =
        typeof updater === 'function' ? updater(pagination) : updater;
      if (onPaginationChange) {
        onPaginationChange(newState);
      } else {
        setInternalPagination(newState);
      }
    },
    onSortingChange: (updater) => {
      const newState =
        typeof updater === 'function' ? updater(sorting) : updater;
      if (onSortingChange) {
        onSortingChange(newState);
      } else {
        setInternalSorting(newState);
      }
    },
    onColumnFiltersChange: (updater) => {
      const newState =
        typeof updater === 'function' ? updater(columnFilters) : updater;
      if (onColumnFiltersChange) {
        onColumnFiltersChange(newState);
      } else {
        setInternalColumnFilters(newState);
      }
    },
    onColumnVisibilityChange: (updater) => {
      const newState =
        typeof updater === 'function' ? updater(columnVisibility) : updater;
      if (onColumnVisibilityChange) {
        onColumnVisibilityChange(newState);
      } else {
        setInternalColumnVisibility(newState);
      }
    },
    onRowSelectionChange: (updater) => {
      const newState =
        typeof updater === 'function' ? updater(rowSelection) : updater;
      if (onRowSelectionChange) {
        onRowSelectionChange(newState);
      } else {
        setInternalRowSelection(newState);
      }
    },
    onGlobalFilterChange: (updater) => {
      const newState =
        typeof updater === 'function' ? updater(globalFilter) : updater;
      if (onGlobalFilterChange) {
        onGlobalFilterChange(newState);
      } else {
        setInternalGlobalFilter(newState);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: isServerSidePagination ? undefined : getPaginationRowModel(),
    getSortedRowModel: isServerSideSorting ? undefined : getSortedRowModel(),
    getFilteredRowModel: isServerSideFiltering ? undefined : getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    manualPagination: isServerSidePagination,
    manualSorting: isServerSideSorting,
    manualFiltering: isServerSideFiltering,
    enableRowSelection,
    enableMultiRowSelection,
    enableGlobalFilter,
    globalFilterFn: 'includesString',
    getRowId,
  });

  // Get selected rows data
  const selectedRows = useMemo(() => {
    return table.getFilteredSelectedRowModel().rows.map((row) => row.original);
  }, [table.getFilteredSelectedRowModel().rows]);

  return (
    <div className={fillHeight ? 'space-y-4 flex flex-1 min-h-0 flex-col' : 'space-y-4'}>
      <DataTableToolbar
        table={table}
        searchPlaceholder={searchPlaceholder}
        filterableColumns={filterableColumns}
        enableGlobalFilter={enableGlobalFilter}
        globalFilter={globalFilter}
        onGlobalFilterChange={onGlobalFilterChange}
        bulkActions={bulkActions}
        selectedRows={selectedRows}
        toolbarLeft={toolbarLeft}
        onReset={onReset}
        isFilteredExtra={isFilteredExtra}
        resetLabel={resetLabel}
      />
      <div className={fillHeight ? 'rounded-md border flex-1 min-h-0 overflow-auto' : 'rounded-md border'}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={tableColumns.length}
                  className="h-24 text-center"
                >
                  <div className="flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">Loading...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className={rowClassName?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={tableColumns.length}
                  className="h-24 text-center"
                >
                  {emptyState ?? (
                    <div className="text-muted-foreground">No results.</div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} />
    </div>
  );
}
