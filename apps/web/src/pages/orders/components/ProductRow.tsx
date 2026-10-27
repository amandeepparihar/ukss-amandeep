/**
 * Single product row for the order products table.
 * Requirements: REQ-05-003 through REQ-05-014, REQ-06 (product-level actions)
 *
 * SPEC-06: All interactive checkboxes and inputs wired to mutation callbacks.
 */

import { useState, useCallback, useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { TableRow, TableCell } from '@/components/ui/table';
import { ProductAttributes } from './ProductAttributes';
import { formatDbDate } from '@/lib/date-utils';
import type { OrderProductItem } from '../hooks/useOrderProducts';
import type { ProductActionCallbacks } from './ProductsTable';
import { FC_BOX_NUMBER } from '../constants';
import { SelectSupplierModal } from './SelectSupplierModal';

// Map currency codes to their symbols (matching PHP currencies table symbol_left)
const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '\u00A3', AUD: '$', CAD: 'C$', CHF: 'Fr', DKK: 'Kr.',
  EUR: '\u20AC', HKD: 'HK$', INR: '\u20B9', JPY: '\u00A5',
  MXN: 'Mex$', MYR: 'RM', NOK: 'kr', NZD: 'NZ$', PLN: 'z\u0142',
  SEK: 'kr', SGD: 'S$', USD: '$', AED: '\u062F.\u0625',
};

interface ProductRowProps {
  orderId: number;
  product: OrderProductItem;
  orderReturnCheck: string;
  isExchangeOrder: boolean;
  currency: string;
  currencyValue: number;
  isBackorderPass: boolean;
  showBundleColumn: boolean;
  showAllocateColumn: boolean;
  showPrintingColumn: boolean;
  actions: ProductActionCallbacks;
}

