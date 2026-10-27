/**
 * Delivery and billing address display.
 * Requirements: REQ-04-008
 *
 * Deferred to SPEC-11 (Shipping):
 * - "Change Address" dialog (opens change_delivery_address.php equivalent)
 * - ISF checkbox (AJAX toggle for altaddress class)
 */

import { toast } from 'sonner';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AddressInfo } from '../hooks/useOrderDetail';

interface AddressSectionProps {
  deliveryAddress: AddressInfo;
  billingAddress: AddressInfo;
}

function formatAddress(addr: AddressInfo): string[] {
  const lines: string[] = [];
  if (addr.name) lines.push(addr.name);
  if (addr.company) lines.push(addr.company);
  if (addr.street) lines.push(addr.street);
  if (addr.suburb) lines.push(addr.suburb);
  // Match zenc's address format: City, Postcode / State, Country
  // This covers marketplace orders (hardcoded in PHP) and address_format #1 (238/244 countries)
  const cityPostcode = [addr.city, addr.postcode].filter(Boolean).join(', ');
  if (cityPostcode) lines.push(cityPostcode);
  const stateCountry = [addr.state, addr.country].filter(Boolean).join(', ');
  if (stateCountry) lines.push(stateCountry);
  return lines;
}

function AddressCard({ title, address, showChangeLink }: { title: string; address: AddressInfo; showChangeLink?: boolean }) {
  const lines = formatAddress(address);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {showChangeLink && (
          <Button
            variant="ghost" size="sm" className="h-7 text-xs"
            onClick={() => toast.info('Change Address will be implemented in SPEC-11')}
          >
            <Pencil className="mr-1 h-3 w-3" />
            Change Address
          </Button>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {lines.length > 0 ? (
          lines.map((line, i) => <div key={i}>{line}</div>)
        ) : (
          <span className="text-muted-foreground">No address on record</span>
        )}
      </CardContent>
    </Card>
  );
}

export function AddressSection({ deliveryAddress, billingAddress }: AddressSectionProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <AddressCard title="Delivery Address" address={deliveryAddress} showChangeLink />
      <AddressCard title="Billing Address" address={billingAddress} />
    </div>
  );
}
