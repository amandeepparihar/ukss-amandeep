-- ============================================================================
-- Column Verification for Product Feeds Queries
-- ----------------------------------------------------------------------------
-- Execute manually against whichever MySQL the feed will read from:
--   - Staging:    zenc_main_db
--   - Production: ukssmain_* (the feed DB)
--   - Local WAMP: zenc_main_db
--
-- Uses DATABASE() so the same file works in every environment -- just
-- `USE <db>;` (or connect with a default DB set) before running.
--
-- CLAUDE.md Rule 6: Verify DB columns before writing raw SQL.
--
-- Each SELECT should return the full column set listed in its IN (...)
-- clause; any missing row indicates the column (or the table / view) does
-- not exist in the current DB.
--
-- Source references in D:/wamp64/www/ukss-feed/:
--   product_variation_view      -> create_view_for_local.sql
--   salemaker_sales             -> price_functions.php:checkSale()
--   weekend_offer_10_percent    -> price_functions.php:checkWeekend10()
--   deals_management            -> price_functions.php:checkDeals()
--   currencies                  -> build_data_functions.php:getCurrency()
--   shipping_modules            -> shipping.php (flat / zones)
--   courier_shipments           -> shipping.php (courier / supersaver)
--   shipping_delivery_time      -> shipping.php (JOIN on zone_title)
--   additional_data             -> build_data_functions.php:getAdditionalData()
--   teams                       -> productTypeSet.php:getTeams()
--   create_feed_config          -> ukss-feed PHP config table (reference only;
--                                  Stock2 uses env vars instead)
-- ============================================================================

-- Confirm which DB we're running against before anything else.
SELECT DATABASE() AS current_database;

-- ----------------------------------------------------------------------------
-- 1. product_variation_view (50 columns matching ProductVariationRow type)
--    Note: this is a VIEW - if the query returns 0 rows, run
--    sql/product-variation-view.sql on the target DB first.
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'product_variation_view'
  AND COLUMN_NAME IN (
    'ovid','pfv_product_variation_size','agegroup','pfv_product_id','sku',
    'pfv_product_variation_name','mpn','gtin','main_image','color',
    'hero_shirts','your_name','manufacturer_name','description',
    'virtual_product_type_id','products_type','href_link','products_rrp_price',
    'available_from','t_modified','base_date','league','team','np_team_id',
    'team_type','sleevelength','season','bestseller_update_date',
    'bestsellers_count','qty','canvas_product','modifiedDate','gender',
    'products_price','products_model','product_is_free',
    'products_priced_by_attribute','products_sort_order','specials_status',
    'specials_price','non_vat','products_to_categories','additional_img',
    'products_quantity','products_weight','continent','player_name','material',
    'products_name','master_categories_id','print'
  )
ORDER BY COLUMN_NAME;

-- ----------------------------------------------------------------------------
-- 2. salemaker_sales (checkSale)
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'salemaker_sales'
  AND COLUMN_NAME IN (
    'sale_deduction_value','sale_deduction_type','sale_categories_all',
    'sortorder_to_exclude','sale_pricerange_from','sale_pricerange_to',
    'sale_status','sale_date_start','sale_date_end'
  )
ORDER BY COLUMN_NAME;

-- ----------------------------------------------------------------------------
-- 3. weekend_offer_10_percent (checkWeekend10)
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'weekend_offer_10_percent'
  AND COLUMN_NAME IN (
    'id','exclude_categories','status','start_date','end_date'
  )
ORDER BY COLUMN_NAME;

-- ----------------------------------------------------------------------------
-- 4. deals_management (checkDeals)
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'deals_management'
  AND COLUMN_NAME IN (
    'deal_type','deal_target_type','target_id','discount_type','discount_value',
    'is_active'
  )
ORDER BY COLUMN_NAME;

-- ----------------------------------------------------------------------------
-- 5. currencies (getCurrency)
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'currencies'
  AND COLUMN_NAME IN ('code','value')
ORDER BY COLUMN_NAME;

-- ----------------------------------------------------------------------------
-- 6. shipping_modules (flat / zones)
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'shipping_modules'
  AND COLUMN_NAME IN (
    'shipping_price','delivery_time','shipping_method','countries_list'
  )
ORDER BY COLUMN_NAME;

-- ----------------------------------------------------------------------------
-- 7. courier_shipments (courier / supersaver)
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'courier_shipments'
  AND COLUMN_NAME IN ('shipping_price','zone_title','countries_list')
ORDER BY COLUMN_NAME;

-- ----------------------------------------------------------------------------
-- 8. shipping_delivery_time (JOIN source for courier / supersaver titles)
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'shipping_delivery_time'
  AND COLUMN_NAME IN ('zone_title','delivery_time','shipping_method')
ORDER BY COLUMN_NAME;

-- ----------------------------------------------------------------------------
-- 9. additional_data (getAdditionalData)
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'additional_data'
  AND COLUMN_NAME IN ('product_id','player_name')
ORDER BY COLUMN_NAME;

-- ----------------------------------------------------------------------------
-- 10. teams (getTeams)
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'teams'
  AND COLUMN_NAME IN ('team','team_type')
ORDER BY COLUMN_NAME;

-- ----------------------------------------------------------------------------
-- 11. create_feed_config (legacy PHP config table - reference only)
--     Stock2 does not read from this table; it uses env vars instead.
--     Kept here so the production DBA can confirm the table still exists
--     alongside the PHP feed during the parallel-validation window.
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'create_feed_config'
  AND COLUMN_NAME IN (
    'configuration_title','configuration_key','configuration_value',
    'configuration_description','date_added'
  )
ORDER BY COLUMN_NAME;

-- ----------------------------------------------------------------------------
-- Underlying tables behind product_variation_view (sanity check, in case
-- the view fails query #1 above). Confirms the JOIN columns still exist.
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('new_products','new_products_variations','products_options_values','products_attributes')
  AND COLUMN_NAME IN (
    -- new_products
    'products_id','products_status','products_type','out_of_stock',
    'delete_product_from_front_end','products_image','np_color','hero_shirts',
    'is_your_name','manufacturers_name','products_description',
    'virtual_product_type_id','href_link','products_rrp_price',
    'products_date_added','products_last_modified','products_date_available',
    'np_league','np_team','np_team_id','np_team_type','np_sleevelength',
    'np_season','bestseller_update_date','bestsellers_count','canvas_product',
    'np_gender','products_price','products_model','product_is_free',
    'products_priced_by_attribute','products_sort_order','specials_status',
    'specials_price','products_to_categories','additional_img',
    'products_quantity','products_weight','np_continent','np_player_name',
    'np_material','products_name','master_categories_id','np_agegroup',
    -- new_products_variations
    'npv_size_options_value_id','npv_products_sku','npv_products_name',
    'npv_products_model','npv_products_barcodes','npv_quantities',
    'npv_delete_status','npv_products_id',
    -- products_options_values
    'products_options_values_id','products_options_values_name','non_vat',
    -- products_attributes
    'options_id'
  )
ORDER BY TABLE_NAME, COLUMN_NAME;
