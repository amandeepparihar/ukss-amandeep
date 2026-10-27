import { Prisma } from '@prisma/client';
import { NotFoundError } from '../../lib/errors';
import { getLogger } from '../../lib/logger-context';
import { prisma } from '../../lib/prisma';
import { ShopifySDK } from '../../lib/shopify-sdk';
import { TokenCredentials } from './shopify-product.schema';
import { config } from '../../config';
import { ProductVariantInput } from '../../lib/shopify-sdk/resources/products';

// TODO: Architectural Refactor - Move Dynamic Store Configs to Database
// Current setup builds dynamic keys like SHOPIFY_GRAPHQL_ENDPOINT_${storeId} and SHOPIFY_LOCATION_ID_${storeId}.
// This requires code changes, Zod schema updates, and redeploys to onboard a new store.
// 
// Remediation Steps:
// 1. In Database 'location_id' column already exists in the 'store_management' table, but doesn't contains values for the location_id ,
//    confirm it's usability and use it instead.
// 2. Code: Fetch location_id dynamically from the database alongside the store credentials and access token.
// 3. URL Generation: Remove the endpoint environment variables completely. Instead, generate the GraphQL URL 
//    dynamically from the shop domain using the SDK (similar to shopify-sdk/index.ts around line 75).


// interfaces 
interface ShopifyGraphQLResponse {
    statusCode: number;
    data?: Record<string, any>;
    errors?: Array<{ message: string; extensions?: Record<string, any> }>;
    extensions?: Record<string, any>;
}

export interface ShopifyProduct {
    sp_id: number;
    sp_handle: string;
    sp_published_at: string | Date | null;
    sp_title: string;
    sp_body_html: string | null;
    sp_vendor: string | null;
    sp_product_type: string | null;
    sp_tags: string | null;
    sp_special_status: string | null;
    sp_status: 'active' | 'archived' | 'draft';

    // Dynamic Product Options Mapping Context
    sp_option_1?: string | null;
    sp_option_2?: string | null;
    sp_option_3?: string | null;
    sp_option1_values?: string | null;
    sp_option2_values?: string | null;
    sp_option3_values?: string | null;

    // Metafield Mapping Context
    np_products_model?: string | null;
    np_league?: string | null;
    np_team?: string | null;
    np_agegroup?: string | null;
    np_gender?: string | null;
    np_color?: string | null;
    np_sleevelength?: string | null;

    [key: string]: any;
}

export interface ProductImage {
    sp_id: number;
    spi_id?: number | string;
    product_id?: number | string;
    spi_position?: number;
    spi_alt?: string | null;
    spi_width?: number;
    spi_height?: number;
    spi_src: string;
    spi_variant_ids?: (number | string)[];
}

export interface ProductVariant {
    sp_id: number;
    spv_id?: number | string;
    spv_title: string;
    spv_grams: number;
    spv_requires_shipping: number;
    spv_price?: string | number;
    spv_sku?: string;
    spv_compare_at_price?: string | number | null;
    spv_inventory_management?: 'shopify' | string | null;
    spv_inventory_policy?: 'deny' | 'continue';
    spv_inventory_quantity?: number;
    spv_barcode?: string;
    spv_taxable?: boolean;
    spv_option1_value?: string | null;
    spv_option2_value?: string | null;
    spv_option3_value?: string | null;

}
export interface ShopifyVariantPayload {
    title?: string | null;
    price?: string | number;
    compare_at_price?: string | number;
    inventory_quantity?: number;
    grams?: number;
    inventory_policy?: 'deny' | 'continue';
    inventory_management?: 'shopify' | string;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    taxable?: boolean;
    barcode?: string;
    requires_shipping?: boolean;
    sku?: string;
}

export interface ShopifyImagePayload {
    alt?: string | null;
    position?: number;
    width?: number;
    height?: number;
    src: string;
}

export interface ProductPayload {
    title: string;
    body_html?: string;
    vendor?: string;
    product_type?: string;
    status?: 'active' | 'archived' | 'draft';
    variants: ShopifyVariantPayload[];
    images: ShopifyImagePayload[];
    [key: string]: any;
}

export interface VariationResponseItem {
    sp_id?: number;
    sp_product_id: string | number;
    spv_variation_id?: string | number;
    spv_price?: string | number;
    spv_compare_at_price?: string | number | null;
    spv_title?: string;
    spv_sku?: string;
    spv_grams?: number;
    spv_requires_shipping?: number;
    [key: string]: any;
}

export interface ItemToCreate {
    spId: number;
    payload: ProductPayload;
}
// interfaces

// helper functions 
export async function getTokenCredentials(storeId: number, logger?: any): Promise<TokenCredentials | 'fail'> {
    const log = logger;

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

        if (storeCredentials) {
            log.info({ storeId, storeName: storeCredentials.storeName }, 'Store credentials found in StoreManagement');

            // Handle null/empty values
            const shopUrl = storeCredentials.storeOrderIntegrationApiHostname || '';

            if (!shopUrl) {
                log.error({ storeId }, 'Store has no order integration API hostname configured');
                return 'fail';
            }

            return {
                ShopUrl: shopUrl,
                ApiKey: storeCredentials.smAppApiKey || '',
                SharedSecret: storeCredentials.smAppSharedsecret || '',
                AccessToken: storeCredentials.smAppAccessToken || '',
                StoreName: storeCredentials.storeName,
            };
        }
        return 'fail';
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ error, storeId, message }, 'Failed to get token credentials');

        return 'fail';
    }
}

const buildMetafieldsArray = (fieldMappings: Record<string, any>, namespace: string = 'custom'): { metafields: any[]; productValues: Record<string, string> } => {

    const metafieldsArray: any[] = [];
    const productValuesArray: Record<string, string> = {};

    for (const [key, value] of Object.entries(fieldMappings)) {

        // skip null values
        if (value === null) {
            continue;
        }

        let cleanedValue = String(value).trim();

        // if key is NOT product_code or product_type, capitalize the first letter (ucfirst)
        if (key !== 'product_code' && key !== 'product_type') {
            cleanedValue = cleanedValue.charAt(0).toUpperCase() + cleanedValue.slice(1);
        }

        // build Shopify standard structural object
        const metafieldEntry = {
            namespace: namespace,
            key: key,
            value: cleanedValue,
            type: 'single_line_text_field'
        };

        metafieldsArray.push(metafieldEntry);
        productValuesArray[key] = cleanedValue;
    }

    return {
        metafields: metafieldsArray,
        productValues: productValuesArray
    };
}

async function sendGraphQLRequest(url: string, apiKey: string, query: Record<string, any>, logger: any): Promise<ShopifyGraphQLResponse> {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Shopify-Access-Token': apiKey
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(query),
        });


        if (!response.ok) {
            throw new Error(`Shopify API HTTP Error: ${response.status} ${response.statusText}`);
        }

        const responseData = await response.json();

        const hasThrottleError = responseData.errors?.some((err: any) =>
            err.extensions?.code === 'THROTTLED' ||
            err.message?.toLowerCase().includes('throt')
        );

        if (hasThrottleError) {
            throw new Error('Shopify API GraphQL throttled: Cost limit exceeded.');
        }


        return {
            statusCode: response.status,
            data: responseData.data,
            errors: responseData.errors,
            extensions: responseData.extensions
        };

    } catch (error) {
        logger.error('Request failed:', error);
        throw error;
    }
}

function parseShopifyNextPageCursor(headers: Record<string, string>): string | null {
    const linkHeader = headers['link'] || headers['Link'];
    if (!linkHeader) return null;

    const links = linkHeader.split(',');
    for (const link of links) {
        if (link.includes('rel="next"')) {
            const match = link.match(/page_info=([^>&]+)/);
            if (match && match[1]) {
                return match[1];
            }
        }
    }
    return null;
}

// gets and checks enpoint url for shopify GraphQL
function resolveShopifyEndpoint(storeId: number | string, logger: any) {
    const endpointStore = `SHOPIFY_GRAPHQL_ENDPOINT_${storeId}`;
    const shopifyGraphQlUrl = config[endpointStore as keyof typeof config] as string;

    if (!shopifyGraphQlUrl) {
        logger.error({ storeId }, 'Shopify GraphQl Url for the Store not found');
        return { success: false, url: null, errorResponse: { success: false, msg: "Shopify GraphQl Url for the Store not found" } };
    }

    return { success: true, url: shopifyGraphQlUrl, errorResponse: null };
}

