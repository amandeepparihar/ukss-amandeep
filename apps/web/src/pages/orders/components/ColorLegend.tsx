/**
 * Color legend for product rows + lock for review toggle.
 * Requirements: REQ-04-019
 */

import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToggleLockForReview } from '../hooks/useOrderDetail';

interface ColorLegendProps {
  orderId: number;
  lockForReview: boolean;
}

/** REQ-04-019: 9 color swatches (16x16px) */
const LEGEND_ITEMS = [
  { color: '#13DFF9', label: 'Personalization' },
  { color: '#FAA631', label: 'Scanned' },
  { color: '#FF66CC', label: 'Return' },
  { color: '#2bc312', label: 'Backorder' },
  { color: 'yellow', label: 'Matched' },
  { color: 'pink', label: 'Exchanged' },
  { color: 'lightgreen', label: 'Allocate' },
  { color: '#fa8260', label: 'FC ONBACKORDER' },
  { color: '#adbddc', label: 'Mystery' },
] as const;

export function ColorLegend({ orderId, lockForReview }: ColorLegendProps) {
  const toggleLock = useToggleLockForReview(orderId);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Color Legend</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <div
                className="h-4 w-4 rounded-sm border"
                style={{ backgroundColor: item.color }}
              />
              <span>{item.label}</span>
            </div>
          ))}

          {/* REQ-04-019: Lock for review checkbox */}
          <div className="ml-auto flex items-center gap-2 border-l pl-4">
            <Checkbox
              id="lockForReview"
              checked={lockForReview}
              disabled={toggleLock.isPending}
              onCheckedChange={() => toggleLock.mutate()}
            />
            <Label htmlFor="lockForReview" className="flex items-center gap-1 text-xs">
              Lock for Review
              {toggleLock.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            </Label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
