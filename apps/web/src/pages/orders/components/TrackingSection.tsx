/**
 * Tracking numbers display — order tracking, DHL, Royal Mail, DPD, last scan.
 * Requirements: REQ-04-011
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDbSqlDateTime } from '@/lib/date-utils';
import type { TrackingInfo } from '../hooks/useOrderDetail';

interface TrackingSectionProps {
  tracking: TrackingInfo;
}

export function TrackingSection({ tracking }: TrackingSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Tracking Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {/* REQ-04-011: Order product tracking numbers */}
        <div className="flex gap-2">
          <span className="font-medium text-muted-foreground w-28 shrink-0">Tracking:</span>
          <span>
            {tracking.orderTracking.length > 0
              ? tracking.orderTracking.join(', ')
              : 'Not Available'}
          </span>
        </div>

        {/* REQ-04-011: DHL shipment numbers */}
        {tracking.dhl.length > 0 && (
          <div className="flex gap-2">
            <span className="font-medium text-muted-foreground w-28 shrink-0">DHL:</span>
            <span>
              {tracking.dhl.map((num, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  <a
                    href={`https://www.dhl.com/en/express/tracking.html?AWB=${num}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {num}
                  </a>
                </span>
              ))}
            </span>
          </div>
        )}

        {/* REQ-04-011: Royal Mail shipment numbers */}
        {tracking.royalMail.length > 0 && (
          <div className="flex gap-2">
            <span className="font-medium text-muted-foreground w-28 shrink-0">Royal Mail:</span>
            <span>
              {tracking.royalMail.map((num, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  <a
                    href={`https://www.royalmail.com/track-your-item#/tracking-results/${num}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {num}
                  </a>
                </span>
              ))}
            </span>
          </div>
        )}

        {/* REQ-04-011: DPD tracking numbers */}
        {tracking.dpd.length > 0 && (
          <div className="flex gap-2">
            <span className="font-medium text-muted-foreground w-28 shrink-0">DPD:</span>
            <span>
              {tracking.dpd.map((num, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  <a
                    href={`https://track.dpd.co.uk/parcel/${num}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {num}
                  </a>
                </span>
              ))}
            </span>
          </div>
        )}

        {/* REQ-04-011: Last scan date — matches Zenc format "2024-06-27 13:05:44".
            Show the scanning_activity_logs.modified_date whenever a scan row exists,
            independent of tracking numbers. The legacy edit_order.php gates this on
            `if ($track_show_no == "Not Available")`, but $track_show_no is an ARRAY
            there (edit_order.php:4008) — `array == "string"` is always false in PHP —
            so that gate is dead code and zenc always shows the scan date when present.
            (Reverts BUG-432, which mirrored the *apparent* gate, not the *effective*
            behaviour; verified live against zenc for order 1793119 → "08:10:17".) */}
        <div className="flex gap-2">
          <span className="font-medium text-muted-foreground w-28 shrink-0">Last Scan:</span>
          <span>
            {tracking.lastScanDate
              ? formatDbSqlDateTime(tracking.lastScanDate)
              : 'Not Available'}
          </span>
        </div>

        {/* REQ-04-011: Shipment returned status */}
        {tracking.courierReturnStatus != null && tracking.courierReturnStatus > 0 && (
          <div className="mt-2 rounded bg-amber-100 px-3 py-1.5 text-amber-800 text-xs font-semibold">
            {tracking.courierReturnStatus === 3
              ? 'Claim submitted for shipment'
              : 'SHIPMENT RETURNED'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