const timeForApiCall = 0.5

async function executeShopifyRequestWithRetry(
    shopifyGraphQlUrl: string,
    accessToken: string,
    graphqlQuery: Record<string, any>,
    logger: any
): Promise<any> {
    try {
        return await sendGraphQLRequest(shopifyGraphQlUrl, accessToken, graphqlQuery, logger);
    } catch (err: any) {
        const message = err?.message?.toLowerCase?.() || "";

        if (message.includes("throttled") || message.includes("429")) {
            logger.warn({ shopifyGraphQlUrl }, 'Shopify request throttled. Retrying in 10 seconds...');

            await new Promise(resolve => setTimeout(resolve, 10000));
            return await sendGraphQLRequest(shopifyGraphQlUrl, accessToken, graphqlQuery, logger);
        }

        throw err;
    }
}


// Job 7
export const createProductsShopify = async (storeId: number) => {
    const logger = getLogger();

    logger.info({ storeId }, 'Creating products on Shopify ');

    const cronRecord = await prisma.shopifyCronRunHistory.create({
        data: {
            scrh_store_id: storeId,
            scrh_name: "create_products ",
            scrh_url: `/shopify_products/create_products_on_shopify/${storeId}`,
            scrh_start_time: new Date(),
            scrh_status: 'InProgress',
        },
    });


    const configWithToken = await getTokenCredentials(Number(storeId), logger);

    if (configWithToken === 'fail') {
        throw new Error(`Failed to get token credentials for store: ${storeId}`);
    }

    logger.info(
        { storeId, storeName: configWithToken.StoreName },
        'Token credentials loaded'
    );

    const shopifyConfig = {
        shopDomain: configWithToken.ShopUrl,
        apiKey: configWithToken.ApiKey,
        sharedSecret: configWithToken.SharedSecret,
        accessToken: configWithToken.AccessToken,
        storeName: configWithToken.StoreName,
        defaultApiVersion: config.SHOPIFY_API_VERSION,
        apiVersion: config.SHOPIFY_API_VERSION,
        microtimeOfLastApiCall: null,
        timeAllowedForEachApiCall: timeForApiCall,
    };

    const shopify = new ShopifySDK(shopifyConfig);

    logger.info({ storeId, shopDomain: configWithToken.ShopUrl }, 'Shopify SDK initialized');

    const create_limit = config.FETCH_SHOPIFY_PRODUCT_LIMIT;

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

        const itemsToCreate: ItemToCreate[] = [];


        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {

            // NEW products not yet on Shopify
            const getProducts = `SELECT sp.sp_id, sp.np_products_id,sp.sm_store_id,sp.sm_store_name,sp.np_products_id,sp.sp_ukss_virtual_product_type_id,sp.sp_product_id,sp.sp_title,sp.sp_body_html,sp.sp_vendor,sp.sp_product_type,sp.sp_handle,sp.sp_published_at,sp.sp_status,sp.sp_create_product_status,sp.sp_special_status,sp.sp_tags,sp.sp_option_1,sp.sp_option_1_id,sp.sp_option1_values,sp.sp_google_custom_label0,sp.sp_google_custom_label1,sp.sp_google_custom_label2,sp.sp_google_custom_label3,sp.sp_google_custom_label4,sp.sp_created_at,sp.sp_updated_at,sp.np_products_model,sp.np_league,sp.np_team,sp.np_agegroup,sp.np_gender,sp.np_color,sp.np_sleevelength,
                                IF(SUM(CASE WHEN spv.spv_sku <> '' THEN 1 ELSE 0 END) > 0, 'new', 'data_missing') AS checkpoint
                                FROM shopify_products sp
                                JOIN shopify_products_variations spv ON sp.sp_id = spv.sp_id
                                WHERE sp.sp_create_product_status = 'new' AND sp.sp_product_id IS NULL AND sp.sm_store_id = ?
                                GROUP BY sp.np_products_id
                                ORDER BY sp.sp_id ASC
                                LIMIT ?;`

            const productsResponse = await tx.$queryRawUnsafe(getProducts, storeId, create_limit);

            if (!productsResponse || productsResponse.length === 0) {
                return { success: "success" };
            }

            const productIds = productsResponse.map((p: ShopifyProduct) => p.sp_id);

            const [variationsResponse, imagesResponse] = await Promise.all([
                tx.$queryRawUnsafe(`SELECT sp_id, spv_title, spv_price, spv_compare_at_price, spv_inventory_quantity,   spv_inventory_policy, spv_inventory_management, spv_option1_value,   spv_taxable, spv_barcode, spv_requires_shipping, spv_sku   FROM shopify_products_variations   WHERE sp_id IN (${productIds.map(() => '?').join(',')})  AND sp_product_id IS NULL  AND spv_variation_id IS NULL AND sm_store_id = ?  AND spv_sku IS NOT NULL  AND spv_sku <> ''`, ...productIds, storeId),
                tx.$queryRawUnsafe(`SELECT sp_id, spi_alt, spi_position, spi_width, spi_height, spi_src FROM shopify_products_images WHERE sp_id IN (${productIds.map(() => '?').join(',')})  AND sp_product_id IS NULL  AND spi_image_id IS NULL AND sm_store_id = ?  AND spi_src IS NOT NULL  AND spi_src <> ''`, ...productIds, storeId)
            ]);

            const productMap = new Map<number, any>();

            // store to include metafields while create operation
            const configStores = config.SHOPIFY_STORE_IDS_FOR_METAFIELDS_ON_CREATE || '';
            const storesWithMetafieldsOnCreate = configStores.split(',').map(id => id.trim());
            const isMetafieldActiveStore = storesWithMetafieldsOnCreate.length > 0 && storesWithMetafieldsOnCreate.includes(storeId.toString());

            productsResponse.forEach((product: ShopifyProduct) => {
                const productOptions = Array.from({ length: 3 }, (_, index) => index + 1).map(i => {
                    const name = product[`sp_option_${i}`];
                    const rawValues = product[`sp_option${i}_values`];
                    if (!name) return null;

                    const values = rawValues
                        ? rawValues.split(',').map((v: string) => v.trim()).filter(Boolean)
                        : [];

                    return { name, position: i, values };
                }).filter(Boolean);

                const tagList = [product.sp_tags, product.sp_special_status]
                    .map(t => t?.trim())
                    .filter(Boolean)
                    .join(', ');

                let metafieldsPayload = undefined;

                if (isMetafieldActiveStore) {
                    const fieldMappings = {
                        product_code: product.np_products_model ?? null,
                        league: product.np_league ?? null,
                        team: product.np_team ?? null,
                        agegroup: product.np_agegroup ?? null,
                        gender: product.np_gender ?? null,
                        color: product.np_color ?? null,
                        sleeve_length: product.np_sleevelength ?? null,
                        product_type: product.sp_product_type ?? null,
                    };

                    const metafieldsResult = buildMetafieldsArray(fieldMappings);

                    if (metafieldsResult?.metafields?.length > 0) {
                        metafieldsPayload = metafieldsResult.metafields;
                    }
                }

                // products payload
                productMap.set(product.sp_id, {
                    handle: product.sp_handle,
                    published_at: product.sp_published_at,
                    title: product.sp_title,
                    body_html: product.sp_body_html,
                    vendor: product.sp_vendor,
                    product_type: product.sp_product_type,
                    variants: [],
                    images: [],
                    options: productOptions,
                    tags: tagList,
                    status: product.sp_status,
                    ...(metafieldsPayload && { metafields: metafieldsPayload })
                });
            });



            for (const product of productsResponse) {
                const spId = product.sp_id;
                const payload = productMap.get(spId);

                // check for empty or invalid products
                if (!payload) continue;

                const productVariants = variationsResponse.filter((v: ProductVariant) => v.sp_id === spId);
                const productImages = imagesResponse.filter((img: ProductImage) => img.sp_id === spId);

                // validate empty variants or imgs 
                const hasValidVariantWithSku = productVariants.length > 0 && productVariants.some((v: ProductVariant) => v.spv_sku && v.spv_sku.trim() !== '');
                const hasImages = productImages.length > 0;

                if (!hasValidVariantWithSku || !hasImages) {
                    await tx.$queryRawUnsafe(
                        `UPDATE shopify_products SET sp_create_product_status = 'data_missing', updated_on_shopify = NOW() WHERE sp_id = ? AND sm_store_id = ?;`,
                        spId, storeId
                    );
                    continue;
                }

                // map variants and images to the payload object
                payload.variants = productVariants.map((variant: ProductVariant) => ({
                    title: variant.spv_title || "",
                    price: variant.spv_price || null,
                    compare_at_price: variant.spv_compare_at_price || null,
                    inventory_quantity: variant.spv_inventory_quantity || null,
                    grams: variant.spv_grams || null,
                    inventory_policy: variant.spv_inventory_policy || null,
                    inventory_management: variant.spv_inventory_management || null,
                    option1: variant.spv_option1_value || null,
                    option2: variant.spv_option2_value || null,
                    option3: variant.spv_option3_value || null,
                    taxable: variant.spv_taxable || null,
                    barcode: variant.spv_barcode || null,
                    requires_shipping: variant.spv_requires_shipping || null,
                    sku: variant.spv_sku || null,
                }));

                payload.images = productImages.map((img: ProductImage) => ({
                    alt: img.spi_alt,
                    position: img.spi_position,
                    width: img.spi_width,
                    height: img.spi_height,
                    src: img.spi_src,
                }));

                itemsToCreate.push({ spId, payload });
            }

        })

        for (const item of itemsToCreate) {
            try {

                const productCreateResponse = await shopify.Product.post({ product: item.payload });
                const createdProduct = productCreateResponse.data;

                const option1Id = createdProduct?.options?.[0]?.id || null;
                const option2Id = createdProduct?.options?.[1]?.id || null;
                const option3Id = createdProduct?.options?.[2]?.id || null;

                await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                    // Update the matching row using item.spId
                    const updateSpQuery = `UPDATE shopify_products
                                            SET sp_product_id = ?, 
                                                sp_handle = ?,
                                                sp_option_1_id = ?, 
                                                sp_option_2_id = ?, 
                                                sp_option_3_id = ?,
                                                sp_create_product_status = 'created', 
                                                created_on_shopify = NOW(), 
                                                updated_on_shopify = NOW()
                                            WHERE sp_id = ? AND sm_store_id = ?; `;

                    await tx.$queryRawUnsafe(
                        updateSpQuery,
                        createdProduct.id.toString(),
                        createdProduct.handle,
                        option1Id,
                        option2Id,
                        option3Id,
                        item.spId,
                        storeId
                    );

                    for (const variant of createdProduct.variants) {
                        // update variations 
                        const updateVariationSql = `UPDATE shopify_products_variations
                                                    SET spv_variation_id=?, sp_product_id=?,
                                                        spv_inventory_item_id=?, updated_on_shopify=NOW()
                                                    WHERE sm_store_id=? AND spv_sku=? AND sp_id=?;`

                        await tx.$queryRawUnsafe(updateVariationSql, variant.id, variant.product_id, variant.inventory_item_id, storeId, variant.sku, item.spId);
                    };

                    for (const image of createdProduct.images) {
                        // update images 
                        const updateImageSql = `UPDATE shopify_products_images
                                                SET sp_product_id=?, spi_image_id=?, updated_on_shopify=NOW()
                                                WHERE sm_store_id=? AND sp_id=? AND spi_alt=?;`

                        await tx.$queryRawUnsafe(updateImageSql, image.product_id, image.id, storeId, item.spId, image.alt);
                    };

                    await tx.shopifyTrackingHistory.create({
                        data: {
                            store_id: storeId,
                            sp_product_id: createdProduct.id.toString(),
                            spv_variation_id: null,
                            sth_update_type: 'product',
                            sth_new_value: JSON.stringify({ handle: createdProduct.handle }),
                            sth_status: 'success',
                            sth_message: `Product successfully created on Shopify with ID: ${createdProduct.id}`,

                        }
                    });
                })

            } catch (error: any) {

                const updateErrorSql = `UPDATE shopify_products SET sp_create_product_status = 'error', updated_on_shopify = NOW() WHERE sp_id = ? AND sm_store_id = ?;`;
                await prisma.$queryRawUnsafe(updateErrorSql, item.spId, storeId);
                await prisma.shopifyTrackingHistory.create({
                    data: {
                        store_id: storeId,
                        sp_product_id: null,
                        spv_variation_id: null,
                        sth_update_type: 'product',
                        sth_new_value: JSON.stringify({ payload: item.payload }),
                        sth_status: 'failure',
                        sth_message: `Product failed to be created on Shopify with ID: ${item.spId}`,

                    }
                });
                logger.error({ error: error.message }, `Failed creating product for sp_id ${item.spId}`);
            }
        }

        await prisma.shopifyCronRunHistory.update({
            where: { scrh_id: cronRecord.scrh_id },
            data: {
                scrh_status: 'completed',
                scrh_end_time: new Date(),
            },
        });

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

        if (error instanceof NotFoundError) {
            logger.error({ error: error, storeId: storeId }, ` Store with ID ${storeId} not found.`);
            throw error
        } else {
            logger.error({ error: error, storeId: storeId }, `Internal Server error while creating products for store ID on Shopify ${storeId}: `);
            throw new Error("Internal Server Error")
        }
    }
}

