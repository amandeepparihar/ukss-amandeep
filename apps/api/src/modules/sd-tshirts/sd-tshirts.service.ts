// `Prisma` MUST come from lib/prisma, per the rule stated there: that copy is taken off the
// client loaded via createRequire, so it stays out of the tsup ESM bundle. Importing it as a
// runtime value from the generated client instead makes esbuild inline that client, and its
// CJS require('fs') then throws "Dynamic require of \"fs\" is not supported" at boot.
import { prisma, Prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import type { GetTshirtsQuery, ApproveProductsInput } from './sd-tshirts.schema';
import { ApiError } from '../../lib/errors';
import {
  sdListingFlag,
  isCustomisableFromIsYourName,
  isYourNameFromCustomisable,
} from '../../lib/marketplaces/seller-dynamics/sd-flags';
// Type-only, and must stay that way: lib/prisma types its namespace against the PostgreSQL
// client, which has no MySQL-only input types such as NewProductWhereInput.
import type { Prisma as MysqlPrisma } from '../../../node_modules/.prisma/client-mysql';

const SD_MARKUP = Number(process.env.SD_MARKUP) || 1.15;
const SELLER_DYNAMICS_STORE_ID = Number(process.env.SELLER_DYNAMICS_STORE_ID) || 151;

export async function getTshirts(query: GetTshirtsQuery) {
  const { page, pageSize, sortBy, sortOrder, search, approved } = query;

  getLogger('sd-tshirts-service').info({ ...query }, 'fetching tshirts');

  const where: MysqlPrisma.NewProductWhereInput = {
    virtual_product_type_id: 4,
    products_status: true,
  };

  if (search) {
    where.OR = [{ products_name: { contains: search } }, { products_model: { contains: search } }];
  }

  if (approved === true) {
    where.marketplaceListings = { some: { storeId: SELLER_DYNAMICS_STORE_ID } };
  } else if (approved === false) {
    where.marketplaceListings = { none: { storeId: SELLER_DYNAMICS_STORE_ID } };
  }

  const [products, total] = await Promise.all([
    prisma.newProduct.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        products_id: true,
        products_name: true,
        products_model: true,
        products_price: true,
        products_date_added: true,
        np_best_seller_7days: true,
        np_best_seller_6months: true,
        np_best_seller_1year: true,
        np_best_seller_lifetime: true,
        // Customisability lives on the product, not the listing — this is the legacy
        // Is_Your_Name flag the storefront and the feeds already use.
        is_your_name: true,
        marketplaceListings: {
          where: { storeId: SELLER_DYNAMICS_STORE_ID },
          take: 1,
          select: { marketplaceListingsId: true },
        },
      },
    }),
    prisma.newProduct.count({ where }),
  ]);

  const data = products.map((p) => ({
    ...p,
    products_price: Number(p.products_price),
    sd_price: Math.ceil(Number(p.products_price) * SD_MARKUP),
    isApproved: p.marketplaceListings.length > 0,
    // The Flag this product is (or would be) sent to SD with. Always resolvable, because
    // Is_Your_Name is set on every product whether or not it has been approved yet —
    // which is what lets the approver see an already-customisable shirt before ticking.
    sdFlag: sdListingFlag(isCustomisableFromIsYourName(p.is_your_name)),
    // Dropped from the response (JSON.stringify omits undefined): sdFlag already carries
    // the meaning, and the client has no business knowing the legacy column name.
    is_your_name: undefined,
    marketplaceListings: undefined,
  }));

  getLogger('sd-tshirts-service').info({ total, count: data.length }, 'tshirts fetched');

  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function approveProducts(input: ApproveProductsInput, userId: string) {
  const productIds = input.products.map((p) => p.productId);

  // Split once, up front: every write below is grouped by flag rather than done per product,
  // so a 500-product batch is 4 statements instead of 1000.
  const customisableIds = input.products.filter((p) => p.isCustomisable).map((p) => p.productId);
  const plainIds = input.products.filter((p) => !p.isCustomisable).map((p) => p.productId);

  getLogger('sd-tshirts-service').info(
    {
      count: productIds.length,
      custCount: customisableIds.length,
      podCount: plainIds.length,
    },
    'approving products'
  );

  // verify all product ids exist in new_products as t-shirts
  const existingProducts = await prisma.newProduct.findMany({
    where: {
      products_id: { in: productIds },
      virtual_product_type_id: 4,
    },
    select: { products_id: true },
  });

  const foundIds = existingProducts.map((p) => p.products_id);
  const notFoundIds = productIds.filter((id) => !foundIds.includes(id));

  if (notFoundIds.length > 0) {
    getLogger('sd-tshirts-service').info({ notFoundIds }, 'some product ids not found');
    throw new ApiError(
      404,
      'PRODUCTS_NOT_FOUND',
      `Products not found or not t-shirt products: ${notFoundIds.join(', ')}`
    );
  }

  // check if any products are already approved
  const alreadyApproved = await prisma.marketplaceListing.findMany({
    where: {
      productsId: { in: productIds },
      storeId: SELLER_DYNAMICS_STORE_ID,
    },
    select: { productsId: true },
    distinct: ['productsId'],
  });

  if (alreadyApproved.length > 0) {
    const alreadyApprovedIds = alreadyApproved.map((l) => l.productsId);
    getLogger('sd-tshirts-service').info({ alreadyApprovedIds }, 'some products already approved');
    throw new ApiError(
      400,
      'PRODUCTS_ALREADY_APPROVED',
      `Products already approved: ${alreadyApprovedIds.join(', ')}`
    );
  }

  // fetching all non-deleted variations for the given product ids
  const variations = await prisma.newProductsVariation.findMany({
    where: {
      npvProductsId: { in: productIds },
      npvDeleteStatus: '0',
    },
    select: {
      npvProductsId: true,
      npvSku: true,
    },
  });

  if (variations.length === 0) {
    throw new ApiError(
      404,
      'VARIATIONS_NOT_FOUND',
      'No variations found for the given product ids'
    );
  }

  getLogger('sd-tshirts-service').info({ variationCount: variations.length }, 'variations fetched');

  // insert one marketplace_listing row per variation + audit log atomically
  const listingsData = variations.map((v) => ({
    productsId: v.npvProductsId,
    storeId: SELLER_DYNAMICS_STORE_ID,
    productsSku: v.npvSku,
    marketplaceItemIdentifier: v.npvSku,
  }));

  // One pair of writes per flag value, skipped when that group is empty — Prisma.join([])
  // would produce `IN ()`, which is a syntax error.
  //
  // `products` is the master copy of the flag, written raw because the MySQL Prisma schema
  // has no model for the legacy `products` table. `new_products` is a mirror that
  // fill_new_products refreshes from `products`; writing it here too means the grid and the
  // bulk-upload cron see the choice immediately instead of waiting for the next refresh.
  const flagWrites = [
    { ids: customisableIds, isCustomisable: true },
    { ids: plainIds, isCustomisable: false },
  ]
    .filter((group) => group.ids.length > 0)
    .flatMap(({ ids, isCustomisable }) => {
      const isYourName = isYourNameFromCustomisable(isCustomisable);

      return [
        prisma.$executeRaw`UPDATE products SET Is_Your_Name = ${isYourName} WHERE products_id IN (${Prisma.join(ids)})`,
        prisma.newProduct.updateMany({
          where: { products_id: { in: ids } },
          data: { is_your_name: isYourName },
        }),
      ];
    });

  await prisma.$transaction([
    prisma.marketplaceListing.createMany({
      data: listingsData,
      skipDuplicates: true,
    }),
    ...flagWrites,
    prisma.auditLog.create({
      data: {
        userId,
        action: 'APPROVE',
        resource: 'SdTshirts',
        // Record which products got which flag — this is the trail of who marked a T-shirt
        // customisable, and Is_Your_Name is editable elsewhere so it can change afterwards.
        newValues: {
          productIds,
          variationsInserted: listingsData.length,
          customisableProductIds: customisableIds,
          plainProductIds: plainIds,
        },
      },
    }),
  ]);

  getLogger('sd-tshirts-service').info(
    { inserted: listingsData.length },
    'marketplace listings inserted'
  );

  getLogger('sd-tshirts-service').info({ userId }, 'audit log written');

  return { inserted: listingsData.length };
}

