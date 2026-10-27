/**
 * Order metadata row — sift/risk scores, exchange links, matched by, lock status.
 * Requirements: REQ-04-010
 */

import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { OrderDetailData } from '../hooks/useOrderDetail';

interface OrderMetadataSectionProps {
  order: OrderDetailData;
}

export function OrderMetadataSection({ order }: OrderMetadataSectionProps) {
  const { metadata } = order;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Order Metadata</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {/* REQ-04-010: Order ID with exchange links */}
          <span className="font-medium">
            #{order.orderId}
            {metadata.isExchange && (
              <span className="text-red-600">
                EX{' '}
                {metadata.originalOrderId && (
                  <Link to={`/orders/${metadata.originalOrderId}`} className="hover:underline">
                    (Original: #{metadata.originalOrderId})
                  </Link>
                )}
              </span>
            )}
            {metadata.exchangeOrderId && (
              <Link to={`/orders/${metadata.exchangeOrderId}`} className="ml-1 text-blue-600 hover:underline">
                Exchange: #{metadata.exchangeOrderId}
              </Link>
            )}
          </span>

          {/* REQ-04-010: Sift Score — green bg, white text */}
          {metadata.siftScore != null && metadata.siftScore > 0 && (
            <Badge className="bg-green-600 text-white text-xs font-bold">
              Sift: {metadata.siftScore.toFixed(2)}
            </Badge>
          )}

          {/* REQ-04-010: Risk Score — red bg, white text */}
          {metadata.riskScore != null && metadata.riskScore > 0 && (
            <Badge className="bg-red-600 text-white text-xs font-bold">
              Risk: {metadata.riskScore}
            </Badge>
          )}

          {/* REQ-04-010: Matched By — blue bg */}
          {metadata.matchedBy && (
            <Badge className="bg-blue-600 text-white text-xs font-bold">
              Matched: {metadata.matchedBy}
            </Badge>
          )}

          {/* REQ-04-010: Riskified — green if approved, red if declined */}
          {metadata.riskifiedStatus && (
            <Badge className={
              metadata.riskifiedStatus === 'approved'
                ? 'bg-green-600 text-white text-xs font-bold'
                : 'bg-red-600 text-white text-xs font-bold'
            }>
              Riskified: {metadata.riskifiedStatus}
            </Badge>
          )}

          {/* REQ-04-010: Lock status */}
          {metadata.lockStatus.isLocked && (
            <div className="flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-red-700">
              <Lock className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">
                {metadata.lockStatus.extraOption === 4
                  ? 'Cancellation requested'
                  : metadata.lockStatus.extraOption === 6 || metadata.lockStatus.extraOption === 7
                    ? 'Amendment requested'
                    : 'Locked pending review'}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
