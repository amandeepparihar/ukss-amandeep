import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Loader2, Bell, BellRing, AlertTriangle, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
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
import { cn } from '@/lib/utils';
import type { MarketplaceSyncPerfRow } from '@admin/shared';
import {
  useMarketplaceSyncPerformance,
  useResetFailedMarketplaceListings,
} from './hooks/useMarketplaceSyncPerformance';

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-GB');
}

/** Minutes since an ISO timestamp, or null. */
function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

type Severity = 'oversell' | 'stuck' | 'failures' | 'ok';

function severityOf(r: MarketplaceSyncPerfRow): Severity {
  if (r.oversellRisk > 0) return 'oversell';
  if (r.stuckTotal > 0) return 'stuck';
  if (r.failedTotal > 0) return 'failures';
  return 'ok';
}

function StatusBadge({ severity }: { severity: Severity }) {
  switch (severity) {
    case 'oversell':
      return <Badge variant="destructive">Oversell risk</Badge>;
    case 'stuck':
      return <Badge variant="destructive">Stuck — needs fixing</Badge>;
    case 'failures':
      return <Badge variant="secondary">Failures</Badge>;
    default:
      return <Badge variant="success">OK</Badge>;
  }
}

const n = (v: number) => v.toLocaleString('en-GB');

export function MarketplaceSyncPerformance() {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } =
    useMarketplaceSyncPerformance();
  const [resetTarget, setResetTarget] = useState<MarketplaceSyncPerfRow | null>(null);

  const resetMutation = useResetFailedMarketplaceListings();
  const handleReset = (storeId: number) => resetMutation.mutate(storeId, {
    onSuccess: ({ resetCount }) => {
      toast.success(`${n(resetCount)} failed listing${resetCount === 1 ? '' : 's'} reset to pending`);
      setResetTarget(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reset marketplace listings');
    },
  });

  // ── Browser alerting ──────────────────────────────────────────────────────
  // Fire a notification when, between refreshes, a marketplace develops an
  // oversell risk or its stuck-listing count rises. Opt-in (manual permission).
  const [alertsOn, setAlertsOn] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted',
  );
  const prevStuck = useRef<Map<number, number>>(new Map());

  async function enableAlerts() {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setAlertsOn(perm === 'granted');
  }

  useEffect(() => {
    if (!data) return;
    const rows = data.rows;
    if (alertsOn && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const breaches: string[] = [];
      for (const r of rows) {
        const before = prevStuck.current.get(r.storeId);
        if (r.oversellRisk > 0) {
          breaches.push(`${r.storeName}: ${n(r.oversellRisk)} oversell-risk listing(s)`);
        } else if (before !== undefined && r.stuckTotal > before) {
          breaches.push(`${r.storeName}: stuck listings ${n(before)} → ${n(r.stuckTotal)}`);
        }
      }
      if (breaches.length > 0) {
        new Notification('Marketplace sync — attention needed', {
          body: breaches.join('\n'),
        });
      }
    }
    // Update snapshot for next comparison regardless of alert state.
    prevStuck.current = new Map(rows.map((r) => [r.storeId, r.stuckTotal]));
  }, [data, alertsOn]);

  // ── Totals strip ──────────────────────────────────────────────────────────
  const rows = data?.rows ?? [];
  const totals = rows.reduce(
    (acc, r) => {
      acc.syncedToday += r.syncedToday;
      acc.failed += r.failedTotal;
      acc.stuck += r.stuckTotal;
      acc.oversell += r.oversellRisk;
      acc.pending += r.pendingTotal;
      return acc;
    },
    { syncedToday: 0, failed: 0, stuck: 0, oversell: 0, pending: 0 },
  );

  return (
    <div className="space-y-4">
      {/* Header / controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {data
            ? <>Last refreshed {formatDateTime(new Date(dataUpdatedAt).toISOString())}</>
            : 'Loading…'}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={alertsOn ? 'secondary' : 'outline'}
            size="sm"
            onClick={enableAlerts}
            title="Get a browser notification when an oversell risk appears or stuck listings increase"
          >
            {alertsOn ? <BellRing className="mr-2 h-4 w-4" /> : <Bell className="mr-2 h-4 w-4" />}
            {alertsOn ? 'Alerts on' : 'Enable alerts'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Caveat: what the daily numbers mean */}
      <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Daily counts show SKUs whose <strong>most recent successful sync</strong> fell on
          that day — not how many times they synced. A SKU that syncs every day appears only
          under “Today”. Use the <strong>Failed</strong>, <strong>Stuck</strong> and{' '}
          <strong>Oversell risk</strong> columns as the reliable “is it working?” signals.
          Stuck listings (≥ {data?.stuckThreshold ?? 3} consecutive failures) are not retried
          automatically — they need a manual fix.
        </p>
      </div>

      {isError && (
        <Card><CardContent className="py-10 text-center text-sm text-destructive">
          Unable to load sync performance. Try refreshing.
        </CardContent></Card>
      )}

      {/* Totals strip */}
      {!isError && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Synced today" value={totals.syncedToday} />
          <StatCard label="Pending" value={totals.pending} />
          <StatCard label="Failed" value={totals.failed} tone={totals.failed > 0 ? 'warn' : undefined} />
          <StatCard label="Stuck (manual fix)" value={totals.stuck} tone={totals.stuck > 0 ? 'warn' : undefined} />
          <StatCard label="Oversell risk" value={totals.oversell} tone={totals.oversell > 0 ? 'danger' : undefined} />
        </div>
      )}

      {/* Health + daily activity table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Per-marketplace sync health</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table className="border-collapse border [&_th]:border [&_td]:border [&_th]:px-3 [&_td]:px-3">
            <TableHeader>
              <TableRow>
                <TableHead>Marketplace</TableHead>
                <TableHead className="text-right">Live</TableHead>
                <TableHead className="text-right">Success rate</TableHead>
                <TableHead className="text-right">Today</TableHead>
                <TableHead className="text-right">Yesterday</TableHead>
                <TableHead className="text-right">Day before</TableHead>
                <TableHead className="text-right">Last 3 days</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Stuck</TableHead>
                <TableHead className="text-right">Oversell</TableHead>
                <TableHead>Last sync</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={14} className="py-8 text-center">Loading…</TableCell></TableRow>
              )}
              {!isLoading && rows.length === 0 && !isError && (
                <TableRow><TableCell colSpan={14} className="py-8 text-center">No marketplace listings found.</TableCell></TableRow>
              )}
              {rows.map((r) => {
                const sev = severityOf(r);
                const mins = minutesSince(r.lastSyncTime);
                const isResetting = resetMutation.isPending && resetMutation.variables === r.storeId;
                return (
                  <TableRow
                    key={r.storeId}
                    className={cn(sev === 'oversell' && 'bg-red-50 dark:bg-red-950/30')}
                  >
                    <TableCell className="font-medium">{r.storeName}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(r.live)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.successRate}%</TableCell>
                    <TableCell className="text-right tabular-nums">{n(r.syncedToday)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(r.syncedYesterday)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(r.syncedDayBefore)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(r.syncedLast3Days)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(r.pendingTotal)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', r.failedTotal > 0 && 'text-amber-700 dark:text-amber-400')}>{n(r.failedTotal)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', r.stuckTotal > 0 && 'font-semibold text-amber-700 dark:text-amber-400')}>{n(r.stuckTotal)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', r.oversellRisk > 0 && 'font-semibold text-destructive')}>{n(r.oversellRisk)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" title={formatDateTime(r.lastSyncTime)}>
                      {mins === null ? 'Never' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`}
                    </TableCell>
                    <TableCell><StatusBadge severity={sev} /></TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setResetTarget(r)}
                        disabled={r.failedTotal === 0 || resetMutation.isPending}
                        title="Reset failed listings for this marketplace to pending"
                      >
                        {isResetting
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : <RotateCcw className="mr-2 h-4 w-4" />}
                        Reset
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Errors to fix */}
      {rows.some((r) => r.topErrors.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top failures to triage (by error code)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {rows.filter((r) => r.topErrors.length > 0).map((r) => (
              <div key={r.storeId} className="space-y-1.5">
                <div className="text-sm font-medium">{r.storeName}</div>
                <Table className="border-collapse border [&_th]:border [&_td]:border [&_th]:px-3 [&_td]:px-3 [&_th]:py-1.5 [&_td]:py-1.5">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">Code</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead className="w-20 text-right">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.topErrors.map((e) => {
                      const isOversell = e.code === 'VALIDATION_NEGATIVE_STOCK';
                      return (
                        <TableRow key={e.code} className={cn(isOversell && 'bg-red-50 dark:bg-red-950/30')}>
                          <TableCell className="align-top">
                            <span className={cn('font-mono text-xs', isOversell && 'font-semibold text-destructive')}>
                              {e.code}
                            </span>
                          </TableCell>
                          <TableCell className="align-top text-sm" title={e.message || undefined}>
                            {e.message || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="align-top text-right tabular-nums">{n(e.count)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={!!resetTarget}
        onOpenChange={(open) => {
          if (!open && !resetMutation.isPending) setResetTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset failed marketplace listings</AlertDialogTitle>
            <AlertDialogDescription>
              This will set {n(resetTarget?.failedTotal ?? 0)} failed listing
              {(resetTarget?.failedTotal ?? 0) === 1 ? '' : 's'} for {resetTarget?.storeName} back to pending
              and clear their retry count and API error fields.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetMutation.isPending}
              onClick={() => resetTarget && handleReset(resetTarget.storeId)}
            >
              {resetMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({
  label, value, tone,
}: { label: string; value: number; tone?: 'warn' | 'danger' }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn(
        'text-2xl font-semibold tabular-nums',
        tone === 'warn' && 'text-amber-700 dark:text-amber-400',
        tone === 'danger' && 'text-destructive',
      )}>
        {n(value)}
      </div>
    </div>
  );
}
