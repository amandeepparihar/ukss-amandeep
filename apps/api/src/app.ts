import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import * as path from 'path';

import { config } from './config';
import { ApiError, ValidationError } from './lib/errors';
import authPlugin from './plugins/auth';
import { authRoutes } from './modules/auth/auth.routes';
import { userRoutes } from './modules/users/users.routes';
import { roleRoutes } from './modules/roles/roles.routes';
import { menuRoutes } from './modules/menu/menu.routes';
import { filesRoutes } from './modules/files/files.routes';
import { batchUploadRoutes } from './modules/files/batch-upload.routes';
import { exportsRoutes } from './modules/exports/exports.routes';
import { devicesRoutes } from './modules/auth/devices.routes';
import { emailRoutes } from './modules/email/email.routes';
import { auditRoutes } from './modules/audit/audit.routes';
import { announcementRoutes } from './modules/announcements/announcements.routes';
import { demoRoutes } from './modules/demo/demo.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { activityRoutes } from './modules/activity/activity.routes';
import { i18nRoutes } from './modules/i18n/i18n.routes';
import { jobsRoutes } from './modules/jobs/jobs.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';
import { reportsRoutes } from './modules/reports/reports.routes';
import { marketplaceSyncRoutes } from './modules/marketplace-sync/marketplace-sync.routes';
import { shopifyRoutes } from './modules/shopify/shopify.routes';
import { toffsRoutes } from './modules/toffs/toffs.routes';
import { marketplaceOrdersRoutes } from './modules/marketplace-orders/marketplace-orders.routes';
import { orderStatusSyncRoutes } from './modules/order-status-sync/order-status-sync.routes';
import { sportdealRoutes } from './modules/sportdeal/sportdeal-routes';
import { fruugoRoutes } from './modules/fruugo/fruugo-routes';
import { onbuyRoutes } from './modules/onbuy/onbuy-routes';
import { walmartRoutes } from './modules/walmart/walmart-routes';
import { allegroRoutes } from './modules/allegro/allegro-routes';
import { debenhamsRoutes } from './modules/debenhams/debenhams.routes';
import { debenhamsInventoryUploadRoutes } from './modules/debenhams-inventory-upload/debenhams-inventory-upload.routes';
import { salesDashboardRoutes } from './modules/sales-dashboard/sales-dashboard.routes';
import { executiveDashboardRoutes } from './modules/executive-dashboard/executive-dashboard.routes';
import { shopifyInventorySyncRoutes } from './modules/shopify-inventory-sync/shopify-inventory-sync.routes';
import { shopifyProductsRoutes } from './modules/shopify-products-listing/shopify-products.routes';
import { ordersRoutes } from './modules/orders/orders.routes';
import { fcScanRoutes } from './modules/fc-scan/fc-scan.routes';
import { reconciliationRoutes } from './modules/reconciliation/reconciliation.routes';
import { dailyDealsRoutes } from './modules/daily-deals/daily-deals.routes';
import { marketplaceDashboardRoutes } from './modules/marketplaces/marketplace-dashboard.routes';
import { ebayRoutes } from './modules/ebay/ebay.routes';
import { ebayReconciliationRoutes } from './modules/ebay-reconciliation/ebay-reconciliation.routes';
import { sellerDynamicsRoutes } from './modules/seller-dynamics/seller-dynamics-routes';
import { toteAssignmentRoutes } from './modules/tote-assignment/tote-assignment.routes';
import { productRoutes } from './modules/products/products.routes';
import { fontsRoutes } from './modules/fonts/fonts.routes';
import { logsRoutes } from './modules/logs/logs.routes';
import { deliveriesRoutes } from './modules/deliveries/deliveries.routes';
import { stockHomeGridRoutes } from './modules/stock-home-grid/stock-home-grid.routes';
import { sdTshirtsRoutes } from './modules/sd-tshirts/sd-tshirts.routes';
import { seasonsRoutes } from './modules/seasons/seasons.routes';
import { teamsRoutes } from './modules/teams/teams.routes';
import { notesRoutes } from './modules/notes/notes.routes';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
  });

  // Register plugins
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps, curl, etc.)
      if (!origin) {
        return cb(null, true);
      }
      // Allow configured APP_URL
      if (origin === config.APP_URL) {
        return cb(null, true);
      }
      // In development, allow any localhost origin
      if (config.NODE_ENV !== 'production' && origin.match(/^https?:\/\/localhost(:\d+)?$/)) {
        return cb(null, true);
      }
      // Reject other origins
      return cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for Swagger UI
        scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for Swagger UI
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", config.APP_URL],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // Disable for file downloads
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin for file downloads
  });

  await app.register(cookie, {
    secret: config.JWT_SECRET,
    parseOptions: {},
  });

  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: {
      expiresIn: config.JWT_ACCESS_EXPIRY,
    },
  });

  await app.register(rateLimit, {
    // BUG-347: Increased from 100 to 500 — the orders edit page polls /viewers
    // every 3 s (20 req/min per open tab) plus loads ~10 sub-resources on mount.
    // A single user running Playwright comparison tests or actively browsing
    // multiple orders exhausted the old 100/min limit, causing 500 responses that
    // redirected the React SPA back to the listing page with no order data shown.
    max: 500,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMIT_ERROR',
        message: 'Too many requests. Please try again later.',
      },
    }),
  });

  // Register multipart for file uploads
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 10,
    },
  });

  // Register static file serving for local storage
  if (config.STORAGE_PROVIDER === 'local') {
    const uploadPath = path.resolve(config.STORAGE_LOCAL_PATH);
    // Use /api prefix to match other routes
    const staticPrefix = `/api${config.STORAGE_LOCAL_URL_PREFIX}`;
    await app.register(fastifyStatic, {
      root: uploadPath,
      prefix: staticPrefix,
      decorateReply: false, // Don't decorate reply to avoid conflicts
    });
    app.log.info({ path: uploadPath, prefix: staticPrefix }, 'Local file serving enabled');
  }

  // Serve font zip files for download from FONTS_DIR volume
  const fontsDir = process.env.FONTS_DIR
    ? path.resolve(process.env.FONTS_DIR)
    : path.resolve('fonts');
  const fontsZipDir = path.join(fontsDir, 'zipfiles_to_download');
  await app.register(fastifyStatic, {
    root: fontsZipDir,
    prefix: '/api/fonts/download/',
    decorateReply: false,
  });
  app.log.info(
    { path: fontsZipDir, prefix: '/api/fonts/download/' },
    'Font zip download serving enabled'
  );

  // Register WebSocket plugin for real-time features
  await app.register(websocket, {
    options: {
      maxPayload: 1048576, // 1MB
    },
  });

  // Register auth plugin
  await app.register(authPlugin);

  // Swagger documentation
  if (config.NODE_ENV === 'development') {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Admin Panel API',
          description: 'API documentation for the Admin Panel Framework',
          version: '1.0.0',
        },
        servers: [
          {
            url: config.API_URL,
            description: 'Development server',
          },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    });
  }

  // Request logging hook
  app.addHook('onRequest', async (request) => {
    request.log.info({
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  });

  // Response logging hook
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    });
  });

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      const validationError = new ValidationError(
        error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }))
      );
      return reply.status(validationError.statusCode).send(validationError.toJSON());
    }

    // Handle custom API errors
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(error.toJSON());
    }

    // Handle JWT errors
    if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
      return reply.status(401).send({
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Authentication required',
        },
      });
    }

    if (error.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
      return reply.status(401).send({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token has expired',
        },
      });
    }

    if (error.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID') {
      return reply.status(401).send({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid access token',
        },
      });
    }

    // Handle unknown errors
    const statusCode = error.statusCode || 500;
    const response = {
      error: {
        code: 'INTERNAL_ERROR',
        message: config.NODE_ENV === 'production' ? 'An unexpected error occurred' : error.message,
      },
    };

    return reply.status(statusCode).send(response);
  });

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  }));

  // Register routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(devicesRoutes, { prefix: '/api/auth' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(roleRoutes, { prefix: '/api/roles' });
  await app.register(menuRoutes, { prefix: '/api/menu' });
  await app.register(filesRoutes, { prefix: '/api/files' });
  await app.register(batchUploadRoutes, { prefix: '/api/files' });
  await app.register(exportsRoutes, { prefix: '/api' });
  await app.register(emailRoutes, { prefix: '/api/email' });
  await app.register(auditRoutes, { prefix: '/api/audit-logs' });
  await app.register(announcementRoutes, { prefix: '/api/announcements' });
  await app.register(demoRoutes, { prefix: '/api/demo' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(activityRoutes, { prefix: '/api/activity' });
  await app.register(i18nRoutes, { prefix: '/api/i18n' });
  await app.register(jobsRoutes, { prefix: '/api/jobs' });
  await app.register(notificationsRoutes, { prefix: '/api/notifications' });
  await app.register(reportsRoutes, { prefix: '/api/reports' });
  await app.register(logsRoutes, { prefix: '/api/logs' });
  await app.register(marketplaceSyncRoutes, { prefix: '/api/marketplace_listings' });

  await app.register(shopifyRoutes, { prefix: '/api/shopify' });
  await app.register(marketplaceOrdersRoutes, { prefix: '/api/marketplace-orders' });
  await app.register(orderStatusSyncRoutes, { prefix: '/api/order-status-sync' });
  await app.register(toffsRoutes, { prefix: '/api/toffs' });
  await app.register(sportdealRoutes, { prefix: '/api/sportdeal' });
  await app.register(fruugoRoutes, { prefix: '/api/fruugo' });
  await app.register(onbuyRoutes, { prefix: '/api/onbuy' });
  await app.register(walmartRoutes, { prefix: '/api/walmart' });
  await app.register(allegroRoutes, { prefix: '/api/allegro' });
  await app.register(debenhamsRoutes, { prefix: '/api/debenhams' });
  await app.register(debenhamsInventoryUploadRoutes, { prefix: '/api/debenhams-inventory-upload' });
  await app.register(salesDashboardRoutes, { prefix: '/api/sales-dashboard' });
  await app.register(executiveDashboardRoutes, { prefix: '/api/executive-dashboard' });
  await app.register(shopifyInventorySyncRoutes, { prefix: '/api/shopify-inventory-sync' });
  await app.register(shopifyProductsRoutes, { prefix: '/api/shopify_products' });
  await app.register(ordersRoutes, { prefix: '/api/orders' });
  await app.register(fcScanRoutes, { prefix: '/api/fc-scan' });
  await app.register(reconciliationRoutes, { prefix: '/api/reconciliation' });
  await app.register(dailyDealsRoutes, { prefix: '/api/daily-deals' });
  await app.register(marketplaceDashboardRoutes, { prefix: '/api/marketplaces' });
  await app.register(ebayRoutes, { prefix: '/api/ebay' });
  await app.register(ebayReconciliationRoutes, { prefix: '/api/ebay-reconciliation' });
  await app.register(sellerDynamicsRoutes, { prefix: '/api/seller-dynamics' });
  await app.register(toteAssignmentRoutes, { prefix: '/api/tote-assignment' });
  await app.register(productRoutes, { prefix: '/api/products' });
  await app.register(fontsRoutes, { prefix: '/api/fonts' });
  await app.register(deliveriesRoutes, { prefix: '/api/deliveries' });
  await app.register(stockHomeGridRoutes, { prefix: '/api/stock-grid' });
  await app.register(sdTshirtsRoutes, { prefix: '/api/seller-dynamics-listing' });
  await app.register(seasonsRoutes, { prefix: '/api/seasons' });
  await app.register(teamsRoutes, { prefix: '/api/teams' });
  await app.register(notesRoutes, {prefix: '/api/notes'});

  return app;
}
