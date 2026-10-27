import { z } from 'zod';
// Import marketplace constants to ensure consistency across config defaults
import { MARKETPLACES } from '@admin/shared';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),

  // Directory for the catalog
  DIR_FS_CATALOG: z.string().default('/home/ukssmain/public_html/'),

  // UKSS Domain
  HTTP_HTTPS_SERVER: z.string().default('https://www.uksoccershop.com'),
  CLIENT_EMAIL: z.string().default('simon@uksoccershop.com'),

  // Legacy SMS host — used by the deliveries write-path to invoke the existing
  // `grid_file/updategridlist` rebuild endpoint on the legacy app (see
  // documentation/deliveries-write-path-plan.md §3). On production this is
  // `http://stock.uksoccershop.com` (same SMS app self-call).
  LEGACY_SMS_BASE_URL: z.string().default('https://stock.uksoccershop.com'),

  // Name & Number printing price override — legacy `Configure::read('NameAndNumberPrice')`.
  // Used by Flow B of create_edit_product_form when attribute id 261 is present
  // AND training_wear includes category id 2282 (see audit C.4 / add_sms_products_controller.php:3967-3979).
  // Per legacy PM #151937, the live value is currently 14.95.
  DELIVERIES_NAME_AND_NUMBER_PRICE: z.string().default('14.95'),

  // App URLs
  APP_URL: z.string().default('http://localhost:3000'),
  API_URL: z.string().default('http://localhost:4000'),

  // Database
  DATABASE_PROVIDER: z.enum(['postgresql', 'mysql']).default('postgresql'),
  DATABASE_URL: z.string(),
  MYSQL_DATABASE_URL: z.string().optional(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT
  JWT_SECRET: z.string().min(32).refine(
    (secret) => !secret.includes('your-super-secret') && !secret.includes('changeme'),
    { message: 'JWT_SECRET must be changed from the default placeholder value' }
  ),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // Google OAuth (optional — enables "Login with Gmail" when set)
  GOOGLE_CLIENT_ID: z.string().optional(),

  // Encryption (optional - will derive from JWT_SECRET if not provided)
  ENCRYPTION_KEY: z.string().min(32).optional(),

  // Storage Provider
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),

  // Local Storage (when STORAGE_PROVIDER=local)
  STORAGE_LOCAL_PATH: z.string().default('./uploads'),
  STORAGE_LOCAL_URL_PREFIX: z.string().default('/uploads'),

  // Product images path (resolved relative to cwd)
  PRODUCT_IMAGES_PATH: z.string().default('./images'),

  UKSS_HTTP_SERVER: z.string().default('https://zenc.uksoccershop.com'),



  // S3 Storage (when STORAGE_PROVIDER=s3)
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_BUCKET: z.string().default('uploads'),
  S3_REGION: z.string().default('us-east-1'),

  // Email
  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@example.com'),

  // SMTP Configuration (for email service)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),

  // Development team email for error notifications
  DEVELOPMENT_TEAM_EMAIL: z.string().optional(),

  // Admin CC email for order status updates (PHP: SEND_EXTRA_ORDERS_STATUS_ADMIN_EMAILS_TO)
  ADMIN_STATUS_CC_EMAIL: z.string().optional(),
  // Enable/disable admin CC emails (PHP: SEND_EXTRA_ORDERS_STATUS_ADMIN_EMAILS_TO_STATUS, '1' = enabled)
  ADMIN_STATUS_CC_ENABLED: z
    .string()
    .default('0')
    .transform((val) => val === '1' || val === 'true'),
  // Subject prefix for admin CC emails (PHP: SEND_EXTRA_ORDERS_STATUS_ADMIN_EMAILS_TO_SUBJECT)
  ADMIN_STATUS_CC_SUBJECT_PREFIX: z.string().default('Admin Copy:'),

  // SMS
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // TOFFS
  TOFFS_API_TOKEN_URL: z.string().optional(),
  TOFFS_API_USERNAME: z.string().optional(),
  TOFFS_API_PASSWORD: z.string().optional(),
  TOFFS_PROXY_ENABLED: z.coerce.boolean().default(false),
  TOFFS_PROXY_HOST: z.string().default('127.0.0.1'),
  TOFFS_PROXY_PORT: z.coerce.number().default(5559),
  TOFFS_API_ORDERS_URL: z.string().optional(),
  TOFFS_STORE_NAME: z.string().default('Toffs'),
  TOFFS_API_BASE_URL: z.string().optional().default('https://toffs.com'),
  TOFFS_STORE_ID: z.coerce.number().default(143),
  TOFFS_MANUAL_ORDER_FALLBACK_ENABLED: z.coerce.boolean().default(false),
  // TOFFS

  // SHOPIFY
  SHOPIFY_STORE_IDS_FOR_ORDER_STATUS_UPDATE: z.string().optional(),
  // Comma-separated store IDs where UKSS is one of several marketplace sellers (e.g. Lokkaroom=153).
  // For these, orders may include other sellers' products; we save only ours and apportion shipping.
  MULTI_SELLER_STORES: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().optional().default('2023-07'),
  SOCCERCLASSICO_PERSONALIZED_OPTION_PRODUCT_ID: z.string().optional().default('7037885153338,8155761410302,8578723152128,15251411566857,15511397564803'),

  // SHOPIFY Products
  NP_SEASON:z.string().default('2023-2024'),
  SHOPIFY_DELETE_OLD_LOGS_FROM_SHOPIFY_TRACKING: z.coerce.number().default(30),
  SHOPIFY_DELETE_OLD_LOGS_FROM_CRON_RUN: z.coerce.number().default(30),
  FETCH_SHOPIFY_PRICE_AND_INVENTORY_PRODUCT_LIMIT: z.coerce.number().default(50),
  FETCH_SHOPIFY_UPDATE_PRODUCT_LIMIT: z.coerce.number().default(50),
  FETCH_SHOPIFY_PRODUCT_LIMIT: z.coerce.number().default(25),
  SHOPIFY_INVENTORY_BATCH_SIZE: z.coerce.number().default(200),
  SHOPIFY_LOCATION_ID_146: z.string(),
  SHOPIFY_LOCATION_ID_153: z.string(),
  SHOPIFY_LOCATION_ID_154: z.string(),
  
  // production
  SHOPIFY_LOCATION_ID_156: z.string(),
  SHOPIFY_LOCATION_ID_155: z.string(),

  // for staging
  // SHOPIFY_LOCATION_ID_157: z.string(),
  // SHOPIFY_LOCATION_ID_158: z.string(),

  
  SHOPIFY_INITIAL_MODIFIED_DATE_TO_INSERT_SPECIAL_PRODUCT: z.string().default("2000-02-09 00:00:00"),
  SHOPIFY_INITIAL_MODIFIED_DATE: z.string().default("2000-02-09 00:00:00"),
  SHOPIFY_STORE_IDS_FOR_METAFIELDS_ON_CREATE: z.string(),
  STORE_CONTAINING_PHYSICAL_QUANTITY: z.string(),

  SHOPIFY_GRAPHQL_ENDPOINT_126: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_118: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_124: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_129: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_135: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_136: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_134: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_141: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_142: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_145: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_146: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_155: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_156: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_153: z.string(),
  SHOPIFY_GRAPHQL_ENDPOINT_154: z.string(),

  GLADE_SPORT_STORE_ID: z.coerce.number(),
  SELLER_DYNAMIC_STORE_ID: z.coerce.number(),
  // Shopify Products


  // FRUUGO
  FRUUGO_STORE_ID: z.coerce.number().default(95),
  FRUUGO_ALLOWED_STATUS_FOR_CONFIRMATION: z.string().optional(),
  Fruugo_API_ID: z.string().optional(),
  Fruugo_API_Password: z.string().optional(),
  Fruugo_API_REQUEST_URL: z.string().optional(),
  Fruugo_API_STATUS_UPDATE_URL: z.string().optional(),
  Fruugo_UPDATE_LISTING_API_REQUEST_URL: z.string().optional(),
  FRUUGO_INVENTORY_UPDATE_BATCH_SIZE: z.coerce.number().optional(),
  Fruugo_REQUEST_LISTING_API_REQUEST_URL: z.string().optional(),
  DIR_FS_FRUUGO: z.string().optional(),
  // FRUUGO

  // SPORTDEAL
  SPORTSDEAL_ALLOWED_STATUS_FOR_CONFIRMATION: z.string().optional(),
  // SPORTDEAL

  // DEBENHAMS
  DEBENHAMS_STORE_ID: z.coerce.number().default(150),
  DEBENHAMS_STORE_NAME: z.string().default('Debenhams'),
  DEBENHAMS_API_BASE_URL: z.string().default('https://debenhamsuk-dev.mirakl.net/api'),
  DEBENHAMS_FETCH_ORDER_COUNT: z.coerce.number().default(50),
  // Carrier-code mapping for Debenhams (Mirakl) shipment submission (PM #166488).
  // JSON object mapping UKSS carrier slug -> the code Mirakl expects. Royal Mail must be
  // `ROYALMAIL` exactly, otherwise Mirakl cannot build the tracking URL passed to Debenhams CS;
  // unmapped carriers pass through unchanged. Required (no default) — must be set in .env.
  DEBENHAMS_CARRIER_MAP: z
    .string()
    .transform((val, ctx) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(val);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DEBENHAMS_CARRIER_MAP must be valid JSON' });
        return z.NEVER;
      }
      const result = z.record(z.string(), z.string()).safeParse(parsed);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DEBENHAMS_CARRIER_MAP must be a JSON object mapping string keys to string values',
        });
        return z.NEVER;
      }
      return result.data;
    }),
  // DEBENHAMS

  // SHOPIFY STORES
  RACECRATE_CREATED_AT_MIN: z.string().optional(),
  MYSTERYSHIRTCLUB_CREATED_AT_MIN: z.string().optional(),
  MYSTERYSHIRTCLUBOFFICIAL_CREATED_AT_MIN: z.string().optional(),
  UKRS_CREATED_AT_MIN: z.string().optional(),
  SOCCERCLASSICO_CREATED_AT_MIN: z.string().optional(),
  JERSEYDOR_CREATED_AT_MIN: z.string().optional(),
  CLASSICFOOTBALLKIT_CREATED_AT_MIN: z.string().optional(),
  TEAMZO_CREATED_AT_MIN: z.string().optional(),
  TERRACE_GEAR_AT_MIN: z.string().optional(),
  ONSIDE_THREADS_AT_MIN: z.string().optional(),
  THE_OFFSIDE_LINE_AT_MIN: z.string().optional(),
  THE_RUGBY_HQ_AT_MIN: z.string().optional(),
  TOFFS_UK_CREATED_AT_MIN: z.string().optional(),
  LOKKAROOM_CREATED_AT_MIN: z.string().optional(),
  ABSOLUTE_RUGBY_CREATED_AT_MIN: z.string().optional(),
  // SHOPIFY STORES

  // Development team email id
  DEFAULT_UKSS_MARKETPLACE_EMAIL: z.string().optional(),

  // Marketplace Orders Site with Personalization Enabled
  PERSONALIZE_ORDERS_SITE: z.string().optional(),

  // Remove.bg Background Removal API (used by New Product module)
  REMOVE_BG_API_URL: z.string().default('https://api.remove.bg/v1.0/removebg'),
  REMOVE_BG_API_KEY: z.string().optional(),
  REMOVE_BG_SIZE: z.enum(['preview', 'full']).default('full'), // 'preview' for testing (free), 'full' for production (uses credits)


  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Marketplace Sync Configuration (defaults/fallbacks)
  MARKETPLACE_SYNC_MAX_PRODUCTS: z.coerce.number().default(100),
  MARKETPLACE_SYNC_BATCH_SIZE: z.coerce.number().default(4),
  MARKETPLACE_SYNC_BATCH_DELAY: z.coerce.number().default(1),
  MARKETPLACE_SYNC_MAX_RETRIES: z.coerce.number().default(3),
  MARKETPLACE_SYNC_MAX_QUANTITY_CAP: z.coerce.number().min(0, 'Quantity cap must be 0 or greater (0 = no cap)').default(0),
  MARKETPLACE_SYNC_BESTSELLERS_ONLY: z
    .string()
    .default('false')
    .transform((val) => val === 'true' || val === '1'),
  MARKETPLACE_SYNC_DEBUG: z
    .string()
    .default('true')
    .transform((val) => val === 'true' || val === '1'),
  MARKETPLACE_SYNC_EMAIL_ALERTS: z
    .string()
    .default('true')
    .transform((val) => val === 'true' || val === '1'),

  // Per-marketplace sync configurations (optional, falls back to MARKETPLACE_SYNC_* defaults)
  // eBay
  MARKETPLACE_EBAY_MAX_PRODUCTS: z.coerce.number().optional(),
  MARKETPLACE_EBAY_BATCH_SIZE: z.coerce.number().optional(),
  MARKETPLACE_EBAY_BATCH_DELAY: z.coerce.number().optional(),
  MARKETPLACE_EBAY_MAX_RETRIES: z.coerce.number().optional(),
  MARKETPLACE_EBAY_MAX_QUANTITY_CAP: z.coerce.number().min(0, 'Quantity cap must be 0 or greater (0 = no cap)').optional(),
  MARKETPLACE_EBAY_BESTSELLERS_ONLY: z
    .string()
    .optional()
    .transform((val) => val === undefined ? undefined : val === 'true' || val === '1'),

  // OnBuy
  MARKETPLACE_ONBUY_MAX_PRODUCTS: z.coerce.number().optional(),
  MARKETPLACE_ONBUY_BATCH_SIZE: z.coerce.number().optional(),
  MARKETPLACE_ONBUY_BATCH_DELAY: z.coerce.number().optional(),
  MARKETPLACE_ONBUY_MAX_RETRIES: z.coerce.number().optional(),
  MARKETPLACE_ONBUY_MAX_QUANTITY_CAP: z.coerce.number().min(0, 'Quantity cap must be 0 or greater (0 = no cap)').optional(),
  MARKETPLACE_ONBUY_BESTSELLERS_ONLY: z
    .string()
    .optional()
    .transform((val) => val === undefined ? undefined : val === 'true' || val === '1'),

  // Debenhams/Mirakl
  MARKETPLACE_DEBENHAMS_MAX_PRODUCTS: z.coerce.number().optional(),
  MARKETPLACE_DEBENHAMS_BATCH_SIZE: z.coerce.number().optional(),
  MARKETPLACE_DEBENHAMS_BATCH_DELAY: z.coerce.number().optional(),
  MARKETPLACE_DEBENHAMS_MAX_RETRIES: z.coerce.number().optional(),
  MARKETPLACE_DEBENHAMS_MAX_QUANTITY_CAP: z.coerce.number().min(0, 'Quantity cap must be 0 or greater (0 = no cap)').optional(),
  MARKETPLACE_DEBENHAMS_BESTSELLERS_ONLY: z
    .string()
    .optional()
    .transform((val) => val === undefined ? undefined : val === 'true' || val === '1'),

  // SportDeal
  MARKETPLACE_SPORTDEAL_MAX_PRODUCTS: z.coerce.number().optional(),
  MARKETPLACE_SPORTDEAL_BATCH_SIZE: z.coerce.number().optional(),
  MARKETPLACE_SPORTDEAL_BATCH_DELAY: z.coerce.number().optional(),
  MARKETPLACE_SPORTDEAL_MAX_RETRIES: z.coerce.number().optional(),
  MARKETPLACE_SPORTDEAL_MAX_QUANTITY_CAP: z.coerce.number().min(0, 'Quantity cap must be 0 or greater (0 = no cap)').optional(),
  MARKETPLACE_SPORTDEAL_BESTSELLERS_ONLY: z
    .string()
    .optional()
    .transform((val) => val === undefined ? undefined : val === 'true' || val === '1'),

  // SportDeal Feed Config
  SPORTDEAL_FEED_DIR: z.string().optional(),

  // Seller Dynamics (PMS #165838) — bulk-upload SOAP API.
  // BATCH_SIZE defaults to 2000 (single CSV per call) and BATCH_DELAY to 11s
  // because SD enforces ≥10s between same-method calls and ≤25 calls/method/5min.
  // Do NOT drop BATCH_DELAY below 11.
  MARKETPLACE_SELLER_DYNAMICS_MAX_PRODUCTS: z.coerce.number().optional(),
  MARKETPLACE_SELLER_DYNAMICS_BATCH_SIZE: z.coerce.number().default(2000),
  MARKETPLACE_SELLER_DYNAMICS_BATCH_DELAY: z.coerce.number().min(11, 'Seller Dynamics requires ≥11s between same-method calls').default(11),
  MARKETPLACE_SELLER_DYNAMICS_MAX_RETRIES: z.coerce.number().optional(),
  MARKETPLACE_SELLER_DYNAMICS_MAX_QUANTITY_CAP: z.coerce.number().min(0, 'Quantity cap must be 0 or greater (0 = no cap)').optional(),
  MARKETPLACE_SELLER_DYNAMICS_POLL_MAX_ATTEMPTS: z.coerce.number().min(1).default(5),
  MARKETPLACE_SELLER_DYNAMICS_POLL_DELAY: z.coerce.number().min(11, 'SD requires ≥11s between same-method calls').default(240),
  // Percentage markup applied to the selling price sent to Seller Dynamics (e.g. 25 = +25%).
  // Applied to the final price only; the un-marked-up price stays the drift baseline. 0 = no markup.
  MARKETPLACE_SELLER_DYNAMICS_PRICE_MARKUP_PERCENTAGE: z.coerce.number().min(0).default(25),
  // T-shirt (new_products.virtual_product_type_id = 4) markup MULTIPLIER for Seller Dynamics.
  // Note the shape difference: this is a direct multiplier (1.15 = +15%), whereas
  // *_PRICE_MARKUP_PERCENTAGE above is a percentage (25 -> ×1.25). min(1) so a T-shirt is
  // never sent below its base price. Applied only to the final SD price, never to the stored
  // last_synced_price baseline (see seller-dynamics/adapter.ts).
  SD_MARKUP: z.coerce.number().min(1).default(1.15),
  MARKETPLACE_SELLER_DYNAMICS_BESTSELLERS_ONLY: z
    .string()
    .optional()
    .transform((val) => val === undefined ? undefined : val === 'true' || val === '1'),

  // Allegro
  MARKETPLACE_ALLEGRO_MAX_PRODUCTS: z.coerce.number().optional(),
  MARKETPLACE_ALLEGRO_BATCH_SIZE: z.coerce.number().optional(),
  MARKETPLACE_ALLEGRO_BATCH_DELAY: z.coerce.number().optional(),
  MARKETPLACE_ALLEGRO_MAX_RETRIES: z.coerce.number().optional(),
  MARKETPLACE_ALLEGRO_MAX_QUANTITY_CAP: z.coerce.number().min(0, 'Quantity cap must be 0 or greater (0 = no cap)').optional(),
  MARKETPLACE_ALLEGRO_BESTSELLERS_ONLY: z
    .string()
    .optional()
    .transform((val) => val === undefined ? undefined : val === 'true' || val === '1'),

  // eBay API Configuration
  EBAY_TEST_ENVIRONMENT: z
    .string()
    .default('false')
    .transform((val) => val === 'true' || val === '1'),
  EBAY_TRADING_API_ENDPOINT_SANDBOX: z.string().default('https://api.sandbox.ebay.com/ws/api.dll'),
  EBAY_TRADING_API_ENDPOINT_LIVE: z.string().default('https://api.ebay.com/ws/api.dll'),
  EBAY_API_COMPATIBILITY_LEVEL: z.string().default('1451'),
  EBAY_API_URL_SANDBOX: z.string().default('https://api.sandbox.ebay.com'),
  EBAY_API_URL_LIVE: z.string().default('https://api.ebay.com'),
  EBAY_API_AUTHORIZATION_SANDBOX: z.string().optional(),
  EBAY_API_AUTHORIZATION_LIVE: z.string().optional(),
  EBAY_API_REFRESH_TOKEN_SANDBOX: z.string().optional(),
  EBAY_API_REFRESH_TOKEN_LIVE: z.string().optional(),

  // OnBuy API Configuration
  ONBUY_TEST_ENVIRONMENT: z
    .string()
    .default('false')
    .transform((val) => val === 'true' || val === '1'),
  ONBUY_API_CONSUMER_KEY_LIVE: z.string().default(''),
  ONBUY_API_SECRET_KEY_LIVE: z.string().default(''),
  ONBUY_API_CONSUMER_KEY_TEST: z.string().default(''),
  ONBUY_API_SECRET_KEY_TEST: z.string().default(''),
  ONBUY_API_BASE_URL: z.string().default('https://api.onbuy.com/v2/'),
  ONBUY_SITE_ID: z.string().default('2000'),
  // OnBuy Order Integration (PMS #158188 - migrated from legacy SMS, store_id 125)
  // Note: ONBUY_ORDERS_API_URL has a literal "//" after "v2" — preserved verbatim from legacy
  // (working in production; OnBuy's reverse proxy normalizes it). Do not "fix" it.
  ONBUY_STORE_ID: z.coerce.number().default(125),
  ONBUY_ORDERS_API_URL: z.string().optional(),
  ONBUY_DISPATCH_API_URL: z.string().optional(),
  ONBUY_CANCEL_API_URL: z.string().optional(),

  // Walmart Order Integration (#165070 — migrated from legacy SMS)
  // Names match legacy app/config/ukss_configure.php verbatim. Asymmetric (no _LIVE suffix on
  // live creds, _TEST on sandbox) is intentional — copies legacy.
  WALMART_STORE_ID: z.coerce.number().default(140), // production = 140; staging override = 135
  WALMART_STORE_NAME: z.string().default('Walmart-UKSS'), // sent as WM_SVC.NAME header
  WALMART_TEST_ENVIRONMENT: z
    .string()
    .default('false')
    .transform((val) => val === 'true' || val === '1'),
  WALMART_API_URL: z.string().default('https://marketplace.walmartapis.com'),
  WALMART_API_URL_TEST: z.string().default('https://sandbox.walmartapis.com'),
  WALMART_CLIENT_ID: z.string().default(''),
  WALMART_CLIENT_SECRET: z.string().default(''),
  WALMART_API_CLIENT_ID_TEST: z.string().default(''),
  WALMART_API_CLIENT_SECRET_TEST: z.string().default(''),
  // PM #164896 — comma-separated recipients of override-shipped notification email
  WALMART_CANCELLATION_OVERRIDE_EMAIL: z
    .string()
    .default('simon@uksoccershop.com,ukss-team@velsof.com'),

  // Mirakl API Configuration (Debenhams)
  MIRAKL_TEST_ENVIRONMENT: z
    .string()
    .default('true')
    .transform((val) => val === 'true' || val === '1'),
  MIRAKL_DEBENHAMS_STAGING_URL: z.string().default('https://debenhamsuk-dev.mirakl.net'),
  MIRAKL_DEBENHAMS_PRODUCTION_URL: z.string().default('https://debenhamsuk.mirakl.net'),
  MIRAKL_DEBENHAMS_API_KEY: z.string().default(''),
  
  // Allegro margin (full Allegro client/store config is consolidated in the ALLEGRO marketplace block below)
  ALLEGRO_MARGIN_PERCENT: z.coerce.number().default(0),

  // Seller Dynamics API Configuration (PMS #165838)
  // Endpoint path is case-sensitive — SellerDynamicsAPI (not lowercase 'i')
  SELLER_DYNAMICS_API_URL: z.string().default('https://login.sellerdynamics.com/api/SellerDynamicsAPI.asmx'),
  SELLER_DYNAMICS_ENCRYPTED_LOGIN: z.string().default(''),
  SELLER_DYNAMICS_RETAILER_ID: z.string().default(''),
  SELLER_DYNAMICS_RETAILER_MARKETPLACE_NAME: z.string().default('Amazon.co.uk'),
  SELLER_DYNAMICS_STORE_ID: z.coerce.number().optional(),
  SELLER_DYNAMICS_CANCEL_REJECT_EMAILS: z.string().optional(),

  // Store mapping (JSON strings)
  EBAY_STORE_SITE_ID_MAP: z.string().default('{"145": 3}'),
  MARKETPLACE_STORE_TYPE_MAP: z.string().default(
    JSON.stringify({
      "145": MARKETPLACES.EBAY,
      "125": MARKETPLACES.ONBUY,
      "146": MARKETPLACES.DEBENHAMS
    })
  ),
  LOG_DIR: z.string().default('./logs'),
  LOG_RETENTION_DAYS: z.coerce.number().default(30),

  // CLI Configuration
  CLI_TIMEOUT_MS: z.coerce.number().default(3600000), // 1 hour default
  FEED_CHUNK_SIZE: z.coerce.number().default(10000), // Records per chunk for streaming

  // SPORTDEAL
  SPORTDEAL_API_KEY: z.string().optional(),
  SPORTDEAL_ORDERS_API_URL: z.string().optional(),
  SPORTDEAL_ORDER_PRODUCT_API_URL: z.string().optional(),
  SPORTDEAL_STORE_ID: z.coerce.number().optional(),
  SPORTDEAL_STORE_NAME: z.string().optional(),
  SPORTDEAL_ORDER_STATUS_UPDATE_API: z.string().optional(),
  SPORTDEAL_CURRENCY: z.string().default('EUR'),
  SPORTDEAL_SHIPPING_METHOD: z.string().default('Sportdeal Standard'),
  BASELINKER_STORE_ID: z.coerce.number().default(144),
  // Backward compat: support both SPORTDEAL_ and SPORTSDEAL_ (typo) for status config
  SPORTDEAL_ALLOWED_STATUS_FOR_CONFIRMATION: z.string().optional(),

  // EBAY UK ORDER INTEGRATION
  // WHY: OAuth/API config uses environment-based variables (EBAY_*_SANDBOX vs EBAY_*_LIVE)
  //      selected dynamically by EBAY_TEST_ENVIRONMENT (see ebay-oauth.ts)
  // Variables defined above:
  //   - EBAY_TEST_ENVIRONMENT: true = sandbox, false = live
  //   - EBAY_TRADING_API_ENDPOINT_SANDBOX / EBAY_TRADING_API_ENDPOINT_LIVE
  //   - EBAY_API_URL_SANDBOX / EBAY_API_URL_LIVE (base URL for OAuth)
  //   - EBAY_API_AUTHORIZATION_SANDBOX / EBAY_API_AUTHORIZATION_LIVE (Base64 AppID:CertID)
  //   - EBAY_API_REFRESH_TOKEN_SANDBOX / EBAY_API_REFRESH_TOKEN_LIVE
  EBAY_STORE_ID: z.coerce.number().int().positive(), // Store ID from store_management table
  // eBay reconciliation dashboard: max Browse-API oversell verifications per snapshot run (0 = disabled)
  EBAY_RECON_BROWSE_CAP: z.coerce.number().int().min(0).default(200),
  EBAY_API_SITEID: z.coerce.number().default(3), // UK site (3 = eBay UK)
  EBAY_DEFAULT_LOOKBACK_DAYS: z.coerce.number().default(7),
  EBAY_ORDERS_LIMIT: z.coerce.number().default(100), // eBay API max per page
  EBAY_SHIPPING_METHOD: z.string().default('eBay Standard'),
  // eBay item-level error codes for a REDUNDANT revision: eBay already holds the
  // value we sent, so the listing is already in sync. Treated as success (not
  // failure) by the eBay adapter so last_synced_* converges. Comma-separated.
  //   21917091 - StartPrice and Quantity revision redundant
  //   21917092 - Quantity revision redundant
  //   21917093 - StartPrice revision redundant
  EBAY_REDUNDANT_REVISION_ERROR_CODES: z
    .string()
    .default('21917091,21917092,21917093')
    .transform((val) => val.split(',').map((c) => c.trim()).filter(Boolean)),

  // Account-level monthly listing-limit errors ("you've reached / would exceed the
  // amount you can list this month"). Not the listing's fault: the sync run freezes
  // (no retry_count burn, abort run) instead of marking listings failed.
  //   21919188 - This listing would cause you to exceed / you've reached the £3,000,000 amount
  //   21919189 - You'll be able to list £N more this month (approaching the limit)
  EBAY_LISTING_LIMIT_ERROR_CODES: z
    .string()
    .default('21919188,21919189')
    .transform((val) => val.split(',').map((c) => c.trim()).filter(Boolean)),

  // eBay listing is single-SKU (not Managed-by-SKU) but we sent a SKU-qualified
  // revise. Recoverable: re-revise the same ItemID without the SKU field, then mark
  // terminal (suspended) if it still fails.
  //   21916799 - SKU does not exist in Non-ManageBySKU item specified by ItemID
  EBAY_SKU_NOT_MANAGED_ERROR_CODES: z
    .string()
    .default('21916799')
    .transform((val) => val.split(',').map((c) => c.trim()).filter(Boolean)),

  // ALLEGRO
  ALLEGRO_CLIENT_ID: z.string().optional(),
  ALLEGRO_CLIENT_SECRET: z.string().optional(),
  ALLEGRO_API_BASE_URL: z.string().default('https://api.allegro.pl'),
  ALLEGRO_AUTH_URL: z.string().default('https://allegro.pl/auth/oauth/token'),
  ALLEGRO_STORE_ID: z.coerce.number().optional(),
  ALLEGRO_STORE_NAME: z.string().default('Allegro'),
  ALLEGRO_CURRENCY: z.string().default('PLN'),
  ALLEGRO_SHIPPING_METHOD: z.string().default('Allegro Standard'),
  ALLEGRO_ALLOWED_STATUS_FOR_CONFIRMATION: z.string().optional(),

  // AI Chatbot (Claude) - used by sales dashboard chatbot; optional, dashboard works without it
  ANTHROPIC_API_KEY: z.string().optional(),

  // Daily Deals
  DAILY_DEAL_CATEGORY_ID: z.coerce.number().optional(),
  DAILY_DEALS_BANNER_PATH: z.string().optional(),
  DAILY_DEALS_BANNER_URL: z.string().optional(),

  // Product Feeds (Google Merchant Center + Microsoft Advertising)
  PRODUCT_FEED_OUTPUT_DIR: z.string().default('/feeds/product-feeds'),
  PRODUCT_FEED_CDN_URL: z.string().default('https://cdn.uksoccershop.com'),
  PRODUCT_FEED_CURRENT_SEASON: z.coerce.number().default(2026),
  PRODUCT_FEED_CHUNK_SIZE: z.coerce.number().default(10000),
  PRODUCT_FEED_SUPERSAVER_COST: z.string().default('5.25'),
  PRODUCT_FEED_WEEKLY_DEAL_CATEGORY_ID: z.coerce.number().optional(),
  PRODUCT_FEED_PERMANENT_DEAL_CATEGORY_ID: z.coerce.number().optional(),
  PRODUCT_FEED_SKIP_IMAGE_COLOR: z
    .string()
    .default('false')
    .transform((val) => val === 'true' || val === '1'),
  PRODUCT_FEED_EMAIL_RECIPIENTS: z
    .string()
    .default('david@wmetraining.com,simon@uksoccershop.com,ukss-team@velsof.com'),

  // SFTP - Google Merchant Center
  PRODUCT_FEED_GOOGLE_SFTP_HOST: z.string().default('partnerupload.google.com'),
  PRODUCT_FEED_GOOGLE_SFTP_PORT: z.coerce.number().default(19321),
  PRODUCT_FEED_GOOGLE_SFTP_USER: z.string().optional(),
  PRODUCT_FEED_GOOGLE_SFTP_PASS: z.string().optional(),

  // SFTP - Microsoft Advertising
  PRODUCT_FEED_MICROSOFT_SFTP_HOST: z.string().default('sftp.ads.microsoft.com'),
  PRODUCT_FEED_MICROSOFT_SFTP_PORT: z.coerce.number().default(19321),
  PRODUCT_FEED_MICROSOFT_SFTP_USER: z.string().optional(),
  PRODUCT_FEED_MICROSOFT_SFTP_PASS: z.string().optional(),

  // Dify (AI Workflows) — used by New Product module Steps 3 (Images) & 4 (Description)
  DIFY_API_BASE_URL: z.string().default('https://api.dify.ai/v1'),
  DIFY_DESCRIPTION_API_KEY: z.string().optional(),
  DIFY_IMAGES_API_KEY: z.string().optional(),
  DIFY_UPSCALE_API_KEY: z.string().optional(),
  DIFY_ENHANCE_API_KEY: z.string().optional(),
  DIFY_REMOVE_BG_API_KEY: z.string().optional(),
  DIFY_TIMEOUT_MS: z.coerce.number().default(150_000),
  DIFY_STUB_MODE: z.string().optional().transform((val) => val === 'true'),
  USE_DIFY_FOR_IMAGES: z.string().optional().transform((val) => val === 'true'),
  // Per-operation override for background removal. Defaults to FALSE so a code-only
  // deploy routes remove-bg straight to the remove.bg API (bypassing the broken Dify
  // remove-bg workflow), while enhance/upscale/edits stay on Dify via USE_DIFY_FOR_IMAGES.
  // Set USE_DIFY_FOR_REMOVE_BG=true to send background removal back through Dify once
  // its plugin storage permission is fixed.
  USE_DIFY_FOR_REMOVE_BG: z.string().optional().transform((val) => val === 'true'),
  // Replicate (per-image enhance via real-esrgan) — used by New Product module
  REPLICATE_API_TOKEN: z.string().optional(),
  REPLICATE_TIMEOUT_MS: z.coerce.number().default(60_000),
  REPLICATE_STUB_MODE: z.string().optional().transform((val) => val === 'true'),
  // Typesense — source of truth for the constrained attribute dropdowns in the
  // New Product module. Same instance the Dify description-generator workflow
  // reads from, so dropdown options stay in sync with workflow validation.
  TYPESENSE_HOST: z.string().default('http://ukss.braveotter.com:8108'),
  TYPESENSE_API_KEY: z.string().optional(),
  TYPESENSE_ATTRIBUTES_COLLECTION: z.string().default('staging_ukss_attribute_values_A'),
  // Storefront products collection — reused (not rebuilt) for typo-tolerant
  // duplicate detection in the New Product wizard (Robert's Brazil-shirt case).
  // It is maintained by the storefront's own blue-green reindex (A/B pair), so
  // we never write to it. NOTE: it holds ACTIVE products only — archived
  // duplicates are covered by the structured MySQL tier, not this search.
  // Set to whichever of ukssproductiondata_A / _B the storefront alias points at.
  TYPESENSE_PRODUCTS_COLLECTION: z.string().default('ukssproductiondata_B'),
  TYPESENSE_TIMEOUT_MS: z.coerce.number().default(15_000),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