// Job 9 
export const updatePriceOnShopify = async (storeId: number, all?: string) => {
    const logger = getLogger();

    logger.info({ storeId }, 'Updating Price On Shopify');

    const cronRecord = await prisma.shopifyCronRunHistory.create({
        data: {
            scrh_store_id: storeId,
            scrh_name: "update_shopify_price",
            scrh_url: `/shopify_products/update_price_on_shopify/${storeId}/${all}`,
            scrh_start_time: new Date(),
            scrh_status: 'InProgress',
        },
    });


    const configWithToken = await getTokenCredentials(Number(storeId), logger);

    if (configWithToken === 'fail') {
        throw new Error(`Failed to get token credentials for store: ${storeId}`);
    }

    logger.info(
        { storeId, storeName: configWithToken.StoreName },
        'Token credentials loaded'
    );

    const accessToken = configWithToken.AccessToken;

    const endpointCheck = resolveShopifyEndpoint(storeId, logger);
    if (!endpointCheck.success) {
        return endpointCheck.errorResponse;
    }
    const shopifyGraphQlUrl = endpointCheck.url as string

    logger.info({ storeId, shopDomain: configWithToken.ShopUrl }, 'Shopify SDK initialized');
    const price_limit = config.FETCH_SHOPIFY_PRICE_AND_INVENTORY_PRODUCT_LIMIT;
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

        let variationResponse: VariationResponseItem[] = [];
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {

            // NEW products not yet on Shopify

            let updatedProductsQuery = "";
            if (all === "all") {
                updatedProductsQuery = `SELECT sp_id FROM shopify_products
                                              WHERE  sp_product_id IS NOT NULL AND sm_store_id=?
                                                AND sp_status='active' AND sp_create_product_status='created'
                                              LIMIT ?;`
            } else {
                updatedProductsQuery = `SELECT sp_id FROM shopify_products
                                                 WHERE sp_update_price_status='modified' AND sp_product_id IS NOT NULL AND sm_store_id=?
                                                   AND sp_status='active' AND sp_create_product_status='created'
                                                 LIMIT ?;`

            }

            const productsResponse = await tx.$queryRawUnsafe(updatedProductsQuery, storeId, price_limit);

            if (!productsResponse || productsResponse.length === 0) {
                return { success: "success" };
            }

            const productIds = productsResponse.map((p: ShopifyProduct) => p.sp_id);
            const productsList = productIds.map(() => '?').join(',');
            if (productIds.length === 0) {
                return [];
            }

            // -- 2) STEP 2 — the sellable variations for those sp_ids.
            const variationsquery = `SELECT sp_id, sp_product_id, spv_variation_id, spv_price, spv_compare_at_price
                                    FROM shopify_products_variations
                                    WHERE sm_store_id=? AND sp_product_id IS NOT NULL
                                      AND spv_sku <> '' AND spv_sku IS NOT NULL
                                      AND spv_variation_id <> '' AND spv_variation_id IS NOT NULL
                                      AND sp_id IN (${productsList});`

            variationResponse = await tx.$queryRawUnsafe(variationsquery, storeId, ...productIds);

            if (variationResponse && variationResponse.length > 0) {
                variationResponse.push({ sp_product_id: "end" });

            }

        })


        if (variationResponse?.length) {
            let shopifyProduct: string | number = '';
            let variants: ProductVariantInput[] = [];
            let trackingData: any[] = [];

            const processVariationPriceUpdate = async (
                productId: string | number,
                variantsPayload: any[],
                trackingPayload: any[]
            ) => {
                if (!productId || variantsPayload.length === 0) {
                    return;
                }

                const graphqlQuery = {
                    query: `
                mutation PriceSync(
                    $productId: ID!,
                    $variants: [ProductVariantsBulkInput!]!
                ) {
                    productVariantsBulkUpdate(
                        productId: $productId,
                        variants: $variants
                    ) {
                        productVariants {
                            id
                            price
                            compareAtPrice
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }
                `,
                    variables: {
                        productId: `gid://shopify/Product/${productId}`,
                        variants: variantsPayload
                    }
                };

                try {
                    const response = await executeShopifyRequestWithRetry(shopifyGraphQlUrl, accessToken, graphqlQuery, logger);

                    const graphqlErrors: string[] = [];

                    if (response?.errors?.length) {
                        graphqlErrors.push(
                            ...response.errors.map((e: any) => e.message)
                        );
                    }

                    const userErrors =
                        response?.data?.productVariantsBulkUpdate?.userErrors || [];

                    if (userErrors.length) {
                        graphqlErrors.push(
                            ...userErrors.map((e: any) => e.message)
                        );
                    }

                    if (graphqlErrors.length) {

                        await prisma.$queryRawUnsafe(
                            `UPDATE shopify_products
                                 SET sp_update_price_status='error',
                                     updated_on_shopify=NOW()
                                 WHERE sp_product_id=? 
                                 AND sm_store_id=?`,
                            productId,
                            storeId
                        );

                        await prisma.shopifyTrackingHistory.createMany({
                            data: trackingPayload.map(item => ({
                                ...item,
                                sp_product_id: item.sp_product_id?.toString(),
                                spv_variation_id: item.spv_variation_id?.toString(),
                                sth_new_value: String(item.sth_new_value || ""),
                                sth_status: 'failure',
                                sth_message: graphqlErrors.join(', ')
                            }))
                        });

                        logger.error(
                            { productId, graphqlErrors },
                            'Variation price update failed'
                        );

                        return;
                    }

                    await prisma.$queryRawUnsafe(`UPDATE shopify_products
                                                SET sp_update_price_status='finalized',
                                                    updated_on_shopify=NOW()
                                                WHERE sp_product_id=? 
                                                AND sm_store_id=?`,
                        productId,
                        storeId);

                    await prisma.shopifyTrackingHistory.createMany({
                        data: trackingPayload.map(item => ({
                            ...item,
                            sp_product_id: item.sp_product_id?.toString(),
                            spv_variation_id: item.spv_variation_id?.toString(),
                            sth_new_value: String(item.sth_new_value || ""),

                            sth_status: 'success',
                            sth_message: 'Product variation price updated successfully'
                        }))
                    });

                    logger.info(
                        { productId },
                        'Variation prices updated successfully'
                    );

                } catch (error: any) {

                    await prisma.$queryRawUnsafe(
                        `UPDATE shopify_products
                 SET sp_update_price_status='error',
                     updated_on_shopify=NOW()
                 WHERE sp_product_id=? 
                 AND sm_store_id=?`,
                        productId,
                        storeId
                    );

                    await prisma.shopifyTrackingHistory.createMany({
                        data: trackingPayload.map(item => ({
                            ...item,
                            sp_product_id: item.sp_product_id?.toString(),
                            spv_variation_id: item.spv_variation_id?.toString(),
                            sth_new_value: String(item.sth_new_value || ""),

                            sth_status: 'failure',
                            sth_message: error.message
                        }))
                    });

                    logger.error(
                        { productId, error: error.message },
                        'Variation update failed'
                    );
                }
            };

            for (const product of variationResponse) {

                if (shopifyProduct !== product.sp_product_id) {

                    if (shopifyProduct) {
                        await processVariationPriceUpdate(
                            shopifyProduct,
                            variants,
                            trackingData
                        );
                    }

                    shopifyProduct = product.sp_product_id;

                    variants = [];
                    trackingData = [];

                    if (shopifyProduct === 'end') {
                        break;
                    }
                }

                variants.push({
                    id: `gid://shopify/ProductVariant/${product.spv_variation_id}`,
                    price: String(product.spv_price),
                    compareAtPrice: String(product.spv_compare_at_price) || null
                });

                trackingData.push({
                    store_id: storeId,
                    sp_product_id: product.sp_product_id,
                    spv_variation_id: product.spv_variation_id,
                    sth_update_type: "product",
                    sth_new_value: product.spv_price,
                    sth_status: '',
                    sth_message: ''
                });
            }

            // Process last product
            if (shopifyProduct && variants.length) {
                await processVariationPriceUpdate(
                    shopifyProduct,
                    variants,
                    trackingData
                );
            }
        }



        logger.info({ storeId }, "Products price updated successfully");

        await prisma.shopifyCronRunHistory.update({
            where: { scrh_id: cronRecord.scrh_id },
            data: {
                scrh_status: 'completed',
                scrh_end_time: new Date(),
            },
        });

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

        if (error instanceof NotFoundError) {
            logger.error({ error: error, storeId: storeId }, ` Store with ID ${storeId} not found.`);
            throw error
        } else {
            logger.error({ error: error, storeId: storeId }, `Internal Server error while updating price on Shopify `);
            throw new Error("Internal Server Error")
        }
    }

}


