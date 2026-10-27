/**
 * Refunded products section — displayed below the main products table.
 * Requirements: REQ-05-016
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import type { OrderProductItem } from '../hooks/useOrderProducts';

interface RefundedProductsProps {
  products: OrderProductItem[];
}

export function RefundedProducts({ products }: RefundedProductsProps) {
  return (
    <Card className="border-red-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-red-600">
          Refunded Products ({products.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead>Product</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-center">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Return Comment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.ordersProductsId} className="text-xs bg-red-50">
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.model ?? ''}</TableCell>
                <TableCell className="text-center">{p.quantity}</TableCell>
                <TableCell className="text-right font-bold">
                  £{p.finalPrice.toFixed(2)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {p.returnComment ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