export type Config = z.infer<typeof envSchema>;

/**
 * Marketplace-specific configuration getters
 * Each function falls back to the default MARKETPLACE_SYNC_* value if marketplace-specific config is not set
 */

export function getMarketplaceMaxProducts(marketplace: string): number {
  const normalizedMarketplace = marketplace.toLowerCase();

  switch (normalizedMarketplace) {
    case MARKETPLACES.EBAY:
      return config.MARKETPLACE_EBAY_MAX_PRODUCTS ?? config.MARKETPLACE_SYNC_MAX_PRODUCTS;
    case MARKETPLACES.ONBUY:
      return config.MARKETPLACE_ONBUY_MAX_PRODUCTS ?? config.MARKETPLACE_SYNC_MAX_PRODUCTS;
    case MARKETPLACES.DEBENHAMS:
    case MARKETPLACES.MIRAKL:
      return config.MARKETPLACE_DEBENHAMS_MAX_PRODUCTS ?? config.MARKETPLACE_SYNC_MAX_PRODUCTS;
    case MARKETPLACES.SPORTDEAL:
      return config.MARKETPLACE_SPORTDEAL_MAX_PRODUCTS ?? config.MARKETPLACE_SYNC_MAX_PRODUCTS;
    case MARKETPLACES.ALLEGRO:
      return config.MARKETPLACE_ALLEGRO_MAX_PRODUCTS ?? config.MARKETPLACE_SYNC_MAX_PRODUCTS;
    case MARKETPLACES.SELLER_DYNAMICS:
      return config.MARKETPLACE_SELLER_DYNAMICS_MAX_PRODUCTS ?? config.MARKETPLACE_SYNC_MAX_PRODUCTS;
    default:
      return config.MARKETPLACE_SYNC_MAX_PRODUCTS;
  }
}

