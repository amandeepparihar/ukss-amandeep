// apps/web/src/pages/reports/ebay-reconciliation/EbayReconciliationPage.tsx
/**
 * eBay Reconciliation Dashboard (spec §8): snapshot age + summary cards +
 * server-side reconciliation DataTable + verify-first bulk actions + run history.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { RefreshCw, Download, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, useDataTable } from '@/components/data-table';
import { usePermission } from '@/hooks/useAuth';
import {
  useEbayReconSummary,
  useEbayReconItems,
  useEbayReconRefresh,
  downloadEbayReconCsv,
} from '../hooks/useEbayReconciliation';
import { ReconActionDialog } from './ReconActionDialog';
import type { EbayReconActionName, EbayReconCategory, EbayReconItem } from '@admin/shared';

const CATEGORY_BADGES: Record<EbayReconCategory, { label: string; className: string }> = {
  unmanaged: { label: 'Unmanaged (client)', className: 'bg-blue-100 text-blue-800' },
  status_mismatch: { label: 'Status mismatch', className: 'bg-red-100 text-red-800' },
  managed_ghost: { label: 'Ghost (not on eBay)', className: 'bg-amber-100 text-amber-800' },
  unmatched_sku: { label: 'Unmatched SKU', className: 'bg-purple-100 text-purple-800' },
  oversell_suspect: { label: 'Oversell suspect', className: 'bg-red-200 text-red-900' },
  qty_mismatch: { label: 'Qty mismatch', className: 'bg-orange-100 text-orange-800' },
  price_mismatch: { label: 'Price mismatch', className: 'bg-yellow-100 text-yellow-800' },
  managed_ok: { label: 'OK', className: 'bg-green-100 text-green-800' },
};

/** Which bulk action makes sense per category filter (spec §8 point 4). */
const CATEGORY_ACTIONS: Partial<Record<EbayReconCategory, EbayReconActionName[]>> = {
  status_mismatch: ['reactivate'],
  managed_ghost: ['relist', 'mark_gone'],
  oversell_suspect: ['verify_oversell'],
  qty_mismatch: ['verify_oversell'],
};

const ageOf = (iso: string): { text: string; tone: 'ok' | 'warn' | 'bad' } => {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 24) return { text: `${Math.round(hours)}h ago`, tone: 'ok' };
  if (hours < 48) return { text: `${Math.round(hours)}h ago`, tone: 'warn' };
  return { text: `${Math.round(hours / 24)}d ago`, tone: 'bad' };
};

