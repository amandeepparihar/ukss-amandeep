/**
 * FC Order Status section — displays FC Order ID and FC Order Status for Amazon
 * Fulfilment Centre orders. Only rendered when fcOrderId is not null.
 * Fixes: #485 (BUG-439 FC order status not shown), #490 (BUG-443 FC Order ID not shown)
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MarketplaceIds } from '../hooks/useOrderDetail';

interface FcOrderSectionProps {
  marketplaceIds: MarketplaceIds;
}

export function FcOrderSection({ marketplaceIds }: FcOrderSectionProps) {
  const { fcOrderId, fcStatus } = marketplaceIds;

  // Only render for Amazon FC orders
  if (!fcOrderId) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">FC Order Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-muted-foreground">FC Order ID: </span>
            <span className="font-bold text-red-600">{fcOrderId}</span>
          </span>
          {fcStatus && (
            <span>
              <span className="text-muted-foreground">FC Order Status: </span>
              <span className="font-bold text-red-600">{fcStatus}</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
