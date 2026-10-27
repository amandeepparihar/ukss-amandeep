/**
 * Panel status controls — status dropdown, FC status, notify checkbox, quick update.
 * Requirements: REQ-03-011 (status dropdown), REQ-03-012 (notify + update button)
 * SPEC-07: Wired to actual status update endpoint.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { OrderPanelData } from '../../hooks/useOrderPanel';
import type { OrderStatus } from '../../hooks/useOrders';
import { useStatusUpdate } from '../../hooks/useOrderStatus';

interface PanelStatusControlsProps {
  data: OrderPanelData;
  statuses: OrderStatus[] | undefined;
}

export function PanelStatusControls({ data, statuses }: PanelStatusControlsProps) {
  const [selectedStatus, setSelectedStatus] = useState(String(data.status));
  const statusMutation = useStatusUpdate(data.orderId);

  // Sync when data changes (e.g., user clicks a different order)
  useEffect(() => {
    setSelectedStatus(String(data.status));
  }, [data.status]);

  const isMultisite = data.marketplace.multisiteOrderId != null
    && data.marketplace.multisiteOrderId !== '0'
    && data.marketplace.multisiteOrderId !== '';

  // REQ-03-012: Multisite orders have notify disabled
  const [notifyCustomer, setNotifyCustomer] = useState(!isMultisite);

  // REQ-07-022: Auto-toggle notify based on status selection
  useEffect(() => {
    if (isMultisite) return;
    const statusNum = parseInt(selectedStatus, 10);
    if (statusNum === 23 || statusNum === 12 || statusNum === 128) {
      setNotifyCustomer(false);
    } else {
      setNotifyCustomer(true);
    }
  }, [selectedStatus, isMultisite]);

  const handleUpdate = () => {
    const statusNum = parseInt(selectedStatus, 10);

    statusMutation.mutate(
      {
        status: statusNum,
        previousOrderStatus: data.status,
        comments: '',
        notify: notifyCustomer,
        notifyComments: false,
        privateComment: false,
        useOriginalEmail: false,
        sendMessageAutomatically: false,
        pageForLog: 'Page',
      },
      {
        onSuccess: (result) => {
          if (result.status === 'success') {
            toast.success(result.message);
          } else {
            toast.error(result.message);
          }
        },
        onError: (error) => {
          const msg = (error as { response?: { data?: { message?: string } } })
            ?.response?.data?.message || 'Status update failed';
          toast.error(msg);
        },
      }
    );
  };

  return (
    <div className="space-y-3">
      {/* REQ-03-011: FC Order Status (read-only) */}
      {data.fcOrderStatus && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">FC Status:</span>
          <span className="font-medium">{data.fcOrderStatus}</span>
        </div>
      )}

      {/* REQ-03-011: Status dropdown */}
      <div className="flex items-center gap-2">
        <Select value={selectedStatus} onValueChange={setSelectedStatus}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            {statuses?.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* REQ-03-012: Notify + Update */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Checkbox
            id="notify-customer"
            checked={notifyCustomer}
            onCheckedChange={(checked) => setNotifyCustomer(!!checked)}
            disabled={isMultisite}
            className={isMultisite ? 'cursor-not-allowed' : ''}
          />
          <Label htmlFor="notify-customer" className="text-sm">
            Notify Customer
          </Label>
        </div>
        <Button
          size="sm"
          onClick={handleUpdate}
          disabled={statusMutation.isPending}
        >
          {statusMutation.isPending ? 'Updating...' : 'Update'}
        </Button>
      </div>
    </div>
  );
}