export function ProductRow({
  orderId,
  product: p,
  orderReturnCheck,
  isExchangeOrder,
  currency,
  currencyValue,
  isBackorderPass,
  showBundleColumn,
  showAllocateColumn,
  showPrintingColumn,
  actions,
}: ProductRowProps) {
  const bgColor = isBackorderPass
    ? getBackorderRowColor()
    : getNormalRowColor(p, orderReturnCheck);

  // REQ-05-004: Trainers personalisation cyan cell background
  const nameCellBg = p.hasTrainersPersonalisation ? '#13DFF9' : undefined;

  // REQ-05-014: Financial calculations
  // final_price is stored in GBP (base currency). Matching PHP orders.php lines 5676-5679:
  //   "Total GBP" column:     format(final_price * qty, 'GBP', 1.0) — no conversion, already GBP
  //   "Total Inc Tax" column: format(final_price * qty, currency, currency_value) — multiplies to get original currency
  const taxMultiplier = 1 + (p.tax / 100);
  const totalGbp = (p.finalPrice * taxMultiplier * p.quantity) + p.onetimeCharges;
  const totalIncTax = totalGbp * (currencyValue > 0 ? currencyValue : 1);
  const currencySymbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;

  // REQ-05-014: Free offer — single cell colspan
  const isFreeOfferRow = p.freeOffer;

  // REQ-05-013: Box1 auto-fill from scan_checkpoint
  const box1Display = resolveBox1Display(p);

  // REQ-05-011: SMS quantity display
  const smsQtyDisplay = p.smsQuantity === 'OFS'
    ? <span className={p.smsQuantityMap === 1 ? 'text-red-600' : ''}>OFS</span>
    : p.smsQuantity !== '' ? <span>{String(p.smsQuantity)}</span> : null;

  // REQ-05-014: Model cell background for scanning
  const modelCellBg = p.scanningStatus === 'Yes' ? '#FAA631' : undefined;

  // FC disabled checks
  const isFcDisabled = !!p.fcOrderId;
  const isJitDisabled = p.boxNumber === FC_BOX_NUMBER || !!p.multipartBatchId || !!p.fcOrderId;

  // SPEC-12a: Select supplier modal open state
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);

  // SPEC-06: Local state for box number input (submit on blur/enter)
  const [boxNumValue, setBoxNumValue] = useState(p.boxNumber ?? '');
  const [box1Value, setBox1Value] = useState(box1Display);

  // Sync local state when server data changes after mutation refetch
  useEffect(() => { setBoxNumValue(p.boxNumber ?? ''); }, [p.boxNumber]);
  useEffect(() => { setBox1Value(box1Display); }, [box1Display]);

  // REQ-06-001: Box number submit handler
  const handleBoxNumberSubmit = useCallback(() => {
    if (boxNumValue !== (p.boxNumber ?? '')) {
      actions.onBoxNumberChange(p.ordersProductsId, boxNumValue);
    }
  }, [boxNumValue, p.boxNumber, p.ordersProductsId, actions]);

  // REQ-06-025: Box1 submit handler
  const handleBox1Submit = useCallback(() => {
    if (box1Value !== box1Display) {
      actions.onBox1Change(p.ordersProductsId, box1Value);
    }
  }, [box1Value, box1Display, p.ordersProductsId, actions]);

  return (
    <>
    {/* SPEC-12a: Supplier order modal — renders into a portal; sibling of TableRow is fine */}
    {p.isSupplierSelectable && (
      <SelectSupplierModal
        orderId={orderId}
        orderProductIds={[p.ordersProductsId]}
        open={supplierModalOpen}
        onOpenChange={setSupplierModalOpen}
      />
    )}
    <TableRow
      className="text-xs"
      style={bgColor ? { backgroundColor: bgColor } : undefined}
    >
      {/* Col 1: Refund checkbox + FC indicators (REQ-05-009) */}
      <TableCell className="w-[50px] text-center">
        <Checkbox
          checked={p.refund}
          disabled
          title="Refund (SPEC-10)"
        />
        {p.addToMultipartFc && (
          <span className="ml-0.5 inline-block h-2 w-2 rounded-full bg-red-500" title="Added to Multipart FC" />
        )}
        {p.multipartBatchId && (
          <span className="ml-0.5 inline-block h-2 w-2 rounded-full bg-blue-500" title="Multipart Batch" />
        )}
      </TableCell>

      {/* Col 2: Quantity (REQ-05-006) */}
      <TableCell className="w-[40px] text-center">
        <span
          className={`cursor-pointer font-semibold underline ${p.changeQuantity ? 'text-red-600' : 'text-blue-600'}`}
          title="Edit quantity (future)"
        >
          {p.quantity} x
        </span>
      </TableCell>

      {/* Col 3: Product name + attributes (REQ-05-006, REQ-05-007, REQ-05-008) */}
      <TableCell style={nameCellBg ? { backgroundColor: nameCellBg } : undefined}>
        <div>
          <span
            className={`cursor-pointer font-medium underline ${getNameColor(p)}`}
            title="View product details"
          >
            {p.name}
          </span>
          {p.changeName && (
            <span className="ml-1 text-orange-600">(Product changed)</span>
          )}
        </div>

        {/* Action links */}
        <div className="mt-0.5 flex flex-wrap gap-2 text-[10px]">
          <span className="cursor-pointer text-green-600 underline" title="Change Product (future)">
            Change Product
          </span>
          <span className="cursor-pointer text-blue-600 underline" title="Add/Change Personalisation (future)">
            Add/Change Personalisation
          </span>
        </div>

        {/* Attributes (REQ-05-007) */}
        <ProductAttributes
          attributes={p.attributes}
          freeOffer={p.freeOffer}
        />

        {/* REQ-05-008: Stock comment */}
        {p.productComment && (
          <div className="mt-1 max-w-[200px]">
            <div className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-800">
              {p.productComment}
            </div>
          </div>
        )}

        {/* REQ-05-008: Supplier checkbox — matches PHP orders.php buy_from_retailer_order_product.
          * PHP: name="buy_from_retailer_order_product" (fixed name, id varies), never pre-checked,
          * disabled when supplier_order_id > 0 (existing supplier order placed).
          * This checkbox is inert in legacy too — it's a batch-select input for the
          * "Buy From Retailer" page-level button, which has no Stock2 UI (unbuilt).
          * The real, working per-line supplier-select control is the "Select supplier"
          * button in the Allocate column below (same row, gated on p.isSupplierSelectable,
          * same SelectSupplierModal) — do not duplicate its onClick here. */}
        <div className="mt-1 text-[10px]">
          <input
            type="checkbox"
            name="buy_from_retailer_order_product"
            id={`buy_from_retailer_order_product_${p.ordersProductsId}`}
            defaultChecked={false}
            disabled={!!(p.supplier?.supplierOrderId)}
            className="mr-1 h-3 w-3 align-middle"
            title="Select for Buy From Retailer"
            style={{ verticalAlign: 'top' }}
          />
          {p.supplier?.supplierId ? (
            <span className="text-muted-foreground">Supplier assigned</span>
          ) : (
            <span className="text-muted-foreground">Select Supplier</span>
          )}
        </div>

        {/* REQ-05-008: Printer info */}
        {p.printerName && p.printingDate && (
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            Printed By: {p.printerName} ON: {formatDbDate(p.printingDate)}
          </div>
        )}

        {/* REQ-05-008: Tote ID */}
        {p.fcToteId && (
          <div className="mt-0.5 text-[10px]">
            <span className="font-bold">Tote ID: {p.fcToteId}</span>
            {p.fcItemReceivedScanUser && <span className="ml-1">Rcvd: {p.fcItemReceivedScanUser}</span>}
            {p.fcItemSentScanUser && <span className="ml-1">Sent: {p.fcItemSentScanUser}</span>}
          </div>
        )}

        {/* REQ-05-008: Multipart FC Batch Name */}
        {p.multipartFcBatchName && (
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            Batch: {p.multipartFcBatchName}
          </div>
        )}
      </TableCell>

      {/* Col 4: Bundle Product ID (REQ-05-009) — conditional */}
      {showBundleColumn && (
        <TableCell className="text-center text-red-600">
          {p.bundleProductId ? p.bundleProductId.split(':')[0] : ''}
        </TableCell>
      )}

      {/* Col 5: Exchange (REQ-05-010) */}
      <TableCell className="w-[50px] text-center">
        {!isExchangeOrder && (
          <Checkbox disabled title="Exchange (SPEC-15)" />
        )}
      </TableCell>

      {/* Col 6: Shipped / Ship Check (REQ-06-021) */}
      <TableCell className="w-[80px] text-center">
        {p.backorder === 'No' && (
          <Checkbox
            checked={p.shipChk === 'yes'}
            disabled={isFcDisabled}
            onCheckedChange={(checked) => {
              actions.onShipCheckToggle(p.ordersProductsId, checked ? 'yes' : 'no');
            }}
            title="Ship check"
          />
        )}
      </TableCell>

      {/* Col 7: Return (REQ-05-010) */}
      <TableCell className="w-[80px] text-center">
        {p.backorder === 'No' && p.shipChk !== 'yes' ? (
          <div className="space-y-0.5">
            <Checkbox
              checked={p.returnChk === 'yes'}
              disabled
              title="Return item (SPEC-15)"
            />
            <div>
              <span
                className="cursor-pointer text-[10px] text-blue-600 underline"
                title="Return History (SPEC-15)"
              >
                History
              </span>
            </div>
          </div>
        ) : null}
      </TableCell>

      {/* Col 8: Pick + SMS qty (REQ-05-011) */}
      <TableCell className="w-[80px] text-center">
        <div className="space-y-0.5">
          <Checkbox
            checked={!!p.boxNumber}
            disabled={isFcDisabled}
            title="Pick indicator"
          />
          {smsQtyDisplay && <div className="text-[10px]">{smsQtyDisplay}</div>}
        </div>
      </TableCell>

      {/* Col 9: JIT (REQ-06-008) */}
      <TableCell className="w-[50px] text-center">
        <Checkbox
          checked={p.jitMarked === 'yes'}
          disabled={isJitDisabled}
          onCheckedChange={(checked) => {
            actions.onJitToggle(p.ordersProductsId, checked ? 'yes' : 'no');
          }}
          title="JIT toggle"
        />
      </TableCell>

      {/* Col 10: Assigned Box (REQ-05-012) */}
      <TableCell className="w-[80px] text-center">
        {p.assignBoxNumber ? (
          <Badge variant="outline" className="text-[10px]">
            Box No: {p.assignBoxNumber}
          </Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground">NA</span>
        )}
      </TableCell>

      {/* Col 11: Allocate (REQ-05-012) — conditional */}
      {showAllocateColumn && (
        <TableCell className="text-center">
          {p.isAllocationPending ? (
            <div className="flex flex-col items-center gap-1">
              <Checkbox
                checked={p.supplier?.allocate === 1 && !!p.boxNumber}
                disabled
                title="Allocate (SPEC-12)"
              />
            </div>
          ) : p.isSupplierSelectable ? (
            <div className="flex flex-col items-center gap-1">
              {/* SPEC-12a: launch supplier-order creation for this line */}
              <button
                type="button"
                className="text-[10px] text-blue-600 underline hover:text-blue-800"
                onClick={() => setSupplierModalOpen(true)}
              >
                Select supplier
              </button>
            </div>
          ) : null}
        </TableCell>
      )}

      {/* Col 12: Order Printing (REQ-05-013) — conditional */}
      {showPrintingColumn && (
        <TableCell className="text-center">
          {p.isTshirtProduct ? (
            <Checkbox
              checked={p.orderPrintingStatus === 1}
              disabled
              title="Order Printing (SPEC-13)"
            />
          ) : null}
        </TableCell>
      )}

      {/* Col 13: Box Number (REQ-06-001) */}
      <TableCell className="w-[60px] text-center">
        <Input
          value={boxNumValue}
          onChange={(e) => setBoxNumValue(e.target.value)}
          onBlur={handleBoxNumberSubmit}
          onKeyDown={(e) => { if (e.key === 'Enter') handleBoxNumberSubmit(); }}
          disabled={isFcDisabled}
          className="h-6 w-[50px] text-center text-xs"
          title="Box number"
        />
      </TableCell>

      {/* Col 14: Box1 + Printed (REQ-06-025, REQ-06-022)
        * PHP: box1 editable input + separate print_box_name readonly input (if set) + printed checkbox */}
      <TableCell className="w-[200px]">
        {isFreeOfferRow ? (
          <span className="font-bold text-red-600">FREE</span>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={box1Value}
              onChange={(e) => setBox1Value(e.target.value)}
              onBlur={handleBox1Submit}
              onKeyDown={(e) => { if (e.key === 'Enter') handleBox1Submit(); }}
              className="h-6 w-24 text-xs"
              title={p.memberName ?? 'Box1'}
            />
            {/* PHP: separate readonly print_box_name field alongside box1 */}
            {p.printBoxName && (
              <Input
                value={p.printBoxName}
                readOnly
                className="h-6 w-20 text-xs"
                title="Print box name"
              />
            )}
            <Checkbox
              checked={p.printingStatus === 'Printed'}
              disabled={isFcDisabled}
              onCheckedChange={(checked) => {
                actions.onPrintingStatusToggle(
                  p.ordersProductsId,
                  checked ? 'Printed' : 'Not Printed',
                );
              }}
              title="Printed"
            />
          </div>
        )}
      </TableCell>

      {/* Col 15: Arrived (REQ-06-023) */}
      <TableCell className="text-center">
        {!isFreeOfferRow && (
          <Checkbox
            checked={p.arrivedStatus === 'Arrived'}
            disabled={isFcDisabled}
            onCheckedChange={(checked) => {
              actions.onArrivedStatusToggle(
                p.ordersProductsId,
                checked ? 'Arrived' : 'Not Arrived',
              );
            }}
            title="Arrived"
          />
        )}
      </TableCell>

      {/* Col 16: Backorder (REQ-06-014) */}
      <TableCell className="text-center">
        {!isFreeOfferRow && renderBackorderCell(p, isBackorderPass, isFcDisabled, actions)}
      </TableCell>

      {/* Col 17: Model/SKU (REQ-05-014) */}
      <TableCell style={modelCellBg ? { backgroundColor: modelCellBg } : undefined}>
        <span className="text-[10px]">{p.model ?? ''}</span>
      </TableCell>

      {/* Col 18: Tax (REQ-05-014) */}
      <TableCell className="text-right">
        {!isFreeOfferRow && (
          <Checkbox disabled title="Tax confirm refund (SPEC-10)" />
        )}
      </TableCell>

      {/* Col 19: Total Inc Tax (REQ-05-014) — original order currency (e.g. USD for USD orders) */}
      <TableCell className="text-right font-bold">
        {!isFreeOfferRow ? `${currencySymbol}${totalIncTax.toFixed(2)}` : ''}
      </TableCell>

      {/* Col 20: Total GBP (REQ-05-014) — always GBP; final_price is stored in GBP */}
      <TableCell className="text-right font-bold">
        {!isFreeOfferRow ? `\u00A3${totalGbp.toFixed(2)}` : ''}
      </TableCell>
    </TableRow>
    </>
  );
}