// Job 10 
export const updateInventoryOnShopify = async (storeId: number) => {
    const logger = getLogger();

    logger.info('Updating Stocks On Shopify');

    const configStores = config.STORE_CONTAINING_PHYSICAL_QUANTITY || '';
    const storesWithPhysicalStore = configStores.split(',').map(id => id.trim());
    const isPhysicalStore = storesWithPhysicalStore.length > 0 && storesWithPhysicalStore.includes(storeId.toString());

    const cronRecord = await prisma.shopifyCronRunHistory.create({
        data: {
            scrh_store_id: storeId,
            scrh_name: "update_shopify_inventory  ",
            scrh_url: `/shopify_products/update_inventory_on_shopify/${storeId}`,
            scrh_start_time: new Date(),
            scrh_status: 'InProgress',
        },
    })

    const batchSize = config.SHOPIFY_INVENTORY_BATCH_SIZE;
    const locationStore = `SHOPIFY_LOCATION_ID_${storeId}`
    const locationId = config[locationStore as keyof typeof config];

    if (!locationId) {
        logger.error({ storeId }, 'Location Id for the Store not found');
        return { success: false, msg: "Location Id for the Store not found" }
    }

    const configWithToken = await getTokenCredentials(Number(storeId), logger);

    if (configWithToken === 'fail') {
        throw new Error(`Failed to get token credentials for store: ${storeId}`);
    }

    logger.info(
        { storeId, storeName: configWithToken.StoreName },
        'Token credentials loaded'
    );

    const invLimit = config.FETCH_SHOPIFY_PRICE_AND_INVENTORY_PRODUCT_LIMIT;
    const accessToken = configWithToken.AccessToken;

    const endpointCheck = resolveShopifyEndpoint(storeId, logger);
    if (!endpointCheck.success) {
        return endpointCheck.errorResponse;
    }
    const shopifyGraphQlUrl = endpointCheck.url as string

    logger.info({ storeId, shopDomain: configWithToken.ShopUrl }, 'Shopify SDK initialized');

    try {

        // in this Added JOIN to reference products_attributes table for dead sizes , which wasn't present in the legacy code.
        const changedStockSql = `SELECT spv.sp_id, spv.spv_id, spv.sp_product_id, spv.spv_variation_id, spv.spv_inventory_item_id,
                            spv.spv_inventory_quantity, npv.npv_quantities, npv.npv_delete_status, npv.npv_products_sku,
                            npv.fc_quantity,
                            pa.pa_status AS attribute_status 
                        FROM shopify_products_variations spv
                        JOIN shopify_products sp ON spv.sp_id = sp.sp_id
                        LEFT JOIN new_products_variations npv ON spv.spv_sku = npv.npv_products_sku
                    
                        LEFT JOIN products_attributes pa 
                            ON spv.np_products_id = pa.products_id
                            AND spv.products_options_values_id_for_option1 = pa.options_values_id
                        WHERE spv.sm_store_id=? AND spv.sp_product_id IS NOT NULL
                        AND spv.spv_sku <> '' AND spv.spv_inventory_item_id <> '' AND spv.spv_variation_id <> ''
                        AND sp.sp_status='active' AND sp.sp_create_product_status='created'
                        AND (
                            -- Condition 1: Handle normal active stock mismatch based on store type
                            (npv.npv_delete_status = '0' AND npv.npv_products_sku IS NOT NULL AND spv.spv_inventory_quantity <> 
                                ${isPhysicalStore
                ? `CASE WHEN npv.fc_quantity IS NULL THEN 0 ELSE npv.npv_quantities END`
                : `npv.npv_quantities`
            }
                            )
                            OR
                            -- Condition 2: If local product is marked as deleted, Shopify inventory should be 0
                            (npv.npv_delete_status = '1' AND spv.spv_inventory_quantity <> 0)
                            OR
                            -- Condition 3: If local product doesn't exist at all, Shopify inventory should be 0
                            (npv.npv_products_sku IS NULL AND spv.spv_inventory_quantity <> 0)
                        )
                        LIMIT ?;`

        const changedStock = await prisma.$queryRawUnsafe(
            changedStockSql,
            storeId,
            invLimit
        ) as any[];

        if (!changedStock?.length) {
            logger.info({ storeId }, "No inventory changes found");
            return { success: true, msg: "No inventory changes found" };
        }

        const successProductArray: string[] = [];
        const failureProductArray: string[] = [];

        let batchQuantities: any[] = [];
        let batchTrackingData: any[] = [];
        let batchSpvData: any[] = [];
        let batchProductIds: string[] = [];

        for (let i = 0; i < changedStock.length; i++) {
            const product = changedStock[i];

            // Dead/orphan variant: pa_status = 0, or no products_attributes row (attribute_status null).
            // Explicit null/numeric check — pa_status may come back as the string '0', which is truthy.
            const isDeadVariant = product.attribute_status == null || Number(product.attribute_status) === 0;

            // Physical store: mirror legacy target computation — if fc_quantity IS NULL, force Shopify target to 0.
            // (Distinct from isDeadVariant/pa_status; a live size can still have a null fc_quantity.)
            const targetQty = !product.npv_products_sku || product.npv_delete_status === '1' || isDeadVariant
                || (isPhysicalStore && product.fc_quantity == null)
                ? 0
                : Number(product.npv_quantities);

            batchQuantities.push({
                inventoryItemId: `gid://shopify/InventoryItem/${product.spv_inventory_item_id}`,
                locationId: `gid://shopify/Location/${locationId}`,
                quantity: targetQty
            });

            batchTrackingData.push({
                store_id: storeId,
                sp_product_id: product.sp_product_id,
                spv_variation_id: product.spv_variation_id,
                sth_update_type: "inventory",
                sth_new_value: targetQty,
                sth_status: "",
                sth_message: ""
            });

            batchSpvData.push({
                spv_id: Number(product.spv_id),
                target_qty: targetQty
            });

            if (!batchProductIds.includes(product.sp_product_id)) {
                batchProductIds.push(product.sp_product_id);
            }

            const isLast = i === changedStock.length - 1;

            if (
                batchQuantities.length < batchSize &&
                !isLast
            ) {
                continue;
            }

            const graphqlQuery = {
                query: `
                mutation inventorySetQuantities(
                    $input: InventorySetQuantitiesInput!
                ) {
                    inventorySetQuantities(
                        input: $input
                    ) {
                        inventoryAdjustmentGroup {
                            createdAt
                        }
                        userErrors {
                            field
                            message
                            code
                        }
                    }
                }
            `,
                variables: {
                    input: {
                        name: "available",
                        reason: "correction",
                        ignoreCompareQuantity: true,
                        quantities: batchQuantities
                    }
                }
            };

            try {

                const response = await executeShopifyRequestWithRetry(shopifyGraphQlUrl, accessToken, graphqlQuery, logger);

                const graphqlErrors: string[] = [];

                if (response?.errors?.length) {
                    graphqlErrors.push(
                        ...response.errors.map(
                            (e: any) => e.message
                        )
                    );
                }

                const userErrors = response?.data?.inventorySetQuantities?.userErrors || [];

                if (userErrors.length) {
                    graphqlErrors.push(
                        ...userErrors.map(
                            (e: any) => e.message
                        )
                    );
                }

                if (graphqlErrors.length) {
                    for (const pid of batchProductIds) {
                        if (!failureProductArray.includes(pid)) {
                            failureProductArray.push(pid);
                        }
                    }

                    await prisma.shopifyTrackingHistory.createMany({
                        data: batchTrackingData.map(item => ({
                            ...item,
                            sp_product_id: item.sp_product_id?.toString(),
                            spv_variation_id: item.spv_variation_id?.toString(),
                            sth_new_value: String(item.sth_new_value),
                            sth_status: "failure",
                            sth_message:
                                graphqlErrors.join(", ")
                        }))
                    });

                    logger.error(
                        {
                            storeId,
                            graphqlErrors,
                            batchSize:
                                batchQuantities.length
                        },
                        "Inventory batch failed"
                    );

                } else {

                    for (const pid of batchProductIds) {
                        if (
                            !successProductArray.includes(pid)
                        ) {
                            successProductArray.push(pid);
                        }
                    }

                    await prisma.shopifyTrackingHistory.createMany({
                        data: batchTrackingData.map(item => ({
                            ...item,
                            sp_product_id: item.sp_product_id?.toString(),
                            spv_variation_id: item.spv_variation_id?.toString(),
                            sth_new_value: String(item.sth_new_value),
                            sth_status: "success",
                            sth_message:
                                "Inventory updated successfully"
                        }))
                    });

                    const caseStatement = batchSpvData.map(x => `WHEN ${x.spv_id} THEN ${x.target_qty}`).join(" ");

                    const spvIds = batchSpvData.map(x => x.spv_id).join(",");

                    await prisma.$executeRawUnsafe(`
                    UPDATE shopify_products_variations
                    SET spv_inventory_quantity =
                        CASE spv_id
                            ${caseStatement}
                        END
                    WHERE spv_id IN (${spvIds})
                `);

                    logger.info(
                        {
                            storeId,
                            variations:
                                batchSpvData.length
                        },
                        "Inventory batch updated successfully"
                    );
                }

            } catch (error: any) {

                for (const pid of batchProductIds) {
                    if (
                        !failureProductArray.includes(pid)
                    ) {
                        failureProductArray.push(pid);
                    }
                }

                await prisma.shopifyTrackingHistory.createMany({
                    data: batchTrackingData.map(item => ({
                        ...item,
                        sp_product_id: item.sp_product_id?.toString(),
                        spv_variation_id: item.spv_variation_id?.toString(),
                        sth_new_value: String(item.sth_new_value),
                        sth_status: "failure",
                        sth_message:
                            error?.message ||
                            "Unknown error"
                    }))
                });

                logger.error(
                    {
                        storeId,
                        error: error?.message
                    },
                    "Inventory sync batch failed"
                );
            }

            batchQuantities = [];
            batchTrackingData = [];
            batchSpvData = [];
            batchProductIds = [];
        }

        const productsToFinalize =
            successProductArray.filter(
                pid =>
                    !failureProductArray.includes(pid)
            );

        if (productsToFinalize.length) {

            await prisma.$executeRawUnsafe(`
            UPDATE shopify_products
            SET
                sp_update_inventory_status='finalized',
                updated_on_shopify=NOW()
            WHERE
                sm_store_id=${storeId}
                AND sp_product_id IN (${productsToFinalize.join(",")})
        `);

            logger.info(
                {
                    productsToFinalize
                },
                "Inventory finalized"
            );
        }

        if (failureProductArray.length) {

            await prisma.$executeRawUnsafe(`
            UPDATE shopify_products
            SET
                sp_update_inventory_status='error',
                updated_on_shopify=NOW()
            WHERE
                sm_store_id=${storeId}
                AND sp_product_id IN (${failureProductArray.join(",")})
        `);

            logger.error(
                {
                    failureProductArray
                },
                "Inventory sync errors found"
            );
        }

        await prisma.shopifyCronRunHistory.update({
            where: { scrh_id: cronRecord.scrh_id },
            data: {
                scrh_status: 'completed',
                scrh_end_time: new Date(),
            },
        });

        return {
            success: true,
            totalProducts: successProductArray.length,
            failedProducts: failureProductArray.length
        };


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

        if (error instanceof NotFoundError) {
            logger.error({ error: error, storeId: storeId }, ` Store with ID ${storeId} not found.`);
            throw error
        } else {
            logger.error({ error: error, storeId: storeId }, `Internal Server error while updating Stocks on Shopify `);
            throw new Error("Internal Server Error")
        }
    }


}

