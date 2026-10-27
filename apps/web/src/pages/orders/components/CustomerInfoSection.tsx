/**
 * Customer information section — name, contact, priority/approve toggles.
 * Requirements: REQ-04-007
 */

import { Phone, Mail, Globe, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { OrderDetailData } from '../hooks/useOrderDetail';
import { useTogglePriority, useToggleApprove } from '../hooks/useOrderDetail';

interface CustomerInfoSectionProps {
  order: OrderDetailData;
}

export function CustomerInfoSection({ order }: CustomerInfoSectionProps) {
  const { customer } = order;
  const togglePriority = useTogglePriority(order.orderId);
  const toggleApprove = useToggleApprove(order.orderId);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Customer Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <span className="font-medium">{customer.name}</span>
          {customer.company && <span className="text-muted-foreground"> ({customer.company})</span>}
        </div>

        {customer.phone && (
          <div className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{customer.phone}</span>
          </div>
        )}

        {customer.email && (
          <div className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            <a href={`mailto:${customer.email}`} className="text-blue-600 hover:underline">{customer.email}</a>
          </div>
        )}

        {customer.ipAddress && (
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{customer.ipAddress}</span>
          </div>
        )}

        <div className="flex items-center gap-6 border-t pt-3">
          {/* REQ-04-007: Priority checkbox */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="priority"
              checked={customer.isPriority}
              disabled={togglePriority.isPending}
              onCheckedChange={() => togglePriority.mutate(customer.id)}
            />
            <Label htmlFor="priority" className="flex items-center gap-1">
              Priority
              {togglePriority.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            </Label>
          </div>

          {/* REQ-04-007: Approve checkbox */}
          {customer.id > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="approve"
                checked={customer.isApproved}
                disabled={toggleApprove.isPending}
                onCheckedChange={() => toggleApprove.mutate(customer.id)}
              />
              <Label htmlFor="approve" className="flex items-center gap-1">
                Approve
                {toggleApprove.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              </Label>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