export function getMarketplaceBatchSize(marketplace: string): number {
  const normalizedMarketplace = marketplace.toLowerCase();

  switch (normalizedMarketplace) {
    case MARKETPLACES.EBAY:
      return config.MARKETPLACE_EBAY_BATCH_SIZE ?? config.MARKETPLACE_SYNC_BATCH_SIZE;
    case MARKETPLACES.ONBUY:
      return config.MARKETPLACE_ONBUY_BATCH_SIZE ?? config.MARKETPLACE_SYNC_BATCH_SIZE;
    case MARKETPLACES.DEBENHAMS:
    case MARKETPLACES.MIRAKL:
      return config.MARKETPLACE_DEBENHAMS_BATCH_SIZE ?? config.MARKETPLACE_SYNC_BATCH_SIZE;
    case MARKETPLACES.SPORTDEAL:
      return config.MARKETPLACE_SPORTDEAL_BATCH_SIZE ?? config.MARKETPLACE_SYNC_BATCH_SIZE;
    case MARKETPLACES.ALLEGRO:
      return config.MARKETPLACE_ALLEGRO_BATCH_SIZE ?? config.MARKETPLACE_SYNC_BATCH_SIZE;
    case MARKETPLACES.SELLER_DYNAMICS:
      return config.MARKETPLACE_SELLER_DYNAMICS_BATCH_SIZE;
    default:
      return config.MARKETPLACE_SYNC_BATCH_SIZE;
  }
}

