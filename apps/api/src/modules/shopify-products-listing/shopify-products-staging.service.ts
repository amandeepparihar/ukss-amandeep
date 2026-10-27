import { Prisma } from '@prisma/client';
import { NotFoundError } from '../../lib/errors';
import { getLogger } from '../../lib/logger-context';
import { prisma } from '../../lib/prisma';
import { eligibiltyCondition } from './utils/eligibilityConditions';
import { config } from '../../config';


// Job 1
// #Todo: Currently the variants are created from products_attributes and sku's for them are fetched from the new_products_variations. 
// We have to change this as this sometime causes some variants without sku . So switch to one table for creating variations.


export const stageNewProducts = async (storeId: number) => {
  const logger = getLogger();

  logger.info({ storeId }, 'Staging UKSS products to mirror tables');
  const cronRecord = await prisma.shopifyCronRunHistory.create({
    data: {
      scrh_store_id: storeId,
      scrh_name: "insert_data_in_shopify_tables",
      scrh_url: `/shopify_products/stage_products/${storeId}`,
      scrh_start_time: new Date(),
      scrh_status: 'InProgress',
    },
  });

  const eligibiltyConditions: string = eligibiltyCondition[storeId];

  if (!eligibiltyConditions) throw new Error(`No staging criteria assigned for store id ${storeId}`);



  try {
    const storeCredentials = await prisma.storeManagement.findFirst({
      where: {
        storeId: storeId,
      },
      select: {
        storeName: true,
        smAppApiKey: true,
        smAppSharedsecret: true,
        smAppAccessToken: true,
        storeOrderIntegrationApiHostname: true,
      },
    });
    if (!storeCredentials) {
      throw new NotFoundError('Store');
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {

      // checking last product Id inserted into Shopify
      const highWaterQuery = `SELECT np_products_id FROM shopify_products WHERE sm_store_id = ? ORDER BY np_products_id DESC LIMIT 1;`
      const result = await tx.$queryRawUnsafe(highWaterQuery, storeId);
      const created_after = (result && result.length > 0) ? (result[0].np_products_id || 0) : 0;

      // Insert Data into Shopify products 
      const insertProductsQuery = `INSERT
	INTO
	shopify_products (sm_store_id,sm_store_name,np_products_id,sp_ukss_virtual_product_type_id,sp_product_id,sp_title,sp_body_html,sp_vendor,sp_product_type,sp_handle,
  sp_published_at,sp_status,sp_create_product_status,sp_special_status,sp_tags,sp_option_1,sp_option_1_id,sp_option1_values,sp_google_custom_label0,
  sp_google_custom_label1,sp_google_custom_label2,sp_google_custom_label3,sp_google_custom_label4,sp_created_at,sp_updated_at,np_products_model,np_league,np_team,
  np_agegroup,np_gender,np_color,np_sleevelength,sp_update_metafields_status)
SELECT
	?,
	?,
	products_id,
	virtual_product_type_id,
	NULL,
	products_name,
	products_description,
	manufacturers_name,
	(SELECT	type_name FROM product_types WHERE type_id = products_type), 
  CONCAT(REGEXP_REPLACE(products_name,'[^0-9a-zA-Z]','-'), '-', products_id),
	CASE
		WHEN hero_shirts = 1 THEN NOW()
		ELSE NOW() - INTERVAL 1 HOUR
	END,
	'active',
	'new',
	specials_status,
	CONCAT(
            CASE WHEN np_gender != "" THEN CONCAT("feed-gender-", np_gender, ",") ELSE "" END,
            CASE WHEN np_agegroup != "" THEN CONCAT("feed-agegroup-", np_agegroup, ",") ELSE "" END,
            CASE WHEN np_sizetype != "" THEN CONCAT("feed-sizetype-", np_sizetype, ",") ELSE "" END,
            CASE WHEN np_color != "" THEN CONCAT("feed-color-", np_color, ",") ELSE "" END,
            CASE WHEN np_material != "" THEN CONCAT("feed-material-", np_material, ",") ELSE "" END,
            CASE WHEN np_google_product_categories != "" THEN CONCAT("feed-gpc-", np_google_product_categories, ",") ELSE "" END,
            CASE WHEN np_condition != "" THEN CONCAT("feed-cond-", np_condition, ",") ELSE "" END,
            CASE WHEN np_team_type != "" THEN CONCAT("team_type-", np_team_type, ",") ELSE "" END,
            CASE WHEN np_team_type != "" THEN CONCAT(np_team_type, ",") ELSE "" END,
            CASE WHEN np_continent != "" THEN CONCAT("continent-", np_continent, ",") ELSE "" END,
            CASE WHEN np_continent != "" THEN CONCAT(np_continent, ",") ELSE "" END,
            CASE WHEN np_league != "" THEN CONCAT("league-", np_league, ",") ELSE "" END,
            CASE WHEN np_league != "" THEN CONCAT(np_league, ",") ELSE "" END,
            CASE WHEN np_player_name != "" THEN CONCAT("player_name-", np_player_name, ",") ELSE "" END,
            CASE WHEN np_player_name != "" THEN CONCAT(np_player_name, ",") ELSE "" END,
            CASE WHEN np_team != "" THEN CONCAT("Team_", np_team, ",") ELSE "" END,
            CASE WHEN np_team != "" THEN CONCAT(np_team, ",") ELSE "" END,
            CASE WHEN np_shopify_product_type != "" THEN CONCAT("product_type-", np_shopify_product_type, ",") ELSE "" END,
            CASE WHEN np_shopify_product_type != "" THEN CONCAT(np_shopify_product_type, ",") ELSE "" END,
            CASE WHEN ? IN (126,129,99,135,136)
            THEN CASE WHEN hero_shirts != 1 AND np_season != '' THEN CONCAT('season-',np_season,',',np_season,',') ELSE '' END
            ELSE CASE WHEN np_season != '' THEN CONCAT('season-',np_season,',',np_season,',') ELSE '' END END,
            CASE WHEN np_sleevelength != "" THEN CONCAT("sleevelength-", np_sleevelength, ",") ELSE "" END,
            CASE WHEN np_sleevelength != "" THEN CONCAT(np_sleevelength, ",") ELSE "" END,
            CASE WHEN hero_shirts = 1 THEN CONCAT("hero_shirt", ",") ELSE "" END,
            CASE WHEN hero_shirts = 1 AND np_season!= "" THEN CONCAT(np_season,"_","hero-shirt",",") ELSE "" END
        ) ,
	'Size',
	NULL,
	"",
	CASE
		WHEN ? IN (126, 129, 99, 134, 135, 136) THEN np_season
		ELSE np_player_name
	END,
	np_team,
	CASE
		WHEN ? IN (126, 129, 99, 134, 135, 136) THEN np_player_name
		ELSE np_season
	END ,
	CASE
		WHEN ? IN (126, 129, 99, 134, 135, 136) THEN np_league
		ELSE specials_status
	END,
	CASE
		WHEN ? IN (126, 129, 99, 134, 135, 136) THEN np_continent
		ELSE np_sizeguide
	END,
	NOW(),
	NOW(),
	products_model,
	np_league,
	np_team,
	np_agegroup,
	np_gender,
	np_color,
	np_sleevelength,
	'modified'
FROM
	new_products
WHERE ${eligibiltyConditions} `;


      await tx.$executeRawUnsafe(insertProductsQuery, storeId, storeCredentials.storeName, storeId, storeId, storeId, storeId, storeId, created_after);

      // -- 4) Fill sp_option1_values with the comma-joined size list per product.
      const productOptionsQuery = `UPDATE shopify_products sp
                              INNER JOIN (
                              SELECT pa.products_id, GROUP_CONCAT(pov.products_options_values_name SEPARATOR ',') AS sizes
                              FROM products_attributes pa
                              JOIN products_options_values pov ON pa.options_values_id = pov.products_options_values_id
                              JOIN products_options po         ON pa.options_id        = po.products_options_id
                              WHERE po.products_options_name LIKE '%size%' AND pa.products_id > ?
                              GROUP BY pa.products_id) t ON sp.np_products_id = t.products_id AND sp.sm_store_id =?
                              SET sp.sp_option1_values = t.sizes;`

      await tx.$executeRawUnsafe(productOptionsQuery, created_after, storeId);

      const personalizationQuery = `UPDATE shopify_products sp
                                INNER JOIN (SELECT DISTINCT products_id FROM products_attributes WHERE options_id = 4) t
                                ON sp.np_products_id = t.products_id
                                SET sp.sp_tags = CONCAT(sp.sp_tags, 'Personalized_Product', ',')
                                WHERE sp.sm_store_id = ?;`

      await tx.$executeRawUnsafe(personalizationQuery, storeId);

      const gledStoreId = config.GLADE_SPORT_STORE_ID;
      const sellerDynamicsStore = config.SELLER_DYNAMIC_STORE_ID;

      // For the Glade Sport store, only create variants whose SKU is on an active
      // marketplace listing for the SellerDynamics store 
      const marketplaceVariantFilter = storeId === gledStoreId
        ? `AND EXISTS (
            SELECT 1
            FROM marketplace_listings ml
            INNER JOIN new_products_variations npv ON ml.products_sku = npv.npv_products_sku
            WHERE npv.npv_products_id = np.products_id
              AND npv.npv_size_options_value_id = pa.options_values_id
              AND ml.store_id = ${sellerDynamicsStore}
              AND ml.marketplace_listing_status = 'active'
         )`
        : '';

      const createVariationQuery = `
  INSERT INTO shopify_products_variations (
    sp_id, sm_store_id, sm_store_name, np_products_id, sp_product_id, spv_variation_id, spv_title,
    spv_price, spv_sku, spv_inventory_policy, spv_compare_at_price, spv_inventory_management,
    spv_option1_value, products_options_values_id_for_option1, spv_taxable, spv_barcode,
    spv_weight_unit, spv_inventory_quantity, spv_requires_shipping, spv_created_at, spv_updated_at
  )
  SELECT
    sp.sp_id, ?, ?, pa.products_id, NULL, NULL, pov.products_options_values_name,
    CASE WHEN np.specials_status = 'Special' AND np.specials_price > 0 THEN np.specials_price ELSE np.products_price END,
    NULL, 'deny',
    CASE WHEN np.products_rrp_price > np.products_price THEN np.products_rrp_price ELSE np.products_price END,
    'shopify', pov.products_options_values_name, pa.options_values_id, 1, NULL, 'kg',
    CASE WHEN np.quantity_map = 0 THEN np.products_quantity ELSE 0 END,
    1, NOW(), NOW()
  FROM new_products np
  JOIN shopify_products sp ON sp.np_products_id = np.products_id AND sp.sm_store_id = ?
  JOIN products_attributes pa ON np.products_id = pa.products_id
  JOIN products_options_values pov ON pa.options_values_id = pov.products_options_values_id
  JOIN products_options po ON pa.options_id = po.products_options_id
  WHERE po.products_options_name LIKE '%size%' AND np.products_id > ?
  ${marketplaceVariantFilter};
`;

      await tx.$executeRawUnsafe(createVariationQuery, storeId, storeCredentials.storeName, storeId, created_after);


      // --- STEP 7: Pull SKU + barcode from new_products_variations ---

      const updateVariationQuery = `UPDATE shopify_products_variations spv
                                    INNER JOIN new_products_variations npv
                                      ON spv.products_options_values_id_for_option1 = npv.npv_size_options_value_id
                                    AND spv.np_products_id = npv.npv_products_id
                                    SET spv.spv_sku = npv.npv_products_sku, 
                                        spv.spv_barcode = npv.npv_products_barcodes
                                    WHERE spv.sm_store_id = ? 
                                      AND npv.npv_products_sku <> '' 
                                      AND npv.npv_products_id > ?;
                                  `;

      await tx.$executeRawUnsafe(updateVariationQuery, storeId, created_after);

      // -- 8) quantity_map=1 products: roll up FC bin stock (product_lists → product_quantities) per size.

      const setQuantityQuery = `UPDATE shopify_products_variations spv
INNER JOIN (
  SELECT spv.np_products_id, spv.products_options_values_id_for_option1 AS opt_id, SUM(pq.quantity) AS qty
  FROM shopify_products_variations spv
  INNER JOIN new_products np ON np.products_id = spv.np_products_id
  INNER JOIN product_lists pl ON np.products_model = pl.product_code
  INNER JOIN products_options_values_to_products_options povtpo
       ON spv.products_options_values_id_for_option1 = povtpo.products_options_values_id
  INNER JOIN product_quantities pq ON pl.product_lists_id = pq.product_lists_id
       AND povtpo.products_options_values_to_products_options_id = pq.size_id
  WHERE np.quantity_map = 1 AND np.products_id > ? AND spv.sm_store_id = ?
  GROUP BY spv.np_products_id, spv.products_options_values_id_for_option1) t
  ON spv.products_options_values_id_for_option1 = t.opt_id AND spv.np_products_id = t.np_products_id
SET spv.spv_inventory_quantity = t.qty
WHERE spv.sm_store_id = ?;`

      await tx.$executeRawUnsafe(setQuantityQuery, created_after,storeId, storeId);

      // Fetch all products and their images from the database
      const productsImages = await tx.$queryRawUnsafe(`
  SELECT 
    sp.sp_id, sp.sm_store_id, sp.sm_store_name, 
    np.products_id, np.products_name, np.products_image, np.back_img, np.additional_img
  FROM shopify_products sp
  INNER JOIN new_products np ON np.products_id = sp.np_products_id
  WHERE np.products_id > ? AND sp.sm_store_id = ?
`, created_after, storeId);

      const imageRecordsToInsert: any[] = [];
      const BASE_URL = config.UKSS_HTTP_SERVER;
      for (const row of productsImages) {
        const productImageArray: string[] = [];


        if (row.products_image && row.products_image.trim() !== '') {
          productImageArray.push(`${BASE_URL}/images/${row.products_image.trim()}`);
        }

        if (row.back_img && row.back_img.trim() !== '') {
          productImageArray.push(`${BASE_URL}/images/adtnl_prodts_img/${row.back_img.trim()}`);
        }

        // Additional Images
        if (row.additional_img && row.additional_img.trim() !== '') {
          const additionalImages = row.additional_img
            .split(',')
            .map((img: string) => img.trim())
            .filter((img: string) => img.length > 0);

          additionalImages.forEach((img: string) => {
            productImageArray.push(`${BASE_URL}/images/adtnl_prodts_img/${img}`);
          });
        }

        // map of images to be inserted
        productImageArray.forEach((imgSrc, index) => {
          imageRecordsToInsert.push({
            spId: row.sp_id,
            smStoreId: row.sm_store_id,
            smStoreName: row.sm_store_name,
            npProductId: row.products_id,
            spProductId: null,
            spiImageId: null,
            spiPosition: index + 1,
            spiAlt: `${row.products_name}_${index}`,
            spiWidth: 1000,
            spiHeight: 1000,
            spiSrc: imgSrc,
          });
        });
      }

      // bulk insert 
      if (imageRecordsToInsert.length > 0) {
        await tx.shopifyProductsImage.createMany({
          data: imageRecordsToInsert,
          skipDuplicates: true,
        });
      }
    }, {
      maxWait: 15000,
      timeout: 60000
    })

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'completed',
        scrh_end_time: new Date(),
      },
    });


    logger.info({ storeId: storeId }, 'Successfully staged products');

    return { success: true };

  } catch (error) {

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'failed',
        scrh_end_time: new Date(),
      },
    }).catch((logError: any) => {
      logger.warn({ logError }, 'Failed to persist fatal state update into history logs.');
    });

    if (error instanceof NotFoundError) {
      logger.error({ error: error, storeId: storeId }, ` Store with ID ${storeId} not found.`);
      throw error
    } else {
      logger.error({ error, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, storeId: storeId }, `Internal Server error while staging products for store ID ${storeId}: `);
      throw new Error("Internal Server Error")
    }
  }

}

