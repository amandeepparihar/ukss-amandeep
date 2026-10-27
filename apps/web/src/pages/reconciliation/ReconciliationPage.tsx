import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  ClipboardCheck,
  Download,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';

import { RunReconciliationDialog } from './RunReconciliationDialog';
import { ReconciliationLogsTab } from './ReconciliationLogsTab';
import { ReconciliationScheduleBar } from './ReconciliationScheduleBar';
import { MarketplaceOrderLink, UkssOrderLink } from './OrderLinks';
import { AuditTab } from './AuditTab';
import { SummaryCard } from './SummaryCard';
import { downloadBlobExport, formatDateTime } from './utils';

// ─── Types ───────────────────────────────────────────────────

interface ReconciliationStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
  triggeredBy?: string;
}

interface MissingOrderDetail {
  orderId: string;
  storeName: string;
  orderDate: string;
  marketplaceUrl?: string;
}

interface ProductMismatchDetail {
  orderId: string;
  storeName: string;
  apiQuantity: number;
  dbQuantity: number;
  ukssOrderId?: string;
  marketplaceUrl?: string;
}

interface StuckStatusDetail {
  mopId: string;
  orderId: string;
  storeName: string;
  statusToUpdate: string;
  waitingSinceHours: number;
  ukssOrderId?: string;
  marketplaceUrl?: string;
}

interface UnconvertedOrderDetail {
  moId: string;
  orderId: string;
  storeName: string;
  orderDate: string;
  ageHours: number;
  marketplaceUrl?: string;
}

interface MarketplaceResult {
  marketplace: string;
  storeCount: number;
  apiError?: string;
  missingOrders?: {
    apiOrderCount: number;
    dbOrderCount: number;
    missingOrders: MissingOrderDetail[];
  };
  missingProducts?: {
    mismatches: ProductMismatchDetail[];
  };
  statusSync: {
    stuckStatuses: StuckStatusDetail[];
  };
  unconvertedOrders: {
    unconvertedOrders: UnconvertedOrderDetail[];
  };
}

interface ReconciliationReport {
  runDate: string;
  windowHours: number;
  stuckThresholdHours: number;
  unconvertedThresholdHours: number;
  results: MarketplaceResult[];
  summary: {
    totalMissing: number;
    totalProductMismatches: number;
    totalStuck: number;
    totalUnconverted: number;
    hasIssues: boolean;
  };
}

