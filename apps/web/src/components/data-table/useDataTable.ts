import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SortingState, ColumnFiltersState, VisibilityState, RowSelectionState, PaginationState } from '@tanstack/react-table';

export interface UseDataTableOptions {
  pageSize?: number;
  enableUrlSync?: boolean;
  /** Faceted filters applied on first render (e.g. a report that defaults to
   *  a specific status). Reset returns to this set, not an empty one. */
  initialColumnFilters?: ColumnFiltersState;
}

export interface UseDataTableReturn {
  // Pagination
  pagination: PaginationState;
  setPagination: React.Dispatch<React.SetStateAction<PaginationState>>;
  // Sorting
  sorting: SortingState;
  setSorting: React.Dispatch<React.SetStateAction<SortingState>>;
  // Column filters
  columnFilters: ColumnFiltersState;
  setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  // Global filter
  globalFilter: string;
  setGlobalFilter: React.Dispatch<React.SetStateAction<string>>;
  // Column visibility
  columnVisibility: VisibilityState;
  setColumnVisibility: React.Dispatch<React.SetStateAction<VisibilityState>>;
  // Row selection
  rowSelection: RowSelectionState;
  setRowSelection: React.Dispatch<React.SetStateAction<RowSelectionState>>;
  // Derived query params for API
  queryParams: {
    page: number;
    limit: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    search?: string;
    filters?: Record<string, string[]>;
  };
  // Reset all
  resetAll: () => void;
}

export function useDataTable(options: UseDataTableOptions = {}): UseDataTableReturn {
  const { pageSize = 10, enableUrlSync = true, initialColumnFilters = [] } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize state from URL params
  const initialPagination = useMemo(() => {
    if (!enableUrlSync) return { pageIndex: 0, pageSize };
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || String(pageSize), 10);
    return {
      pageIndex: Math.max(0, page - 1),
      pageSize: [10, 20, 50, 100].includes(limit) ? limit : pageSize,
    };
  }, []);

  const initialSorting = useMemo(() => {
    if (!enableUrlSync) return [];
    const sortBy = searchParams.get('sortBy');
    const sortOrder = searchParams.get('sortOrder');
    if (sortBy) {
      return [{ id: sortBy, desc: sortOrder === 'desc' }];
    }
    return [];
  }, []);

  const initialGlobalFilter = useMemo(() => {
    if (!enableUrlSync) return '';
    return searchParams.get('search') || '';
  }, []);

  // State
  const [pagination, setPagination] = useState<PaginationState>(initialPagination);
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(initialColumnFilters);
  const [globalFilter, setGlobalFilter] = useState(initialGlobalFilter);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Sync state to URL
  useEffect(() => {
    if (!enableUrlSync) return;

    const params = new URLSearchParams();

    // Pagination
    if (pagination.pageIndex > 0) {
      params.set('page', String(pagination.pageIndex + 1));
    }
    if (pagination.pageSize !== pageSize) {
      params.set('limit', String(pagination.pageSize));
    }

    // Sorting
    if (sorting.length > 0) {
      params.set('sortBy', sorting[0].id);
      params.set('sortOrder', sorting[0].desc ? 'desc' : 'asc');
    }

    // Global filter
    if (globalFilter) {
      params.set('search', globalFilter);
    }

    // Column filters
    columnFilters.forEach((filter) => {
      const value = filter.value as string[];
      if (value && value.length > 0) {
        params.set(`filter_${filter.id}`, value.join(','));
      }
    });

    setSearchParams(params, { replace: true });
  }, [pagination, sorting, globalFilter, columnFilters, enableUrlSync, pageSize, setSearchParams]);

  // Query params for API
  const queryParams = useMemo(() => {
    const params: UseDataTableReturn['queryParams'] = {
      page: pagination.pageIndex + 1,
      limit: pagination.pageSize,
    };

    if (sorting.length > 0) {
      params.sortBy = sorting[0].id;
      params.sortOrder = sorting[0].desc ? 'desc' : 'asc';
    }

    if (globalFilter) {
      params.search = globalFilter;
    }

    if (columnFilters.length > 0) {
      params.filters = {};
      columnFilters.forEach((filter) => {
        const value = filter.value as string[];
        if (value && value.length > 0) {
          params.filters![filter.id] = value;
        }
      });
    }

    return params;
  }, [pagination, sorting, globalFilter, columnFilters]);

  // Reset all state
  const resetAll = useCallback(() => {
    setPagination({ pageIndex: 0, pageSize });
    setSorting([]);
    setColumnFilters(initialColumnFilters);
    setGlobalFilter('');
    setRowSelection({});
  }, [pageSize, initialColumnFilters]);

  return {
    pagination,
    setPagination,
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    globalFilter,
    setGlobalFilter,
    columnVisibility,
    setColumnVisibility,
    rowSelection,
    setRowSelection,
    queryParams,
    resetAll,
  };
}