// Job 8 
export const updateProductsDetailOnShopify = async (storeId: number, all?: string) => {

    const logger = getLogger();

    logger.info('Updating Products Details On Shopify');

    const cronRecord = await prisma.shopifyCronRunHistory.create({
        data: {
            scrh_store_id: storeId,
            scrh_name: "update_shopify_product:1190",
            scrh_url: `/shopify_products/update_product_detail_on_shopify/${storeId}/${all}`,
            scrh_start_time: new Date(),
            scrh_status: 'InProgress',
        },
    });


    const configWithToken = await getTokenCredentials(Number(storeId), logger);

    if (configWithToken === 'fail') {
        throw new Error(`Failed to get token credentials for store: ${storeId}`);
    }

    logger.info(
        { storeId, storeName: configWithToken.StoreName },
        'Token credentials loaded'
    );

    const shopifyConfig = {
        shopDomain: configWithToken.ShopUrl,
        apiKey: configWithToken.ApiKey,
        sharedSecret: configWithToken.SharedSecret,
        accessToken: configWithToken.AccessToken,
        storeName: configWithToken.StoreName,
        defaultApiVersion: config.SHOPIFY_API_VERSION,
        apiVersion: config.SHOPIFY_API_VERSION,
        microtimeOfLastApiCall: null,
        timeAllowedForEachApiCall: timeForApiCall,
    };

    const shopify = new ShopifySDK(shopifyConfig);
    const updateLimit = config.FETCH_SHOPIFY_UPDATE_PRODUCT_LIMIT;
    const accessToken = configWithToken.AccessToken;
    const endpointCheck = resolveShopifyEndpoint(storeId, logger);
    if (!endpointCheck.success) {
        return endpointCheck.errorResponse;
    }
    const shopifyGraphQlUrl = endpointCheck.url as string

    logger.info({ storeId, shopDomain: configWithToken.ShopUrl }, 'Shopify SDK initialized');

    let productsToPush: ProductPayload[] = [];
    try {
        let productToPushSql = "";

        if (all === "all") { //wihtout limit push all active changes 

            productToPushSql = `SELECT * FROM shopify_products
                                    WHERE sp_update_product_status='modified' AND sp_product_id IS NOT NULL
                                      AND sm_store_id=? AND sp_status='active';`
            productsToPush = await prisma.$queryRawUnsafe(productToPushSql, storeId);

        } else {

            productToPushSql = `SELECT * FROM shopify_products
                                    WHERE sp_update_product_status='modified' AND sp_product_id IS NOT NULL
                                      AND sm_store_id=? AND sp_status='active' LIMIT ?;`
            productsToPush = await prisma.$queryRawUnsafe(productToPushSql, storeId, updateLimit);

        }

        for (const product of productsToPush) {
            const graphqlErrors: string[] = [];

            // Build tags
            let tags = product.sp_tags || '';

            if (product.sp_google_custom_label0?.trim()) {
                tags += `,feed-cl0-${product.sp_google_custom_label0}`;
            }

            if (product.sp_google_custom_label1?.trim()) {
                tags += `,feed-cl1-${product.sp_google_custom_label1}`;
            }

            if (product.sp_google_custom_label2?.trim()) {
                tags += `,feed-cl2-${product.sp_google_custom_label2}`;
            }

            if (product.sp_google_custom_label3?.trim()) {
                tags += `,feed-cl3-${product.sp_google_custom_label3}`;
            }

            if (product.sp_google_custom_label4?.trim()) {
                tags += `,feed-cl4-${product.sp_google_custom_label4}`;
            }

            const allTags = `${tags},${product.sp_special_status || ''}`.split(',').map((tag) => tag.trim()).filter(Boolean);

            const productInput = {
                id: `gid://shopify/Product/${product.sp_product_id}`,
                title: product.sp_title,
                vendor: product.sp_vendor,
                productType: product.sp_product_type,
                status: product.sp_status.toUpperCase(),
                tags: allTags,
            };

            const mutation = `mutation ProductSync(
                                    $id: ID!,
                                    $title: String,
                                    $vendor: String,
                                    $productType: String,
                                    $status: ProductStatus,
                                    $tags: [String!]
                                ) {
                                    productUpdate(
                                        product: {
                                            id: $id
                                            title: $title
                                            vendor: $vendor
                                            productType: $productType
                                            status: $status
                                            tags: $tags
                                        }
                                    ) {
                                        product {
                                            id
                                            title
                                            status
                                        }
                                        userErrors {
                                            field
                                            message
                                        }
                                    }
                                }
                            `;

            const updateQuery = {
                query: mutation,
                variables: productInput
            }
            const productNewValues = {
                title: product.sp_title,
                vendor: product.sp_vendor,
                productType: product.sp_product_type,
                status: product.sp_status,
                tags: `${tags},${product.sp_special_status || ''}`,
            };

            logger.info(
                {
                    npProductId: product.np_products_id,
                    shopifyProductId: product.sp_product_id,
                    productInput,
                },
                'Updating Shopify product'
            );

            try {
                const response = await executeShopifyRequestWithRetry(shopifyGraphQlUrl, accessToken, updateQuery, logger);

                const userErrors = response?.data?.productUpdate?.userErrors || [];

                if (userErrors.length) {
                    graphqlErrors.push(
                        ...userErrors.map((e: any) => e.message)
                    );
                }

                if (graphqlErrors.length) {
                    // update status = error
                    const updateSpSql = `UPDATE shopify_products SET sp_update_product_status='error' WHERE np_products_id=? AND sm_store_id=?;`

                    await prisma.$executeRawUnsafe(updateSpSql, product.np_products_id, storeId);

                    await prisma.shopifyTrackingHistory.create({
                        data: {
                            sp_product_id: product.sp_product_id?.toString(),
                            spv_variation_id: null,
                            sth_update_type: 'product',
                            sth_new_value: JSON.stringify(productNewValues),
                            sth_status: 'failure',
                            store_id: storeId,
                            sth_message: graphqlErrors.join(', '),
                        },
                    });

                    continue;
                }

                // SUCCESS
                const updaeSpSql = `UPDATE shopify_products SET sp_update_product_status='finalized', updated_on_shopify=NOW()
                                        WHERE sp_product_id=? AND sm_store_id=?;`;

                await prisma.$executeRawUnsafe(updaeSpSql, product.sp_product_id, storeId);

                await prisma.shopifyTrackingHistory.create({
                    data: {
                        sp_product_id: product.sp_product_id?.toString(),
                        spv_variation_id: null,
                        sth_update_type: 'product',
                        sth_new_value: JSON.stringify(productNewValues),
                        sth_status: 'success',
                        store_id: storeId,
                        sth_message: 'Product updated successfully',
                    },
                });

                //   ---------------------------------------------------------------------------------------------------------
                // Create missing Shopify variants

                const missingVariantsSql = `SELECT *
                                                FROM shopify_products_variations
                                                WHERE sp_id = ?
                                                AND spv_variation_id IS NULL
                                                AND sp_product_id IS NOT NULL
                                                AND spv_sku IS NOT NULL
                                                AND spv_sku <> ''
                                                AND sm_store_id = ?;
                                               `;

                const missingVariants = await prisma.$queryRawUnsafe(missingVariantsSql, product.sp_id, storeId);

                for (const variant of missingVariants) {
                    try {
                        const variantPayload = {
                            product_id: product.sp_product_id?.toString(),
                            price: variant.spv_price || null,
                            compare_at_price: variant.spv_compare_at_price || null,
                            inventory_quantity: variant.spv_inventory_quantity || null,
                            inventory_policy: variant.spv_inventory_policy || null,
                            inventory_management: variant.spv_inventory_management || null,
                            option1: variant.spv_option1_value || null,
                            option2: variant.spv_option2_value || null,
                            option3: variant.spv_option3_value || null,
                            taxable: variant.spv_taxable || null,
                            barcode: variant.spv_barcode || null,
                            requires_shipping: variant.spv_requires_shipping || null,
                            sku: variant.spv_sku || null,
                        };

                        const createdVariantResponse = await shopify.ProductVariant.create(product.sp_product_id?.toString(), variantPayload);
                        const createdVariant = createdVariantResponse.data;

                        const updateSql = `UPDATE shopify_products_variations
                                                SET spv_variation_id = ?,
                                                    sp_product_id = ?,
                                                    spv_inventory_item_id = ?,
                                                    updated_on_shopify = NOW()
                                                WHERE spv_id = ?
                                                AND sm_store_id = ?
                                                `;
                        await prisma.$queryRawUnsafe(updateSql, createdVariant.id, createdVariant.product_id, createdVariant.inventory_item_id, variant.spv_id, storeId);

                        await prisma.shopifyTrackingHistory.create({
                            data: {
                                store_id: storeId,
                                sp_product_id: product.sp_product_id?.toString(),
                                spv_variation_id: createdVariant.id.toString(),
                                sth_update_type: 'product',
                                sth_new_value: JSON.stringify({
                                    sku: variant.spv_sku,
                                }),
                                sth_status: 'success',
                                sth_message: `Variant created on Shopify: ${createdVariant.id}`,
                            },
                        });
                    } catch (variantError: any) {
                        logger.error(
                            {
                                variantId: variant.spv_id,
                                sku: variant.spv_sku,
                                error: variantError.message,
                            },
                            'Failed creating Shopify variant'
                        );

                        await prisma.shopifyTrackingHistory.create({
                            data: {
                                store_id: storeId,
                                sp_product_id: product.sp_product_id?.toString(),
                                spv_variation_id: null,
                                sth_update_type: 'product',
                                sth_new_value: JSON.stringify({
                                    sku: variant.spv_sku,
                                }),
                                sth_status: 'failure',
                                sth_message: variantError.message,
                            },
                        });

                        throw variantError;
                    }
                }

            } catch (error: any) {
                logger.error(
                    { error, productId: product.sp_product_id }, 'Failed updating Shopify product');

                const updateSpSql = `UPDATE shopify_products SET sp_update_product_status='error'
WHERE np_products_id=? AND sm_store_id=?;`

                await prisma.$executeRawUnsafe(updateSpSql, product.np_products_id, storeId);

                await prisma.shopifyTrackingHistory.create({
                    data: {
                        sp_product_id: product.sp_product_id?.toString(),
                        spv_variation_id: null,
                        sth_update_type: 'product',
                        sth_new_value: JSON.stringify(productNewValues),
                        sth_status: 'failure',
                        store_id: storeId,
                        sth_message: error.message,
                    },
                });
            }
        }

        await prisma.shopifyCronRunHistory.update({
            where: { scrh_id: cronRecord.scrh_id },
            data: {
                scrh_status: 'completed',
                scrh_end_time: new Date(),
            },
        });

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

        if (error instanceof NotFoundError) {
            logger.error({ error: error, storeId: storeId }, ` Store with ID ${storeId} not found.`);
            throw error
        } else {
            logger.error({ error: error, storeId: storeId }, `Internal Server error while updating products on Shopify `);
            throw new Error("Internal Server Error")
        }
    }

}

