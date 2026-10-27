import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';

interface MarketplaceCounts {
  total: number;
  active: number;
  notCreatedOnMarketplace: number;
  synced: number;
  failed: number;
  syncNotAllowed: number;
}

interface MarketplaceData {
  name: string;
  marketplaceId: string;
  storeId: number;
  pattern: string;
  productCreationMethod: string;
  counts: MarketplaceCounts;
}

interface DashboardResponse {
  data: {
    marketplaces: MarketplaceData[];
  };
}

function StatItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${color}`}>{value.toLocaleString()}</span>
    </div>
  );
}

function MarketplaceCard({ marketplace }: { marketplace: MarketplaceData }) {
  const { counts } = marketplace;

  const patternVariant = marketplace.pattern === 'feed' ? 'secondary' : 'default';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{marketplace.name}</CardTitle>
          <Badge variant={patternVariant}>{marketplace.pattern}</Badge>
        </div>
        <CardDescription className="text-xs leading-relaxed">
          {marketplace.productCreationMethod}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          <StatItem label="Total" value={counts.total} color="text-foreground" />
          <StatItem label="Active" value={counts.active} color="text-blue-600 dark:text-blue-400" />
          <StatItem label="Not Created on Marketplace" value={counts.notCreatedOnMarketplace} color="text-muted-foreground" />
          <StatItem label="Synced" value={counts.synced} color="text-green-600 dark:text-green-400" />
          <StatItem label="Failed" value={counts.failed} color="text-red-600 dark:text-red-400" />
          <StatItem label="Sync Not Allowed" value={counts.syncNotAllowed} color="text-amber-600 dark:text-amber-400" />
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-8 w-full mt-2" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[1, 2, 3, 4, 5, 6].map((j) => (
                <div key={j} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function MarketplaceDashboardPage() {
  const { data, isLoading, error } = useQuery<DashboardResponse>({
    queryKey: ['marketplace-dashboard'],
    queryFn: () => api.get('/marketplaces/dashboard').then((res) => res.data),
    staleTime: 30_000,
  });

  const marketplaces = data?.data?.marketplaces ?? [];

  return (
    <div>
      <PageHeader
        title="Marketplace Dashboard"
        description="Overview of marketplace product listings and sync status"
      />

      {isLoading && <LoadingSkeleton />}

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 p-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Failed to load dashboard data</p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'An unexpected error occurred'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {marketplaces.map((marketplace) => (
            <MarketplaceCard key={marketplace.marketplaceId} marketplace={marketplace} />
          ))}
        </div>
      )}
    </div>
  );
}

export default MarketplaceDashboardPage;