export default function EbayReconciliationPage() {
  const { can } = usePermission();
  const canAct = can('marketplace-sync:reconcile');

  const [categoryFilter, setCategoryFilter] = useState<EbayReconCategory | null>(null);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<{ action: EbayReconActionName; itemIds: string[] } | null>(null);

  const summary = useEbayReconSummary();
  const refresh = useEbayReconRefresh();
  const { pagination, setPagination, sorting, setSorting, globalFilter, setGlobalFilter, queryParams } = useDataTable({
    pageSize: 25,
  });

  const items = useEbayReconItems({
    page: queryParams.page,
    limit: queryParams.limit,
    sortBy: queryParams.sortBy,
    sortOrder: queryParams.sortOrder,
    search: queryParams.search,
    category: categoryFilter ? [categoryFilter] : undefined,
  });

  const latest = summary.data?.latestRun ?? null;
  const running = summary.data?.runningRun ?? null;

  // Persist rowId -> itemId across visited pages so cross-page bulk selection
  // doesn't silently drop selections made on pages we've since navigated away from.
  const rowIdToItemIdRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const r of items.data?.rows ?? []) {
      rowIdToItemIdRef.current.set(String(r.id), r.itemId);
    }
  }, [items.data?.rows]);

  const selectedItemIds = useMemo(() => {
    const byRowId = rowIdToItemIdRef.current;
    return [...new Set(Object.keys(rowSelection).filter((k) => rowSelection[k]).map((k) => byRowId.get(k)).filter(Boolean))] as string[];
  }, [rowSelection, items.data]);

  const columns: ColumnDef<EbayReconItem>[] = useMemo(
    () => [
      {
        accessorKey: 'itemId',
        header: 'eBay ItemID',
        cell: ({ row }) => (
          <a
            href={`https://www.ebay.co.uk/itm/${row.original.itemId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {row.original.itemId}
            <ExternalLink className="h-3 w-3" />
          </a>
        ),
      },
      { accessorKey: 'sku', header: 'SKU', cell: ({ row }) => row.original.sku ?? '—' },
      {
        accessorKey: 'category',
        header: 'Category',
        cell: ({ row }) => {
          const b = CATEGORY_BADGES[row.original.category];
          return <Badge className={b.className}>{b.label}</Badge>;
        },
      },
      { accessorKey: 'dbListingStatus', header: 'DB status', cell: ({ row }) => row.original.dbListingStatus ?? '—' },
      {
        id: 'qty',
        header: 'Qty (DB ↔ eBay)',
        cell: ({ row }) => `${row.original.dbLastSyncedQty ?? '—'} ↔ ${row.original.ebayQtyAvailable ?? '—'}`,
      },
      {
        id: 'price',
        header: 'Price (DB ↔ eBay)',
        cell: ({ row }) => `${row.original.dbLastSyncedPrice ?? '—'} ↔ ${row.original.ebayPrice ?? '—'}`,
      },
      {
        accessorKey: 'browseStatus',
        header: 'Buyer view',
        cell: ({ row }) => {
          const r = row.original;
          if (!r.browseChecked) return <span className="text-muted-foreground">unchecked</span>;
          if (r.browseStatus === 'IN_STOCK') return <Badge className="bg-red-200 text-red-900">IN_STOCK ({r.browseQty ?? '?'})</Badge>;
          return <span>{r.browseStatus ?? 'unresolved'}</span>;
        },
      },
      {
        accessorKey: 'actionTaken',
        header: 'Last action',
        cell: ({ row }) =>
          row.original.actionTaken ? `${row.original.actionTaken} · ${row.original.actionBy ?? ''}` : '—',
      },
      { accessorKey: 'ebayTitle', header: 'Title', cell: ({ row }) => <span className="block max-w-[240px] truncate">{row.original.ebayTitle ?? '—'}</span> },
    ],
    [],
  );

  const cards: { key: EbayReconCategory | null; label: string; value: number | string }[] = [
    { key: null, label: 'Active on eBay', value: latest?.listingsFetched ?? '—' },
    { key: 'unmanaged', label: 'Unmanaged (client)', value: latest?.categoryCounts.unmanaged ?? 0 },
    { key: 'managed_ghost', label: 'Ghosts', value: latest?.categoryCounts.managed_ghost ?? 0 },
    { key: 'status_mismatch', label: 'Status mismatches', value: latest?.categoryCounts.status_mismatch ?? 0 },
    { key: 'oversell_suspect', label: 'Oversell suspects', value: latest?.categoryCounts.oversell_suspect ?? 0 },
    { key: 'qty_mismatch', label: 'Qty mismatches', value: latest?.categoryCounts.qty_mismatch ?? 0 },
  ];

  const availableActions = categoryFilter ? CATEGORY_ACTIONS[categoryFilter] ?? [] : [];

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">eBay Reconciliation</h1>
          {latest ? (
            <p className="text-sm text-muted-foreground">
              Snapshot run #{latest.runId} ·{' '}
              <Badge
                variant="outline"
                className={
                  ageOf(latest.startedAt).tone === 'ok'
                    ? 'text-green-700'
                    : ageOf(latest.startedAt).tone === 'warn'
                      ? 'text-amber-700'
                      : 'text-red-700'
                }
              >
                {ageOf(latest.startedAt).text}
              </Badge>{' '}
              · {latest.variationsFetched} SKUs across {latest.listingsFetched} listings
              {latest.browseUnchecked > 0 && (
                <span className="ml-2 text-amber-700">{latest.browseUnchecked} oversell suspects UNCHECKED (Browse cap)</span>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No completed snapshot yet — trigger a refresh.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => downloadEbayReconCsv({ category: categoryFilter ? [categoryFilter] : undefined, search: queryParams.search })}>
            <Download className="mr-1 h-4 w-4" /> CSV
          </Button>
          {canAct && (
            <Button onClick={() => refresh.mutate()} disabled={!!running || refresh.isPending}>
              <RefreshCw className={`mr-1 h-4 w-4 ${running ? 'animate-spin' : ''}`} />
              {running ? `Run #${running.runId} in progress…` : 'Refresh now'}
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards — click filters the table */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        {cards.map((c) => (
          <Card
            key={c.label}
            className={`cursor-pointer ${categoryFilter === c.key && c.key !== null ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setCategoryFilter(c.key === categoryFilter ? null : c.key)}
          >
            <CardHeader className="p-3 pb-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-1 text-xl font-semibold">{c.value}</CardContent>
          </Card>
        ))}
      </div>

      {/* Bulk action bar */}
      {canAct && availableActions.length > 0 && (
        <div className="flex items-center gap-2 rounded border bg-muted/40 p-2 text-sm">
          <span>{selectedItemIds.length} ItemID(s) selected</span>
          {selectedItemIds.length > 500 && (
            <span className="text-amber-700">Acting on first 500 of {selectedItemIds.length} selected</span>
          )}
          {availableActions.map((a) => (
            <Button
              key={a}
              size="sm"
              variant="outline"
              disabled={selectedItemIds.length === 0}
              onClick={() => setDialog({ action: a, itemIds: selectedItemIds.slice(0, 500) })}
            >
              {a.replace('_', ' ')}
            </Button>
          ))}
        </div>
      )}

      {/* Reconciliation table (server-side) */}
      <DataTable
        columns={columns}
        data={items.data?.rows ?? []}
        pageCount={items.data?.totalPages ?? 0}
        isLoading={items.isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        enableGlobalFilter
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        searchPlaceholder="Search ItemID / SKU / title…"
        enableRowSelection={canAct}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        getRowId={(row) => String(row.id)}
      />

      {/* Run history */}
      <Card>
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm">Run history</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 text-sm">
          {(summary.data?.previousRuns ?? []).length === 0 && <p className="text-muted-foreground">No previous runs.</p>}
          {(summary.data?.previousRuns ?? []).map((r) => (
            <div key={r.runId} className="flex items-center gap-3 border-b py-1 last:border-0">
              <Badge variant={r.status === 'completed' ? 'outline' : 'destructive'}>{r.status}</Badge>
              <span>#{r.runId}</span>
              <span className="text-muted-foreground">{new Date(r.startedAt).toLocaleString()}</span>
              <span className="text-muted-foreground">{r.triggerSource}{r.triggeredBy ? ` · ${r.triggeredBy}` : ''}</span>
              <span>{r.listingsFetched} listings</span>
              {r.errorMessage && <span className="truncate text-red-700">{r.errorMessage}</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      {dialog && (
        <ReconActionDialog
          action={dialog.action}
          itemIds={dialog.itemIds}
          runId={items.data?.runId}
          onClose={() => {
            setDialog(null);
            setRowSelection({});
          }}
        />
      )}
    </div>
  );
}
