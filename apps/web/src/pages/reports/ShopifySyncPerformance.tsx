import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { RefreshCw, Loader2, Bell, BellRing, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ShopifySyncPerfRow } from '@admin/shared';
import { useShopifySyncPerformance, useShopifySyncFailures } from './hooks/useShopifySyncPerformance';

const WINDOWS = [24, 48, 168] as const;
const n = (v: number) => v.toLocaleString('en-GB');
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB') : 'Never');

function statusBadge(r: ShopifySyncPerfRow) {
  if (r.isStale) return <Badge variant="destructive">Stale — cron?</Badge>;
  if (r.failingSince) return <Badge variant="destructive">Failing</Badge>;
  if (r.failureTotal > 0) return <Badge variant="secondary">Some failures</Badge>;
  return <Badge variant="success">OK</Badge>;
}

/** Tiny inline sparkline of failures/hour (last point = most recent). */
function Sparkline({ row }: { row: ShopifySyncPerfRow }) {
  const pts = row.trend;
  if (pts.length === 0) return <span className="text-muted-foreground">—</span>;
  const max = Math.max(1, ...pts.map((p) => p.fails));
  return (
    <span className="inline-flex items-end gap-[1px] h-5" title="Failures / hour (48h)">
      {pts.map((p, i) => (
        <span key={i}
          className={cn('w-[2px]', p.fails > 0 ? 'bg-destructive' : 'bg-muted')}
          style={{ height: `${Math.max(2, (p.fails / max) * 20)}px` }} />
      ))}
    </span>
  );
}