// Job 3
//  Refresh Product price for Shopify tables
export const refreshPrice = async () => {
  const logger = getLogger();
  logger.info('Refresh Product price for Shopify tables');

  const cronRecord = await prisma.shopifyCronRunHistory.create({
    data: {
      scrh_store_id: 0,
      scrh_name: "update_price_on_shopify_tables",
      scrh_url: '/shopify_products/refresh_price_in_shopify_tables',
      scrh_start_time: new Date(),
      scrh_status: 'InProgress',
    },
  });

  try {
    // -- 1) Copy UKSS special-status into shopify_products.sp_special_status.
    await prisma.$executeRawUnsafe('UPDATE shopify_products sp INNER JOIN new_products np ON sp.np_products_id = np.products_id SET sp.sp_special_status = np.specials_status');

    // -- 2) FLAG drift — runs BEFORE step 3, so it compares the OLD stored price vs the fresh effective price.

    await prisma.$executeRawUnsafe(`UPDATE shopify_products
                                  SET sp_update_price_status = 'modified'
                                  WHERE np_products_id IN (
                                          SELECT DISTINCT np.products_id
                                          FROM new_products np
                                          JOIN shopify_products_variations spv ON np.products_id = spv.np_products_id
                                          WHERE spv.spv_price != CASE WHEN np.specials_status='Special' AND np.specials_price>0
                                                                      THEN ROUND(np.specials_price,2) ELSE ROUND(np.products_price,2) END
                                             OR spv.spv_compare_at_price != CASE WHEN np.products_rrp_price > np.products_price
                                                                      THEN ROUND(np.products_rrp_price,2) ELSE ROUND(np.products_price,2) END)
                                    AND sp_update_price_status = 'finalized'
                                    AND sp_product_id IS NOT NULL;`);

    await prisma.$executeRawUnsafe(`UPDATE shopify_products_variations spv
                                  INNER JOIN (
                                    SELECT products_id AS pid,
                                           CASE WHEN specials_status='Special' AND specials_price>0
                                                THEN ROUND(specials_price,2) ELSE ROUND(products_price,2) END AS price,
                                           CASE WHEN products_rrp_price > products_price
                                                THEN ROUND(products_rrp_price,2) ELSE ROUND(products_price,2) END AS cmp
                                    FROM new_products) t ON spv.np_products_id = t.pid
                                  SET spv.spv_price = t.price, spv.spv_compare_at_price = t.cmp;`)

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'completed',
        scrh_end_time: new Date(),
      },
    });

    logger.info('Successfully Refreshed Product price for Shopify tables');

    return { success: true };

  } catch (error) {

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'failed',
        scrh_end_time: new Date(),
      },
    }).catch((logError: Error) => {
      logger.warn({ logError }, 'Failed to persist fatal state update into history logs.');
    });


    logger.error({ error: error }, `Internal Server error while refreshing price `);
    throw new Error("Internal Server Error")

  }

}


