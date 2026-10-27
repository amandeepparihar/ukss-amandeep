import type { FastifyPluginAsync } from 'fastify';
import {
  productListSchema,
  singleSizeProductsSchema,
  scheduleQuerySchema,
  saveDealSchema,
  deleteDealParamsSchema,
  summarySchema,
  productDealInfoSchema,
  productSizeGridSchema,
  productSitePriceSchema,
  runCronSchema,
  bannerConfigSchema,
  setSpecialPriceSchema,
  removeSpecialPriceParamsSchema,
  getSpecialPriceSchema,
  ignoreProductSchema,
  unignoreProductParamsSchema,
} from './daily-deals.schema';
import {
  getProductsNotSoldRecently,
  getSingleSizeProducts,
  getSchedule,
  saveDeal,
  deleteDeal,
  getSummary,
  getProductDealInfo,
  getProductSizeGrid,
  getProductSitePrice,
  getFilterOptions,
  getBannerConfig,
  saveBannerConfig,
  setSpecialPrice,
  removeSpecialPrice,
  getSpecialPriceInfo,
  ignoreProduct,
  unignoreProduct,
} from './daily-deals.service';

export const dailyDealsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/daily-deals/products — Tab 1: Products not sold recently
  app.get('/products', {
    preHandler: [app.requirePermission('daily-deals:view')],
  }, async (request) => {
    const params = productListSchema.parse(request.query);
    return getProductsNotSoldRecently(params);
  });

  // GET /api/daily-deals/single-size-products — Tab 2: Single size in stock
  app.get('/single-size-products', {
    preHandler: [app.requirePermission('daily-deals:view')],
  }, async (request) => {
    const params = singleSizeProductsSchema.parse(request.query);
    return getSingleSizeProducts(params);
  });

  // GET /api/daily-deals/schedule — 7-day grid data
  app.get('/schedule', {
    preHandler: [app.requirePermission('daily-deals:view')],
  }, async (request) => {
    const params = scheduleQuerySchema.parse(request.query);
    return getSchedule(params);
  });

  // POST /api/daily-deals/deals — Save a new deal to deals_management
  app.post('/deals', {
    preHandler: [app.requirePermission('daily-deals:create')],
  }, async (request) => {
    const input = saveDealSchema.parse(request.body);
    return saveDeal(input);
  });

  // DELETE /api/daily-deals/deals/:id — Remove/deactivate a deal
  app.delete('/deals/:id', {
    preHandler: [app.requirePermission('daily-deals:edit')],
  }, async (request) => {
    const { id } = deleteDealParamsSchema.parse(request.params);
    return deleteDeal(id);
  });

  // GET /api/daily-deals/filter-options — Leagues + teams for dropdowns
  app.get('/filter-options', {
    preHandler: [app.requirePermission('daily-deals:view')],
  }, async () => {
    return getFilterOptions();
  });

  // GET /api/daily-deals/product-deal-info — Lazy-loaded deal status + revenue for specific products
  app.get('/product-deal-info', {
    preHandler: [app.requirePermission('daily-deals:view')],
  }, async (request) => {
    const { productIds } = productDealInfoSchema.parse(request.query);
    return getProductDealInfo(productIds);
  });

  // GET /api/daily-deals/product-size-grid — Size breakdown for specific products
  app.get('/product-size-grid', {
    preHandler: [app.requirePermission('daily-deals:view')],
  }, async (request) => {
    const { productIds } = productSizeGridSchema.parse(request.query);
    return getProductSizeGrid(productIds);
  });

  // GET /api/daily-deals/product-site-price — Fresh site price for popup
  app.get('/product-site-price', {
    preHandler: [app.requirePermission('daily-deals:view')],
  }, async (request) => {
    const { productsId } = productSitePriceSchema.parse(request.query);
    return getProductSitePrice(productsId);
  });

  // GET /api/daily-deals/summary — Revenue summary
  app.get('/summary', {
    preHandler: [app.requirePermission('daily-deals:view')],
  }, async (request) => {
    const params = summarySchema.parse(request.query);
    return getSummary(params);
  });

  // GET /api/daily-deals/banner-config — Current banner title + image
  app.get('/banner-config', {
    preHandler: [app.requirePermission('daily-deals:view')],
  }, async () => {
    return getBannerConfig();
  });

  // POST /api/daily-deals/banner-config — Update banner title + optional image
  app.post('/banner-config', {
    preHandler: [app.requirePermission('daily-deals:edit')],
  }, async (request) => {
    let title = '';
    let imageBuffer: Buffer | undefined;
    let imageFilename: string | undefined;
    const isMultipart = request.isMultipart();

    if (isMultipart) {
      const data = await request.file();
      if (data) {
        // Multipart with file: extract title from fields, image from file
        const titleField = data.fields.title as { value?: string } | undefined;
        title = titleField?.value || '';
        imageBuffer = await data.toBuffer();
        imageFilename = data.filename;

        // Validate mimetype
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowed.includes(data.mimetype)) {
          return { error: { code: 'INVALID_FILE_TYPE', message: 'Only JPG, PNG, and WEBP images are allowed' } };
        }
      }
    } else {
      // JSON body with title only
      const body = request.body as { title?: string };
      title = body?.title || '';
    }

    const input = bannerConfigSchema.parse({ title });
    return saveBannerConfig(input, imageBuffer, imageFilename);
  });

  // POST /api/daily-deals/run-cron — Manual cron trigger
  app.post('/run-cron', {
    preHandler: [app.requirePermission('daily-deals:edit')],
  }, async (request) => {
    const params = runCronSchema.parse(request.body);
    const { runDailyDealsCron } = await import('./daily-deals-cron.service');
    const result = await runDailyDealsCron({
      date: params.date,
      dryRun: params.dryRun,
    });
    return { data: result };
  });

  // GET /api/daily-deals/special-price — Get current special price info for a product
  app.get('/special-price', {
    preHandler: [app.requirePermission('daily-deals:view')],
  }, async (request) => {
    const { productsId } = getSpecialPriceSchema.parse(request.query);
    return getSpecialPriceInfo(productsId);
  });

  // PUT /api/daily-deals/special-price — Set/update special price (mirrors SMS specials)
  app.put('/special-price', {
    preHandler: [app.requirePermission('daily-deals:edit')],
  }, async (request) => {
    const input = setSpecialPriceSchema.parse(request.body);
    return setSpecialPrice(input);
  });

  // DELETE /api/daily-deals/special-price/:id — Remove special price
  app.delete('/special-price/:id', {
    preHandler: [app.requirePermission('daily-deals:edit')],
  }, async (request) => {
    const { id } = removeSpecialPriceParamsSchema.parse(request.params);
    return removeSpecialPrice(id);
  });

  // POST /api/daily-deals/ignored-products — Ignore a product
  app.post('/ignored-products', {
    preHandler: [app.requirePermission('daily-deals:edit')],
  }, async (request) => {
    const { productsId } = ignoreProductSchema.parse(request.body);
    return ignoreProduct(productsId);
  });

  // DELETE /api/daily-deals/ignored-products/:id — Unignore a product
  app.delete('/ignored-products/:id', {
    preHandler: [app.requirePermission('daily-deals:edit')],
  }, async (request) => {
    const { id } = unignoreProductParamsSchema.parse(request.params);
    return unignoreProduct(id);
  });
};
