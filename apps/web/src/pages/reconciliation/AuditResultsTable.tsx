import { Fragment, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AuditDetailRow } from './AuditDetailRow';
import { formatDate } from './utils';

// ─── Types ───────────────────────────────────────────────────

interface ShippingAddress {
  line1: string;
  city: string;
  postcode: string;
  country: string;
}

interface LineItem {
  sku: string;
  productName: string;
  quantity: number;
  price: number;
}

interface MarketplaceData {
  orderId: string;
  storeName: string;
  storeId: number;
  orderDate: string;
  status: string;
  financialStatus?: string;
  customerName: string;
  customerEmail: string;
  shippingAddress: ShippingAddress;
  lineItems: LineItem[];
  marketplaceUrl?: string;
}

interface MoData {
  found: boolean;
  moId?: number;
  moOrderStatus?: string;
  moCustomerName?: string;
  moCustomerEmail?: string;
  moShippingLine1?: string;
  moShippingCity?: string;
  moShippingCountry?: string;
  moShippingZipcode?: string;
  moUkssOrderId?: number;
  moDateAdded?: string;
}

interface MopProduct {
  mopId?: number;
  mopProductSku: string;
  mopProductName: string;
  mopProductQuantity: number;
  mopProductPrice: number;
  mopUkssProductSku: string;
  mopUkssOrdersProductsId?: number;
}

interface MopData {
  products: MopProduct[];
}

interface UkssOrderData {
  found: boolean;
  ordersId?: number;
  ordersStatus?: number;
  ordersStatusName?: string;
  customersName?: string;
  customersEmailAddress?: string;
  deliveryStreetAddress?: string;
  deliveryCity?: string;
  deliveryPostcode?: string;
  deliveryCountry?: string;
  orderTotal?: number;
  datePurchased?: string;
}

interface UkssProduct {
  ordersProductsId?: number;
  productsModel: string;
  productsName: string;
  productsQuantity: number;
  productsPrice: number;
  finalPrice: number;
}

interface UkssProductsData {
  products: UkssProduct[];
}

interface AuditFlags {
  missingFromMo: boolean;
  unconverted: boolean;
  productCountMismatch: boolean;
}

export interface AuditOrderRecord {
  marketplace: MarketplaceData;
  mo: MoData;
  mop: MopData;
  ukssOrder: UkssOrderData;
  ukssProducts: UkssProductsData;
  flags: AuditFlags;
}

type AuditFilter = 'all' | 'missing' | 'unconverted' | 'mismatch';

interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface AuditResultsTableProps {
  results: {
    orders: AuditOrderRecord[];
    pagination: Pagination;
    summary: unknown;
  };
  page: number;
  filter: AuditFilter;
  onPageChange: (page: number) => void;
  onFilterChange: (filter: AuditFilter) => void;
  isLoading: boolean;
}

// ─── Component ───────────────────────────────────────────────

export function AuditResultsTable({
  results,
  page,
  filter,
  onPageChange,
  onFilterChange,
  isLoading,
}: AuditResultsTableProps) {
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const toggleExpand = (orderId: string) => {
    setExpandedOrderId((prev) => (prev === orderId ? null : orderId));
  };

  const { orders, pagination } = results;
  const { pageSize, totalItems, totalPages } = pagination;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filter:</span>
          <Select value={filter} onValueChange={(value) => onFilterChange(value as AuditFilter)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Orders</SelectItem>
              <SelectItem value="missing">Missing from MO</SelectItem>
              <SelectItem value="unconverted">Unconverted</SelectItem>
              <SelectItem value="mismatch">Product Mismatches</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <span className="text-sm text-muted-foreground">
          {totalItems > 0
            ? `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, totalItems)} of ${totalItems}`
            : 'No results'}
        </span>
      </div>

      {/* Empty state */}
      {orders.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          No orders match the selected filter.
        </div>
      ) : (
        <>
          {/* Table */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>MP Status</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>MO Status</TableHead>
                <TableHead>UKSS Order</TableHead>
                <TableHead>UKSS Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((record) => (
                <Fragment key={record.marketplace.orderId}>
                  {/* Main row - clickable to expand */}
                  <TableRow
                    className={cn(
                      'cursor-pointer hover:bg-muted/50',
                      record.flags.missingFromMo && 'bg-red-50 hover:bg-red-100',
                      !record.flags.missingFromMo &&
                        record.flags.unconverted &&
                        'bg-amber-50 hover:bg-amber-100',
                    )}
                    onClick={() => toggleExpand(record.marketplace.orderId)}
                  >
                    <TableCell>
                      {record.marketplace.marketplaceUrl ? (
                        <a
                          href={record.marketplace.marketplaceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {record.marketplace.orderId}{' '}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        record.marketplace.orderId
                      )}
                    </TableCell>
                    <TableCell>{formatDate(record.marketplace.orderDate)}</TableCell>
                    <TableCell>{record.marketplace.status}</TableCell>
                    <TableCell>{record.marketplace.customerName}</TableCell>
                    <TableCell>{record.marketplace.lineItems.length}</TableCell>
                    <TableCell>
                      {record.mo.found ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                          Found
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
                          Missing
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {record.ukssOrder.found ? (
                        <a
                          href={`/orders?id=${record.ukssOrder.ordersId}`}
                          className="text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {record.ukssOrder.ordersId}
                        </a>
                      ) : record.mo.found ? (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                          Unconverted
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {record.ukssOrder.ordersStatus != null
                        ? `${record.ukssOrder.ordersStatusName || 'Unknown'} (${record.ukssOrder.ordersStatus})`
                        : <span className="text-muted-foreground">&mdash;</span>}
                    </TableCell>
                  </TableRow>

                  {/* Expanded detail row */}
                  {expandedOrderId === record.marketplace.orderId && (
                    <TableRow>
                      <TableCell colSpan={8} className="p-0">
                        <AuditDetailRow record={record} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