// Job 4
//  Flag Stock Changes
export const flagStockChange = async () => {
  const logger = getLogger();
  logger.info('Flagging Stock Change');

  const cronRecord = await prisma.shopifyCronRunHistory.create({
    data: {
      scrh_store_id: 0,
      scrh_name: "update_quantity_on_shopify_tables",
      scrh_url: '/shopify_products/flag_stock_change',
      scrh_start_time: new Date(),
      scrh_status: 'InProgress',
    },
  });

  try {
    // -- Flag inventory drift. The second OR-branch is the "deleted size still shows stock" safety case — keep it.
    await prisma.$executeRawUnsafe(`UPDATE shopify_products
                                    SET sp_update_inventory_status = 'modified'
                                    WHERE np_products_id IN (
                                            SELECT DISTINCT np_products_id
                                            FROM shopify_products_variations spv
                                            JOIN new_products_variations npv ON spv.spv_sku = npv.npv_products_sku
                                            WHERE (npv.npv_delete_status = '0' AND spv.spv_inventory_quantity != npv.npv_quantities)
                                               OR (npv.npv_delete_status = '1' AND spv.spv_inventory_quantity != 0))
                                      AND sp_product_id IS NOT NULL;`);

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'completed',
        scrh_end_time: new Date(),
      },
    });

    logger.info('Successfully Flaged Stock Change');
    return { success: true };

  } catch (error) {

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'failed',
        scrh_end_time: new Date(),
      },
    }).catch((logError: Error) => {
      logger.warn({ logError }, 'Failed to persist fatal state update into history logs.');
    });


    logger.error({ error: error }, `Internal Server error while flagging stock change `);
    throw new Error("Internal Server Error")

  }

}