// Job 11
export const updateProductMetafieldsOnShopify = async (storeId: number, all?: string) => {
    const logger = getLogger();

    logger.info('Updating Product Metafields On Shopify');

    const cronRecord = await prisma.shopifyCronRunHistory.create({
        data: {
            scrh_store_id: storeId,
            scrh_name: "update_shopify_metafields",
            scrh_url: `/shopify_products/update_metafields_on_shopify/${storeId}/${all}`,
            scrh_start_time: new Date(),
            scrh_status: 'InProgress',
        },
    });

    let hasFailed: boolean = false;

    const configWithToken = await getTokenCredentials(Number(storeId), logger);

    if (configWithToken === 'fail') {
        throw new Error(
            `Failed to get token credentials for store: ${storeId}`
        );
    }

    const updateLimit = config.FETCH_SHOPIFY_UPDATE_PRODUCT_LIMIT;
    const accessToken = configWithToken.AccessToken;
    const endpointCheck = resolveShopifyEndpoint(storeId, logger);
    if (!endpointCheck.success) {
        return endpointCheck.errorResponse;
    }
    const shopifyGraphQlUrl = endpointCheck.url as string;

    let productsSql = "";
    let products = [];
    if (all === "all") {
        productsSql = `SELECT *
                                FROM shopify_products
                                WHERE sp_update_metafields_status='modified'
                                AND sp_product_id IS NOT NULL
                                AND sm_store_id=?
                                AND sp_status='active'
                                `;
        products = await prisma.$queryRawUnsafe(productsSql, storeId);
    } else {
        productsSql = `SELECT *
                                FROM shopify_products
                                WHERE sp_update_metafields_status='modified'
                                AND sp_product_id IS NOT NULL
                                AND sm_store_id=?
                                AND sp_status='active'
                                LIMIT ?;
                                `;
        products = await prisma.$queryRawUnsafe(productsSql, storeId, updateLimit);
    }

    for (const product of products) {
        const fieldMappings = {
            product_code: product.np_products_model ?? null,
            league: product.np_league ?? null,
            team: product.np_team ?? null,
            agegroup: product.np_agegroup ?? null,
            gender: product.np_gender ?? null,
            color: product.np_color ?? null,
            sleeve_length: product.np_sleevelength ?? null,
            product_type: product.sp_product_type ?? null,
        };

        const { metafields } = buildMetafieldsArray(fieldMappings);

        const metafieldValues = {
            product_code: product.np_products_model,
            league: product.np_league,
            team: product.np_team,
            agegroup: product.np_agegroup,
            gender: product.np_gender,
            color: product.np_color,
            sleeve_length: product.np_sleevelength,
            product_type: product.sp_product_type,
        };

        try {
            const mutation = `
                        mutation ProductMetafieldsUpdate(
                            $id: ID!,
                            $metafields: [MetafieldInput!]!
                        ) {
                            productUpdate(
                                product: {
                                    id: $id
                                    metafields: $metafields
                                }
                            ) {
                                product {
                                    id
                                }
                                userErrors {
                                    field
                                    message
                                }
                            }
                        }
                    `;

            const graphqlQuery = {
                query: mutation,
                variables: {
                    id: `gid://shopify/Product/${product.sp_product_id}`,
                    metafields,
                }
            }

            const response = await executeShopifyRequestWithRetry(shopifyGraphQlUrl, accessToken, graphqlQuery, logger);

            const userErrors = response?.data?.productUpdate?.userErrors || [];

            if (userErrors.length > 0) {
                hasFailed = true;

                const updateSpSql = `UPDATE shopify_products
                                            SET sp_update_metafields_status='error'
                                            WHERE np_products_id=?
                                            AND sm_store_id=?;
                                            `;
                await prisma.$queryRawUnsafe(updateSpSql, product.np_products_id, storeId);

                await prisma.shopifyTrackingHistory.create({
                    data: {
                        store_id: storeId,
                        sp_product_id:
                            product.sp_product_id?.toString(),
                        spv_variation_id: null,
                        sth_update_type: 'product',
                        sth_new_value:
                            JSON.stringify(metafieldValues),
                        sth_status: 'failure',
                        sth_message: userErrors
                            .map((e: any) => e.message)
                            .join(', '),
                    },
                });

                continue;
            }
            const updateSql = `UPDATE shopify_products
                                        SET sp_update_metafields_status='finalized',
                                            updated_on_shopify=NOW()
                                        WHERE sp_product_id=?
                                        AND sm_store_id=?;
                                        `;

            await prisma.$executeRawUnsafe(updateSql, product.sp_product_id, storeId);

            await prisma.shopifyTrackingHistory.create({
                data: {
                    store_id: storeId,
                    sp_product_id:
                        product.sp_product_id?.toString(),
                    spv_variation_id: null,
                    sth_update_type: 'product',
                    sth_new_value:
                        JSON.stringify(metafieldValues),
                    sth_status: 'success',
                    sth_message:
                        'Metafields updated successfully',
                },
            });



        } catch (error: any) {
            hasFailed = true;
            const updateSpQuery = `UPDATE shopify_products
                                        SET sp_update_metafields_status='error'
                                        WHERE np_products_id=?
                                        AND sm_store_id=?;
                                        `;
            await prisma.$executeRawUnsafe(updateSpQuery, product.np_products_id, storeId);

            await prisma.shopifyTrackingHistory.create({
                data: {
                    store_id: storeId,
                    sp_product_id:
                        product.sp_product_id?.toString(),
                    spv_variation_id: null,
                    sth_update_type: 'product',
                    sth_new_value:
                        JSON.stringify(metafieldValues),
                    sth_status: 'failure',
                    sth_message:
                        error?.message ||
                        'Unknown Shopify error',
                },
            });

            logger.error({ error, productId: product.sp_product_id, }, 'Failed updating metafields');
        }

    }
    await prisma.shopifyCronRunHistory.update({
        where: { scrh_id: cronRecord.scrh_id },
        data: {
            scrh_status: hasFailed ? 'failed' : 'completed',
            scrh_end_time: new Date(),
        },
    });

};


