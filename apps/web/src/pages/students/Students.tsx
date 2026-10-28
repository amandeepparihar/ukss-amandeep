import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, User } from 'lucide-react';
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

import { useNotifications } from '@/hooks/useNotifications';
import { usePermission } from '@/hooks/useAuth';
import { getApiError } from '@/lib/api';

import { useStudentsList, useDeleteStudent, type Student } from './useStudents';

export function Students() {
  const navigate = useNavigate();
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);

  const { success, error: errorNotify } = useNotifications();
  const { can } = usePermission();
  const deleteStudentMutation = useDeleteStudent();

  const canCreate = can('students:create');
  const canEdit = can('students:edit');
  const canDelete = can('students:delete');

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
    sortBy: queryParams.sortBy || 'createdAt',
    sortOrder: queryParams.sortOrder || 'desc',
    search: queryParams.search,
  };

  const { data: studentsData, isLoading } = useStudentsList(params);

  const students = studentsData?.data ?? [];
  const pageCount = studentsData?.meta?.totalPages ?? 0;

  const columns = useMemo<ColumnDef<Student>[]>(
    () => [
      {
        id: 'photo',
        header: 'Photo',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.photoUrl ? (
            <img
              src={row.original.photoUrl}
              alt={row.original.name}
              className="h-10 w-10 rounded-full object-cover border"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full border bg-muted">
              <User className="h-4 w-4 text-muted-foreground" />
            </div>
          ),
      },
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ cell }) => <p className="font-medium">{cell.getValue<string>()}</p>,
      },
      {
        accessorKey: 'rollNo',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Roll No" />,
        cell: ({ cell }) => <p className="tabular-nums">{cell.getValue<string>()}</p>,
      },
      {
        accessorKey: 'phoneNo',
        header: 'Phone',
        enableSorting: false,
        cell: ({ cell }) => <p className="tabular-nums">{cell.getValue<string>()}</p>,
      },
      {
        accessorKey: 'city',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Location" />,
        cell: ({ row }) => (
          <p>
            {row.original.city}, {row.original.state}, {row.original.country}
          </p>
        ),
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
                onClick={() => navigate(`/students/${row.original.id}`)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                title="Delete"
                onClick={() => setStudentToDelete(row.original)}
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

  const confirmDelete = async () => {
    if (!studentToDelete) return;

    try {
      await deleteStudentMutation.mutateAsync(studentToDelete.id);
      success('Student deleted successfully');
    } catch (err) {
      const apiError = getApiError(err);

      errorNotify(apiError.code === 'CONFLICT' ? apiError.message : 'Failed to delete student');
    } finally {
      setStudentToDelete(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Students"
        description="Manage library students"
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Students' }]}
        actions={
          canCreate && (
            <Button onClick={() => navigate('/students/create')}>
              <Plus className="mr-2 h-4 w-4" />
              Add Student
            </Button>
          )
        }
      />

      <DataTable<Student, any>
        columns={columns}
        data={students}
        pageCount={pageCount}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        getRowId={(row) => row.id}
        searchPlaceholder="Search by name or roll no..."
        isFilteredExtra
        onReset={resetAll}
        resetLabel="Reset All Filters"
        emptyState={
          <div className="text-center py-8 text-muted-foreground">
            No students found matching the current filters.
          </div>
        }
        fillHeight
      />

      <Dialog open={!!studentToDelete} onOpenChange={(open) => !open && setStudentToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Student</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{studentToDelete?.name}</strong>? Their issue
              history will be deleted too. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStudentToDelete(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              loading={deleteStudentMutation.isPending}
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