// Job6 
// Enforce Inventory policy on Dead Sizes 
export const enforceInventoryPolicyChange = async (storeId: number) => {
  const logger = getLogger();
  logger.info('Enforcing Inventory policy on Dead Sizes');

  const cronRecord = await prisma.shopifyCronRunHistory.create({
    data: {
      scrh_store_id: storeId,
      scrh_name: "update_inventory_policy_on_shopify_tables",
      scrh_url: `/shopify_products/enforce_inventory_policy_on_dead_size/:${storeId}`,
      scrh_start_time: new Date(),
      scrh_status: 'InProgress',
    },
  });

  try {
    // -- Zero-out + 'deny' any deleted size (pa_status=0) or orphan variant (no products_attributes row)
    // -- that still shows stock/continue; flag the parent product so the inventory push corrects Shopify.

    const updatePolicyQuery = `UPDATE shopify_products_variations spv
                              LEFT JOIN products_attributes pa
                                     ON spv.np_products_id = pa.products_id
                                    AND spv.products_options_values_id_for_option1 = pa.options_values_id
                              LEFT JOIN shopify_products sp ON pa.products_id = sp.np_products_id
                              SET spv.spv_inventory_policy      = 'deny',
                                  sp.sp_update_inventory_status = 'modified'
                              WHERE spv.sm_store_id = ?
                                AND ( pa.pa_status = 0
                                      OR (pa.products_attributes_id IS NULL
                                          AND (spv.spv_inventory_quantity > 0 OR spv.spv_inventory_policy = 'continue')) )`;


    await prisma.$executeRawUnsafe(updatePolicyQuery, storeId);

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'completed',
        scrh_end_time: new Date(),
      },
    });

    logger.info('Successfully Enforced Inventory policy on Dead Sizes');
    return { success: true };

  } catch (error) {

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'failed',
        scrh_end_time: new Date(),
      },
    }).catch((logError: Error) => {
      logger.warn({ logError }, 'Failed to persist fatal state update into history logs.');
    });

    logger.error({ error: error }, `Internal Server error while updating Inventory policy on Dead Sizes on shoppify table `);
    throw new Error("Internal Server Error")

  }

}


