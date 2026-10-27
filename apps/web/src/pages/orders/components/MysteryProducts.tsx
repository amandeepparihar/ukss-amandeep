/**
 * Mystery products section — displayed below the main products table.
 * Requirements: REQ-05-017
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import type { OrderProductItem } from '../hooks/useOrderProducts';

interface MysteryProductsProps {
  products: OrderProductItem[];
}

export function MysteryProducts({ products }: MysteryProductsProps) {
  return (
    <Card className="border-indigo-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-indigo-600">
          Mystery Products ({products.length})
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.ordersProductsId} className="text-xs" style={{ backgroundColor: '#adbddc' }}>
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.model ?? ''}</TableCell>
                <TableCell className="text-center">{p.quantity}</TableCell>
                <TableCell className="text-right font-bold">
                  £{p.finalPrice.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
