import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Download, Loader2 } from 'lucide-react';
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
import { getApiError } from '@/lib/api';

import {
  useSeasonsList,
  useDeleteSeason,
  exportSeasons,
  type Season,
  type SeasonExportFormat,
} from './useSeasons';

// table column
const sortFieldMap: Record<string, string> = {
  seasonsId: 'seasons_id',
  season: 'season',
  sort: 'sort',
  created: 'created',
};

export function Seasons() {
  const navigate = useNavigate();
  const [seasonToDelete, setSeasonToDelete] = useState<Season | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const { success, error: errorNotify } = useNotifications();
  const deleteSeasonMutation = useDeleteSeason();

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
    sortBy: sortFieldMap[queryParams.sortBy || ''] || 'sort',
    sortOrder: queryParams.sortOrder || 'asc',
    search: queryParams.search,
  };

  const { data: seasonsData, isLoading } = useSeasonsList(params);

  const seasons = seasonsData?.data ?? [];
  const pageCount = seasonsData?.meta?.totalPages ?? 0;

  const columns = useMemo<ColumnDef<Season>[]>(
    () => [
      {
        accessorKey: 'seasonsId',
        header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
        cell: ({ cell }) => <p>{cell.getValue<number>()}</p>,
      },
      {
        accessorKey: 'season',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Season" />,
        cell: ({ cell }) => <p>{cell.getValue<string>() || '-'}</p>,
      },
      {
        accessorKey: 'sort',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Sort" />,
        cell: ({ cell }) => <p>{cell.getValue<number>() ?? '-'}</p>,
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              title="Edit"
              onClick={() => navigate(`/seasons/${row.original.seasonsId}`)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Delete"
              onClick={() => setSeasonToDelete(row.original)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ),
      },
    ],
    [navigate]
  );

  const handleExport = async (format: SeasonExportFormat) => {
    setIsExporting(true);

    try {
      // send the active filters, not the current page, so the file matches what is filtered
      await exportSeasons(
        { search: params.search, sortBy: params.sortBy, sortOrder: params.sortOrder },
        format
      );
      success('Export completed');
    } catch {
      errorNotify('Failed to export seasons');
    } finally {
      setIsExporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!seasonToDelete) return;

    try {
      await deleteSeasonMutation.mutateAsync(seasonToDelete.seasonsId);
      success('Season deleted successfully');
    } catch (err) {
      const apiError = getApiError(err);

      // the conflict message names the records still using the season, so show it as-is
      errorNotify(apiError.code === 'CONFLICT' ? apiError.message : 'Failed to delete season');
    } finally {
      setSeasonToDelete(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Seasons"
        description="Manage seasons"
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Seasons' }]}
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
              </DropdownMenuContent>
            </DropdownMenu>

            <Button onClick={() => navigate('/seasons/create')}>
              <Plus className="mr-2 h-4 w-4" />
              Add Season
            </Button>
          </div>
        }
      />

      <DataTable<Season, any>
        columns={columns}
        data={seasons}
        pageCount={pageCount}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        getRowId={(row) => String(row.seasonsId)}
        searchPlaceholder="Search seasons..."
        isFilteredExtra
        onReset={resetAll}
        resetLabel="Reset All Filters"
        emptyState={
          <div className="text-center py-8 text-muted-foreground">
            No seasons found matching the current filters.
          </div>
        }
        fillHeight
      />

      <Dialog open={!!seasonToDelete} onOpenChange={(open) => !open && setSeasonToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Season</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{seasonToDelete?.season}</strong>? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeasonToDelete(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              loading={deleteSeasonMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
