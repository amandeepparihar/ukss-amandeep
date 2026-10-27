import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable } from '@/components/data-table/DataTable';
import { useDataTable } from '@/components/data-table/useDataTable';
import { DataTableColumnHeader } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
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
import { Badge } from "@/components/ui/badge";

import { useFonts, useDeleteFont } from './useFonts';

export interface Fonts {
    fontId: number;
    fontName: string;
    fontDescription: string;
    fontStyle: string;
    textCase: string;
}

export interface FontApiResponse {
    data: Fonts[];
    meta: {
        total: number,
        page: number,
        pageSize: number,
        totalPages: number,
    }
}

type FontColumns = Fonts & {
    SNo?: number;
    text: string;
    row_id: number;
    rowClass?: string;
}

const sortFieldMap: Record<string, string> = {
    fontName: 'font_name',
    fontStyle: 'font_style',
    fontDescription: 'font_description',
    text: 'text_case',
};


export function Fonts() {
    const navigate = useNavigate();
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [fontToDelete, setFontToDelete] = useState<FontColumns | null>(null);

    const {
        pagination,
        setPagination,
        sorting,
        setSorting,
        queryParams,
        globalFilter,
        setGlobalFilter
    } = useDataTable({ pageSize: 10 });

    const params = {
        page: queryParams.page,
        pageSize: queryParams.limit,
        sortBy: sortFieldMap[queryParams.sortBy || ""] || 'font_id',
        sortOrder: queryParams.sortOrder || 'desc',
        search: queryParams.search,
    }

    const deleteMutation = useDeleteFont();

    const { data: FontData, isLoading } = useFonts(params);

    const pageCount = FontData?.meta?.totalPages ?? 0;
    const columns = useMemo<ColumnDef<FontColumns>[]>(() => {
        return [
            {
                accessorKey: 'SNo',
                header: ({ column }) => <DataTableColumnHeader column={column} title="#" />,
                cell: ({row}) => <p>{row.original.row_id}</p>
            },
            {
                accessorKey: 'fontName',
                header: ({ column }) => <DataTableColumnHeader column={column} title="Font Name" />,
                cell: (info) => <p>{info.getValue<string>()}</p>
                ,
            },
            {
                accessorKey: 'fontDescription',
                header: ({ column }) => <DataTableColumnHeader column={column} title="Font Description" />,
                cell: ({ cell }) => {
                    //   const user = row.original.user;
                    return (
                        <p>{cell.getValue<string>() || '-'}</p>
                    );
                },
            },
            {
                accessorKey: 'fontStyle',
                header: ({ column }) => <DataTableColumnHeader column={column} title="Font Style" />,
                cell: ({ cell }) => {
                    const value = cell.getValue<string>();
                    return (
                        <Badge
                            variant={value === 'Curve' ? 'success' : 'default'}>
                            {value || 'NA'}
                        </Badge>
                    );
                },
            },
            {
                accessorKey: 'text',
                header: ({ column }) => <DataTableColumnHeader column={column} title="Text" />,
                cell: ({ cell }) => {
                    const value = cell.getValue<string>();
                    return (
                        <Badge variant={value === 'Upper' ? 'default' : value === 'Lower' ? 'success' : 'outline'
                        }>{value || 'NA'}</Badge>

                    );
                },
            },
            {
                id: 'actions',
                header: ({ column }) => <DataTableColumnHeader column={column} title="Actions" />,
                cell: ({ row }) => (
                    <div className="flex items-center">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/fonts/${row.original.row_id}`)}
                        >
                            Edit
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            // onClick={() => deleteMutation.mutate(row.original.row_id)}
                            onClick={() => handleDeleteFont(row.original)}
                        >
                            <X className="w-4 text-red-600" />
                        </Button>
                    </div>
                ),
            },
        ]
    }, [navigate])

    const font_data = useMemo(() => {
        if (!FontData?.data) return [];

        return FontData?.data?.map((font) => {
            return {
                ...font,
                row_id: font.fontId,
                text: font.textCase,
            };
        })

    }, [FontData?.data]);


    const handleCreate = () => {
        navigate("/fonts/create");
    }

    const handleDeleteFont = (font: FontColumns) => {
        setFontToDelete(font);
        setDeleteDialogOpen(true);
    }

    const confirmDelete = () => {
        if (fontToDelete) {
            deleteMutation.mutate(fontToDelete.row_id);
        }
        setDeleteDialogOpen(false);
        setFontToDelete(null);
    };

    return (
        <div className="flex h-full flex-col">
            <PageHeader
                title="Fonts "
                description="Manage fonts "
                breadcrumbs={[
                    { label: 'Dashboard', href: '/' },
                    { label: 'Fonts' },
                ]}

                actions={

                    <>
                        <Button onClick={handleCreate}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add New Font
                        </Button>

                    </>
                }
            />

            {/* <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    title="Total Fonts"
                    value={FontData?.data?.length || 0}
                    color="#020869"
                />
            </div> */}


            <DataTable<FontColumns, any>
                columns={columns}
                data={font_data}
                pageCount={pageCount}
                isLoading={isLoading}
                pagination={pagination}
                onPaginationChange={setPagination}
                sorting={sorting}
                onSortingChange={setSorting}
                getRowId={(row) => String(row.row_id)}
                rowClassName={(row) => row.rowClass}
                globalFilter={globalFilter}
                onGlobalFilterChange={setGlobalFilter}
                searchPlaceholder="Search fonts..."
                emptyState={
                    <div className="text-center py-8 text-muted-foreground">
                        No fonts found matching the current filters.
                    </div>
                }
                fillHeight
            />
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Font</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete{' '}
                            <strong>
                                {fontToDelete?.fontName}
                            </strong>
                            ? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>

    )
}
