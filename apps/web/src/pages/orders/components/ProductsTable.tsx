/**
 * Products table — main table component for order edit page.
 * Requirements: REQ-05-001 (container/header), REQ-05-002 (two-pass rendering),
 *   REQ-05-018 (post-table buttons), REQ-06 (product-level actions)
 *
 * Renders all products in a single table (not paginated DataTable).
 * SPEC-06: Mutation hooks instantiated here and passed as callbacks to ProductRow.
 */

import { useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table, TableHeader, TableBody, TableRow, TableHead,
} from '@/components/ui/table';
import { useOrderProducts } from '../hooks/useOrderProducts';
import { ProductRow } from './ProductRow';
import { RefundedProducts } from './RefundedProducts';
import { MysteryProducts } from './MysteryProducts';
import {
  useUpdateBoxNumber,
  useToggleJit,
  useToggleBackorder,
  useUpdateShipCheck,
  useUpdatePrintingStatus,
  useUpdateArrivedStatus,
  useUpdateBox1,
} from '../hooks/useProductActions';

/** Callback signatures passed to ProductRow */
export interface ProductActionCallbacks {
  onBoxNumberChange: (productId: number, boxNumber: string) => void;
  onJitToggle: (productId: number, checkBit: 'yes' | 'no') => void;
  onBackorderToggle: (productId: number, backorder: 'Yes' | 'No') => void;
  onShipCheckToggle: (productId: number, shipChk: 'yes' | 'no') => void;
  onPrintingStatusToggle: (productId: number, printed: 'Printed' | 'Not Printed') => void;
  onArrivedStatusToggle: (productId: number, arrived: 'Arrived' | 'Not Arrived') => void;
  onBox1Change: (productId: number, value: string) => void;
}

interface ProductsTableProps {
  orderId: number;
}

