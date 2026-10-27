import { useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable, useDataTable, type FilterableColumn } from '@/components/data-table';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { usePermission } from '@/hooks/useAuth';
import { getApiError } from '@/lib/api';
import { columns } from './columns';
import {
  useSdListing,
  useApproveProducts,
  sdFlagFor,
  type SdProduct,
} from './hooks/useSellerDynamics';

// Mirrors the API's approveProductsSchema `.max(500)` cap.
const MAX_APPROVE = 500;

/** Every row set to the same choice, for the Mark all / Clear all buttons. */
function setAll(rows: SdProduct[], value: boolean): Record<number, boolean> {
  return Object.fromEntries(rows.map((r) => [r.products_id, value]));
}

export function SellerDynamicsPage() {
  const { can } = usePermission();

  // Rows pending confirmation (null = dialog closed).
  const [confirmRows, setConfirmRows] = useState<SdProduct[] | null>(null);

  // Per-product choice, keyed by products_id: true -> Is_Your_Name 'Yes' -> Flag UKSS-CUST,
  // false -> 'No' -> UKSS-POD. Rebuilt from scratch on every dialog open (see openConfirm)
  // so a stale entry can never overwrite a product the approver did not look at.
  const [customisable, setCustomisable] = useState<Record<number, boolean>>({});

  const {
    pagination,
    setPagination,
    sorting,
    setSorting,
    globalFilter,
    setGlobalFilter,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    rowSelection,
    setRowSelection,
    queryParams,
  } = useDataTable({ pageSize: 20 });

  // Status faceted filter → API `approved`. Only filter when exactly one value
  // is selected; none or both = "All" (param omitted).
  const statusFilter = queryParams.filters?.isApproved;
  const approved = statusFilter?.length === 1 ? (statusFilter[0] as 'true' | 'false') : undefined;

  const { data, isLoading, isError, error } = useSdListing({
    page: queryParams.page,
    pageSize: queryParams.limit, // useDataTable emits `limit`; API expects `pageSize`
    sortBy: queryParams.sortBy,
    sortOrder: queryParams.sortOrder,
    search: queryParams.search,
    approved,
  });

  const products: SdProduct[] = data?.data ?? [];
  const pageCount = data?.meta?.totalPages ?? 0;

  const approveMutation = useApproveProducts();

  // Seed each row from the product's *current* flag rather than from a fixed default, so
  // simply confirming the dialog preserves what is already set. Is_Your_Name is shared with
  // the storefront and the marketplace feeds — defaulting everything to unticked would quietly
  // switch personalisation off for shirts that already have it on.
  const openConfirm = (rows: SdProduct[]) => {
    setCustomisable(
      Object.fromEntries(rows.map((r) => [r.products_id, r.sdFlag === 'UKSS-CUST']))
    );
    setConfirmRows(rows);
  };

  const confirmApprove = () => {
    if (!confirmRows) return;
    approveMutation.mutate(
      {
        products: confirmRows.map((r) => ({
          productId: r.products_id,
          isCustomisable: customisable[r.products_id] ?? false,
        })),
      },
      {
        onSuccess: () => {
          setRowSelection({}); // clear stale checkboxes after the change
          setConfirmRows(null);
        },
      }
    );
  };

  // Bulk action buttons only render when ≥1 row is selected (DataTableToolbar).
  // Clicking opens a confirmation dialog rather than firing immediately, because
  // "Approve" has a real side effect (inserts draft Seller Dynamics listings).
  const bulkActions = can('sd-tshirts:approve')
    ? [
        {
          label: 'Approve selected',
          icon: CheckCircle,
          variant: 'default' as const,
          onClick: openConfirm,
          disabled: () => approveMutation.isPending,
        },
      ]
    : [];

  const filterableColumns: FilterableColumn[] = [
    {
      id: 'isApproved',
      title: 'Status',
      options: [
        { label: 'Approved', value: 'true', icon: CheckCircle },
        { label: 'Not approved', value: 'false', icon: XCircle },
      ],
    },
  ];

  const selectedCount = confirmRows?.length ?? 0;
  const tooMany = selectedCount > MAX_APPROVE;

  return (
    // Fill the viewport height so only the table body scrolls internally
    // instead of the whole page (paired with <DataTable fillHeight />).
    <div className="flex h-full flex-col">
      <PageHeader
        title="Seller Dynamics – T-Shirts"
        description="Review and approve T-shirt products for Seller Dynamics listing"
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Seller Dynamics' }]}
      />

      {isError && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load products: {getApiError(error).message}
        </div>
      )}

      <DataTable
        columns={columns}
        data={products}
        pageCount={pageCount}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        // Approval is one-way, so an approved product can never be approved again — the API
        // rejects it with PRODUCTS_ALREADY_APPROVED. Rather than let it be selected and then
        // fail the whole batch, those rows get no checkbox and are skipped by "select all".
        enableRowSelection={(row) => !row.original.isApproved}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        columnFilters={columnFilters}
        onColumnFiltersChange={setColumnFilters}
        enableGlobalFilter
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        searchPlaceholder="Search name or model..."
        filterableColumns={filterableColumns}
        bulkActions={bulkActions}
        getRowId={(row) => String(row.products_id)}
        fillHeight
      />

      <AlertDialog
        open={!!confirmRows}
        onOpenChange={(open) => {
          if (!open) setConfirmRows(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve for Seller Dynamics?</AlertDialogTitle>
            <AlertDialogDescription>
              {tooMany ? (
                <>
                  You selected <strong>{selectedCount}</strong> products. Please approve{' '}
                  <strong>{MAX_APPROVE}</strong> or fewer at a time.
                </>
              ) : (
                <>
                  This will queue <strong>{selectedCount}</strong> product
                  {selectedCount === 1 ? '' : 's'} as draft Seller Dynamics listings. Continue?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Sits outside AlertDialogDescription — that renders a <p>, which cannot legally
              contain this markup. Hidden when the selection is over the cap, since nothing
              can be approved in that state anyway. */}
          {!tooMany && confirmRows && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Customizable</span>
                {/* Batches can run to 500 rows, so ticking each one by hand is not viable —
                    these set every row at once, and individual rows stay editable after. */}
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={approveMutation.isPending}
                    onClick={() => setCustomisable(setAll(confirmRows, true))}
                  >
                    Mark all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={approveMutation.isPending}
                    onClick={() => setCustomisable(setAll(confirmRows, false))}
                  >
                    Clear all
                  </Button>
                </div>
              </div>

              <div className="max-h-56 divide-y overflow-y-auto rounded-md border">
                {confirmRows.map((row) => {
                  const checked = customisable[row.products_id] ?? false;
                  const inputId = `sd-customisable-${row.products_id}`;

                  return (
                    <div key={row.products_id} className="flex items-start gap-3 p-2.5">
                      <Checkbox
                        id={inputId}
                        checked={checked}
                        onCheckedChange={(value) =>
                          setCustomisable((prev) => ({
                            ...prev,
                            [row.products_id]: value === true,
                          }))
                        }
                        disabled={approveMutation.isPending}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <Label
                          htmlFor={inputId}
                          className="cursor-pointer text-sm font-normal break-words"
                        >
                          {row.products_name}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {row.products_model ?? `#${row.products_id}`} →{' '}
                          <span className="font-mono font-semibold text-foreground">
                            {sdFlagFor(checked)}
                          </span>
                          {/* Flags a change against what the product is set to today, since
                              this write is shared with the storefront and the feeds. */}
                          {checked !== (row.sdFlag === 'UKSS-CUST') && (
                            <span className="text-amber-600 dark:text-amber-500">
                              {' '}
                              (was {row.sdFlag})
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-muted-foreground">
                Each tick sets that product&apos;s <span className="font-medium">Is Your Name</span>{' '}
                flag, which the storefront and the marketplace feeds also read. Boxes start from
                each product&apos;s current setting.
              </p>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmApprove} disabled={tooMany || approveMutation.isPending}>
              {approveMutation.isPending ? 'Approving...' : 'Approve'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
