import type { ColumnDef } from '@tanstack/react-table';
import { CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DataTableColumnHeader } from '@/components/data-table';
import type { SdProduct } from './hooks/useSellerDynamics';

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/**
 * Sortable column `accessorKey`s MUST match the API's `sortBy` enum
 * (sd-tshirts.schema.ts): products_name, products_price, np_best_seller_*,
 * products_date_added. Non-sortable columns set `enableSorting: false`.
 * The checkbox column is injected automatically by <DataTable enableRowSelection />.
 */
export const columns: ColumnDef<SdProduct>[] = [
  {
    accessorKey: 'products_id',
    meta: { title: 'Product ID' },
    header: 'Product ID',
    cell: ({ row }) => <span className="font-mono text-sm">{row.original.products_id}</span>,
    enableSorting: false,
  },
  {
    accessorKey: 'products_name',
    meta: { title: 'Name' },
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
    cell: ({ row }) => (
      <div className="font-medium whitespace-normal break-words" title={row.original.products_name}>
        {row.original.products_name}
      </div>
    ),
  },
  {
    accessorKey: 'products_model',
    meta: { title: 'Model' },
    header: 'Model',
    cell: ({ row }) => <span>{row.original.products_model ?? '—'}</span>,
    enableSorting: false,
  },
  {
    accessorKey: 'products_price',
    meta: { title: 'UKSS Price' },
    header: ({ column }) => <DataTableColumnHeader column={column} title="UKSS Price" />,
    cell: ({ row }) => <span className="tabular-nums">{gbp.format(row.original.products_price)}</span>,
  },
  {
    accessorKey: 'sd_price',
    meta: { title: 'SD Price' },
    header: 'SD Price',
    cell: ({ row }) => <span className="tabular-nums">{gbp.format(row.original.sd_price)}</span>,
    enableSorting: false,
  },
  {
    accessorKey: 'np_best_seller_7days',
    meta: { title: '7 Day' },
    header: ({ column }) => <DataTableColumnHeader column={column} title="7 Day" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.np_best_seller_7days}</span>,
  },
  {
    accessorKey: 'np_best_seller_6months',
    meta: { title: '6 Month' },
    header: ({ column }) => <DataTableColumnHeader column={column} title="6 Month" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.np_best_seller_6months}</span>,
  },
  {
    accessorKey: 'np_best_seller_1year',
    meta: { title: '1 Year' },
    header: ({ column }) => <DataTableColumnHeader column={column} title="1 Year" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.np_best_seller_1year}</span>,
  },
  {
    accessorKey: 'np_best_seller_lifetime',
    meta: { title: 'Lifetime' },
    header: ({ column }) => <DataTableColumnHeader column={column} title="Lifetime" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.np_best_seller_lifetime}</span>,
  },
  {
    accessorKey: 'products_date_added',
    meta: { title: 'Date Added' },
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date Added" />,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {new Date(row.original.products_date_added).toLocaleDateString('en-GB')}
      </span>
    ),
  },
  {
    // id matches the Status faceted filter in SellerDynamicsPage. "Approved" =
    // the product already has Seller Dynamics marketplace_listing rows.
    accessorKey: 'isApproved',
    meta: { title: 'Status' },
    header: 'Status',
    cell: ({ row }) =>
      row.original.isApproved ? (
        <Badge variant="success">
          <CheckCircle className="mr-1 h-3 w-3" />
          Approved
        </Badge>
      ) : (
        <Badge variant="secondary">
          <XCircle className="mr-1 h-3 w-3" />
          Not approved
        </Badge>
      ),
    enableSorting: false,
    enableColumnFilter: false, // filtered server-side via the faceted filter
  },
  {
    // The Flag the product is (or would be) sent to Seller Dynamics with, derived from its
    // Is_Your_Name setting. Rendered for unapproved rows too, deliberately: approving with
    // the customizable box unticked overwrites Is_Your_Name to 'No', so the approver needs
    // to see which shirts are already customizable before selecting them.
    accessorKey: 'sdFlag',
    meta: { title: 'SD Flag' },
    header: 'SD Flag',
    cell: ({ row }) => {
      const flag = row.original.sdFlag;

      // Text only, no icon: this column is read-only here, and an icon would read as an
      // edit affordance.
      return (
        <Badge variant={flag === 'UKSS-CUST' ? 'warning' : 'outline'} className="font-mono">
          {flag}
        </Badge>
      );
    },
    enableSorting: false,
    enableColumnFilter: false,
  },
];