// ---------------------------------------------------------------------------
// Row color helpers
// ---------------------------------------------------------------------------

/** REQ-05-003: Normal product row background colors (priority rules).
 * Priority matches zenc orders.php lines 5193-5214:
 * ship_chk first, then whole-order return, then product return,
 * then matching, then scanned.
 * FC ONBACKORDER (#fa8260) is stock2-specific (no legacy equivalent).
 */
function getNormalRowColor(
  p: OrderProductItem,
  orderReturnCheck: string,
): string | undefined {
  // P1: shipped — highest priority, matches zenc ship_chk check first
  if (p.shipChk === 'yes') return 'yellow';
  // P2: whole order return (orders.rtrn_chk)
  if (orderReturnCheck === 'yes') return '#FF66CC';
  // P3: product return
  if (p.returnChk === 'yes') return '#FF66CC';
  // P4: FC ONBACKORDER non-JIT with zero stock (stock2-specific)
  if (p.boxNumber === FC_BOX_NUMBER && p.jitMarked !== 'yes' &&
      (p.smsQuantity === 0 || p.smsQuantity === 'OFS')) return '#fa8260';
  // P5: matching
  if (p.matchingStatus === 'Yes') return 'yellow';
  // P6: scanned
  if (p.scanningStatus === 'Yes') return '#FAA631';
  // P7: default
  return undefined;
}

