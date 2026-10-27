/**
 * Status history display — shows the audit trail of status changes.
 * Requirements: REQ-07-018
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDbDateTime } from '@/lib/date-utils';
import { useStatusHistory } from '../hooks/useOrderStatus';

interface StatusHistoryProps {
  orderId: number;
}

export function StatusHistory({ orderId }: StatusHistoryProps) {
  const { data: history, isLoading } = useStatusHistory(orderId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!history || history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No status history available.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Status History ({history.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[400px] overflow-y-auto">
          <div className="space-y-3">
            {history.map((item) => (
              <div
                key={item.id}
                className="border-b pb-3 last:border-b-0 last:pb-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {item.statusName}
                    </Badge>
                    {item.customerNotified && (
                      <Badge variant="secondary" className="text-xs">
                        Notified
                      </Badge>
                    )}
                    {item.commentPrivate === 'Yes' && (
                      <Badge variant="destructive" className="text-xs">
                        Private
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDbDateTime(item.dateAdded)}
                  </span>
                </div>
                {item.comments && (
                  <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">
                    {item.comments}
                  </p>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  by {item.commentBy || 'System'}
                  {item.statusChangeFrom && ` (${item.statusChangeFrom})`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
