import type { AuditOrderRecord } from './AuditResultsTable';
import { formatDate } from './utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';

interface AuditDetailRowProps {
  record: AuditOrderRecord;
}

// --- Helper components and functions ---

function InfoRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">
        {value != null ? String(value) : '\u2014'}
      </span>
    </div>
  );
}

function formatAddress(addr: { line1: string; city: string; postcode: string; country: string }): string {
  return (
    [addr.line1, addr.city, addr.postcode, addr.country]
      .filter(Boolean)
      .join(', ') || '\u2014'
  );
}

// --- Main component ---

export function AuditDetailRow({ record }: AuditDetailRowProps) {
  return (
    <div className="p-4 bg-muted/30 border-t">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Panel 1: Marketplace API */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Marketplace API</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <InfoRow label="Order ID" value={record.marketplace.orderId} />
            <InfoRow label="Store" value={record.marketplace.storeName} />
            <InfoRow label="Status" value={record.marketplace.status} />
            {record.marketplace.financialStatus && (
              <InfoRow
                label="Financial"
                value={record.marketplace.financialStatus}
              />
            )}
            <InfoRow
              label="Customer"
              value={record.marketplace.customerName}
            />
            <InfoRow label="Email" value={record.marketplace.customerEmail} />
            <InfoRow
              label="Ship To"
              value={formatAddress(record.marketplace.shippingAddress)}
            />

            <Separator className="my-2" />
            <p className="font-medium">
              Line Items ({record.marketplace.lineItems.length})
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">SKU</TableHead>
                  <TableHead className="text-xs">Product</TableHead>
                  <TableHead className="text-xs">Qty</TableHead>
                  <TableHead className="text-xs">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {record.marketplace.lineItems.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{item.sku}</TableCell>
                    <TableCell className="text-xs truncate max-w-[150px]">
                      {item.productName}
                    </TableCell>
                    <TableCell className="text-xs">{item.quantity}</TableCell>
                    <TableCell className="text-xs">
                      {item.price.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Panel 2: MO/MOP Tables */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">MO / MOP Tables</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!record.mo.found ? (
              <Alert variant="destructive" className="py-2">
                <AlertDescription>
                  Not found in marketplace_orders table
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <InfoRow label="MO ID" value={record.mo.moId} />
                <InfoRow
                  label="Status"
                  value={record.mo.moOrderStatus ?? '\u2014'}
                />
                <InfoRow
                  label="Customer"
                  value={record.mo.moCustomerName ?? '\u2014'}
                />
                <InfoRow
                  label="Email"
                  value={record.mo.moCustomerEmail ?? '\u2014'}
                />
                <InfoRow
                  label="Ship To"
                  value={
                    [
                      record.mo.moShippingLine1,
                      record.mo.moShippingCity,
                      record.mo.moShippingZipcode,
                      record.mo.moShippingCountry,
                    ]
                      .filter(Boolean)
                      .join(', ') || '\u2014'
                  }
                />
                <InfoRow
                  label="UKSS Order"
                  value={record.mo.moUkssOrderId ?? 'Not converted'}
                />
                <InfoRow
                  label="Date Added"
                  value={
                    record.mo.moDateAdded
                      ? formatDate(record.mo.moDateAdded)
                      : '\u2014'
                  }
                />

                <Separator className="my-2" />
                <p className="font-medium">
                  MOP Products ({record.mop.products.length})
                </p>
                {record.mop.products.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">SKU</TableHead>
                        <TableHead className="text-xs">Product</TableHead>
                        <TableHead className="text-xs">Qty</TableHead>
                        <TableHead className="text-xs">Price</TableHead>
                        <TableHead className="text-xs">UKSS SKU</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {record.mop.products.map((p, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">
                            {p.mopProductSku}
                          </TableCell>
                          <TableCell className="text-xs truncate max-w-[150px]">
                            {p.mopProductName}
                          </TableCell>
                          <TableCell className="text-xs">
                            {p.mopProductQuantity}
                          </TableCell>
                          <TableCell className="text-xs">
                            {Number(p.mopProductPrice).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {p.mopUkssProductSku}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No products recorded
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Panel 3: UKSS Orders */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">UKSS Orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!record.ukssOrder.found ? (
              <Alert className="py-2 border-amber-200 bg-amber-50">
                <AlertDescription className="text-amber-800">
                  {record.mo.found
                    ? 'Order not yet converted to UKSS'
                    : 'N/A \u2014 order missing from MO table'}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <InfoRow
                  label="Order ID"
                  value={record.ukssOrder.ordersId}
                />
                <InfoRow
                  label="Status"
                  value={record.ukssOrder.ordersStatus != null
                    ? `${record.ukssOrder.ordersStatusName || 'Unknown'} (${record.ukssOrder.ordersStatus})`
                    : undefined}
                />
                <InfoRow
                  label="Customer"
                  value={record.ukssOrder.customersName ?? '\u2014'}
                />
                <InfoRow
                  label="Email"
                  value={record.ukssOrder.customersEmailAddress ?? '\u2014'}
                />
                <InfoRow
                  label="Ship To"
                  value={
                    [
                      record.ukssOrder.deliveryStreetAddress,
                      record.ukssOrder.deliveryCity,
                      record.ukssOrder.deliveryPostcode,
                      record.ukssOrder.deliveryCountry,
                    ]
                      .filter(Boolean)
                      .join(', ') || '\u2014'
                  }
                />
                <InfoRow
                  label="Total"
                  value={
                    record.ukssOrder.orderTotal != null
                      ? `\u00A3${Number(record.ukssOrder.orderTotal).toFixed(2)}`
                      : '\u2014'
                  }
                />
                <InfoRow
                  label="Purchased"
                  value={
                    record.ukssOrder.datePurchased
                      ? formatDate(record.ukssOrder.datePurchased)
                      : '\u2014'
                  }
                />

                <Separator className="my-2" />
                <p className="font-medium">
                  Products ({record.ukssProducts.products.length})
                </p>
                {record.ukssProducts.products.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Model</TableHead>
                        <TableHead className="text-xs">Product</TableHead>
                        <TableHead className="text-xs">Qty</TableHead>
                        <TableHead className="text-xs">Price</TableHead>
                        <TableHead className="text-xs">Final</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {record.ukssProducts.products.map((p, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">
                            {p.productsModel}
                          </TableCell>
                          <TableCell className="text-xs truncate max-w-[150px]">
                            {p.productsName}
                          </TableCell>
                          <TableCell className="text-xs">
                            {p.productsQuantity}
                          </TableCell>
                          <TableCell className="text-xs">
                            {Number(p.productsPrice).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {Number(p.finalPrice).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No products recorded
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