export function getMarketplaceBatchDelay(marketplace: string): number {
  const normalizedMarketplace = marketplace.toLowerCase();

  switch (normalizedMarketplace) {
    case MARKETPLACES.EBAY:
      return config.MARKETPLACE_EBAY_BATCH_DELAY ?? config.MARKETPLACE_SYNC_BATCH_DELAY;
    case MARKETPLACES.ONBUY:
      return config.MARKETPLACE_ONBUY_BATCH_DELAY ?? config.MARKETPLACE_SYNC_BATCH_DELAY;
    case MARKETPLACES.DEBENHAMS:
    case MARKETPLACES.MIRAKL:
      return config.MARKETPLACE_DEBENHAMS_BATCH_DELAY ?? config.MARKETPLACE_SYNC_BATCH_DELAY;
    case MARKETPLACES.SPORTDEAL:
      return config.MARKETPLACE_SPORTDEAL_BATCH_DELAY ?? config.MARKETPLACE_SYNC_BATCH_DELAY;
    case MARKETPLACES.ALLEGRO:
      return config.MARKETPLACE_ALLEGRO_BATCH_DELAY ?? config.MARKETPLACE_SYNC_BATCH_DELAY;
    case MARKETPLACES.SELLER_DYNAMICS:
      return config.MARKETPLACE_SELLER_DYNAMICS_BATCH_DELAY;
    default:
      return config.MARKETPLACE_SYNC_BATCH_DELAY;
  }
}

