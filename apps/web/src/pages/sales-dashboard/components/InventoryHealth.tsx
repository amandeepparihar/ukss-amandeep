import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, XCircle, Clock, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
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
import type { InventoryHealthSummary, InventoryHealthItem } from '@admin/shared';

type Category = 'low-stock' | 'out-of-stock' | 'aging';

const PAGE_SIZE = 20;

interface InventoryHealthProps {
  onProductClick: (productCode: string) => void;
}

interface SummaryResponse {
  data: {
    summary: InventoryHealthSummary;
  };
}

interface DetailResponse {
  data: {
    items: InventoryHealthItem[];
  };
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

/**
 * Format a date string to a short locale date, or "Never sold" if null.
 */
function formatLastSaleDate(dateStr: string | null): string {
  if (!dateStr) return 'Never sold';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format days since last sale, or "N/A" if null.
 */
function formatDaysSinceLastSale(days: number | null): string {
  if (days === null) return 'N/A';
  if (days > 365) return '1+ year';
  return `${days}d`;
}

// =============================================================================
// Summary Cards
// =============================================================================

const CATEGORY_CONFIG: {
  key: Category;
  label: string;
  summaryKey: keyof InventoryHealthSummary;
  icon: React.ElementType;
  iconColor: string;
  activeRing: string;
}[] = [
  {
    key: 'low-stock',
    label: 'Low Stock Alerts',
    summaryKey: 'lowStock',
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    activeRing: 'ring-2 ring-amber-500',
  },
  {
    key: 'out-of-stock',
    label: 'Out of Stock',
    summaryKey: 'outOfStock',
    icon: XCircle,
    iconColor: 'text-red-500',
    activeRing: 'ring-2 ring-red-500',
  },
  {
    key: 'aging',
    label: 'Aging Inventory',
    summaryKey: 'agingInventory',
    icon: Clock,
    iconColor: 'text-orange-500',
    activeRing: 'ring-2 ring-orange-500',
  },
];

/**
 * InventoryHealth component for the Sales Dashboard.
 *
 * Displays three summary cards (Low Stock, Out of Stock, Aging Inventory)
 * and an expandable detail table when a category card is clicked.
 */
export function InventoryHealth({ onProductClick }: InventoryHealthProps) {
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [page, setPage] = useState(1);

  // Summary query - always fetched (no category param)
  const {
    data: summary,
    isLoading: loadingSummary,
  } = useQuery<InventoryHealthSummary>({
    queryKey: ['inventory-health-summary'],
    queryFn: () =>
      api
        .get<SummaryResponse>('/sales-dashboard/inventory-health')
        .then((r) => r.data.data.summary),
  });

  // Detail query - only when a category is active
  const {
    data: detailData,
    isLoading: loadingDetail,
    isError: errorDetail,
  } = useQuery<DetailResponse>({
    queryKey: ['inventory-health-detail', activeCategory, page],
    queryFn: () =>
      api
        .get<DetailResponse>('/sales-dashboard/inventory-health', {
          params: {
            category: activeCategory,
            page,
            pageSize: PAGE_SIZE,
          },
        })
        .then((r) => r.data),
    enabled: activeCategory !== null,
  });

  const handleCategoryClick = (category: Category) => {
    if (activeCategory === category) {
      // Deselect - hide the table
      setActiveCategory(null);
    } else {
      setActiveCategory(category);
      setPage(1);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Inventory Health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Cards */}
        {loadingSummary ? (
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {CATEGORY_CONFIG.map(({ key, label, summaryKey, icon: Icon, iconColor, activeRing }) => (
              <Card
                key={key}
                className={cn(
                  'cursor-pointer transition-all hover:shadow-md',
                  activeCategory === key && activeRing,
                )}
                onClick={() => handleCategoryClick(key)}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <div className={cn('h-8 w-8 rounded-lg bg-muted flex items-center justify-center', iconColor)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{label}</p>
                    <p className="text-2xl font-bold">
                      {(summary?.[summaryKey] ?? 0).toLocaleString()}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Detail Table */}
        {activeCategory !== null && (
          <DetailTable
            items={detailData?.data?.items ?? []}
            isLoading={loadingDetail}
            isError={errorDetail}
            page={page}
            totalPages={detailData?.meta?.totalPages ?? 1}
            total={detailData?.meta?.total ?? 0}
            onPageChange={setPage}
            onProductClick={onProductClick}
          />
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Detail Table
// =============================================================================

interface DetailTableProps {
  items: InventoryHealthItem[];
  isLoading: boolean;
  isError: boolean;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  onProductClick: (productCode: string) => void;
}

function DetailTable({
  items,
  isLoading,
  isError,
  page,
  totalPages,
  total,
  onPageChange,
  onProductClick,
}: DetailTableProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading items...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-destructive">
          Unable to load inventory data. Please try refreshing.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">No items found for this category.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Min Qty</TableHead>
              <TableHead>Last Sale Date</TableHead>
              <TableHead className="text-right">Days Since Sale</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.productCode}>
                <TableCell
                  className="cursor-pointer font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() => onProductClick(item.productCode)}
                >
                  {item.productCode}
                </TableCell>
                <TableCell className="max-w-[200px] truncate font-medium">
                  {item.productName}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.teamName ?? '-'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.quantity.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.minimumQuantity.toLocaleString()}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatLastSaleDate(item.lastSaleDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDaysSinceLastSale(item.daysSinceLastSale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString()} item{total !== 1 ? 's' : ''} total
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Skeleton
// =============================================================================

function SummaryCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}
