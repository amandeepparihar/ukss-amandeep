import { X } from 'lucide-react';
import type { Table } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTableViewOptions } from './DataTableViewOptions';
import { DataTableFacetedFilter } from './DataTableFacetedFilter';
import type { FilterableColumn, BulkAction } from './types';

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  searchPlaceholder?: string;
  filterableColumns?: FilterableColumn[];
  enableGlobalFilter?: boolean;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  bulkActions?: BulkAction<TData>[];
  selectedRows?: TData[];
  toolbarLeft?: React.ReactNode;
  onReset?: () => void;
  isFilteredExtra?: boolean;
  resetLabel?: string;
}

export function DataTableToolbar<TData>({
  table,
  searchPlaceholder = 'Search...',
  filterableColumns = [],
  enableGlobalFilter = true,
  globalFilter: externalGlobalFilter,
  onGlobalFilterChange: externalOnGlobalFilterChange,
  bulkActions = [],
  selectedRows = [],
  toolbarLeft,
  onReset,
  isFilteredExtra,
  resetLabel = 'Reset',
}: DataTableToolbarProps<TData>) {
  // Use external or table's internal globalFilter state
  const globalFilter = externalGlobalFilter ?? (table.getState().globalFilter as string) ?? '';
  const onGlobalFilterChange = externalOnGlobalFilterChange ?? ((value: string) => table.setGlobalFilter(value));

  const isFiltered = table.getState().columnFilters.length > 0 || !!globalFilter || !!isFilteredExtra;

  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex flex-1 items-center space-x-2">
        {toolbarLeft}
        {enableGlobalFilter && (
          <Input
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(event) => onGlobalFilterChange(event.target.value)}
            className="h-8 w-[150px] lg:w-[250px]"
          />
        )}
        {filterableColumns.map((column) => {
          const tableColumn = table.getColumn(column.id);
          return tableColumn ? (
            <DataTableFacetedFilter
              key={column.id}
              column={tableColumn}
              title={column.title}
              options={column.options}
            />
          ) : null;
        })}
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => {
              table.resetColumnFilters();
              onGlobalFilterChange('');
              onReset?.();
            }}
            className="h-8 px-2 lg:px-3"
          >
            {resetLabel}
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex items-center space-x-2">
        {selectedRows.length > 0 && bulkActions.length > 0 && (
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              {selectedRows.length} selected
            </span>
            {bulkActions.map((action, index) => {
              const Icon = action.icon;
              const isDisabled = action.disabled?.(selectedRows);
              return (
                <Button
                  key={index}
                  variant={action.variant ?? 'outline'}
                  size="sm"
                  onClick={() => action.onClick(selectedRows)}
                  disabled={isDisabled}
                  className="h-8"
                >
                  {Icon && <Icon className="mr-2 h-4 w-4" />}
                  {action.label}
                </Button>
              );
            })}
          </div>
        )}
        <DataTableViewOptions table={table} />
      </div>
    </div>
  );
}