export function getMarketplaceMaxRetries(marketplace: string): number {
  const normalizedMarketplace = marketplace.toLowerCase();

  switch (normalizedMarketplace) {
    case MARKETPLACES.EBAY:
      return config.MARKETPLACE_EBAY_MAX_RETRIES ?? config.MARKETPLACE_SYNC_MAX_RETRIES;
    case MARKETPLACES.ONBUY:
      return config.MARKETPLACE_ONBUY_MAX_RETRIES ?? config.MARKETPLACE_SYNC_MAX_RETRIES;
    case MARKETPLACES.DEBENHAMS:
    case MARKETPLACES.MIRAKL:
      return config.MARKETPLACE_DEBENHAMS_MAX_RETRIES ?? config.MARKETPLACE_SYNC_MAX_RETRIES;
    case MARKETPLACES.SPORTDEAL:
      return config.MARKETPLACE_SPORTDEAL_MAX_RETRIES ?? config.MARKETPLACE_SYNC_MAX_RETRIES;
    case MARKETPLACES.ALLEGRO:
      return config.MARKETPLACE_ALLEGRO_MAX_RETRIES ?? config.MARKETPLACE_SYNC_MAX_RETRIES;
    case MARKETPLACES.SELLER_DYNAMICS:
      return config.MARKETPLACE_SELLER_DYNAMICS_MAX_RETRIES ?? config.MARKETPLACE_SYNC_MAX_RETRIES;
    default:
      return config.MARKETPLACE_SYNC_MAX_RETRIES;
  }
}

