
import { config } from '../../../config';

const season = config.NP_SEASON;
const gledStoreId: number = config.GLADE_SPORT_STORE_ID
const sellerDynamicsStore: number = config.SELLER_DYNAMIC_STORE_ID
export const eligibiltyCondition: Record<number, string> = {
  // -- 99 Teamzo
  99: `np_season = '${season}' AND virtual_product_type_id = 0 AND delete_product_from_front_end = 0
  AND products_status = 1 AND out_of_stock = 'no' AND products_id > ?
ORDER BY np_season DESC`,

  // -- 118 RaceCrate
  118: `products_status = 1 AND is_sms_product = 1 AND products_id > ?
  AND products_to_categories LIKE '%#5212#%'`,

  124: `delete_product_from_front_end = 0 AND products_status = 1 AND out_of_stock = 'no'
  AND products_id > ? AND products_to_categories LIKE '%#2696#%'`,

  126: `delete_product_from_front_end = 0 AND products_status = 1 AND out_of_stock = 'no'
  AND products_id > ?
  AND products_to_categories NOT LIKE '%#2696#%' AND products_to_categories NOT LIKE '%#5212#%'
  AND ((virtual_product_type_id = 5 AND specials_status = 'Not Special')
       OR products_to_categories LIKE '%#5812#%')
ORDER BY np_season DESC`,

  134: `EXISTS (SELECT 1 FROM new_products NewProduct
        JOIN product_lists pl       ON pl.product_code = NewProduct.products_model
        JOIN product_quantities pq  ON pq.product_lists_id = pl.product_lists_id
        WHERE NewProduct.delete_product_from_front_end = 0 AND NewProduct.products_status = 1
          AND NewProduct.out_of_stock = 'no' AND pq.scanned_at_fc = 'yes'
          AND NewProduct.products_id = new_products.products_id AND products_id > ?)`,

  142: `EXISTS (SELECT 1 FROM new_products NewProduct
        JOIN product_lists pl       ON pl.product_code = NewProduct.products_model
        JOIN product_quantities pq  ON pq.product_lists_id = pl.product_lists_id
        WHERE NewProduct.delete_product_from_front_end = 0 AND NewProduct.products_status = 1
          AND NewProduct.out_of_stock = 'no' AND pq.scanned_at_fc = 'yes'
          AND NewProduct.products_id = new_products.products_id AND products_id > ?)`,

  135: `EXISTS (SELECT 1 FROM new_products NewProduct
        JOIN product_lists pl       ON pl.product_code = NewProduct.products_model
        JOIN product_quantities pq  ON pq.product_lists_id = pl.product_lists_id
        WHERE NewProduct.delete_product_from_front_end = 0 AND NewProduct.products_status = 1
          AND NewProduct.out_of_stock = 'no' AND pq.scanned_at_fc = 'yes'
          AND NewProduct.products_id = new_products.products_id AND products_id > ? AND NewProduct.virtual_product_type_id != 4 )`,

  136: `EXISTS (SELECT 1 FROM new_products NewProduct
        WHERE NewProduct.products_status = 1 AND NewProduct.out_of_stock = 'no'
          AND NewProduct.products_to_categories LIKE '%#2696#%'
          AND NewProduct.virtual_product_type_id = 4
          AND NewProduct.products_id = new_products.products_id AND products_id > ?)`,

  145: `EXISTS (SELECT 1 FROM new_products NewProduct
        JOIN product_lists pl       ON pl.product_code = NewProduct.products_model
        JOIN product_quantities pq  ON pq.product_lists_id = pl.product_lists_id
        WHERE NewProduct.delete_product_from_front_end = 0 AND NewProduct.products_status = 1
          AND NewProduct.out_of_stock = 'no' AND pq.scanned_at_fc = 'yes'
          AND NewProduct.products_id = new_products.products_id AND products_id > ? AND NewProduct.specials_status = 'Special' )`,

  146: `delete_product_from_front_end = 0 AND products_status = 1 AND out_of_stock = 'no'
  AND manufacturers_id = 35 AND products_id > ?`,

  // -- 129 CFK (mirrors 126 Soccer Classico)
  129: `delete_product_from_front_end = 0 AND products_status = 1 AND out_of_stock = 'no'
  AND products_id > ?
  AND products_to_categories NOT LIKE '%#2696#%' AND products_to_categories NOT LIKE '%#5212#%'
  AND ((virtual_product_type_id = 5 AND specials_status = 'Not Special')
       OR products_to_categories LIKE '%#5812#%')
ORDER BY np_season DESC`,

  // -- 141 Rugby HQ (mirrors 124 Direct Rugby)
  141: `delete_product_from_front_end = 0 AND products_status = 1 AND out_of_stock = 'no'
  AND products_id > ? AND products_to_categories LIKE '%#2696#%'`,

  // -- 153 Mystery Shirts Club (mirrors 142)
  153: `EXISTS (SELECT 1 FROM new_products NewProduct
        JOIN product_lists pl       ON pl.product_code = NewProduct.products_model
        JOIN product_quantities pq  ON pq.product_lists_id = pl.product_lists_id
        WHERE NewProduct.delete_product_from_front_end = 0 AND NewProduct.products_status = 1
          AND NewProduct.out_of_stock = 'no' AND pq.scanned_at_fc = 'yes'
          AND NewProduct.products_id = new_products.products_id AND products_id > ?)`,

  // -- 154 Absolute Rugby (mirrors 134 + category #2696 filter)
  154: `EXISTS (SELECT 1 FROM new_products NewProduct
        JOIN product_lists pl       ON pl.product_code = NewProduct.products_model
        JOIN product_quantities pq  ON pq.product_lists_id = pl.product_lists_id
        WHERE NewProduct.delete_product_from_front_end = 0 AND NewProduct.products_status = 1
          AND NewProduct.out_of_stock = 'no' AND pq.scanned_at_fc = 'yes'
          AND NewProduct.products_to_categories LIKE '%#2696#%'
          AND NewProduct.products_id = new_products.products_id AND products_id > ?)`,

  155: `EXISTS (SELECT 1 FROM new_products NewProduct
        JOIN product_lists pl       ON pl.product_code = NewProduct.products_model
        JOIN product_quantities pq  ON pq.product_lists_id = pl.product_lists_id
        WHERE NewProduct.delete_product_from_front_end = 0 AND NewProduct.products_status = 1
          AND NewProduct.out_of_stock = 'no' AND pq.scanned_at_fc = 'yes'
          AND NewProduct.products_id = new_products.products_id AND products_id > ?)
           LIMIT 10`,

  [gledStoreId]: `products_id > ? AND EXISTS (
        SELECT 1
        FROM marketplace_listings ml
	      INNER JOIN new_products_variations npv ON ml.products_sku = npv.npv_products_sku
	      WHERE npv.npv_products_id = new_products.products_id
          AND ml.store_id = ${sellerDynamicsStore}
          AND ml.marketplace_listing_status = 'active'
     )`

}