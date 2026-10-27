/**
 * Panel products list — products with SMS qty, attributes, supplier info.
 * Requirements: REQ-03-017 (products header), REQ-03-018 (attributes),
 *   REQ-03-019 (supplier info), REQ-03-020 (pick checkbox / SMS qty),
 *   REQ-03-022 (Buy From Retailer batch button)
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { formatYMD } from '@/lib/date-utils';
import type { PanelProduct } from '../../hooks/useOrderPanel';
import { SelectSupplierModal } from '../SelectSupplierModal';

interface PanelProductsProps {
  orderId: number;
  products: PanelProduct[];
  productCount: number;
}

export function PanelProducts({ orderId, products, productCount }: PanelProductsProps) {
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalOrderProductIds, setModalOrderProductIds] = useState<number[]>([]);

  // OrderDetailsPanel is not remounted when the selected order changes (no key
  // on orderId) — clear any checked boxes from the previous order so a stale
  // id can't leak into this order's Buy From Retailer selection or mixing check.
  useEffect(() => {
    setCheckedIds(new Set());
    setModalOpen(false);
  }, [orderId]);

  const toggleChecked = (opId: number) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(opId)) next.delete(opId);
      else next.add(opId);
      return next;
    });
  };

  // REQ-03-022: legacy select_retailer() forbids mixing AIRO and Toffs
  // products in one batch — a batch assigns ONE supplier to every checked
  // line, and the two types use disjoint supplier pools.
  const handleBuyFromRetailer = () => {
    const checkedTypes = new Set(
      products
        .filter(p => checkedIds.has(p.ordersProductsId))
        .map(p => p.supplierType),
    );
    if (checkedTypes.size > 1) {
      toast.error('Cannot mix AIRO and Toffs products in one selection', {
        description: 'Select only one type at a time, then use Buy From Retailer again for the other.',
      });
      return;
    }
    // Snapshot at open time rather than passing checkedIds directly — the
    // modal's useSupplierOptions fires whenever orderProductIds.length > 0
    // regardless of `open`, so a live-derived array would fire one fetch per
    // checkbox toggle instead of once per actual dialog open.
    setModalOrderProductIds([...checkedIds]);
    setModalOpen(true);
  };

  const showBuyFromRetailer = products.some(p => p.isSupplierSelectable);

  return (
    <div className="space-y-2">
      {/* REQ-03-017: Products header with count */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Products Ordered: {productCount}
        </span>
        <span className="text-sm font-bold">Pick</span>
      </div>

      {products.map((product, index) => (
        <div key={product.ordersProductsId}>
          {index > 0 && <Separator className="my-2" />}
          <ProductItem
            product={product}
            checked={checkedIds.has(product.ordersProductsId)}
            onToggleChecked={() => toggleChecked(product.ordersProductsId)}
          />
        </div>
      ))}

      {/* REQ-03-022: Buy From Retailer batch button */}
      {showBuyFromRetailer && (
        <div className="flex justify-end pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={checkedIds.size === 0}
            onClick={handleBuyFromRetailer}
          >
            Buy From Retailer{checkedIds.size > 0 ? ` (${checkedIds.size})` : ''}
          </Button>
        </div>
      )}

      <SelectSupplierModal
        orderId={orderId}
        orderProductIds={modalOrderProductIds}
        open={modalOpen}
        onOpenChange={(next) => {
          setModalOpen(next);
          if (!next) setCheckedIds(new Set());
        }}
      />
    </div>
  );
}

function ProductItem({
  product,
  checked,
  onToggleChecked,
}: {
  product: PanelProduct;
  checked: boolean;
  onToggleChecked: () => void;
}) {
  // REQ-03-017: Name color based on SMS qty
  const nameColor = getNameColor(product.smsQuantity);

  // REQ-03-020: Pre-checked if box_number not null
  const isPicked = product.boxNumber != null && product.boxNumber !== '';

  return (
    <div className="flex justify-between gap-2">
      <div className="flex-1 min-w-0 space-y-0.5">
        {/* REQ-03-017: qty x name */}
        <div className="text-sm">
          <span>{product.quantity} x </span>
          <span className={nameColor}>{product.name}</span>
        </div>

        {/* REQ-03-018: Product code */}
        {product.model && (
          <div className="text-xs">
            <span className="font-bold">Product Code - {product.model}</span>
          </div>
        )}

        {/* REQ-03-018: Attributes */}
        {product.attributes.map((attr, i) => (
          <div key={i} className="text-xs text-muted-foreground italic">
            &nbsp;- {attr.optionName}: {attr.optionValue}
          </div>
        ))}

        {/* REQ-03-019: Last Ordered supplier */}
        {product.lastOrdered && (
          <div className="text-xs text-muted-foreground">
            Last Ordered: {product.lastOrdered.supplierName}
            {product.lastOrdered.orderedDate && (
              <> on {formatYMD(product.lastOrdered.orderedDate)}</>
            )}
          </div>
        )}

        {/* REQ-03-019: Bulk Upload Supplier */}
        {product.bulkUploadSupplier && (
          <div className="text-xs text-muted-foreground">
            Bulk Upload Supplier: {product.bulkUploadSupplier}
          </div>
        )}

        {/* REQ-03-019 / REQ-03-022: Supplier assignment + batch-select checkbox */}
        <div className="text-xs flex items-center gap-1.5">
          {product.isSupplierSelectable && (
            <Checkbox
              id={`buy_from_retailer_order_product_${product.ordersProductsId}`}
              checked={checked}
              onCheckedChange={onToggleChecked}
              className="h-3 w-3"
              aria-label="Select for Buy From Retailer"
            />
          )}
          {product.supplier?.isAssigned ? (
            <span className="text-blue-600">
              {product.supplier.supplierName}
              {product.supplier.orderNumber && ` - ${product.supplier.orderNumber}`}
            </span>
          ) : (
            <span className="text-muted-foreground">Select Supplier</span>
          )}
        </div>
      </div>

      {/* REQ-03-020: Pick checkbox + SMS qty — read-only indicator of box_number,
        * matching the Edit Order page's pattern (ProductRow.tsx "Pick indicator");
        * disabled once picked into an FC batch, not by supplier assignment. */}
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        <Checkbox
          checked={isPicked}
          disabled={!!product.fcOrderId}
          title="Pick indicator"
          className="h-4 w-4"
        />
        <SmsQuantityBadge quantity={product.smsQuantity} />
      </div>
    </div>
  );
}

function SmsQuantityBadge({ quantity }: { quantity: number | string }) {
  if (quantity === 'OFS' || quantity === 0) {
    return <span className="text-xs text-gray-400">OFS</span>;
  }
  if (quantity === 'N/A' || quantity === '') {
    return <span className="text-xs text-gray-400">N/A</span>;
  }
  return <span className="text-xs text-blue-600 font-medium">{quantity}</span>;
}

function getNameColor(smsQuantity: number | string): string {
  if (smsQuantity === 'OFS' || smsQuantity === 0) return 'text-gray-400';
  if (smsQuantity === 'N/A' || smsQuantity === '') return 'text-gray-400';
  if (typeof smsQuantity === 'number' && smsQuantity > 0) return 'text-blue-600';
  return '';
}