export function getMarketplaceQuantityCap(marketplace: string): number {
  const normalizedMarketplace = marketplace.toLowerCase();

  switch (normalizedMarketplace) {
    case MARKETPLACES.EBAY:
      return config.MARKETPLACE_EBAY_MAX_QUANTITY_CAP ?? config.MARKETPLACE_SYNC_MAX_QUANTITY_CAP;
    case MARKETPLACES.ONBUY:
      return config.MARKETPLACE_ONBUY_MAX_QUANTITY_CAP ?? config.MARKETPLACE_SYNC_MAX_QUANTITY_CAP;
    case MARKETPLACES.DEBENHAMS:
    case MARKETPLACES.MIRAKL:
      return config.MARKETPLACE_DEBENHAMS_MAX_QUANTITY_CAP ?? config.MARKETPLACE_SYNC_MAX_QUANTITY_CAP;
    case MARKETPLACES.SPORTDEAL:
      return config.MARKETPLACE_SPORTDEAL_MAX_QUANTITY_CAP ?? config.MARKETPLACE_SYNC_MAX_QUANTITY_CAP;
    case MARKETPLACES.ALLEGRO:
      return config.MARKETPLACE_ALLEGRO_MAX_QUANTITY_CAP ?? config.MARKETPLACE_SYNC_MAX_QUANTITY_CAP;
    case MARKETPLACES.SELLER_DYNAMICS:
      return config.MARKETPLACE_SELLER_DYNAMICS_MAX_QUANTITY_CAP ?? config.MARKETPLACE_SYNC_MAX_QUANTITY_CAP;
    default:
      return config.MARKETPLACE_SYNC_MAX_QUANTITY_CAP;
  }
}