// takes out approved items from marketplace_listing table(retry < 3 and status: 'draft'). joins with np and npv to fetch all the relevant information needed for the bulkUpload endpoint in the cron
export async function getPendingListings() {
  const limit = Number(process.env.SD_PENDING_LIMIT) || 50;
  const maxRetries = Number(process.env.SD_MAX_RETRIES) || 3;

  getLogger('sd-tshirts-service').info({ limit, maxRetries }, 'fetching pending listings');

  const listings = await prisma.marketplaceListing.findMany({
    where: {
      marketplaceListingStatus: 'draft',
      retryCount: { lt: maxRetries },
      storeId: SELLER_DYNAMICS_STORE_ID,
    },
    take: limit,
    include: {
      newProduct: {
        select: {
          products_id: true,
          products_name: true,
          products_price: true,
          products_weight: true,
          manufacturers_name: true,
          products_description: true,
          products_image: true,
          additional_img: true,
          // Decides the CSV `Flag` column — read at upload time, so a change made after
          // approval (here or in the legacy admin) is picked up by the next upload.
          is_your_name: true,
        },
      },
      newProductVariation: {
        select: {
          npvProductsName: true,
          npvProductsBarcodes: true,
          npvQuantities: true,
        },
      },
    },
  });

  getLogger('sd-tshirts-service').info({ count: listings.length }, 'pending listings fetched');

  // map to response shape with computed fields
  const result = listings.map((listing) => {
    const product = listing.newProduct;
    const variation = listing.newProductVariation;

    // additional images .split by comma, take first 3
    const additionalImages = product?.additional_img
      ? product.additional_img
          .split(',')
          .map((img: string) => img.trim())
          .filter(Boolean)
      : [];

    return {
      // marketplace_listings fields
      marketplaceListingsId: listing.marketplaceListingsId,
      productsSku: listing.productsSku,
      retryCount: listing.retryCount,
      // Decides the CSV `Flag` column: UKSS-CUST when true, UKSS-POD when false.
      isCustomisable: isCustomisableFromIsYourName(product?.is_your_name),

      // from new_products
      productsId: product?.products_id ?? null,
      productsName: product?.products_name ?? null,
      brand: product?.manufacturers_name ?? null,
      listingDescription: product?.products_description ?? null,
      weightGrams: product?.products_weight ? Math.round(product.products_weight * 1000) : null,
      costPrice: product ? Math.ceil(Number(product.products_price) * SD_MARKUP) : null,
      parentSku: product ? `p-${product.products_id}` : null,
      image1: product?.products_image
        ? `https://cdn1.uksoccershop.com/images/${product.products_image}`
        : null,
      image2: additionalImages[0]
        ? `https://cdn1.uksoccershop.com/images/adtnl_prodts_img/${additionalImages[0]}`
        : null,
      image3: additionalImages[1]
        ? `https://cdn1.uksoccershop.com/images/adtnl_prodts_img/${additionalImages[1]}`
        : null,
      image4: additionalImages[2]
        ? `https://cdn1.uksoccershop.com/images/adtnl_prodts_img/${additionalImages[2]}`
        : null,

      // from new_products_variations
      itemTitle: variation?.npvProductsName ?? null,
      eanBarCode: variation?.npvProductsBarcodes ?? null,
      stockLevel: variation?.npvQuantities ?? null,
    };
  });

  return result;
}
