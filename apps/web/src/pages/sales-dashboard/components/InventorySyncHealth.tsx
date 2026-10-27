import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
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
import type { SyncHealthResponse, ShopifySyncStatus, MarketplaceSyncStatus } from '@admin/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO date string to a human-readable en-GB locale string.
 * Returns "Never run" when the date is null.
 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never run';
  return new Date(dateStr).toLocaleString('en-GB');
}

/**
 * Format a percentage to one decimal place with a percent sign.
 */
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Loading State
// ---------------------------------------------------------------------------

function SyncHealthSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-56" />
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Error State
// ---------------------------------------------------------------------------

function SyncHealthError() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Inventory Sync Health</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-destructive">
            Unable to load sync health data. Please try refreshing.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Shopify Stores Table
// ---------------------------------------------------------------------------

function ShopifyStoresTable({ stores }: { stores: ShopifySyncStatus[] }) {
  if (stores.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">No Shopify stores configured</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Store</TableHead>
            <TableHead className="text-right">Active Products</TableHead>
            <TableHead className="text-right">Pending Sync</TableHead>
            <TableHead className="text-right">Failed</TableHead>
            <TableHead className="text-right">Out of Sync</TableHead>
            <TableHead>Last Cron Run</TableHead>
            <TableHead>Health</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stores.map((store) => (
            <TableRow
              key={store.storeId}
              className={cn(!store.isHealthy && 'bg-red-50 dark:bg-red-950/30')}
            >
              <TableCell className="font-medium">{store.storeName}</TableCell>
              <TableCell className="text-right tabular-nums">
                {store.totalActiveProducts.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {store.pendingSync.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {store.failedSync.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {store.outOfSyncItems.toLocaleString()}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {formatDate(store.lastCronRun)}
              </TableCell>
              <TableCell>
                <Badge variant={store.isHealthy ? 'success' : 'destructive'}>
                  {store.isHealthy ? 'Healthy' : 'Unhealthy'}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marketplace Listings Table
// ---------------------------------------------------------------------------

function MarketplaceListingsTable({ listings }: { listings: MarketplaceSyncStatus[] }) {
  if (listings.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">No marketplace listings found</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Store</TableHead>
            <TableHead className="text-right">Active Listings</TableHead>
            <TableHead className="text-right">Success Rate</TableHead>
            <TableHead className="text-right">Failed</TableHead>
            <TableHead className="text-right">Out of Sync</TableHead>
            <TableHead>Last Sync</TableHead>
            <TableHead>Health</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listings.map((listing) => (
            <TableRow
              key={listing.storeId}
              className={cn(!listing.isHealthy && 'bg-red-50 dark:bg-red-950/30')}
            >
              <TableCell className="font-medium">{listing.storeName}</TableCell>
              <TableCell className="text-right tabular-nums">
                {listing.totalActiveListings.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPercent(listing.syncSuccessRate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {listing.failedSyncs.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {listing.outOfSyncItems.toLocaleString()}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {formatDate(listing.lastSyncTime)}
              </TableCell>
              <TableCell>
                <Badge variant={listing.isHealthy ? 'success' : 'destructive'}>
                  {listing.isHealthy ? 'Healthy' : 'Unhealthy'}
                </Badge>
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

/**
 * InventorySyncHealth displays a real-time snapshot of inventory sync status
 * across Shopify stores and marketplace listings.
 *
 * Two sections:
 * - Shopify Stores: shows product sync status and cron run health.
 * - Marketplace Listings: shows listing sync success rates and health.
 *
 * Rows with unhealthy status are highlighted with a red background.
 */
export function InventorySyncHealth() {
  const { data, isLoading, isError } = useQuery<SyncHealthResponse>({
    queryKey: ['sync-health'],
    queryFn: () =>
      api.get('/sales-dashboard/sync-health').then((r) => r.data.data),
  });

  if (isLoading) {
    return <SyncHealthSkeleton />;
  }

  if (isError) {
    return <SyncHealthError />;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Inventory Sync Health</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Shopify Stores Section */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Shopify Stores</h3>
          <ShopifyStoresTable stores={data?.shopify ?? []} />
        </div>

        {/* Marketplace Listings Section */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Marketplace Listings</h3>
          <MarketplaceListingsTable listings={data?.marketplace ?? []} />
        </div>
      </CardContent>
    </Card>
  );
}