export function getMarketplaceBestsellersOnly(marketplace: string): boolean {
  const normalizedMarketplace = marketplace.toLowerCase();

  switch (normalizedMarketplace) {
    case MARKETPLACES.EBAY:
      return config.MARKETPLACE_EBAY_BESTSELLERS_ONLY ?? config.MARKETPLACE_SYNC_BESTSELLERS_ONLY;
    case MARKETPLACES.ONBUY:
      return config.MARKETPLACE_ONBUY_BESTSELLERS_ONLY ?? config.MARKETPLACE_SYNC_BESTSELLERS_ONLY;
    case MARKETPLACES.DEBENHAMS:
    case MARKETPLACES.MIRAKL:
      return config.MARKETPLACE_DEBENHAMS_BESTSELLERS_ONLY ?? config.MARKETPLACE_SYNC_BESTSELLERS_ONLY;
    case MARKETPLACES.SPORTDEAL:
      return config.MARKETPLACE_SPORTDEAL_BESTSELLERS_ONLY ?? config.MARKETPLACE_SYNC_BESTSELLERS_ONLY;
    case MARKETPLACES.ALLEGRO:
      return config.MARKETPLACE_ALLEGRO_BESTSELLERS_ONLY ?? config.MARKETPLACE_SYNC_BESTSELLERS_ONLY;
    case MARKETPLACES.SELLER_DYNAMICS:
      return config.MARKETPLACE_SELLER_DYNAMICS_BESTSELLERS_ONLY ?? config.MARKETPLACE_SYNC_BESTSELLERS_ONLY;
    default:
      return config.MARKETPLACE_SYNC_BESTSELLERS_ONLY;
  }
}
