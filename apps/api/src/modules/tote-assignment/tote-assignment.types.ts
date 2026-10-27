export interface OrderLookupRow {
  orders_id: number;
  orders_status: number;
  fc_order_id: string | null;
}

export interface OrderProductRow {
  orders_products_id: number;
  orders_id: number;
  products_id: number;
  products_name: string | null;
  products_model: string | null;
  product_barcode: string | null;
  products_quantity: number;
  fc_order_id: string | null;
  fc_batch_id: string | null;
  fc_tote_id: string | null;
  multipart_batch_id: number | null;
  multipart_tote_id: string | null;
}

export interface BatchLookupRow {
  mfo_id: number;
  fc_batch_name: string;
}

export interface BatchProductRow extends OrderProductRow {
  orders_status: number;
}

export interface OrderToteAssignmentResponse {
  ordersId: number;
  ordersStatus: number;
  fcOrderId: string | null;
  products: ToteProductDto[];
}

export interface BatchToteAssignmentResponse {
  mfoId: number;
  fcBatchName: string;
  products: ToteProductDto[];
}

export interface ToteProductDto {
  ordersProductsId: number;
  ordersId: number;
  productsId: number;
  name: string;
  model: string | null;
  barcode: string | null;
  quantity: number;
  fcOrderId: string | null;
  fcBatchId: string | null;
  fcToteId: string | null;
  multipartBatchId: number | null;
  multipartToteId: string | null;
}
