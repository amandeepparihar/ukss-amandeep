import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

// ---- Types ----

interface LastRunInfo {
  timestamp: string;
  triggeredBy: string;
  durationMs: number;
  issueCount: number;
}

interface MarketplaceSchedule {
  name: string;
  lastRun: LastRunInfo | null;
  nextScheduledRun: string | null;
}

interface ScheduleResponse {
  marketplaces: MarketplaceSchedule[];
}

// ---- Helpers ----

function formatDurationSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  // Show relative time for recent runs (< 24h), otherwise show formatted date
  if (diffHours < 24) {
    return formatDistanceToNow(date, { addSuffix: true });
  }
  return format(date, 'd MMM yyyy, HH:mm');
}

function formatNextRun(iso: string): string {
  return format(new Date(iso), 'd MMM yyyy, HH:mm');
}

function issueCountColor(count: number): string {
  if (count === 0) return 'text-green-600';
  if (count <= 5) return 'text-amber-600';
  return 'text-red-600';
}

// ---- Loading Skeleton ----

function ScheduleCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-20" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </CardContent>
    </Card>
  );
}

// ---- Schedule Card ----

function ScheduleCard({ marketplace }: { marketplace: MarketplaceSchedule }) {
  const { name, lastRun, nextScheduledRun } = marketplace;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {name.toUpperCase()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {lastRun ? (
          <>
            <p className="text-sm">
              <span className="text-muted-foreground">Last run: </span>
              <span title={new Date(lastRun.timestamp).toLocaleString()}>
                {formatTimestamp(lastRun.timestamp)}
              </span>
            </p>
            <p className="text-muted-foreground text-sm">
              by {lastRun.triggeredBy} &middot; {formatDurationSeconds(lastRun.durationMs)} &middot;{' '}
              <span className={issueCountColor(lastRun.issueCount)}>
                {lastRun.issueCount} issue{lastRun.issueCount !== 1 ? 's' : ''}
              </span>
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">Never run</p>
        )}

        <p className="text-muted-foreground text-sm">
          <span>Next: </span>
          {nextScheduledRun ? (
            <span title={new Date(nextScheduledRun).toLocaleString()}>
              {formatNextRun(nextScheduledRun)}
            </span>
          ) : (
            <span>N/A</span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

// ---- Main Component ----

export function ReconciliationScheduleBar() {
  const { data, isLoading } = useQuery<ScheduleResponse>({
    queryKey: ['reconciliation-schedule'],
    queryFn: () => api.get('/reconciliation/schedule').then((r) => r.data.data),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ScheduleCardSkeleton />
        <ScheduleCardSkeleton />
        <ScheduleCardSkeleton />
        <ScheduleCardSkeleton />
      </div>
    );
  }

  if (!data?.marketplaces?.length) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {data.marketplaces.map((mp) => (
        <ScheduleCard key={mp.name} marketplace={mp} />
      ))}
    </div>
  );
}