interface LastRunData {
  report: ReconciliationReport;
  metadata: {
    triggeredBy: string;
    triggeredAt: string;
    completedAt: string;
    durationMs: number;
    source: string;
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function issueCountForMarketplace(r: MarketplaceResult): number {
  return (
    (r.missingOrders?.missingOrders.length ?? 0) +
    (r.missingProducts?.mismatches.length ?? 0) +
    r.statusSync.stuckStatuses.length +
    r.unconvertedOrders.unconvertedOrders.length
  );
}

async function handleExportDownload(format: 'csv' | 'xlsx') {
  try {
    await downloadBlobExport(`/reconciliation/export?format=${format}`, `reconciliation.${format}`);
  } catch {
    // Error handled by caller
  }
}

// ─── Sub-components ──────────────────────────────────────────

function StatusBadge({ status }: { status: ReconciliationStatus['status'] }) {
  switch (status) {
    case 'running':
      return (
        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Running
        </Badge>
      );
    case 'completed':
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
          <CheckCircle className="mr-1 h-3 w-3" />
          Completed
        </Badge>
      );
    case 'failed':
      return (
        <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
          <XCircle className="mr-1 h-3 w-3" />
          Failed
        </Badge>
      );
    default:
      return <Badge variant="outline">Idle</Badge>;
  }
}

function MarketplaceTab({ result }: { result: MarketplaceResult }) {
  const issues = issueCountForMarketplace(result);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>{result.marketplace}</CardTitle>
            <Badge variant="outline">{result.storeCount} store{result.storeCount !== 1 ? 's' : ''}</Badge>
          </div>
          {issues > 0 ? (
            <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
              {issues} issue{issues !== 1 ? 's' : ''}
            </Badge>
          ) : (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              No issues
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* API Error */}
        {result.apiError && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>API Error</AlertTitle>
            <AlertDescription>{result.apiError}</AlertDescription>
          </Alert>
        )}

        {/* Order counts */}
        {result.missingOrders && (
          <p className="text-sm text-muted-foreground">
            API: <span className="font-medium text-foreground">{result.missingOrders.apiOrderCount}</span>
            {' | '}
            DB: <span className="font-medium text-foreground">{result.missingOrders.dbOrderCount}</span>
          </p>
        )}

        {/* Missing Orders */}
        {result.missingOrders && result.missingOrders.missingOrders.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="mb-2 font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Missing Orders ({result.missingOrders.missingOrders.length})
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Marketplace Order ID</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Order Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.missingOrders.missingOrders.map((o) => (
                    <TableRow key={o.orderId}>
                      <TableCell>
                        <MarketplaceOrderLink orderId={o.orderId} url={o.marketplaceUrl} />
                      </TableCell>
                      <TableCell>{o.storeName}</TableCell>
                      <TableCell>{formatDateTime(o.orderDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {/* Product Mismatches */}
        {result.missingProducts && result.missingProducts.mismatches.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="mb-2 font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Product Mismatches ({result.missingProducts.mismatches.length})
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Marketplace Order ID</TableHead>
                    <TableHead>UKSS Order ID</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>API Qty</TableHead>
                    <TableHead>DB Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.missingProducts.mismatches.map((m) => (
                    <TableRow key={m.orderId}>
                      <TableCell>
                        <MarketplaceOrderLink orderId={m.orderId} url={m.marketplaceUrl} />
                      </TableCell>
                      <TableCell>
                        <UkssOrderLink ukssOrderId={m.ukssOrderId} />
                      </TableCell>
                      <TableCell>{m.storeName}</TableCell>
                      <TableCell>{m.apiQuantity}</TableCell>
                      <TableCell>{m.dbQuantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {/* Stuck Statuses */}
        {result.statusSync.stuckStatuses.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="mb-2 font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-500" />
                Stuck Statuses ({result.statusSync.stuckStatuses.length})
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Marketplace Order ID</TableHead>
                    <TableHead>UKSS Order ID</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Waiting (hrs)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.statusSync.stuckStatuses.map((s) => (
                    <TableRow key={s.mopId}>
                      <TableCell>
                        <MarketplaceOrderLink orderId={s.orderId} url={s.marketplaceUrl} />
                      </TableCell>
                      <TableCell>
                        <UkssOrderLink ukssOrderId={s.ukssOrderId} />
                      </TableCell>
                      <TableCell>{s.storeName}</TableCell>
                      <TableCell>{s.statusToUpdate}</TableCell>
                      <TableCell>{s.waitingSinceHours.toFixed(1)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {/* Unconverted Orders */}
        {result.unconvertedOrders.unconvertedOrders.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="mb-2 font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-500" />
                Unconverted Orders ({result.unconvertedOrders.unconvertedOrders.length})
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Marketplace Order ID</TableHead>
                    <TableHead>UKSS Order ID</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead>Age (hrs)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.unconvertedOrders.unconvertedOrders.map((u) => (
                    <TableRow key={u.moId}>
                      <TableCell>
                        <MarketplaceOrderLink orderId={u.orderId} url={u.marketplaceUrl} />
                      </TableCell>
                      <TableCell>
                        <UkssOrderLink ukssOrderId={null} />
                      </TableCell>
                      <TableCell>{u.storeName}</TableCell>
                      <TableCell>{formatDateTime(u.orderDate)}</TableCell>
                      <TableCell>{u.ageHours.toFixed(1)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {/* All clear */}
        {issues === 0 && !result.apiError && (
          <p className="text-sm text-muted-foreground">All checks passed. No issues found.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────

export function ReconciliationPage() {
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get('tab') ?? 'results';
  const activeMarketplace = searchParams.get('mp') ?? '';

  function handleTabChange(tab: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  }

  function handleMarketplaceChange(mp: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('mp', mp);
      return next;
    }, { replace: true });
  }

  // Poll status - 3s while running, 30s otherwise
  const { data: statusData } = useQuery<ReconciliationStatus>({
    queryKey: ['reconciliation-status'],
    queryFn: () => api.get('/reconciliation/status').then((r) => r.data.data),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 3000 : 30000,
  });

  // Fetch last run report (re-fetches when status transitions away from 'running')
  const { data: lastRunData, isLoading: isLoadingLastRun } = useQuery<LastRunData | null>({
    queryKey: ['reconciliation-last-run'],
    queryFn: () => api.get('/reconciliation/last-run').then((r) => r.data.data),
    enabled: statusData?.status !== 'running',
  });

  const isRunning = statusData?.status === 'running';
  const report = lastRunData?.report;
  const metadata = lastRunData?.metadata;

  return (
    <div>
      <PageHeader
        title="Order Reconciliation"
        description="Cross-check marketplace orders against the local database"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Reconciliation' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            {statusData && <StatusBadge status={statusData.status} />}

            {/* Export dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={!lastRunData}>
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleExportDownload('csv')}>
                  Export CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportDownload('xlsx')}>
                  Export Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Run Now button */}
            <Button
              onClick={() => setRunDialogOpen(true)}
              disabled={isRunning}
            >
              {isRunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Run Now
            </Button>
          </div>
        }
      />

      {/* Run configuration dialog */}
      <RunReconciliationDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        isRunning={isRunning}
      />

      {/* Running status bar */}
      {isRunning && statusData.startedAt && (
        <Alert className="mb-6 border-blue-200 bg-blue-50 text-blue-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertTitle>Reconciliation in progress</AlertTitle>
          <AlertDescription>
            Started at {formatDateTime(statusData.startedAt)}
            {statusData.triggeredBy && ` by ${statusData.triggeredBy}`}
          </AlertDescription>
        </Alert>
      )}

      {/* Failed status */}
      {statusData?.status === 'failed' && statusData.error && (
        <Alert variant="destructive" className="mb-6">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Reconciliation failed</AlertTitle>
          <AlertDescription>{statusData.error}</AlertDescription>
        </Alert>
      )}

      {/* No previous run */}
      {!isRunning && !isLoadingLastRun && !lastRunData && (
        <Alert className="mb-6">
          <ClipboardCheck className="h-4 w-4" />
          <AlertTitle>No reconciliation has been run yet</AlertTitle>
          <AlertDescription>
            Click &quot;Run Now&quot; to start the first check.
          </AlertDescription>
        </Alert>
      )}

      {/* Schedule info bar */}
      <div className="mb-6">
        <ReconciliationScheduleBar />
      </div>

      {/* Top-level tabs: Results | Logs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="audit">Order Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="results">
          {report && metadata && (
            <>
              {/* Summary cards */}
              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                <SummaryCard
                  title="Missing Orders"
                  count={report.summary.totalMissing}
                  variant="error"
                />
                <SummaryCard
                  title="Product Mismatches"
                  count={report.summary.totalProductMismatches}
                  variant="error"
                />
                <SummaryCard
                  title="Stuck Statuses"
                  count={report.summary.totalStuck}
                  variant="warning"
                />
                <SummaryCard
                  title="Unconverted Orders"
                  count={report.summary.totalUnconverted}
                  variant="warning"
                />
              </div>

              {/* Run metadata */}
              <p className="mb-6 text-sm text-muted-foreground">
                Last run: {formatDateTime(metadata.completedAt)} (took{' '}
                {formatDuration(metadata.durationMs)}) &middot; Triggered by{' '}
                {metadata.triggeredBy} &middot; Window: {report.windowHours}h
              </p>

              {/* Marketplace tabs */}
              {report.results.length > 0 && (
                <Tabs
                  value={
                    report.results.some((r) => r.marketplace === activeMarketplace)
                      ? activeMarketplace
                      : report.results[0].marketplace
                  }
                  onValueChange={handleMarketplaceChange}
                >
                  <TabsList className="mb-4">
                    {report.results.map((r) => {
                      const issues = issueCountForMarketplace(r);
                      return (
                        <TabsTrigger key={r.marketplace} value={r.marketplace}>
                          {r.marketplace}
                          {issues > 0 && (
                            <Badge
                              className="ml-2 bg-red-100 text-red-800 hover:bg-red-100"
                              variant="secondary"
                            >
                              {issues}
                            </Badge>
                          )}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                  {report.results.map((r) => (
                    <TabsContent key={r.marketplace} value={r.marketplace}>
                      <MarketplaceTab result={r} />
                    </TabsContent>
                  ))}
                </Tabs>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="logs">
          <ReconciliationLogsTab isRunning={isRunning} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
