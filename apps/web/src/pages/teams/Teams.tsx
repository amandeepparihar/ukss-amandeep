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
  useTeamsList,
  useDeleteTeam,
  exportTeams,
  type Team,
  type TeamExportFormat,
} from './useTeams';

// table column
const sortFieldMap: Record<string, string> = {
  teamsId: 'teams_id',
  teamName: 'team_name',
  sort: 'sort',
  created: 'created',
};

export function Teams() {
  const navigate = useNavigate();
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const { success, error: errorNotify } = useNotifications();
  const deleteTeamMutation = useDeleteTeam();

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

  const { data: teamsData, isLoading } = useTeamsList(params);

  const teams = teamsData?.data ?? [];
  const pageCount = teamsData?.meta?.totalPages ?? 0;

  const columns = useMemo<ColumnDef<Team>[]>(
    () => [
      {
        accessorKey: 'teamsId',
        header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
        cell: ({ cell }) => <p>{cell.getValue<number>()}</p>,
      },
      {
        accessorKey: 'teamName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Team Name" />,
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
              onClick={() => navigate(`/teams/${row.original.teamsId}`)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Delete"
              onClick={() => setTeamToDelete(row.original)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ),
      },
    ],
    [navigate]
  );

  const handleExport = async (format: TeamExportFormat) => {
    setIsExporting(true);

    try {
      // send the active filters, not the current page, so the file matches what is filtered
      await exportTeams(
        { search: params.search, sortBy: params.sortBy, sortOrder: params.sortOrder },
        format
      );
      success('Export completed');
    } catch {
      errorNotify('Failed to export teams');
    } finally {
      setIsExporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!teamToDelete) return;

    try {
      await deleteTeamMutation.mutateAsync(teamToDelete.teamsId);
      success('Team deleted successfully');
    } catch (err) {
      const apiError = getApiError(err);

      // the conflict message names the records still using the team, so show it as-is
      errorNotify(apiError.code === 'CONFLICT' ? apiError.message : 'Failed to delete team');
    } finally {
      setTeamToDelete(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Teams"
        description="Manage teams"
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Teams' }]}
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

            <Button onClick={() => navigate('/teams/create')}>
              <Plus className="mr-2 h-4 w-4" />
              Add Team
            </Button>
          </div>
        }
      />

      <DataTable<Team, any>
        columns={columns}
        data={teams}
        pageCount={pageCount}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        getRowId={(row) => String(row.teamsId)}
        searchPlaceholder="Search teams..."
        isFilteredExtra
        onReset={resetAll}
        resetLabel="Reset All Filters"
        emptyState={
          <div className="text-center py-8 text-muted-foreground">
            No teams found matching the current filters.
          </div>
        }
        fillHeight
      />

      <Dialog open={!!teamToDelete} onOpenChange={(open) => !open && setTeamToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Team</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{teamToDelete?.teamName}</strong>? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTeamToDelete(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              loading={deleteTeamMutation.isPending}
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
