/**
 * Panel metadata section — static order info display.
 * Requirements: REQ-03-016 (metadata fields)
 */

import { formatDbDate } from '@/lib/date-utils';
import type { OrderPanelData } from '../../hooks/useOrderPanel';

interface PanelMetadataProps {
  data: OrderPanelData;
}

interface MetadataField {
  label: string;
  value: string | null;
}

export function PanelMetadata({ data }: PanelMetadataProps) {
  const dateCreated = data.datePurchased ? formatDbDate(data.datePurchased) : null;
  const lastModified = data.lastModified ? formatDbDate(data.lastModified) : null;

  const fields: MetadataField[] = [
    { label: 'Date Created', value: dateCreated },
    { label: 'Email', value: data.customerEmail },
    { label: 'IP Address', value: data.ipAddress },
    // REQ-03-016: Last Modified only if not null
    ...(lastModified ? [{ label: 'Last Modified', value: lastModified }] : []),
    { label: 'Payment Method', value: data.paymentMethod },
    { label: 'Shipping', value: data.shippingMethod },
  ];

  return (
    <div className="space-y-1 text-sm">
      {fields.map(({ label, value }) => (
        <div key={label} className="flex">
          <span className="text-muted-foreground w-32 flex-shrink-0">{label}:</span>
          <span className="break-all">{value ?? '-'}</span>
        </div>
      ))}
    </div>
  );
}
