-- ============================================================================
-- product_variation_view
-- ----------------------------------------------------------------------------
-- Reference copy of the view the product-feeds module reads from.
-- Source: D:/wamp64/www/ukss-feed/create_view_for_local.sql (live prod, 2 Apr 2026)
--
-- This view must exist on the target MySQL database before the feed runs.
-- To deploy: run this statement against the production MySQL as a user with
-- CREATE VIEW privilege.
--
-- Underlying tables: new_products (np), new_products_variations (npv),
-- products_options_values (pov).
-- ============================================================================

DROP VIEW IF EXISTS `product_variation_view`;

CREATE VIEW `product_variation_view` AS
SELECT
  `npv`.`npv_size_options_value_id` AS `ovid`,
  `pov`.`products_options_values_name` AS `pfv_product_variation_size`,
  `np`.`np_agegroup` AS `agegroup`,
  `np`.`products_id` AS `pfv_product_id`,
  `npv`.`npv_products_sku` AS `sku`,
  `npv`.`npv_products_name` AS `pfv_product_variation_name`,
  `npv`.`npv_products_model` AS `mpn`,
  `npv`.`npv_products_barcodes` AS `gtin`,
  `np`.`products_image` AS `main_image`,
  `np`.`np_color` AS `color`,
  `np`.`hero_shirts` AS `hero_shirts`,
  `np`.`is_your_name` AS `your_name`,
  `np`.`manufacturers_name` AS `manufacturer_name`,
  `np`.`products_description` AS `description`,
  `np`.`virtual_product_type_id` AS `virtual_product_type_id`,
  `np`.`products_type` AS `products_type`,
  `np`.`href_link` AS `href_link`,
  `np`.`products_rrp_price` AS `products_rrp_price`,
  -- MySQL 5.7 permits '0000-00-00 00:00:00' zero-dates; Prisma's Rust MySQL
  -- driver refuses to decode them and throws "Code: N/A Message: N/A".
  -- Every direct date column is wrapped in NULLIF so bad rows emit NULL.
  -- `base_date` additionally uses COALESCE to fall through to the next
  -- non-null source, matching the original IFNULL intent. Abhinav Gautam
  NULLIF(`np`.`products_date_added`, '0000-00-00 00:00:00') AS `available_from`,
  GREATEST(`np`.`products_date_added`, `np`.`products_last_modified`) AS `t_modified`,
  COALESCE(NULLIF(`np`.`products_date_available`, '0000-00-00 00:00:00'), `np`.`products_date_added`) AS `base_date`,
  `np`.`np_league` AS `league`,
  `np`.`np_team` AS `team`,
  `np`.`np_team_id` AS `np_team_id`,
  `np`.`np_team_type` AS `team_type`,
  `np`.`np_sleevelength` AS `sleevelength`,
  `np`.`np_season` AS `season`,
  NULLIF(`np`.`bestseller_update_date`, '0000-00-00 00:00:00') AS `bestseller_update_date`,
  `np`.`bestsellers_count` AS `bestsellers_count`,
  `npv`.`npv_quantities` AS `qty`,
  `np`.`canvas_product` AS `canvas_product`,
  NULLIF(`np`.`products_last_modified`, '0000-00-00 00:00:00') AS `modifiedDate`,
  `np`.`np_gender` AS `gender`,
  `np`.`products_price` AS `products_price`,
  `np`.`products_model` AS `products_model`,
  `np`.`product_is_free` AS `product_is_free`,
  `np`.`products_priced_by_attribute` AS `products_priced_by_attribute`,
  `np`.`products_sort_order` AS `products_sort_order`,
  `np`.`specials_status` AS `specials_status`,
  `np`.`specials_price` AS `specials_price`,
  `pov`.`non_vat` AS `non_vat`,
  `np`.`products_to_categories` AS `products_to_categories`,
  `np`.`additional_img` AS `additional_img`,
  `np`.`products_quantity` AS `products_quantity`,
  `np`.`products_weight` AS `products_weight`,
  `np`.`np_continent` AS `continent`,
  `np`.`np_player_name` AS `player_name`,
  `np`.`np_material` AS `material`,
  `np`.`products_name` AS `products_name`,
  `np`.`master_categories_id` AS `master_categories_id`,
  (CASE
    WHEN `np`.`products_id` IN (
      SELECT DISTINCT `products_attributes`.`products_id`
      FROM `products_attributes`
      WHERE `products_attributes`.`options_id` IN (2,3,4,63,64,65)
    ) THEN 1
    ELSE 0
  END) AS `print`
FROM
  `new_products` `np`
  JOIN `new_products_variations` `npv`
    ON `np`.`products_id` = `npv`.`npv_products_id`
  JOIN `products_options_values` `pov`
    ON `pov`.`products_options_values_id` = `npv`.`npv_size_options_value_id`
WHERE
  `np`.`products_status` = '1'
  AND `npv`.`npv_quantities` > 0
  AND `np`.`products_type` <> 45
  AND `npv`.`npv_delete_status` = '0'
  AND `np`.`delete_product_from_front_end` = 0
  AND `np`.`products_id` <> '2437'
  AND `npv`.`npv_products_name` <> ''
  AND `np`.`products_name` <> ''
  AND `np`.`out_of_stock` = 'no'
ORDER BY
  `np`.`products_id`,
  `np`.`bestsellers_count` DESC,
  (CASE
    WHEN LOWER(`pov`.`products_options_values_name`) LIKE '%large%' THEN 1
    WHEN LOWER(`pov`.`products_options_values_name`) LIKE 'L %' THEN 1
    WHEN LOWER(`pov`.`products_options_values_name`) LIKE '%medium%' THEN 2
    WHEN LOWER(`pov`.`products_options_values_name`) LIKE 'M %' THEN 2
    ELSE 3
  END),
  `npv`.`npv_size_options_value_id`,
  `npv`.`npv_products_sku`;