// Job 5
// Todo: currently it only checks finalised while checking the new changes for a product, if a product is modified and a new change is added it will be ignored. 
// add the condition to check for error and modified too.
// -Recompute tags and google labels 

export const updateTagsAndLabel = async (storeId: number) => {
  const logger = getLogger();
  logger.info('Updating tags and google labels on Shopify Table');

  const cronRecord = await prisma.shopifyCronRunHistory.create({
    data: {
      scrh_store_id: storeId,
      scrh_name: "update_tags_in_shopify_table",
      scrh_url: `/shopify_products/update_tags_label_on_shopify_able/${storeId}`,
      scrh_start_time: new Date(),
      scrh_status: 'InProgress',
    },
  });

  try {
    //-- 1) Recompute sp_tags; flip to 'modified' ONLY when the (normalised) tags differ AND status='finalized'.
    const recomputeTagsQuery = `UPDATE shopify_products sp
                                INNER JOIN (
                                  SELECT products_id AS pid, CONCAT(
                                    CASE WHEN np_gender != "" THEN CONCAT("feed-gender-", np_gender, ",") ELSE "" END,
                                    CASE WHEN np_agegroup != "" THEN CONCAT("feed-agegroup-", np_agegroup, ",") ELSE "" END,
                                    CASE WHEN np_sizetype != "" THEN CONCAT("feed-sizetype-", np_sizetype, ",") ELSE "" END,
                                    CASE WHEN np_color != "" THEN CONCAT("feed-color-", np_color, ",") ELSE "" END,
                                    CASE WHEN np_material != "" THEN CONCAT("feed-material-", np_material, ",") ELSE "" END,
                                    CASE WHEN np_google_product_categories != "" THEN CONCAT("feed-gpc-", np_google_product_categories, ",") ELSE "" END,
                                    CASE WHEN np_condition != "" THEN CONCAT("feed-cond-", np_condition, ",") ELSE "" END,
                                    CASE WHEN np_team_type != "" THEN CONCAT("team_type-", np_team_type, ",") ELSE "" END,
                                    CASE WHEN np_team_type != "" THEN CONCAT(np_team_type, ",") ELSE "" END,
                                    CASE WHEN np_continent != "" THEN CONCAT("continent-", np_continent, ",") ELSE "" END,
                                    CASE WHEN np_continent != "" THEN CONCAT(np_continent, ",") ELSE "" END,
                                    CASE WHEN np_league != "" THEN CONCAT("league-", np_league, ",") ELSE "" END,
                                    CASE WHEN np_league != "" THEN CONCAT(np_league, ",") ELSE "" END,
                                    CASE WHEN np_player_name != "" THEN CONCAT("player_name-", np_player_name, ",") ELSE "" END,
                                    CASE WHEN np_player_name != "" THEN CONCAT(np_player_name, ",") ELSE "" END,
                                    CASE WHEN np_team != "" THEN CONCAT("Team_", np_team, ",") ELSE "" END,
                                    CASE WHEN np_team != "" THEN CONCAT(np_team, ",") ELSE "" END,
                                    CASE WHEN np_shopify_product_type != "" THEN CONCAT("product_type-", np_shopify_product_type, ",") ELSE "" END,
                                    CASE WHEN np_shopify_product_type != "" THEN CONCAT(np_shopify_product_type, ",") ELSE "" END,
                                    CASE WHEN ${storeId} IN (126,129,99,135,136)
                                    THEN CASE WHEN hero_shirts != 1 AND np_season != '' THEN CONCAT('season-',np_season,',',np_season,',') ELSE '' END
                                    ELSE CASE WHEN np_season != '' THEN CONCAT('season-',np_season,',',np_season,',') ELSE '' END END,
                                    CASE WHEN np_sleevelength != "" THEN CONCAT("sleevelength-", np_sleevelength, ",") ELSE "" END,
                                    CASE WHEN np_sleevelength != "" THEN CONCAT(np_sleevelength, ",") ELSE "" END,
                                    CASE WHEN hero_shirts = 1 THEN CONCAT("hero_shirt", ",") ELSE "" END,
                                    CASE WHEN hero_shirts = 1 AND np_season!= "" THEN CONCAT(np_season,"_","hero-shirt",",") ELSE "" END
                                ) AS tags FROM new_products) t ON sp.np_products_id = t.pid
                                SET sp.sp_tags = t.tags, sp.sp_update_product_status = 'modified'
                                WHERE sp.sp_update_product_status <> 'modified'
                                  AND TRIM(BOTH ',' FROM REPLACE(REPLACE(TRIM(BOTH ',' FROM sp.sp_tags),'Personalized_Product',''),',,',',')) != TRIM(BOTH ',' FROM t.tags)
                                  AND sp.sm_store_id = ?`;


    await prisma.$executeRawUnsafe(recomputeTagsQuery, storeId);

    // -- 2) Re-append 'Personalized_Product' for products with the personalisation attribute (options_id = 4).

    const reAppendTagsQuery = `UPDATE shopify_products sp
                          INNER JOIN (SELECT DISTINCT products_id FROM products_attributes WHERE options_id = 4) t
                            ON sp.np_products_id = t.products_id
                          SET sp.sp_tags = CONCAT(
                                TRIM(BOTH ',' FROM REPLACE(REPLACE(TRIM(BOTH ',' FROM sp.sp_tags),'Personalized_Product',''),',,',',')),
                                ', Personalized_Product,')
                          WHERE sp.sm_store_id = ?`;


    await prisma.$executeRawUnsafe(reAppendTagsQuery, storeId);

    // -- 3) Rebuild the 5 Google custom labels — mapping depends on the store GROUP (see note below).

    const updateTagsQuery = `UPDATE shopify_products sp
                            INNER JOIN (
                              SELECT products_id AS pid,
                                CASE WHEN ? IN (126,129,99,134,135,136) THEN np_season      ELSE np_player_name END AS l0,
                                np_team AS l1,
                                CASE WHEN ? IN (126,129,99,134,135,136) THEN np_player_name ELSE np_season       END AS l2,
                                CASE WHEN ? IN (126,129,99,134,135,136) THEN np_league      ELSE specials_status END AS l3,
                                CASE WHEN ? IN (126,129,99,134,135,136) THEN np_continent   ELSE np_sizeguide    END AS l4
                              FROM new_products) t ON sp.np_products_id = t.pid
                            SET sp.sp_google_custom_label0=t.l0, sp.sp_google_custom_label1=t.l1, sp.sp_google_custom_label2=t.l2,
                                sp.sp_google_custom_label3=t.l3, sp.sp_google_custom_label4=t.l4
                            WHERE sp.sm_store_id = ?`;


    await prisma.$executeRawUnsafe(updateTagsQuery, storeId, storeId, storeId, storeId, storeId);

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'completed',
        scrh_end_time: new Date(),
      },
    });

    logger.info('Successfully Updated tags and google labels on Shopify Table');
    return { success: true };

  } catch (error) {

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'failed',
        scrh_end_time: new Date(),
      },
    }).catch((logError: Error) => {
      logger.warn({ logError }, 'Failed to persist fatal state update into history logs.');
    });

    logger.error({ error: error }, `Internal Server error while updating updating tags and google labels on Shopify Table `);
    throw new Error("Internal Server Error")
  }

}

