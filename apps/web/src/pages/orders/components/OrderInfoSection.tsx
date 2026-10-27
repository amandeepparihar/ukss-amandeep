/**
 * Order info section — payment, dates, processing archive, referral, previous orders, commission.
 * Requirements: REQ-04-012, REQ-04-013, REQ-04-014
 */

import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDbLongDate } from '@/lib/date-utils';
import type { OrderDetailData } from '../hooks/useOrderDetail';

interface OrderInfoSectionProps {
  order: OrderDetailData;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="font-medium text-muted-foreground w-36 shrink-0">{label}:</span>
      <span>{children}</span>
    </div>
  );
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$',
};
const getCurrencySymbol = (code: string | null) =>
  CURRENCY_SYMBOLS[code ?? ''] ?? (code ?? '£');

export function OrderInfoSection({ order }: OrderInfoSectionProps) {
  const currencySymbol = getCurrencySymbol(order.currency);
  const displayTotal = order.orderTotal != null
    ? (order.orderTotal * (order.currencyValue ?? 1)).toFixed(2)
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Order Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {/* REQ-04-014: Payment method */}
        <InfoRow label="Payment Method">{order.paymentMethod ?? '—'}</InfoRow>

        {/* REQ-04-012: Date purchased — date only, long format matching Zenc (e.g. "Thursday 27 June, 2024") */}
        <InfoRow label="Date Purchased">
          {order.datePurchased ? formatDbLongDate(order.datePurchased) : '—'}
        </InfoRow>

        {/* REQ-04-012: Ship by date — long format matching Zenc (e.g. "Thursday 27 June, 2024") */}
        {order.shipByDate && (
          <InfoRow label="Ship By Date">
            {formatDbLongDate(order.shipByDate)}
          </InfoRow>
        )}

        {/* Order total */}
        <InfoRow label="Order Total">
          {displayTotal != null ? `${currencySymbol}${displayTotal}` : '—'}
        </InfoRow>

        {/* Shipping method */}
        <InfoRow label="Shipping Method">{order.shippingMethod ?? '—'}</InfoRow>

        {/* REQ-04-012: Processing archive */}
        <InfoRow label="Processing Archive">{order.processing.archiveDisplay}</InfoRow>

        {/* REQ-04-014: Commission */}
        {order.paymentInfo.commissionAmount != null && order.paymentInfo.commissionAmount > 0 && (
          <InfoRow label="Commission">
            {currencySymbol}{Number(order.paymentInfo.commissionAmount).toFixed(2)}
            {order.paymentInfo.affiliateName && (
              <span className="text-muted-foreground"> ({order.paymentInfo.affiliateName})</span>
            )}
          </InfoRow>
        )}

        {/* REQ-04-018: Baselinker source */}
        {order.flags.baselinkerSource && (
          <InfoRow label="Baselinker Source">{order.flags.baselinkerSource}</InfoRow>
        )}

        {/* REQ-04-013: Referring keywords */}
        {order.referral.keywords && (
          <InfoRow label="Referring Keywords">
            <span style={{ color: '#009900' }}>{order.referral.keywords}</span>
          </InfoRow>
        )}

        {/* REQ-04-013: Referring URL */}
        {order.referral.url && (
          <InfoRow label="Referring URL">
            <span
              className="block max-w-[513px] truncate"
              style={{ color: '#009900' }}
              title={order.referral.url}
            >
              {order.referral.url}
            </span>
          </InfoRow>
        )}

        {/* REQ-04-014: Previous orders (4 max) */}
        {order.paymentInfo.previousOrders.length > 0 && (
          <div className="border-t pt-2 mt-2">
            <span className="font-medium text-muted-foreground">Previous Orders: </span>
            <div className="flex flex-wrap gap-2 mt-1">
              {order.paymentInfo.previousOrders.map((prev) => (
                <Link
                  key={prev.orderId}
                  to={`/orders/${prev.orderId}`}
                  className={`rounded px-2 py-0.5 text-xs font-medium hover:opacity-80 ${
                    prev.isBackorder
                      ? 'bg-green-100 text-green-800'
                      : prev.isReturned
                        ? 'bg-pink-100 text-pink-800'
                        : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  #{prev.orderId}
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