/** REQ-05-005: Backorder row colors.
 * Always #2bc312 — matches zenc orders.php line 5725 which is unconditional.
 */
function getBackorderRowColor(): string {
  return '#2bc312';
}

/** REQ-05-006: Product name color based on quantity */
function getNameColor(p: OrderProductItem): string {
  if (p.productQuantityMap === 1) return 'text-green-600';
  if (p.smsProductsQuantity != null && p.smsProductsQuantity < 5) return 'text-red-600';
  return 'text-foreground';
}

/** REQ-05-013: Box1 display from scan_checkpoint.
 * PHP orders.php line 5648: box1 field value (or CHECK N if scanning_status=Yes and box1 empty).
 * print_box_name is rendered as a SEPARATE readonly field, not as the box1 value.
 */
function resolveBox1Display(p: OrderProductItem): string {
  if (p.box1) return p.box1;
  if (!p.scanCheckpoint) return '';

  const count = (p.scanCheckpoint.match(/,/g) || []).length + 1;
  if (count === 1) return 'CHECK 1';
  if (count === 2) return p.scanCheckpoint.includes('checkpoint4') ? 'CHECK 4' : 'CHECK 2';
  if (count === 3) return 'CHECK 3';
  if (count >= 4) return 'CHECK 4';
  return '';
}

/** REQ-06-014: Backorder cell rendering with toggle handler */
function renderBackorderCell(
  p: OrderProductItem,
  isBackorderPass: boolean,
  isFcDisabled: boolean,
  actions: ProductActionCallbacks,
): React.ReactNode {
  if (p.shipChk === 'yes') return null;

  if (p.backorder === 'Cancelled') {
    return <span className="text-[10px] text-red-600">Cancelled</span>;
  }
  // PHP orders.php line 5659: backorder == "Replacement" shows "Replacement Requested"
  if (p.backorder === 'Replacement') {
    return <span className="text-[10px] text-blue-600">Replacement Requested</span>;
  }

  if (isBackorderPass) {
    return (
      <Checkbox
        checked
        disabled={isFcDisabled}
        onCheckedChange={() => {
          actions.onBackorderToggle(p.ordersProductsId, 'No');
        }}
        title="Remove from backorder"
      />
    );
  }

  return (
    <Checkbox
      checked={p.backorder === 'Yes'}
      disabled={isFcDisabled}
      onCheckedChange={(checked) => {
        actions.onBackorderToggle(p.ordersProductsId, checked ? 'Yes' : 'No');
      }}
      title="Backorder"
    />
  );
}