// Job 2
// -Stage new sizes on shopify tables
export const stageNewSizes = async (storeId: number) => {
  const logger = getLogger();

  logger.info({ storeId: storeId }, 'Staging New Sizes');

  const cronRecord = await prisma.shopifyCronRunHistory.create({
    data: {
      scrh_store_id: storeId,
      scrh_name: "add_new_variation_in_shopify_variation_table",
      scrh_url: `/shopify_products/stage_new_size/${storeId}`,
      scrh_start_time: new Date(),
      scrh_status: 'InProgress',
    },
  });

  try {

    const storeCredentials = await prisma.storeManagement.findFirst({
      where: {
        storeId: storeId,
      },
      select: {
        storeName: true,
        smAppApiKey: true,
        smAppSharedsecret: true,
        smAppAccessToken: true,
        storeOrderIntegrationApiHostname: true,
      },
    });
    if (!storeCredentials) {
      throw new NotFoundError('Store');
    }

    // 1) Date watermark = start time of the last COMPLETED run of this job for this store
    const lastDateAdedQuery = `SELECT scrh_start_time FROM shopify_cron_run_history
                              WHERE scrh_name = 'add_new_variation_in_shopify_variation_table'
                                AND scrh_status = 'completed' AND scrh_store_id = ?
                              ORDER BY scrh_id DESC LIMIT 1`;

    const lastDateAdedResult = await prisma.$queryRawUnsafe(lastDateAdedQuery, storeId);
    const lastDateAdded = (lastDateAdedResult && lastDateAdedResult.length > 0 && lastDateAdedResult[0].scrh_start_time) ? lastDateAdedResult[0].scrh_start_time : config.SHOPIFY_INITIAL_MODIFIED_DATE;

    logger.info({ lastDateAdded: lastDateAdded }, "lastDateAdded");

    // -- 2) Upsert newly-added SIZES for already-staged products (sizes added since the watermark).

    const gledStoreId = config.GLADE_SPORT_STORE_ID;
    const sellerDynamicsStore = config.SELLER_DYNAMIC_STORE_ID;

    // For the Glade Sport store, only stage variants whose SKU is on an active
    // marketplace listing for the SellerDynamics store (mirrors the product-level
    // eligibility check, but tied to the specific size/variant). Applied to both the
    // variant insert and the product-modified flag so they stay consistent.
    const marketplaceVariantFilter = storeId === gledStoreId
      ? `AND EXISTS (
            SELECT 1
            FROM marketplace_listings ml
            INNER JOIN new_products_variations npv ON ml.products_sku = npv.npv_products_sku
            WHERE npv.npv_products_id = np.products_id
              AND npv.npv_size_options_value_id = pa.options_values_id
              AND ml.store_id = ${sellerDynamicsStore}
              AND ml.marketplace_listing_status = 'active'
         )`
      : '';

    const addNewSizeQuery = `INSERT INTO shopify_products_variations
                              (sp_id, sm_store_id, sm_store_name, np_products_id, sp_product_id, spv_variation_id, spv_title,
                               spv_price, spv_sku, spv_inventory_policy, spv_compare_at_price, spv_inventory_management,
                               spv_option1_value, products_options_values_id_for_option1, spv_taxable, spv_barcode,
                               spv_weight_unit, spv_inventory_quantity, spv_requires_shipping, spv_created_at, spv_updated_at)
                            SELECT
                              sp.sp_id, ?, ?, pa.products_id, sp.sp_product_id, NULL,
                              pov.products_options_values_name,
                              CASE WHEN np.specials_status='Special' AND np.specials_price>0 THEN np.specials_price ELSE np.products_price END,
                              NULL, 'deny',
                              CASE WHEN np.products_rrp_price > np.products_price THEN np.products_rrp_price ELSE np.products_price END,
                              'shopify', pov.products_options_values_name, pa.options_values_id, 1, NULL, 'kg', 0, 1, NOW(), NOW()
                            FROM shopify_products sp
                            JOIN new_products np ON sp.np_products_id = np.products_id AND sp.sm_store_id = ?
                            JOIN products_attributes pa ON np.products_id = pa.products_id
                            JOIN products_options_values pov ON pa.options_values_id = pov.products_options_values_id
                            JOIN products_options po ON pa.options_id = po.products_options_id
                            WHERE po.products_options_name LIKE '%size%' AND pa.date_added >= ?
                            ${marketplaceVariantFilter}
                            ON DUPLICATE KEY UPDATE
                              spv_option1_value = VALUES(spv_option1_value),
                              products_options_values_id_for_option1 = VALUES(products_options_values_id_for_option1),
                              spv_updated_at = NOW()`;

    const newSizeResult = await prisma.$executeRawUnsafe(addNewSizeQuery, storeId, storeCredentials.storeName, storeId, lastDateAdded);
    logger.info({ newSizeResult: newSizeResult }, "newSizeResult");

    const updateProductFlagQuery = `UPDATE shopify_products sp
                                    INNER JOIN (
                                      SELECT DISTINCT sp.sp_id
                                      FROM shopify_products sp
                                      JOIN new_products np ON sp.np_products_id = np.products_id AND sp.sm_store_id = ?
                                      JOIN products_attributes pa ON np.products_id = pa.products_id
                                      JOIN products_options po ON pa.options_id = po.products_options_id
                                      WHERE po.products_options_name LIKE '%size%' AND pa.date_added >= ?
                                      ${marketplaceVariantFilter}
                                    ) t ON sp.sp_id = t.sp_id
                                    SET sp.sp_update_product_status = 'modified'
                                    WHERE sp.sm_store_id = ? 
                                      AND sp.sp_update_product_status <> 'modified'`;

    const flagUpdateResult = await prisma.$executeRawUnsafe(updateProductFlagQuery, storeId, lastDateAdded, storeId);
    logger.info({ flagUpdateResult: flagUpdateResult }, "flagUpdateResult");

    // -- 3) Back-fill SKU + barcode for rows still missing a SKU.

    const updateSkuBarcodeQuery = `UPDATE shopify_products_variations spv
                                  INNER JOIN new_products_variations npv
                                    ON spv.products_options_values_id_for_option1 = npv.npv_size_options_value_id
                                   AND spv.np_products_id = npv.npv_products_id
                                  SET spv.spv_sku = npv.npv_products_sku, spv.spv_barcode = npv.npv_products_barcodes
                                  WHERE spv.sm_store_id = ? AND npv.npv_products_sku <> ''
                                    AND (spv.spv_sku IS NULL OR spv.spv_sku = '')`;


    const updateSkuResult = await prisma.$executeRawUnsafe(updateSkuBarcodeQuery, storeId);
    logger.info({ updateSkuResult: updateSkuResult }, "updateSkuResult");

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'completed',
        scrh_end_time: new Date(),
      },
    });

    logger.info({ storeId: storeId }, 'Successfully Added New Sizes on Shopify Table');
    return { success: true };

  } catch (error) {

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'failed',
        scrh_end_time: new Date(),
      },
    }).catch((logError: Error) => {
      logger.warn({ logError, storeId }, 'Failed to persist fatal state update into history logs.');
    });

    logger.error({ error: error, storeId }, `Internal Server error while adding new sizes on Shopify Table `);
    throw new Error("Internal Server Error")
  }

}

