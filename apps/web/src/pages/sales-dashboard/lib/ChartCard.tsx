import type { ReactNode } from 'react';
import { AlertCircle, BarChart3 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ChartCardProps {
  title: string;
  description?: string;
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  onRetry?: () => void;
}

export function ChartCard({
  title,
  description,
  isLoading,
  isError,
  isEmpty,
  actions,
  children,
  className,
  onRetry,
}: ChartCardProps) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </CardHeader>

      <CardContent className="flex-1">
        {isLoading ? (
          <LoadingSkeleton />
        ) : isError ? (
          <ErrorState onRetry={onRetry} />
        ) : isEmpty ? (
          <EmptyState />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-[200px] w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center gap-3 text-muted-foreground">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="text-sm font-medium">Failed to load chart data</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center gap-3 text-muted-foreground">
      <BarChart3 className="h-8 w-8" />
      <p className="text-sm font-medium">No data for this period</p>
    </div>
  );
}

export default ChartCard;
