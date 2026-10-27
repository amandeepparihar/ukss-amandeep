import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { Play, ImageIcon } from 'lucide-react';
import { useSummary, useRunCron } from './hooks/useDailyDeals';
import { BannerConfigDialog } from './BannerConfigDialog';

export function DealsSalesReport() {
  const { data, isLoading } = useSummary();
  const summary = data?.data;
  const runCron = useRunCron();

  const [showConfirm, setShowConfirm] = useState(false);
  const [cronResult, setCronResult] = useState<any>(null);
  const [bannerConfigOpen, setBannerConfigOpen] = useState(false);

  const handleRunCron = () => {
    runCron.mutate(
      { dryRun: false },
      {
        onSuccess: (data) => {
          setCronResult(data?.data);
        },
      },
    );
    setShowConfirm(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 flex-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? '...' : `£${(summary?.totalRevenue || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Units Sold</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? '...' : summary?.totalUnitsSold || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Deals Run</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? '...' : summary?.totalDealsRun || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Today</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? '...' : summary?.todayActiveCount || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? '...' : summary?.upcomingCount || 0}
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="ml-4 flex flex-col gap-2">
          <Button
            onClick={() => setBannerConfigOpen(true)}
            variant="outline"
          >
            <ImageIcon className="h-4 w-4 mr-2" />
            Banner Config
          </Button>
          <Button
            onClick={() => setShowConfirm(true)}
            disabled={runCron.isPending}
            variant="outline"
          >
            <Play className="h-4 w-4 mr-2" />
            {runCron.isPending ? 'Running...' : 'Run Cron Now'}
          </Button>
        </div>
      </div>

      {/* Cron result log */}
      {cronResult && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Cron Execution Result</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs space-y-1 font-mono bg-muted p-3 rounded max-h-[200px] overflow-auto">
              {cronResult.log?.map((line: string, i: number) => (
                <div key={i}>{line}</div>
              ))}
            </div>
            <div className="mt-2 flex gap-4 text-sm">
              <span>Deactivated: <strong>{cronResult.deactivated}</strong></span>
              <span>Activated: <strong>{cronResult.activated}</strong></span>
              <span>Rolled Over: <strong>{cronResult.rolledOver}</strong></span>
              <span>Total Active: <strong>{cronResult.totalActive}</strong></span>
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setCronResult(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <BannerConfigDialog open={bannerConfigOpen} onOpenChange={setBannerConfigOpen} />

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run Daily Deals Cron</AlertDialogTitle>
            <AlertDialogDescription>
              This will activate/deactivate deals, perform rollover, and update category mappings for today. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRunCron}>Run Now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
