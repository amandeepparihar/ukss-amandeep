/**
 * MarketplaceOrderSyncStatus Component
 *
 * Displays a table of marketplace order sync discrepancies. Each row shows
 * a store's total orders, synced count, mismatched count, and mismatch rate
 * with a colour-coded badge. Rows are expandable to reveal per-status-pair
 * detail breakdowns.
 *
 * Stores with 0 orders are excluded from the table.
 */

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { OrderSyncDiscrepancy } from '@admin/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarketplaceOrderSyncStatusProps {
  startDate: string;
  endDate: string;
  stores: number[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the badge variant based on mismatch rate thresholds.
 * 0% = success ("All synced"), < 5% = success, 5-10% = warning, > 10% = destructive
 */
function getMismatchBadgeVariant(rate: number): 'success' | 'warning' | 'destructive' {
  if (rate <= 5) return 'success';
  if (rate <= 10) return 'warning';
  return 'destructive';
}

/**
 * Returns the badge label for the mismatch rate.
 */
function getMismatchBadgeLabel(rate: number): string {
  if (rate === 0) return 'All synced';
  return `${rate.toFixed(1)}%`;
}

/**
 * Formats a number with locale-aware separators.
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SyncStatusSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function DetailSubTable({
  details,
}: {
  details: OrderSyncDiscrepancy['details'];
}) {
  if (details.length === 0) {
    return (
      <p className="py-2 text-center text-xs text-muted-foreground">
        No mismatch details available.
      </p>
    );
  }

  return (
    <div className="rounded-md border bg-muted/30">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Expected Status</TableHead>
            <TableHead className="text-xs">Marketplace Status</TableHead>
            <TableHead className="text-right text-xs">Count</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {details.map((detail, idx) => (
            <TableRow key={idx}>
              <TableCell className="text-xs">{detail.expectedStatus}</TableCell>
              <TableCell className="text-xs">{detail.marketplaceStatus}</TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {formatNumber(detail.count)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MarketplaceOrderSyncStatus({
  startDate,
  endDate,
  stores,
}: MarketplaceOrderSyncStatusProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // ---- Data fetching ----
  const { data, isLoading, isError, error } = useQuery<OrderSyncDiscrepancy[]>({
    queryKey: ['order-sync-status', startDate, endDate, stores],
    queryFn: () =>
      api
        .get('/sales-dashboard/order-sync-status', {
          params: {
            startDate,
            endDate,
            stores: stores.join(','),
          },
        })
        .then((r) => r.data.data),
  });

  // ---- Toggle row expansion ----
  const toggleRow = (storeId: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) {
        next.delete(storeId);
      } else {
        next.add(storeId);
      }
      return next;
    });
  };

  // Filter out stores with 0 orders
  const filteredData = data?.filter((store) => store.totalOrders > 0) ?? [];

  // ---- Loading state ----
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Marketplace Order Sync Status</CardTitle>
        </CardHeader>
        <CardContent>
          <SyncStatusSkeleton />
        </CardContent>
      </Card>
    );
  }

  // ---- Error state ----
  if (isError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Marketplace Order Sync Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>
              Failed to load order sync status
              {error instanceof Error ? `: ${error.message}` : '.'}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Empty state ----
  if (filteredData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Marketplace Order Sync Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            No marketplace order sync data for the selected period and stores.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ---- Render ----
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Marketplace Order Sync Status</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Store Name</TableHead>
              <TableHead className="text-right">Total Orders</TableHead>
              <TableHead className="text-right">Synced Correctly</TableHead>
              <TableHead className="text-right">Mismatched</TableHead>
              <TableHead className="text-right">Mismatch Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.map((store) => {
              const isExpanded = expandedRows.has(store.storeId);
              return (
                <Fragment key={store.storeId}>
                  <TableRow
                    className={cn('cursor-pointer', isExpanded && 'bg-muted/50')}
                    onClick={() => toggleRow(store.storeId)}
                  >
                    <TableCell className="w-8 px-2">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{store.storeName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(store.totalOrders)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(store.syncedCorrectly)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(store.mismatched)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={getMismatchBadgeVariant(store.mismatchRate)}>
                        {getMismatchBadgeLabel(store.mismatchRate)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={6} className="p-0">
                        <div className="px-8 py-3">
                          <DetailSubTable details={store.details} />
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