// Job 12
export const syncSortOrderOnShopify = async (storeId: number) => {

    const logger = getLogger();

    logger.info({ storeId }, "Starting Shopify collection sort sync");
    const cronRecord = await prisma.shopifyCronRunHistory.create({
        data: {
            scrh_store_id: storeId,
            scrh_name: "update_product_sort_order_for_shopify",
            scrh_url: `/shopify_products/sync_sort_order_on_shopify/${storeId}`,
            scrh_start_time: new Date(),
            scrh_status: 'InProgress',
        },
    });

    const configWithToken = await getTokenCredentials(Number(storeId), logger);

    if (configWithToken === "fail") {
        throw new Error(`Failed to get token credentials for store ${storeId}`);
    }

    const shopifyConfig = {
        shopDomain: configWithToken.ShopUrl,
        apiKey: configWithToken.ApiKey,
        sharedSecret: configWithToken.SharedSecret,
        accessToken: configWithToken.AccessToken,
        storeName: configWithToken.StoreName,
        defaultApiVersion: config.SHOPIFY_API_VERSION,
        apiVersion: config.SHOPIFY_API_VERSION,
        microtimeOfLastApiCall: null,
        timeAllowedForEachApiCall: timeForApiCall,
    };

    const shopify = new ShopifySDK(shopifyConfig);

    try {
        const lastRunSql = `SELECT scrh_end_time
                                FROM shopify_cron_run_history
                                WHERE scrh_name='update_product_sort_order_for_shopify'
                                AND scrh_status='completed'
                                AND scrh_store_id=?
                                ORDER BY scrh_id DESC
                                LIMIT 1`;
        const lastRun = await prisma.$queryRawUnsafe(lastRunSql, storeId);

        const updatedAtMin = lastRun?.length ? lastRun[0].scrh_end_time : config.SHOPIFY_INITIAL_MODIFIED_DATE;

        logger.info({ storeId, updatedAtMin }, "Fetching changed collections",);

        const changedCollections = await getChangedCollections(shopify, updatedAtMin);

        if (!changedCollections.length) {
            await prisma.shopifyCronRunHistory.update({
                where: { scrh_id: cronRecord.scrh_id },
                data: { scrh_status: 'completed', scrh_end_time: new Date() },
            });
            logger.info({ storeId }, "No changed collections found");
            return;
        }

        const successCollections: number[] = [];

        const failedCollections: number[] = [];

        for (const collection of changedCollections) {
            try {
                const collectionId = collection.id;

                logger.info({ collectionId }, "Processing collection");

                const productIds = await fetchAllCollectionProducts(shopify, collectionId);
                const productsList = productIds.map(() => '?').join(',');

                if (!productIds.length) {
                    successCollections.push(collectionId);
                    continue;
                }

                const orderedProducts =
                    await prisma.$queryRawUnsafe(
                        `
                                SELECT
                                    sp.sp_product_id,
                                    IF(
                                        (
                                            np.sms_total_quantity <= 0
                                            AND np.quantity_map = 1
                                        )
                                        OR
                                        (
                                            np.quantity_map = 0
                                            AND np.out_of_stock = 'yes'
                                        ),
                                        0,
                                        1
                                    ) AS order_by,

                                    IF(
                                        SUM(
                                            spv.spv_inventory_quantity
                                        ) = 0,
                                        100000,
                                        np.display_sort_order
                                    ) AS qty_order_by

                                FROM shopify_products sp

                                JOIN shopify_products_variations spv
                                    ON sp.sp_id = spv.sp_id

                                JOIN new_products np
                                    ON sp.np_products_id = np.products_id

                                WHERE
                                    sp.sm_store_id = ?
                                    AND sp.sp_product_id IN (${productsList})

                                GROUP BY sp.sp_id

                                ORDER BY
                                    qty_order_by ASC,
                                    order_by DESC,
                                    np.products_sort_order ASC,
                                    ISNULL(np.groupname_id_1 || np.groupname_id_2) ASC,
                                    ISNULL(np.size_id_1 || np.size_id_2) ASC,
                                    np.groupname_id_1 ASC,
                                    np.size_id_1 ASC,
                                    np.groupname_id_2 ASC,
                                    np.size_id_2 ASC,
                                    np.products_id DESC
                            `,
                        storeId, ...productIds
                    );

                const orderedProductIds =
                    orderedProducts.map(
                        (
                            p: any
                        ) =>
                            Number(
                                p.sp_product_id
                            )
                    );

                if (!orderedProductIds.length) {
                    successCollections.push(collectionId);
                    continue;
                }

                await updateCollectionSortOrder(shopify, collectionId, orderedProductIds);

                successCollections.push(collectionId);

                logger.info({ collectionId, products: orderedProductIds.length }, "Collection reordered successfully");

            } catch (error: any) {
                failedCollections.push(collection.id);

                logger.error({ collectionId: collection.id, error: error?.message }, "Collection reorder failed");
            }
        }

        await prisma.shopifyCronRunHistory.update({
            where: { scrh_id: cronRecord.scrh_id },
            data: {
                scrh_status: 'completed',
                scrh_end_time: new Date(),
            },
        });

        logger.info({ successCollections: successCollections.length, failedCollections: failedCollections.length }, "Collection sort sync completed"
        );

        return { success: true, successCollections: successCollections.length, failedCollections: failedCollections.length };


    } catch (error: any) {
        await prisma.shopifyCronRunHistory.update({
            where: { scrh_id: cronRecord.scrh_id },
            data: {
                scrh_status: 'failed',
                scrh_end_time: new Date(),
            },
        }).catch((logError: Error) => {
            logger.warn({ logError }, 'Failed to persist fatal state update into history logs.');
        });

        logger.error({ storeId, error: error?.message }, "Error updating collection sort order");

        throw error;
    }
};