export function ProductsTable({ orderId }: ProductsTableProps) {
  const { data, isLoading, isError } = useOrderProducts(orderId);

  // SPEC-06: Instantiate mutation hooks
  const boxNumberMutation = useUpdateBoxNumber(orderId);
  const jitMutation = useToggleJit(orderId);
  const backorderMutation = useToggleBackorder(orderId);
  const shipCheckMutation = useUpdateShipCheck(orderId);
  const printingMutation = useUpdatePrintingStatus(orderId);
  const arrivedMutation = useUpdateArrivedStatus(orderId);
  const box1Mutation = useUpdateBox1(orderId);

  // Memoize callbacks (deps use .mutate which is a stable reference)
  const callbacks: ProductActionCallbacks = {
    onBoxNumberChange: useCallback(
      (productId: number, boxNumber: string) => boxNumberMutation.mutate({ productId, boxNumber }),
      [boxNumberMutation.mutate],
    ),
    onJitToggle: useCallback(
      (productId: number, checkBit: 'yes' | 'no') => jitMutation.mutate({ productId, checkBit }),
      [jitMutation.mutate],
    ),
    onBackorderToggle: useCallback(
      (productId: number, backorder: 'Yes' | 'No') =>
        backorderMutation.mutate({ orderProductId: String(productId), backorder }),
      [backorderMutation.mutate],
    ),
    onShipCheckToggle: useCallback(
      (productId: number, shipChk: 'yes' | 'no') => shipCheckMutation.mutate({ productId, shipChk }),
      [shipCheckMutation.mutate],
    ),
    onPrintingStatusToggle: useCallback(
      (productId: number, printed: 'Printed' | 'Not Printed') =>
        printingMutation.mutate({ productId, printed }),
      [printingMutation.mutate],
    ),
    onArrivedStatusToggle: useCallback(
      (productId: number, arrived: 'Arrived' | 'Not Arrived') =>
        arrivedMutation.mutate({ productId, arrived }),
      [arrivedMutation.mutate],
    ),
    onBox1Change: useCallback(
      (productId: number, value: string) => box1Mutation.mutate({ productId, value }),
      [box1Mutation.mutate],
    ),
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading products...</span>
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-red-600">
          Failed to load products. Please refresh the page.
        </CardContent>
      </Card>
    );
  }

  const {
    products,
    conditionalColumns: { showBundleColumn, showAllocateColumn, showPrintingColumn },
    allBackordered,
    refundedProducts,
    mysteryProducts,
    orderReturnCheck,
    isExchangeOrder,
    currency,
    currencyValue,
  } = data;

  // REQ-05-002: Separate normal and backorder products
  const normalProducts = products.filter(p => p.backorder !== 'Yes');
  const backorderProducts = products.filter(p => p.backorder === 'Yes');

  // Calculate total number of columns for colSpan calculations
  const baseColCount = 17;
  const extraCols = (showBundleColumn ? 1 : 0) +
                    (showAllocateColumn ? 1 : 0) +
                    (showPrintingColumn ? 1 : 0);
  const totalCols = baseColCount + extraCols;

  /** REQ-06-014: Bulk mark all non-backorder products as backorder */
  const handleBulkBackorder = () => {
    const nonBackorderIds = normalProducts
      .filter(p => !p.freeOffer && p.backorder !== 'Yes')
      .map(p => p.ordersProductsId);
    if (nonBackorderIds.length === 0) return;
    const idStr = nonBackorderIds.join('_');
    backorderMutation.mutate({ orderProductId: idStr, backorder: 'Yes' });
  };

  return (
    <div className="space-y-4">
      {/* REQ-05-001: Hidden refund confirmation div */}
      <div id="refundConfirm" className="hidden">
        <label>
          <input type="checkbox" id="shipping_price_refund" /> Refund shipping price
        </label>
      </div>

      {/* Hidden field for DHL all-backorder flag (REQ-05-002) */}
      <input type="hidden" id="Dhlallbackorder" value={allBackordered ? 'Yes' : 'No'} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Products ({products.length})
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled title="Add New Order Product (future)">
                Add Product
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkBackorder}
                disabled={backorderMutation.isPending || normalProducts.length === 0}
              >
                Mark Backorder
              </Button>
              <Button variant="outline" size="sm" disabled title="View Tickets (future)">
                View Tickets
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            {/* REQ-05-001: Header row with 19 columns (3 conditional) */}
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="w-[50px]">Refund</TableHead>
                <TableHead className="w-[40px]">Qty</TableHead>
                <TableHead>Products</TableHead>
                {showBundleColumn && <TableHead>Bundle ID</TableHead>}
                <TableHead className="w-[50px] text-center">Exchange</TableHead>
                <TableHead className="w-[80px] text-center">Shipped</TableHead>
                <TableHead className="w-[80px] text-center">Return</TableHead>
                <TableHead className="w-[80px] text-center">Pick</TableHead>
                <TableHead className="w-[50px] text-center">JIT</TableHead>
                <TableHead className="w-[80px] text-center">Assigned Box</TableHead>
                {showAllocateColumn && <TableHead className="text-center">Allocate</TableHead>}
                {showPrintingColumn && <TableHead className="text-center">Printing</TableHead>}
                <TableHead className="w-[60px] text-center">Box No.</TableHead>
                <TableHead className="w-[200px]">
                  <div className="flex">
                    <span className="w-3/4">Boxes</span>
                    <span className="w-1/4">Printed</span>
                  </div>
                </TableHead>
                <TableHead className="text-center">Arrived</TableHead>
                <TableHead className="text-center">Backorder</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total Inc Tax</TableHead>
                <TableHead className="text-right">Total GBP</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {/* Pass 1: Normal products (non-backorder) */}
              {normalProducts.map(product => (
                <ProductRow
                  key={product.ordersProductsId}
                  orderId={orderId}
                  product={product}
                  orderReturnCheck={orderReturnCheck}
                  isExchangeOrder={isExchangeOrder}
                  currency={currency}
                  currencyValue={currencyValue}
                  isBackorderPass={false}
                  showBundleColumn={showBundleColumn}
                  showAllocateColumn={showAllocateColumn}
                  showPrintingColumn={showPrintingColumn}
                  actions={callbacks}
                />
              ))}

              {/* Pass 2: Backorder products with green background (REQ-05-002) */}
              {backorderProducts.length > 0 && (
                <>
                  <TableRow>
                    <TableHead colSpan={totalCols} className="bg-muted/50 text-xs font-semibold">
                      Backorder Products ({backorderProducts.length})
                    </TableHead>
                  </TableRow>
                  {backorderProducts.map(product => (
                    <ProductRow
                      key={product.ordersProductsId}
                      orderId={orderId}
                      product={product}
                      orderReturnCheck={orderReturnCheck}
                      isExchangeOrder={isExchangeOrder}
                      currency={currency}
                      currencyValue={currencyValue}
                      isBackorderPass={true}
                      showBundleColumn={showBundleColumn}
                      showAllocateColumn={showAllocateColumn}
                      showPrintingColumn={showPrintingColumn}
                      actions={callbacks}
                    />
                  ))}
                </>
              )}

              {/* Empty state */}
              {products.length === 0 && (
                <TableRow>
                  <TableHead colSpan={totalCols} className="py-8 text-center text-muted-foreground">
                    No products found for this order.
                  </TableHead>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* REQ-05-016: Refunded products section */}
      {refundedProducts.length > 0 && (
        <RefundedProducts products={refundedProducts} />
      )}

      {/* REQ-05-017: Mystery products section */}
      {mysteryProducts.length > 0 && (
        <MysteryProducts products={mysteryProducts} />
      )}
    </div>
  );
}
