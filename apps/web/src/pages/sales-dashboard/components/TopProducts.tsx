import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, TrendingUp, TrendingDown, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import type { TopProduct, SlowMovingProduct } from '@admin/shared';

interface TopProductsProps {
  startDate: string;
  endDate: string;
  stores: number[];
  onProductClick: (productCode: string) => void;
}

/**
 * Format a number as GBP currency.
 */
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format days since last sale into a human-readable string.
 * Days > 365 are shown as "1+ year".
 */
function formatDaysSinceLastSale(days: number): string {
  if (days > 365) {
    return '1+ year';
  }
  return `${days}d`;
}

/**
 * TopProducts component for the Sales Dashboard.
 *
 * Renders two tabs:
 * - Best Sellers: Products ranked by units sold within the selected date range.
 * - Slow Moving: Products with old/no recent sales and high stock levels.
 *
 * Row click triggers onProductClick to open the ProductDetailDrawer.
 */
export function TopProducts({
  startDate,
  endDate,
  stores,
  onProductClick,
}: TopProductsProps) {
  const [activeTab, setActiveTab] = useState<'best' | 'slow'>('best');

  // Best sellers query - always fetched
  const {
    data: bestSellers,
    isLoading: loadingBest,
    isError: errorBest,
  } = useQuery<TopProduct[]>({
    queryKey: ['top-products-best', startDate, endDate, stores],
    queryFn: () =>
      api
        .get('/sales-dashboard/top-products', {
          params: {
            tab: 'best',
            startDate,
            endDate,
            stores: stores.join(','),
          },
        })
        .then((r) => r.data.data),
  });

  // Slow moving query - only fetch when tab is active
  const {
    data: slowMoving,
    isLoading: loadingSlow,
    isError: errorSlow,
  } = useQuery<SlowMovingProduct[]>({
    queryKey: ['top-products-slow', startDate, endDate, stores],
    queryFn: () =>
      api
        .get('/sales-dashboard/top-products', {
          params: {
            tab: 'slow',
            startDate,
            endDate,
            stores: stores.join(','),
          },
        })
        .then((r) => r.data.data),
    enabled: activeTab === 'slow',
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Top Products</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs
          defaultValue="best"
          onValueChange={(value) => setActiveTab(value as 'best' | 'slow')}
        >
          <TabsList className="mb-4">
            <TabsTrigger value="best" className="gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              Best Sellers
            </TabsTrigger>
            <TabsTrigger value="slow" className="gap-1.5">
              <TrendingDown className="h-3.5 w-3.5" />
              Slow Moving
            </TabsTrigger>
          </TabsList>

          <TabsContent value="best">
            <BestSellersTable
              data={bestSellers ?? []}
              isLoading={loadingBest}
              isError={errorBest}
              onProductClick={onProductClick}
            />
          </TabsContent>

          <TabsContent value="slow">
            <SlowMovingTable
              data={slowMoving ?? []}
              isLoading={loadingSlow}
              isError={errorSlow}
              onProductClick={onProductClick}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Best Sellers Table
// =============================================================================

interface BestSellersTableProps {
  data: TopProduct[];
  isLoading: boolean;
  isError: boolean;
  onProductClick: (productCode: string) => void;
}

function BestSellersTable({
  data,
  isLoading,
  isError,
  onProductClick,
}: BestSellersTableProps) {
  if (isLoading) {
    return <TableLoadingState />;
  }

  if (isError) {
    return <TableErrorState />;
  }

  if (data.length === 0) {
    return <TableEmptyState message="No sales data for the selected period." />;
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">Units Sold</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Orders</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((product) => (
            <TableRow
              key={product.productSku}
              className="cursor-pointer"
              onClick={() => onProductClick(product.productSku)}
            >
              <TableCell className="font-mono text-xs">
                {product.productSku}
              </TableCell>
              <TableCell className="max-w-[200px] truncate font-medium">
                {product.productName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {product.teamName ?? '-'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {product.unitsSold.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(product.revenue)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {product.orderCount.toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// =============================================================================
// Slow Moving Table
// =============================================================================

interface SlowMovingTableProps {
  data: SlowMovingProduct[];
  isLoading: boolean;
  isError: boolean;
  onProductClick: (productCode: string) => void;
}

function SlowMovingTable({
  data,
  isLoading,
  isError,
  onProductClick,
}: SlowMovingTableProps) {
  if (isLoading) {
    return <TableLoadingState />;
  }

  if (isError) {
    return <TableErrorState />;
  }

  if (data.length === 0) {
    return <TableEmptyState message="No slow moving products found." />;
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">Stock Qty</TableHead>
            <TableHead className="text-right">Days Since Last Sale</TableHead>
            <TableHead>Listed On</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((product) => (
            <TableRow
              key={product.productCode}
              className="cursor-pointer"
              onClick={() => onProductClick(product.productCode)}
            >
              <TableCell className="font-mono text-xs">
                {product.productCode}
              </TableCell>
              <TableCell className="max-w-[200px] truncate font-medium">
                {product.productName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {product.teamName ?? '-'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {product.totalQuantity.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatDaysSinceLastSale(product.daysSinceLastSale)}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {product.listedOn.length > 0 ? (
                    product.listedOn.map((marketplace) => (
                      <Badge
                        key={marketplace}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {marketplace}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// =============================================================================
// Shared States
// =============================================================================

function TableLoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="ml-2 text-sm text-muted-foreground">Loading products...</span>
    </div>
  );
}

function TableErrorState() {
  return (
    <div className="flex items-center justify-center py-12">
      <p className="text-sm text-destructive">
        Unable to load products. Please try refreshing.
      </p>
    </div>
  );
}

function TableEmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
