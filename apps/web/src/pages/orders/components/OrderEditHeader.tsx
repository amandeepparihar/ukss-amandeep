/**
 * Order edit page header — order ID, prev/next navigation, concurrent viewers.
 * Requirements: REQ-04-002, REQ-04-004, REQ-04-013, REQ-04-027
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { OrderDetailData, OrderViewer } from '../hooks/useOrderDetail';
import { useOrderNavigation } from '../hooks/useOrderDetail';

interface OrderEditHeaderProps {
  order: OrderDetailData;
  viewers: OrderViewer[];
}

export function OrderEditHeader({ order, viewers }: OrderEditHeaderProps) {
  const navigate = useNavigate();
  const navigation = useOrderNavigation(order.orderId);
  const [navigating, setNavigating] = useState<'prev' | 'next' | null>(null);

  const handleNavigate = async (direction: 'prev' | 'next') => {
    setNavigating(direction);
    try {
      const result = await navigation.mutateAsync({
        direction,
        status: order.status,
      });
      if (result.status === 'success' && result.data?.orderId) {
        navigate(`/orders/${result.data.orderId}`, { replace: true });
      } else {
        toast.info('No more orders exist');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setNavigating(null);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {/* REQ-04-002: Prev button */}
        <Button
          variant="outline" size="icon"
          aria-label="Previous order"
          onClick={() => handleNavigate('prev')}
          disabled={navigating !== null}
        >
          {navigating === 'prev' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>

        <h1 className="text-2xl font-bold">Order #{order.orderId}</h1>

        {/* REQ-04-002: Next button */}
        <Button
          variant="outline" size="icon"
          aria-label="Next order"
          onClick={() => handleNavigate('next')}
          disabled={navigating !== null}
        >
          {navigating === 'next' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
        </Button>

        {/* REQ-04-027: Status labels */}
        <Badge variant="outline" className="ml-2">{order.statusName}</Badge>
        {order.flags.isPrime && (
          <span className="text-lg font-bold text-red-600">PRIME</span>
        )}
        {order.flags.isDhl && (
          <span className="text-lg font-bold text-red-600">DHL</span>
        )}
        {order.metadata.isExchange && (
          <span className="text-lg font-bold text-red-600">EXCHANGE ORDER</span>
        )}
        {order.customer.isPriority && (
          <span className="text-lg font-bold" style={{ color: '#B80207' }}>PRIORITY</span>
        )}
        {order.customer.isApproved && (
          <span className="text-lg font-bold" style={{ color: '#4D9993' }}>APPROVE</span>
        )}
        {order.flags.isGreenFc && (
          <span className="text-lg font-bold text-green-600">GREEN FC</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* REQ-04-018: Store name */}
        <span className="text-sm text-muted-foreground">{order.store.name}</span>

        {/* REQ-04-004: Concurrent viewers */}
        {viewers.length > 0 && (
          <div className="rounded bg-yellow-100 px-3 py-1 text-sm text-yellow-800">
            {viewers.map((v, i) => (
              <span key={v.name}>
                <strong>{v.name}</strong> is viewing this order.{i < viewers.length - 1 && <br />}
              </span>
            ))}
          </div>
        )}

        {/* Back button */}
        <Button variant="outline" onClick={() => navigate('/orders')}>
          Back to Orders
        </Button>
      </div>
    </div>
  );
}
