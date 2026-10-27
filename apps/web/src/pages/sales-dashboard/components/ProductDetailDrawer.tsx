import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import type { ProductDetail } from '@admin/shared';

interface ProductDetailDrawerProps {
  productCode: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Format a number as GBP currency.
 */
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value);
}

/**
 * Format a date string (YYYY-MM-DD) to a short display format (e.g. "24 Jan").
 */
function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(date.getTime())) {
    return dateStr;
  }
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * ProductDetailDrawer - Slide-out drawer showing detailed product information.
 *
 * Displays:
 * - Product header with name, team, and average selling price
 * - Size breakdown table (quantity, min qty, committed)
 * - 30-day sales trend line chart
 * - Per-store sales breakdown table
 *
 * Data is fetched from GET /sales-dashboard/product-detail/:productCode
 * only when the drawer is open and a product code is provided.
 */
export function ProductDetailDrawer({
  productCode,
  open,
  onClose,
}: ProductDetailDrawerProps) {
  const {
    data: product,
    isLoading,
    isError,
  } = useQuery<ProductDetail>({
    queryKey: ['product-detail', productCode],
    queryFn: () =>
      api
        .get(`/sales-dashboard/product-detail/${productCode}`)
        .then((r) => r.data.data),
    enabled: open && !!productCode,
  });

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Product Detail</SheetTitle>
          <SheetDescription>
            {productCode ?? 'No product selected'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {isLoading && <LoadingSkeleton />}

          {isError && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-destructive">
                Product not found
              </p>
            </div>
          )}

          {!isLoading && !isError && product && (
            <>
              <ProductHeader product={product} />
              <SizeBreakdownSection sizeBreakdown={product.sizeBreakdown} />
              <SalesTrendSection salesTrend={product.salesTrend} />
              <StoreBreakdownSection storeBreakdown={product.storeBreakdown} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// =============================================================================
// Product Header
// =============================================================================

function ProductHeader({ product }: { product: ProductDetail }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{product.productName}</h3>
          <p className="text-sm text-muted-foreground">
            {product.teamName ?? 'No team'}
          </p>
          <p className="text-2xl font-bold tabular-nums">
            {formatCurrency(product.averageSellingPrice)}
          </p>
          <p className="text-xs text-muted-foreground">Average selling price</p>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Size Breakdown
// =============================================================================

function SizeBreakdownSection({
  sizeBreakdown,
}: {
  sizeBreakdown: ProductDetail['sizeBreakdown'];
}) {
  if (sizeBreakdown.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Size Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No size information</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Size Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Size</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Min Qty</TableHead>
                <TableHead className="text-right">Committed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sizeBreakdown.map((size) => (
                <TableRow key={size.sizeId}>
                  <TableCell className="font-medium">{size.sizeName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {size.quantity.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {size.minimumQuantity.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {size.committedQuantity.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Sales Trend Chart
// =============================================================================

function SalesTrendSection({
  salesTrend,
}: {
  salesTrend: ProductDetail['salesTrend'];
}) {
  // When there is no sales data, render a flat zero chart placeholder
  const chartData =
    salesTrend.length > 0
      ? salesTrend
      : [
          { date: '', unitsSold: 0, revenue: 0 },
        ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">30-Day Sales Trend</CardTitle>
      </CardHeader>
      <CardContent>
        {salesTrend.length === 0 ? (
          <div className="flex h-[150px] items-center justify-center text-muted-foreground">
            <p className="text-sm">No sales in the last 30 days</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={150}>
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={30}
                allowDecimals={false}
              />
              <Tooltip
                content={<SalesTrendTooltip />}
              />
              <Line
                type="monotone"
                dataKey="unitsSold"
                name="Units Sold"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={salesTrend.length === 1 ? { r: 4, fill: '#3b82f6' } : false}
                activeDot={{ r: 4, strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Custom tooltip for the sales trend chart.
 */
function SalesTrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload: { date: string; unitsSold: number; revenue: number };
  }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="rounded-lg border bg-background p-2 shadow-md">
      <p className="text-xs font-semibold">
        {label ? formatDateShort(String(label)) : ''}
      </p>
      <div className="mt-1 space-y-0.5">
        <p className="text-xs text-muted-foreground">
          Units: <span className="font-medium text-foreground">{data.unitsSold}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Revenue: <span className="font-medium text-foreground">{formatCurrency(data.revenue)}</span>
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Store Breakdown
// =============================================================================

function StoreBreakdownSection({
  storeBreakdown,
}: {
  storeBreakdown: ProductDetail['storeBreakdown'];
}) {
  if (storeBreakdown.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Sales by Store</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No store sales data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Sales by Store</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {storeBreakdown.map((store) => (
                <TableRow key={store.storeName}>
                  <TableCell className="font-medium">
                    {store.storeName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {store.unitsSold.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(store.revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-8 w-1/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </CardContent>
      </Card>

      {/* Size breakdown skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-1/3" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        </CardContent>
      </Card>

      {/* Chart skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-1/3" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[150px] w-full" />
        </CardContent>
      </Card>

      {/* Store breakdown skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-1/3" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