// Job 13 — Purge old logs
export const purgeAllRecords = async () => {
  const logger = getLogger();
  logger.info('Removing old logs from shopify_tracking_history and shopify_cron_run_history');

  // These needs to be added to env file
  const tracking_retention_days = config.SHOPIFY_DELETE_OLD_LOGS_FROM_SHOPIFY_TRACKING;
  const cron_retention_days = config.SHOPIFY_DELETE_OLD_LOGS_FROM_CRON_RUN;

  const cronRecord = await prisma.shopifyCronRunHistory.create({
    data: {
      scrh_store_id: 0,
      scrh_name: "delete_old_log_entries",
      scrh_url: '/shopify_products/purge_all_records',
      scrh_start_time: new Date(),
      scrh_status: 'InProgress',
    },
  });

  try {
    // -- Flag inventory drift. The second OR-branch is the "deleted size still shows stock" safety case — keep it.
    const deleteSTHLogsQuery = `DELETE FROM shopify_tracking_history WHERE sth_created_at < CURDATE() - INTERVAL ? DAY;`
    await prisma.$executeRawUnsafe(deleteSTHLogsQuery, tracking_retention_days);

    const deleteSCRHLogsQuery = `DELETE FROM shopify_cron_run_history WHERE scrh_created_at < CURDATE() - INTERVAL ? DAY;`

    await prisma.$executeRawUnsafe(deleteSCRHLogsQuery, cron_retention_days);

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'completed',
        scrh_end_time: new Date(),
      },
    });

    logger.info({ tracking_retention_days, cron_retention_days }, 'Successfully removed old logs  from shopify_tracking_history and shopify_cron_run_history ');
    return { success: true };

  } catch (error) {

    await prisma.shopifyCronRunHistory.update({
      where: { scrh_id: cronRecord.scrh_id },
      data: {
        scrh_status: 'failed',
        scrh_end_time: new Date(),
      },
    }).catch((logError: Error) => {
      logger.warn({ logError }, 'Failed to persist fatal state update into history logs  from shopify_tracking_history and shopify_cron_run_history.');
    });


    logger.error({ error: error, tracking_retention_days, cron_retention_days }, `Internal Server error while removing old logs  from shopify_tracking_history and shopify_cron_run_history `);
    throw new Error("Internal Server Error")

  }

}



