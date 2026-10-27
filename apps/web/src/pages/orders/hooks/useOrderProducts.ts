/**
 * Order products TanStack Query hook — fetches product table data.
 * Requirements: REQ-05-001 through REQ-05-019
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types (mirrors API response from products.types.ts)
// ---------------------------------------------------------------------------

export interface ProductAttribute {
  id: number;
  optionName: string;
  optionValue: string;
  optionId: number | null;
  optionValueId: number | null;
  resolvedOptionValueId: number | null;
  price: number | null;
  pricePrefix: string | null;
  isFree: boolean;
  sizeChanged: boolean;
}

export interface SupplierInfo {
  supplierOrderProductId: number;
  supplierOrderId: number | null;
  supplierId: number | null;
  allocate: number | null;
  exception: number | null;
  manufacturersId: number | null;
}

export interface OrderProductItem {
  ordersProductsId: number;
  productsId: number;
  model: string | null;
  barcode: string | null;
  name: string;
  price: number;
  finalPrice: number;
  tax: number;
  quantity: number;
  onetimeCharges: number;
  freeOffer: boolean;
  backorder: string;
  replacementStatus: string | null;
  changeQuantity: boolean;
  changeName: boolean;
  boxNumber: string | null;
  kidsChk: string | null;
  shipChk: string;
  shipDate: string | null;
  box1: string | null;
  printBoxName: string | null;
  returnChk: string;
  returnComment: string | null;
  refund: boolean;
  taxRefund: boolean;
  scanningStatus: string;
  scanCheckpoint: string | null;
  memberName: string | null;
  matchingStatus: string;
  matchingMemberName: string | null;
  exchangeCommentStatus: string;
  orderPrintingStatus: number;
  printingStatus: string | null;
  arrivedStatus: string | null;
  jitMarked: string;
  assignBoxNumber: string | null;
  bundleProductId: string | null;
  fcOrderId: string | null;
  fcOrderProductId: string | null;
  fcBatchId: string | null;
  fcToteId: string | null;
  fcItemReceivedScanUser: string | null;
  fcItemSentScanUser: string | null;
  addToMultipartFc: string | null;
  multipartBatchId: string | null;
  multipartFcBatchId: string | null;
  pbPrinterId: number | null;
  printingDate: string | null;
  printerName: string | null;
  isMystery: boolean;
  similarProductsCode: string | null;
  isManuallyAdded: boolean;
  smsProductsQuantity: number | null;
  productQuantityMap: number | null;
  manufacturersId: number | null;
  attributes: ProductAttribute[];
  smsQuantity: string | number;
  smsQuantityMap: number | null;
  supplier: SupplierInfo | null;
  productComment: string | null;
  multipartFcBatchName: string | null;
  hasTrainersPersonalisation: boolean;
  isTshirtProduct: boolean;
  isAllocationPending: boolean;
  isSupplierSelectable: boolean;
}

export interface OrderProductsData {
  products: OrderProductItem[];
  conditionalColumns: {
    showBundleColumn: boolean;
    showAllocateColumn: boolean;
    showPrintingColumn: boolean;
  };
  allBackordered: boolean;
  refundedProducts: OrderProductItem[];
  mysteryProducts: OrderProductItem[];
  orderReturnCheck: string;
  isExchangeOrder: boolean;
  currency: string;
  currencyValue: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOrderProducts(orderId: number | null) {
  return useQuery<OrderProductsData>({
    queryKey: ['orderProducts', orderId],
    queryFn: async () => {
      const response = await api.get(`/orders/${orderId}/products`);
      return response.data.data;
    },
    enabled: orderId !== null && orderId > 0,
    // BUG-356: staleTime:0 ensures products are always refetched on navigation.
    // Without this, TanStack Query serves 5-minute stale data when the same order
    // is revisited within the cache window — causing the products table to show
    // the previous order's products (or 0 rows if structure differs).
    // Same fix applied to useOrderDetail for BUG-294.
    staleTime: 0,
    retry: false,
  });
}
