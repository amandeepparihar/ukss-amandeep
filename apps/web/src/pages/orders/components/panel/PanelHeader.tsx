/**
 * Panel header — order heading with ID, date, Prime indicator, and action buttons.
 * Requirements: REQ-03-004 (heading), REQ-03-005 (edit/delete/cancel refund buttons),
 *   REQ-03-006 (delete confirmation dialog)
 */

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Pencil, Trash2, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDbDate } from '@/lib/date-utils';
import type { OrderPanelData } from '../../hooks/useOrderPanel';
import { useCancelRefund, useDeleteOrder } from '../../hooks/useOrderPanel';

interface PanelHeaderProps {
  data: OrderPanelData;
  rejectPermission: boolean;
  onOrderDeleted?: () => void;
}

export function PanelHeader({ data, rejectPermission, onOrderDeleted }: PanelHeaderProps) {
  const [searchParams] = useSearchParams();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [restock, setRestock] = useState(false);

  const cancelRefundMutation = useCancelRefund(data.orderId);
  const deleteMutation = useDeleteOrder(data.orderId);

  // REQ-03-004: Format date short
  const dateStr = data.datePurchased ? formatDbDate(data.datePurchased) : '';

  // Preserve current URL params when navigating to edit
  const preserveParams = searchParams.toString();
  const editUrl = `/orders/${data.orderId}${preserveParams ? `?${preserveParams}` : ''}`;

  // REQ-03-005: Cancel Refund visible only when refund_status=1 AND reject_permission=1
  const showCancelRefund = data.refundStatusForReject === 1 && rejectPermission;

  const handleCancelRefund = async () => {
    try {
      const result = await cancelRefundMutation.mutateAsync();
      if (result.status === 'success') {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error('Failed to cancel refund. Please try again.');
    }
  };

  const handleDeleteConfirm = async () => {
    try {
      const result = await deleteMutation.mutateAsync(restock);
      if (result.result === 'success') {
        toast.success(result.message);
        setShowDeleteDialog(false);
        onOrderDeleted?.();
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error('Failed to delete order. Please try again.');
    }
  };

  return (
    <div className="space-y-2">
      {/* REQ-03-004: Order heading */}
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold">
          [{data.orderId}] {dateStr}
        </h3>
        {data.isPrime && (
          <span className="text-red-600 font-bold text-sm">UK PRIME</span>
        )}
      </div>

      {/* REQ-03-005: Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" asChild>
          <Link to={editUrl}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Link>
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="text-red-600 hover:text-red-700"
          onClick={() => setShowDeleteDialog(true)}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>

        {showCancelRefund && (
          <Button
            variant="outline"
            size="sm"
            className="text-orange-600 hover:text-orange-700"
            disabled={cancelRefundMutation.isPending}
            onClick={handleCancelRefund}
          >
            {cancelRefundMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <XCircle className="h-3.5 w-3.5 mr-1" />
            }
            Cancel Refund
          </Button>
        )}
      </div>

      {/* REQ-03-006: Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => {
        setShowDeleteDialog(open);
        if (!open) setRestock(false);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Are you sure you want to delete this order?</p>
                <div className="text-foreground font-bold">
                  <div>Invoice No. {data.orderId}</div>
                  <div>{data.orderTotal?.toFixed(2) ?? '0.00'}</div>
                  <div>{data.customerName ?? 'Unknown'}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="restock-checkbox"
                    checked={restock}
                    onCheckedChange={(checked) => setRestock(!!checked)}
                  />
                  <Label htmlFor="restock-checkbox" className="text-sm cursor-pointer">
                    Restock product quantity
                  </Label>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={handleDeleteConfirm}
            >
              {deleteMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