function FailuresDrillDown({ storeId, windowHours }: { storeId: number; windowHours: number }) {
  const { data, isLoading } = useShopifySyncFailures(storeId, windowHours, true);
  const [downloading, setDownloading] = useState(false);
  async function downloadCsv() {
    setDownloading(true);
    try {
      const res = await api.get(
        `/reports/shopify-sync-performance/${storeId}/failures?windowHours=${windowHours}&format=csv`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shopify-sync-failures-${storeId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }
  if (isLoading) return <div className="p-3 text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading failing items…</div>;
  if (!data || data.rows.length === 0) return <div className="p-3 text-sm text-muted-foreground">No failing items in window.</div>;
  return (
    <div className="p-3 space-y-2 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{n(data.total)} failing item(s)</span>
        <Button size="sm" variant="outline" onClick={downloadCsv} disabled={downloading}>
          <Download className="mr-2 h-4 w-4" />{downloading ? 'Preparing…' : 'Export CSV'}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product ID</TableHead><TableHead>SKU</TableHead>
            <TableHead>Inventory Item</TableHead><TableHead>Status</TableHead>
            <TableHead>Last error</TableHead><TableHead>Last seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((f) => (
            <TableRow key={f.variationId}>
              <TableCell className="font-mono text-xs">{f.productId}</TableCell>
              <TableCell className="font-mono text-xs">{f.sku ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">{f.inventoryItemId ?? '—'}</TableCell>
              <TableCell>{f.productStatus ?? '—'}</TableCell>
              <TableCell className="max-w-[280px] truncate" title={f.lastMessage ?? ''}>{f.lastMessage ?? '—'}</TableCell>
              <TableCell className="whitespace-nowrap text-xs">{fmt(f.lastSeen)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ShopifySyncPerformance() {
  const [windowHours, setWindowHours] = useState<number>(24);
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useShopifySyncPerformance(windowHours);
  const [expanded, setExpanded] = useState<number | null>(null);

  // Opt-in browser alerts: fire when a store's failure count rises between refreshes.
  const [alertsOn, setAlertsOn] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted',
  );
  const prevFail = useRef<Map<number, number>>(new Map());

  async function enableAlerts() {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setAlertsOn(perm === 'granted');
  }

  useEffect(() => {
    if (!data) return;
    if (alertsOn && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const breaches: string[] = [];
      for (const r of data.rows) {
        const before = prevFail.current.get(r.storeId);
        if (r.isStale) breaches.push(`${r.storeName}: cron stale (last run ${fmt(r.lastRunAt)})`);
        else if (before !== undefined && r.failureTotal > before) {
          breaches.push(`${r.storeName}: failures ${n(before)} → ${n(r.failureTotal)}`);
        }
      }
      if (breaches.length > 0) new Notification('Shopify sync — attention needed', { body: breaches.join('\n') });
    }
    prevFail.current = new Map(data.rows.map((r) => [r.storeId, r.failureTotal]));
  }, [data, alertsOn]);

  const rows = data?.rows ?? [];
  const totals = rows.reduce((a, r) => {
    a.failing += r.failingSince ? 1 : 0;
    a.stale += r.isStale ? 1 : 0;
    a.healthy += (!r.failingSince && !r.isStale) ? 1 : 0;
    a.items += r.distinctFailingItems;
    return a;
  }, { failing: 0, stale: 0, healthy: 0, items: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {data ? <>Last refreshed {fmt(new Date(dataUpdatedAt).toISOString())} · live <code>shopify_tracking_history</code></> : 'Loading…'}
        </div>
        <div className="flex items-center gap-2">
          {WINDOWS.map((w) => (
            <Button key={w} size="sm" variant={windowHours === w ? 'secondary' : 'outline'} onClick={() => setWindowHours(w)}>
              {w === 168 ? '7d' : `${w}h`}
            </Button>
          ))}
          <Button variant={alertsOn ? 'secondary' : 'outline'} size="sm" onClick={enableAlerts}
            title="Browser notification when failures rise or a cron goes stale">
            {alertsOn ? <BellRing className="mr-2 h-4 w-4" /> : <Bell className="mr-2 h-4 w-4" />}
            {alertsOn ? 'Alerts on' : 'Enable alerts'}
          </Button>
          <Button size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Totals strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Healthy stores" value={totals.healthy} />
        <Kpi label="Failing stores" value={totals.failing} tone={totals.failing ? 'bad' : 'ok'} />
        <Kpi label="Stale (cron?)" value={totals.stale} tone={totals.stale ? 'bad' : 'ok'} />
        <Kpi label="Distinct failing items" value={totals.items} tone={totals.items ? 'warn' : 'ok'} />
      </div>

      {isError && <div className="text-sm text-destructive">Failed to load sync performance.</div>}
      {isLoading && <div className="text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading…</div>}

      {!isLoading && rows.length === 0 && (
        <div className="text-sm text-muted-foreground">No Shopify sync activity in this window.</div>
      )}

      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead></TableHead><TableHead>Store</TableHead><TableHead>Status</TableHead>
              <TableHead>Last run</TableHead><TableHead className="text-right">Success rate</TableHead>
              <TableHead className="text-right">Failing items</TableHead><TableHead>Failing since</TableHead>
              <TableHead>Trend (48h)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <Fragment key={r.storeId}>
                <TableRow className="cursor-pointer" onClick={() => setExpanded(expanded === r.storeId ? null : r.storeId)}>
                  <TableCell><ChevronRight className={cn('h-4 w-4 transition-transform', expanded === r.storeId && 'rotate-90')} /></TableCell>
                  <TableCell className="font-medium">{r.storeName}<span className="ml-1 text-xs text-muted-foreground">#{r.storeId}</span></TableCell>
                  <TableCell>{statusBadge(r)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmt(r.lastRunAt)}{r.minutesSinceLastRun !== null && <span className="ml-1 text-muted-foreground">({r.minutesSinceLastRun}m)</span>}</TableCell>
                  <TableCell className="text-right">{r.successRate}%</TableCell>
                  <TableCell className="text-right">{n(r.distinctFailingItems)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{r.failingSince ? fmt(r.failingSince) : '—'}</TableCell>
                  <TableCell><Sparkline row={r} /></TableCell>
                </TableRow>
                {expanded === r.storeId && (
                  <TableRow>
                    <TableCell colSpan={8} className="p-0">
                      <div className="px-2 pb-2 text-xs text-muted-foreground">
                        {r.errorBuckets.map((b) => (
                          <Badge key={b.key} variant="outline" className="mr-1" title={b.sampleMessage}>{b.label}: {n(b.count)}</Badge>
                        ))}
                      </div>
                      <FailuresDrillDown storeId={r.storeId} windowHours={windowHours} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function Kpi({ label, value, tone = 'ok' }: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-2xl font-semibold', tone === 'bad' && 'text-destructive', tone === 'warn' && 'text-amber-600')}>
        {n(value)}
      </div>
    </div>
  );
}
