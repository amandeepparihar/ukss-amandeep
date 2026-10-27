/**
 * Order listing table column definitions — 13 columns.
 * Requirements: REQ-02-018 (columns), REQ-02-019 (per-cell styling)
 */

import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pencil, Info, AlertCircle } from 'lucide-react';
import type { OrderListItem } from '../hooks/useOrders';

// Map currency codes to their symbols (matching PHP currencies table symbol_left/symbol_right)
const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '\u00A3', AUD: '$', CAD: 'C$', CHF: 'Fr', DKK: 'Kr.',
  EUR: '\u20AC', HKD: 'HK$', INR: '\u20B9', JPY: '\u00A5',
  MXN: 'Mex$', MYR: 'RM', NOK: 'kr', NZD: 'NZ$', PLN: 'z\u0142',
  SEK: 'kr', SGD: 'S$', USD: '$', AED: '\u062F.\u0625',
};

function formatCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? `${code} `;
}

/**
 * REQ-02-018: Build column definitions for the order listing table.
 * @param showRefund Whether to show the refund column (toBeRefund tab active).
 * @param showTouchpoints Whether to show touchpoints (status = 12).
 * @param onInfoClick Callback for info/panel toggle button.
 */
export function getOrderColumns(
  showRefund: boolean,
  showTouchpoints: boolean,
  onInfoClick: (orderId: number) => void,
): ColumnDef<OrderListItem>[] {
  const columns: ColumnDef<OrderListItem>[] = [
    // Col 1: Order ID
    {
      id: 'orderId',
      accessorKey: 'orderId',
      header: 'Order ID',
      cell: ({ row }) => {
        const item = row.original;
        const displayId = item.isExchange
          ? `${item.originalOrderId}EX`
          : String(item.orderId);
        return (
          <div
            className="text-center font-medium"
            style={item.scanned ? { backgroundColor: '#FAA631' } : undefined}
          >
            <Link
              to={`/orders/${item.orderId}`}
              className="text-blue-600 hover:underline"
            >
              {displayId}
            </Link>
          </div>
        );
      },
      size: 100,
    },
    // Col 2: Payment Method
    {
      id: 'paymentMethod',
      accessorKey: 'paymentMethod',
      header: 'Payment',
      cell: ({ row }) => (
        <div className="text-xs" style={{ maxWidth: 50 }}>
          <div className="truncate">{row.original.paymentMethod ?? '-'}</div>
          <div className="truncate text-muted-foreground">{row.original.shippingMethod ?? ''}</div>
        </div>
      ),
      size: 50,
    },
    // Col 3: Customer
    {
      id: 'customerName',
      accessorKey: 'customerName',
      header: 'Customer',
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="text-left">
            <Link
              to={`/orders?customerId=${item.customerId}`}
              className="text-sm hover:underline"
            >
              {item.customerName || '-'}
            </Link>
            {item.companyName && (
              <div className="text-xs text-muted-foreground truncate">{item.companyName}</div>
            )}
            {item.billingShippingMismatch && (
              <AlertCircle className="inline h-3 w-3 text-red-500 ml-1" />
            )}
          </div>
        );
      },
    },
    // Col 4: Ship Date
    {
      id: 'shipByDate',
      accessorKey: 'shipByDate',
      header: 'Ship Date',
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div
            className="text-center text-sm"
            style={item.shipByDateStatus === 1 ? { backgroundColor: '#ef4444', color: 'white' } : undefined}
          >
            {item.shipByDate ?? '-'}
          </div>
        );
      },
      size: 100,
    },
    // Col 5: Order Total (displayed in original currency, matching PHP $currencies->format())
    {
      id: 'orderTotal',
      accessorKey: 'orderTotal',
      header: 'Total',
      cell: ({ row }) => {
        const item = row.original;
        if (item.orderTotal == null) return <div className="text-right text-sm font-medium">-</div>;
        const currencyValue = item.currencyValue ?? 1;
        const originalAmount = (Number(item.orderTotal) * currencyValue).toFixed(2);
        const currencyCode = item.currency ?? 'GBP';
        return (
          <div className="text-right text-sm font-medium">
            {formatCurrencySymbol(currencyCode)}{originalAmount}
          </div>
        );
      },
      size: 80,
    },
    // Col 6: Date Purchased
    {
      id: 'datePurchased',
      accessorKey: 'datePurchased',
      header: 'Purchased',
      cell: ({ row }) => (
        <div className="text-center text-sm">{row.original.datePurchased ?? '-'}</div>
      ),
      size: 100,
    },
    // Col 7: Status
    {
      id: 'statusName',
      accessorKey: 'statusName',
      header: 'Status',
      cell: ({ row }) => (
        <div className="text-right">
          <Badge variant="outline" className="text-xs">
            {row.original.statusName}
          </Badge>
        </div>
      ),
      size: 120,
    },
  ];

  // Col 8: Refund (only when toBeRefund tab active)
  if (showRefund) {
    columns.push({
      id: 'refundInfo',
      header: 'Refund',
      cell: ({ row }) => {
        const info = row.original.refundInfo;
        if (!info) return <div className="text-center">-</div>;
        const symbol = formatCurrencySymbol(row.original.currency ?? 'GBP');
        const cv = row.original.currencyValue ?? 1;
        return (
          <div className="text-center text-sm">
            {info.type === 'partial'
              ? `Partial Refund - ${symbol}${((info.amount ?? 0) * cv).toFixed(2)}`
              : 'Full Refund'}
          </div>
        );
      },
      size: 140,
    });
  }

  // Col 9: Order Type
  columns.push({
    id: 'orderType',
    accessorKey: 'orderType',
    header: 'Type',
    cell: ({ row }) => (
      <div className="text-center text-sm">{row.original.orderType ?? '-'}</div>
    ),
    size: 80,
  });

  // Col 10: Sift Score (only if > 0)
  columns.push({
    id: 'siftScore',
    accessorKey: 'siftScore',
    header: 'Sift',
    cell: ({ row }) => (
      <div className="text-center text-sm">
        {row.original.siftScore ?? ''}
      </div>
    ),
    size: 60,
  });

  // Col 11: Risk Score (only if > 0)
  columns.push({
    id: 'riskScore',
    accessorKey: 'riskScore',
    header: 'Risk',
    cell: ({ row }) => (
      <div className="text-center text-sm">
        {row.original.riskScore ?? ''}
      </div>
    ),
    size: 60,
  });

  // Col 12: Touchpoints (only when status = 12)
  if (showTouchpoints) {
    columns.push({
      id: 'touchpoints',
      accessorKey: 'touchpoints',
      header: 'Touch',
      cell: ({ row }) => (
        <div className="text-center text-sm">
          {row.original.touchpoints ?? '-'}
        </div>
      ),
      size: 60,
    });
  }

  // Col 13: Action
  columns.push({
    id: 'actions',
    header: 'Action',
    cell: ({ row }) => (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
          <Link to={`/orders/${row.original.orderId}`}>
            <Pencil className="h-3.5 w-3.5" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onInfoClick(row.original.orderId)}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </div>
    ),
    size: 80,
  });

  return columns;
}
