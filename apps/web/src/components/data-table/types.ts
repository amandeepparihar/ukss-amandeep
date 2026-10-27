import type { ColumnDef, Table, RowData } from '@tanstack/react-table';

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  pageCount?: number;
  isLoading?: boolean;
  // Server-side state
  pagination?: {
    pageIndex: number;
    pageSize: number;
  };
  onPaginationChange?: (pagination: { pageIndex: number; pageSize: number }) => void;
  sorting?: { id: string; desc: boolean }[];
  onSortingChange?: (sorting: { id: string; desc: boolean }[]) => void;
  // Features
  enableRowSelection?: boolean;
  enableMultiRowSelection?: boolean;
  onRowSelectionChange?: (rows: TData[]) => void;
  enableColumnVisibility?: boolean;
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
  // Row actions
  getRowId?: (row: TData) => string;
}

export interface FilterableColumn {
  id: string;
  title: string;
  options: FilterOption[];
}

export interface FilterOption {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface BulkAction<TData> {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  onClick: (rows: TData[]) => void | Promise<void>;
  disabled?: (rows: TData[]) => boolean;
}

export interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  pageSizeOptions?: number[];
}

export interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  searchPlaceholder?: string;
  filterableColumns?: FilterableColumn[];
  enableGlobalFilter?: boolean;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  bulkActions?: BulkAction<TData>[];
  selectedRows?: TData[];
}

export interface DataTableColumnHeaderProps<TData, TValue> {
  column: import('@tanstack/react-table').Column<TData, TValue>;
  title: string;
  className?: string;
}

export interface DataTableViewOptionsProps<TData> {
  table: Table<TData>;
}

export interface DataTableFacetedFilterProps<TData, TValue> {
  column?: import('@tanstack/react-table').Column<TData, TValue>;
  title?: string;
  options: FilterOption[];
}

export interface ColumnMeta {
  headerClassName?: string;
  cellClassName?: string;
}

// Augment TanStack's ColumnMeta so `column.columnDef.meta.title` is typed.
// Used by DataTableViewOptions to label the "Toggle columns" menu with the
// human-readable header instead of the raw column id.
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    title?: string;
  }
}
