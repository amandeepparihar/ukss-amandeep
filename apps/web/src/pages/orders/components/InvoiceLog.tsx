/**
 * SPEC-13: Invoice Log component.
 * Requirements: REQ-13-005 (invoice log display)
 *
 * Matches PHP order_invoice_simulation.php — shows per-product invoice status,
 * size, remote processing status, and actual print data from printedinvoice_parsing_result.
 */

import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDbDateTime } from '@/lib/date-utils';
import { useInvoiceLog } from '../hooks/useOrderProcessing';

interface InvoiceLogProps {
  orderId: number;
}

export function InvoiceLog({ orderId }: InvoiceLogProps) {
  const [showLog, setShowLog] = useState(false);
  const { data: entries, isLoading } = useInvoiceLog(orderId, showLog);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Invoice Log</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLog(!showLog)}
          >
            <FileText className="mr-2 h-4 w-4" />
            {showLog ? 'Hide Log' : 'View Invoice Log'}
          </Button>
        </div>
      </CardHeader>

      {showLog && (
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !entries || entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products found for this order.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Remote Order Processing</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Invoice Printed By</TableHead>
                    <TableHead>Invoice Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.ordersProductsId}>
                      <TableCell className="max-w-[250px] truncate text-sm">
                        {entry.productName}
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.size || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={entry.remoteProcessingStatus === 'Added' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {entry.remoteProcessingStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.invoiceType}
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.invoicePrintedBy || '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.invoiceTime
                          ? formatDbDateTime(entry.invoiceTime)
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
