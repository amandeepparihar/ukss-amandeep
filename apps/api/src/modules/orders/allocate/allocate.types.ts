import type { SupplierFreeQuantity } from './free-quantity.service';

export interface SupplierOption { id: number; name: string; manufacturerId: number | null; }

/** All metadata needed to write an sop row, derived server-side from the order line. */
export interface SupplierLineMetadata {
  orderProductId: number;     // orders_products.orders_products_id
  productId: number;          // hero-remapped parent if applicable, else line products_id
  masterProductId: number;    // the original ordered products_id (sop.master_product_id)
  productName: string;
  productModel: string;
  sizeName: string;           // products_options_values_name
  shortname: string;          // size_group_items.shortname
  orderId: number;
  orderDate: string;          // orders.date_purchased
  customerId: number;
  customerName: string;
  manufacturersId: number;
  productsOptionsValuesId: number;
  pvtId: string;
  defaultOptionValueId: number;
}

export interface SupplierOptionLine {
  metadata: SupplierLineMetadata;
  freeQuantity: SupplierFreeQuantity;
}

export interface SupplierOptionsResponse {
  lines: SupplierOptionLine[];
  suppliers: SupplierOption[]; // union of manufacturer-matched suppliers across the requested lines
}

export interface CreateSupplierOrderResult {
  createdLines: number;
  updatedLines: number;
  overflowRows: number;
  /** All AIRO lines on the order are now covered → orders_status = 128 (IN_TRANSIT). */
  statusChangedTo128: boolean;
  /** All Toffs lines on the order are now covered → orders_status = 22 (RETRO_SHIRTS). */
  statusChangedTo22: boolean;
}
