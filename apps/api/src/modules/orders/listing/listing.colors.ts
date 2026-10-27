/**
 * Row color coding logic — 19 priority-based rules.
 * Requirements: REQ-02-020
 *
 * Each order row gets exactly one CSS class based on the first matching
 * condition. Evaluation stops at first match.
 */

import { FC_BOX_NUMBER } from '../orders.constants';

interface ColorRow {
  orders_id: number;
  is_prime_order: string | null;
  order_site: number | null;
  shipping_method: string | null;
  delivery_country: string | null;
  amazon_orders_id: string | null;
  mplaza_orders_id: string | null;
  tesco_customer_order_id: string | null;
  ebay_orders_id: string | null;
  rakuten_order_id: string | null;
  lazada_order_id: string | null;
  priceminister_order_id: string | null;
  gosport_order_id: string | null;
  catch_order_id: string | null;
  fruugo_orders_id: string | null;
  has_fc_onbackorder: number;
  has_jit_products: number;
  has_hero_shirt_products: number;
}

/**
 * REQ-02-020: Determine row CSS class based on 19 priority rules.
 * Only the first matching rule applies.
 */
export function determineRowClass(row: ColorRow): string {
  const shipping = (row.shipping_method || '').toLowerCase();

  // Priority 1: FC ONBACKORDER and non-JIT (non-JIT = zero JIT-indicator products)
  if (row.has_fc_onbackorder > 0 && row.has_jit_products === 0) {
    return 'dataTableONBACKORDER';
  }

  // Priority 2: Amazon Prime
  if (row.is_prime_order === 'true') {
    return 'dataTableRowAmazonPrime';
  }

  // Priority 3: Amazon Premium — order_site=82, NextDay shipping, and NO hero shirt products
  // PHP (orders_listing.php:1108-1155): checks products_barcodes for any product barcode;
  // if a barcode exists, hero_shirt_tshirt_flag=1 and this priority is skipped.
  if (row.has_hero_shirt_products === 0 && row.order_site === 82 && shipping.includes('next')) {
    return 'dataTableRowAmazonPremium';
  }

  // Priority 4: DHL Courier
  if (shipping.includes('dhl') && shipping.includes('courier')) {
    return 'dataTableRowDHL';
  }

  // Priority 5: Super Saver to GB
  if (shipping.includes('super saver') && (row.delivery_country || '').toUpperCase() === 'GB') {
    return 'dataTableRowSuperSaver';
  }

  // Priority 6: Amazon order
  if (isNotEmpty(row.amazon_orders_id)) {
    return 'dataTableRowAmazon';
  }

  // Priority 7: Mplaza order
  if (isNotEmpty(row.mplaza_orders_id)) {
    return 'dataTableRowMplaza';
  }

  // Priority 8: Click and Collect
  if (shipping.includes('click') && shipping.includes('collect')) {
    return 'dataTableRowClickAndCollect';
  }

  // Priority 9: Tesco order
  if (isNotEmpty(row.tesco_customer_order_id)) {
    return 'dataTableRowTesco';
  }

  // Priority 10: eBay order
  if (isNotEmpty(row.ebay_orders_id)) {
    return 'dataTableRowEbay';
  }

  // Priority 11: Rakuten order
  if (isNotEmpty(row.rakuten_order_id)) {
    return 'dataTableRowRakuten1';
  }

  // Priority 12: Lazada order
  if (isNotEmpty(row.lazada_order_id)) {
    return 'dataTableRowLazada1';
  }

  // Priority 13: PriceMinister order
  if (isNotEmpty(row.priceminister_order_id)) {
    return 'dataTableRowPriceminister1';
  }

  // Priority 14: GoSport order
  if (isNotEmpty(row.gosport_order_id)) {
    return 'dataTableRowGosport1';
  }

  // Priority 15: Catch order
  if (isNotEmpty(row.catch_order_id)) {
    return 'dataTableRowCatch';
  }

  // Priority 16: Teamzo (order_site = 99)
  if (row.order_site === 99) {
    return 'dataTableRowTeamzo';
  }

  // Priority 17: Airo Sportswear (order_site = 111)
  if (row.order_site === 111) {
    return 'dataTableRowAirosportswear';
  }

  // Priority 18: Fruugo order
  if (isNotEmpty(row.fruugo_orders_id)) {
    return 'dataTableRowFruugo';
  }

  // Priority 19: Default
  return 'dataTableRow';
}

function isNotEmpty(val: string | null | undefined): boolean {
  return val !== null && val !== undefined && val !== '' && val !== '0';
}
