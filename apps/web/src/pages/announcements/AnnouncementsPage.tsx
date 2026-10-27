import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2, Info, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable, DataTableColumnHeader, useDataTable, type FilterableColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Form, TextField, TextareaField, SelectField, SwitchField } from '@/components/forms';
import { api, getApiError } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'INFO' | 'WARNING' | 'SUCCESS' | 'ERROR';
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  targetRoles: string[];
  dismissable: boolean;
  priority: number;
  createdAt: string;
}

const announcementSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required'),
  type: z.enum(['INFO', 'WARNING', 'SUCCESS', 'ERROR']),
  isActive: z.boolean(),
  dismissable: z.boolean(),
  priority: z.string(),
});

type AnnouncementFormData = z.infer<typeof announcementSchema>;

const typeIcons = {
  INFO: Info,
  WARNING: AlertTriangle,
  SUCCESS: CheckCircle,
  ERROR: XCircle,
};

const typeColors: Record<string, string> = {
  INFO: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  WARNING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  SUCCESS: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  ERROR: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

const typeOptions = [
  { label: 'Info', value: 'INFO' },
  { label: 'Warning', value: 'WARNING' },
  { label: 'Success', value: 'SUCCESS' },
  { label: 'Error', value: 'ERROR' },
];

const priorityOptions = [
  { label: '1 - Highest', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '4', value: '4' },
  { label: '5 - Normal', value: '5' },
  { label: '6', value: '6' },
  { label: '7', value: '7' },
  { label: '8', value: '8' },
  { label: '9', value: '9' },
  { label: '10 - Lowest', value: '10' },
];

export function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [deletingAnnouncement, setDeletingAnnouncement] = useState<Announcement | null>(null);

  const {
    pagination,
    setPagination,
    sorting,
    setSorting,
    globalFilter,
    setGlobalFilter,
    columnFilters,
    setColumnFilters,
    queryParams,
  } = useDataTable({ pageSize: 20 });

  const { data, isLoading } = useQuery({
    queryKey: ['announcements', queryParams],
    queryFn: async () => {
      const params: Record<string, unknown> = {
        page: queryParams.page,
        pageSize: queryParams.limit,
        sortBy: queryParams.sortBy || 'createdAt',
        sortOrder: queryParams.sortOrder || 'desc',
        search: queryParams.search,
      };

      const response = await api.get('/announcements', { params });
      return response.data;
    },
  });

  const announcements: Announcement[] = data?.data || [];
  const pageCount = data?.meta?.totalPages || 0;

  const form = useForm<AnnouncementFormData>({
    resolver: zodResolver(announcementSchema),
    defaultValues: {
      title: '',
      content: '',
      type: 'INFO',
      isActive: true,
      dismissable: true,
      priority: '5',
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: AnnouncementFormData) => {
      const response = await api.post('/announcements', {
        ...data,
        priority: parseInt(data.priority, 10),
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      queryClient.invalidateQueries({ queryKey: ['active-announcements'] });
      setShowCreateDialog(false);
      form.reset();
      toast.success('Announcement created');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: AnnouncementFormData }) => {
      const response = await api.put(`/announcements/${id}`, {
        ...data,
        priority: parseInt(data.priority, 10),
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      queryClient.invalidateQueries({ queryKey: ['active-announcements'] });
      setEditingAnnouncement(null);
      form.reset();
      toast.success('Announcement updated');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/announcements/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      queryClient.invalidateQueries({ queryKey: ['active-announcements'] });
      setDeletingAnnouncement(null);
      toast.success('Announcement deleted');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });

  const openEditDialog = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    form.reset({
      title: announcement.title,
      content: announcement.content,
      type: announcement.type,
      isActive: announcement.isActive,
      dismissable: announcement.dismissable,
      priority: announcement.priority.toString(),
    });
  };

  const handleSubmit = (data: AnnouncementFormData) => {
    if (editingAnnouncement) {
      updateMutation.mutate({ id: editingAnnouncement.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns = useMemo<ColumnDef<Announcement>[]>(
    () => [
      {
        accessorKey: 'type',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => {
          const type = row.getValue('type') as string;
          const Icon = typeIcons[type as keyof typeof typeIcons];
          return (
            <Badge className={typeColors[type]}>
              <Icon className="h-3 w-3 mr-1" />
              {type}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'title',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
        cell: ({ row }) => (
          <div className="font-medium">{row.getValue('title')}</div>
        ),
      },
      {
        accessorKey: 'isActive',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge variant={row.getValue('isActive') ? 'default' : 'secondary'}>
            {row.getValue('isActive') ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
      {
        accessorKey: 'priority',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Priority" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.getValue('priority')}</span>
        ),
      },
      {
        accessorKey: 'dismissable',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Dismissable" />,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.getValue('dismissable') ? 'Yes' : 'No'}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDistanceToNow(new Date(row.getValue('createdAt')), { addSuffix: true })}
          </span>
        ),
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openEditDialog(row.original)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeletingAnnouncement(row.original)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const filterableColumns: FilterableColumn[] = [
    {
      id: 'type',
      title: 'Type',
      options: typeOptions,
    },
    {
      id: 'isActive',
      title: 'Status',
      options: [
        { label: 'Active', value: 'true' },
        { label: 'Inactive', value: 'false' },
      ],
    },
  ];

  const isDialogOpen = showCreateDialog || !!editingAnnouncement;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Announcements"
        description="Create and manage system-wide announcements"
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Announcements' }]}
        actions={
          <Button onClick={() => {
            form.reset();
            setShowCreateDialog(true);
          }}>
            <Plus className="h-4 w-4 mr-2" />
            New Announcement
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={announcements}
        pageCount={pageCount}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        enableGlobalFilter
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        columnFilters={columnFilters}
        onColumnFiltersChange={setColumnFilters}
        searchPlaceholder="Search announcements..."
        filterableColumns={filterableColumns}
        getRowId={(row) => row.id}
        fillHeight
      />

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setShowCreateDialog(false);
          setEditingAnnouncement(null);
          form.reset();
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingAnnouncement ? 'Edit Announcement' : 'Create Announcement'}
            </DialogTitle>
            <DialogDescription>
              {editingAnnouncement
                ? 'Update the announcement details below.'
                : 'Create a new announcement to display to users.'}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <TextField
                name="title"
                label="Title"
                required
                placeholder="Enter announcement title"
              />

              <TextareaField
                name="content"
                label="Content"
                required
                placeholder="Enter announcement content"
                rows={3}
              />

              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  name="type"
                  label="Type"
                  options={typeOptions}
                />

                <SelectField
                  name="priority"
                  label="Priority"
                  options={priorityOptions}
                />
              </div>

              <div className="flex gap-4">
                <SwitchField
                  name="isActive"
                  label="Active"
                  description="Show this announcement"
                />

                <SwitchField
                  name="dismissable"
                  label="Dismissable"
                  description="Users can close this"
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowCreateDialog(false);
                    setEditingAnnouncement(null);
                    form.reset();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={createMutation.isPending || updateMutation.isPending}
                >
                  {editingAnnouncement ? 'Update' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deletingAnnouncement}
        onOpenChange={(open) => !open && setDeletingAnnouncement(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Announcement</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingAnnouncement?.title}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingAnnouncement && deleteMutation.mutate(deletingAnnouncement.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
