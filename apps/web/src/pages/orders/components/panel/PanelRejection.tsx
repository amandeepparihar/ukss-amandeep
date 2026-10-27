/**
 * Panel rejection buttons — 5 rejection types with disabled state.
 * Requirements: REQ-03-008 (button visibility), REQ-03-009 (5 types)
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRejectOrder } from '../../hooks/useOrderPanel';

interface PanelRejectionProps {
  orderId: number;
  rejectPermission: boolean;
  refundStatusForReject: number;
}

const REJECTION_TYPES = [
  { type: 1 as const, label: 'Reject' },
  { type: 2 as const, label: 'Reject & Link' },
  { type: 3 as const, label: 'Reject & Remove Size' },
  { type: 4 as const, label: 'Reject & Disable' },
  { type: 5 as const, label: 'Reject & Delete FE' },
] as const;

export function PanelRejection({
  orderId,
  rejectPermission,
  refundStatusForReject,
}: PanelRejectionProps) {
  const rejectMutation = useRejectOrder(orderId);
  const [pendingType, setPendingType] = useState<number | null>(null);

  // REQ-03-008: Hidden when reject_permission = 0
  if (!rejectPermission) return null;

  // REQ-03-008: Disabled when refund_status_for_reject_orders is 1 or 2
  const isDisabled = refundStatusForReject === 1 || refundStatusForReject === 2;

  const handleReject = async (actionType: 1 | 2 | 3 | 4 | 5) => {
    // REQ-03-009: Confirm before rejecting
    const confirmed = window.confirm(
      `Are you sure you want to reject order ${orderId}? This action cannot be undone.`
    );
    if (!confirmed) return;

    setPendingType(actionType);
    try {
      const result = await rejectMutation.mutateAsync(actionType);
      if (result.result === 'success') {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error('Failed to reject order. Please try again.');
    } finally {
      setPendingType(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-muted-foreground">Rejection</div>
      <div className="flex flex-wrap gap-1.5">
        {REJECTION_TYPES.map(({ type, label }) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            disabled={isDisabled || pendingType !== null}
            className={isDisabled ? 'opacity-50 cursor-not-allowed' : 'text-red-600 hover:text-red-700'}
            onClick={() => handleReject(type)}
          >
            {pendingType === type && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
