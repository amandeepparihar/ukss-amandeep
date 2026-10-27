/**
 * Marketplace order IDs display — shows all non-null marketplace IDs in red.
 * Requirements: REQ-04-009
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MarketplaceIds } from '../hooks/useOrderDetail';

interface MarketplaceIdsSectionProps {
  marketplaceIds: MarketplaceIds;
  orderSite: number | null;
}

interface IdEntry {
  label: string;
  value: string;
  color?: string;
}

export function MarketplaceIdsSection({ marketplaceIds, orderSite }: MarketplaceIdsSectionProps) {
  const entries: IdEntry[] = [];

  // REQ-04-009: Each shown only if not NULL, red #FF0000 bold
  if (marketplaceIds.amazon) entries.push({ label: 'Amazon Order Id', value: marketplaceIds.amazon });
  if (marketplaceIds.mplaza) entries.push({ label: 'Mplaza Order Id', value: marketplaceIds.mplaza });
  if (marketplaceIds.tesco) {
    // REQ-04-009: Tesco + parcel tracking from tesco_orders
    const tescoVal = marketplaceIds.tescoTracking
      ? `${marketplaceIds.tesco} (Tracking: ${marketplaceIds.tescoTracking})`
      : marketplaceIds.tesco;
    entries.push({ label: 'Tesco Order Id', value: tescoVal });
  }
  if (marketplaceIds.ebay) entries.push({ label: 'eBay Order Id', value: marketplaceIds.ebay });
  if (marketplaceIds.rakuten) entries.push({ label: 'Rakuten Order Id', value: marketplaceIds.rakuten });
  if (marketplaceIds.lazada) entries.push({ label: 'Lazada Order Id', value: marketplaceIds.lazada });
  if (marketplaceIds.priceminister) entries.push({ label: 'PriceMinister Order Id', value: marketplaceIds.priceminister });
  if (marketplaceIds.gosport) entries.push({ label: 'Go-Sport Order Id', value: marketplaceIds.gosport });
  if (marketplaceIds.catch) entries.push({ label: 'Catch Order Id', value: marketplaceIds.catch });
  if (marketplaceIds.fruugo) entries.push({ label: 'Fruugo Order Id', value: marketplaceIds.fruugo });
  if (marketplaceIds.decathlon) entries.push({ label: 'Decathlon Order Id', value: marketplaceIds.decathlon });
  if (marketplaceIds.laybuy) entries.push({ label: 'Laybuy Order Id', value: marketplaceIds.laybuy });

  // REQ-04-009: Terracegear (site 117) — special format
  if (orderSite === 117 && marketplaceIds.shopify) {
    const terVal = marketplaceIds.multisite
      ? `${marketplaceIds.shopify} (${marketplaceIds.multisite})`
      : marketplaceIds.shopify;
    entries.push({ label: 'Terracegear Order Id', value: terVal });
  } else if (marketplaceIds.shopify) {
    entries.push({ label: 'Shopify Order Id', value: marketplaceIds.shopify });
  }
  if (marketplaceIds.multisite && orderSite !== 117) {
    entries.push({ label: 'Multisite Order Id', value: marketplaceIds.multisite });
  }

  // REQ-04-009: mo_marketplace_orders entries
  for (const mo of marketplaceIds.moOrders) {
    entries.push({ label: `${mo.storeName} Order Id`, value: mo.orderId });
  }

  // NOTE: FC Order ID is intentionally excluded here — it is an internal fulfilment
  // reference, not an external marketplace order ID. It is displayed separately in
  // the FC Order Status section of the panel. Fixes #352.

  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Marketplace Order IDs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {entries.map((entry, i) => (
            <span key={i}>
              <span className="text-muted-foreground">{entry.label}: </span>
              <span className={`font-bold ${entry.color ?? 'text-red-600'}`}>{entry.value}</span>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