async function getChangedCollections(shopify: ShopifySDK, updatedAtMin: string) {
    const collections: any[] = [];

    (shopify.SmartCollection as any).resourceId = undefined;

    // Set up initial filters for page 1
    let queryParams: any = {
        updated_at_min: updatedAtMin,
        limit: 250
    };

    while (true) {
        // Uses your newly created SmartCollection class instance
        const response = await shopify.SmartCollection.get(queryParams);
        const rows = response.data || [];

        collections.push(...rows);

        // Extract the next page cursor details out of your SDK link-header parsing map
        const responseHeaders = response.headers || {};
        const nextPageToken = parseShopifyNextPageCursor(responseHeaders);

        if (!nextPageToken || rows.length < 250) {
            break;
        }

        // Prepare queryParams for next iteration using the pagination cursor token
        queryParams = { limit: 250, page_info: nextPageToken };
    }

    return collections;
}


async function fetchAllCollectionProducts(shopify: any, collectionId: number): Promise<number[]> {
    const productIds: number[] = [];
    const collectionInstance = shopify.Collection.withId(collectionId);

    let queryParams: any = {
        fields: "id",
        limit: 250
    };

    while (true) {
        const responseEnvelope = await collectionInstance.getProducts(queryParams);
        const products = responseEnvelope.data || [];

        productIds.push(...products.map((x: any) => Number(x.id)));

        // Extract headers from the returned envelope wrapper natively
        const responseHeaders = responseEnvelope.headers || {};
        const nextPageToken = parseShopifyNextPageCursor(responseHeaders);

        if (!nextPageToken || products.length < 250) {
            break;
        }

        queryParams = { limit: 250, page_info: nextPageToken };
    }

    return productIds;
}


async function updateCollectionSortOrder(shopify: ShopifySDK, collectionId: number, orderedProductIds: number[]) {

    const targetCollection = shopify.SmartCollection.withId(collectionId);

    await targetCollection.put({
        smart_collection: {
            id: collectionId,
            sort_order: "manual"
        }
    });

    await targetCollection.reorderProducts(orderedProductIds);
}


