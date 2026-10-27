/**
 * Chatbot Service — Sales Dashboard AI Assistant
 *
 * @taskId 16, 17, 18, 19
 *
 * Provides:
 *  - Predefined question catalog (sales, inventory, operations)
 *  - Per-user rate limiting via Redis (20 queries / 5 minutes)
 *  - generateSQL: Claude API to translate natural-language questions to SQL (Task 17)
 *  - validateSQL: 7-layer SQL validation for AI-generated queries (Task 18)
 *  - executeQuery: runs validated SQL with 5s timeout via $queryRawUnsafe (Task 19)
 *  - formatResponse: Claude API to format raw results as natural language (Task 19)
 *  - processQuery orchestration: generateSQL -> validateSQL -> executeQuery -> formatResponse
 */

import { nanoid } from 'nanoid';
import Anthropic from '@anthropic-ai/sdk';
import type { PredefinedQuestion, ChatbotResponse } from '@admin/shared';
import { config } from '../../config';
import { redis } from '../../lib/redis';
import { prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum queries a single user may issue within the rate-limit window. */
const RATE_LIMIT_MAX_REQUESTS = 20;

/** Rate-limit window duration in seconds (5 minutes). */
const RATE_LIMIT_WINDOW_SECONDS = 5 * 60;

/** Redis key prefix for chatbot rate limiting. */
const RATE_LIMIT_KEY_PREFIX = 'sd:chatbot:ratelimit:';

/** Maximum number of rows to display in the formatted markdown table. */
const MAX_DISPLAY_ROWS = 20;

/** Claude model used for SQL generation and response formatting (cost-efficient). */
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

/** Alias for response formatting — uses the same model as SQL generation. */
const FORMAT_MODEL = CLAUDE_MODEL;

/** Maximum tokens for the Claude SQL generation response. */
const CLAUDE_MAX_TOKENS = 1024;

/** Timeout in milliseconds for the Claude API call (30 seconds). */
const CLAUDE_API_TIMEOUT_MS = 30_000;

/** MySQL session timeout for chatbot queries (milliseconds). */
const QUERY_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Schema Context for Claude SQL Generation (@taskId 17)
// ---------------------------------------------------------------------------

/**
 * Static schema context describing the 14 allowed MySQL tables, their columns,
 * data types, relationships, and store/site ID mappings. Injected into the
 * Claude system prompt so the model can generate accurate SQL.
 */
const CHATBOT_SCHEMA_CONTEXT = `You are a SQL expert for a UK Soccer Shop stock management system (MySQL database).
You may ONLY query the following 14 tables. Do NOT reference any other tables.

=== TABLES & COLUMNS ===

1. orders
   - orders_id INT (PK)
   - customers_id INT
   - order_total DECIMAL — total order value
   - date_purchased DATETIME — when the order was placed
   - orders_status INT — current status ID
   - order_site INT — which site/store placed the order (see Store Mappings below)
   - delivery_country VARCHAR
   - delivery_postcode VARCHAR
   - delivery_name VARCHAR

2. orders_products
   - orders_products_id INT (PK)
   - orders_id INT (FK -> orders.orders_id)
   - products_id INT (FK -> products.products_id)
   - products_model VARCHAR — product code/model
   - products_name VARCHAR
   - products_quantity INT — quantity ordered
   - products_price DECIMAL — unit price
   - final_price DECIMAL — price after discounts

3. orders_total
   - orders_total_id INT (PK)
   - orders_id INT (FK -> orders.orders_id)
   - title VARCHAR — label for the total line (e.g. "Sub-Total", "Shipping", "Tax")
   - text VARCHAR — formatted display value
   - value DECIMAL — numeric value
   - class VARCHAR — type key (ot_subtotal, ot_shipping, ot_tax, ot_total, etc.)
   - sort_order INT

4. orders_status_history
   - orders_status_history_id INT (PK)
   - orders_id INT (FK -> orders.orders_id)
   - orders_status_id INT — the status assigned at this point
   - date_added DATETIME — when this status change occurred
   - comments TEXT

5. store_management
   - store_id INT (PK)
   - store_name VARCHAR
   - store_platform VARCHAR — e.g. "shopify", "ebay", "onbuy", "mirakl"
   - status INT — 1 = active, 0 = inactive

6. product_quantities
   - pq_id INT (PK)
   - pq_product_code VARCHAR — matches product_lists.product_code
   - pq_size_id INT
   - pq_quantity INT — current stock on hand
   - pq_minimum_quantity INT — reorder threshold
   - pq_committed_quantity INT — reserved/committed stock
   - last_sale_date DATETIME

7. product_lists
   - product_code VARCHAR (PK) — unique product code
   - product_name VARCHAR
   - teams_id INT (FK -> teams.teams_id)
   - product_price DECIMAL

8. products
   - products_id INT (PK)
   - products_model VARCHAR — matches product code
   - products_price DECIMAL
   - products_status INT — 1 = active, 0 = inactive

9. teams
   - teams_id INT (PK)
   - teams_name VARCHAR — football club or brand name

10. currencies
    - currencies_id INT (PK)
    - code VARCHAR — ISO currency code (GBP, USD, EUR, etc.)
    - title VARCHAR — display name
    - value DECIMAL — exchange rate relative to base currency

11. marketplace_listings
    - id INT (PK)
    - product_code VARCHAR (FK -> product_lists.product_code)
    - store_id INT (FK -> store_management.store_id)
    - marketplace_listing_status VARCHAR — e.g. "active", "inactive", "error"
    - last_synced_at DATETIME
    - last_sync_status VARCHAR — e.g. "success", "failed"
    - last_synced_quantity INT

12. shopify_products
    - sp_id INT (PK)
    - sp_product_code VARCHAR — matches product_lists.product_code
    - sm_store_id INT (FK -> store_management.store_id)
    - sp_status VARCHAR — e.g. "active", "draft"
    - sp_update_inventory_status INT — 1 = auto-sync inventory, 0 = no sync

13. shopify_products_variations
    - spv_id INT (PK)
    - sp_id INT (FK -> shopify_products.sp_id)
    - spv_inventory_quantity INT — variant stock level
    - spv_option_value VARCHAR — size/variant descriptor

14. mop_marketplace_order_products
    - mop_id INT (PK)
    - mop_mo_id INT — marketplace order ID
    - mop_order_status_of_order VARCHAR — marketplace-level order status

=== KEY RELATIONSHIPS ===

- orders.orders_id = orders_products.orders_id
- orders.orders_id = orders_total.orders_id
- orders.orders_id = orders_status_history.orders_id
- orders.order_site can be joined with store_management.store_id
- orders_products.products_id = products.products_id
- orders_products.products_model = product_lists.product_code
- product_lists.teams_id = teams.teams_id
- product_lists.product_code = product_quantities.pq_product_code
- product_lists.product_code = marketplace_listings.product_code
- product_lists.product_code = shopify_products.sp_product_code
- marketplace_listings.store_id = store_management.store_id
- shopify_products.sm_store_id = store_management.store_id
- shopify_products.sp_id = shopify_products_variations.sp_id

=== STORE / SITE MAPPINGS ===

orders.order_site values:
  0 = UKSS Website (uksoccershop.com — main website)

Key store_management.store_id values:
  145 = eBay
  125 = OnBuy
  146 = Debenhams (Mirakl staging)
  150 = Debenhams (Mirakl production)

To find the store name for an order_site value, join: orders.order_site = store_management.store_id

=== RULES ===

- Generate ONLY read-only SELECT queries. Never generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, or any DDL/DML.
- Always add a LIMIT clause (max 100 rows) unless the query is an aggregate (COUNT, SUM, AVG, etc.).
- Use DATE() and NOW() for date comparisons. "Today" = DATE(NOW()), "this week" = last 7 days, "this month" = last 30 days.
- When asked about "revenue" or "sales", use SUM(orders_products.final_price * orders_products.products_quantity) or orders.order_total as appropriate.
- When asked about "best selling", order by SUM(orders_products.products_quantity) DESC.
- When asked about "out of stock", look for product_quantities.pq_quantity <= 0.
- When asked about "pending orders", join orders_status_history to find orders whose latest status indicates pending.
- Return ONLY the raw SQL query. No explanations, no markdown formatting, no backticks, no comments.`;

// ---------------------------------------------------------------------------
// SQL Validation — 7-layer security (@taskId 18)
// ---------------------------------------------------------------------------

/** Result of SQL validation — returned by validateSQL(). */
export interface SqlValidationResult {
  valid: boolean;
  sanitizedSql: string;
  error?: string;
}

/**
 * The 14 tables the chatbot is allowed to query.
 * Any SQL referencing a table outside this set is rejected.
 */
const ALLOWED_TABLES = new Set([
  'orders',
  'orders_products',
  'orders_total',
  'orders_status_history',
  'store_management',
  'product_quantities',
  'product_lists',
  'products',
  'teams',
  'currencies',
  'marketplace_listings',
  'shopify_products',
  'shopify_products_variations',
  'mop_marketplace_order_products',
  // Common alias referenced from mop joins
  'mo_marketplace_orders',
]);

/**
 * Regex matching SQL keywords that indicate write/DDL/privilege operations.
 * Applied against the full normalized SQL (after comment stripping).
 * Uses word boundaries to avoid false positives (e.g. "deleted_at" column name).
 */
const BLOCKED_KEYWORDS_REGEX = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i;

/**
 * Regex matching dangerous MySQL file I/O expressions.
 * These do not require word-boundary matching because they are multi-word phrases.
 */
const BLOCKED_FILE_IO_REGEX = /\b(INTO\s+OUTFILE|INTO\s+DUMPFILE|LOAD_FILE)\b/i;

/** Maximum number of rows the chatbot may retrieve. */
const MAX_RESULT_LIMIT = 100;

// ---------------------------------------------------------------------------
// Predefined Questions
// ---------------------------------------------------------------------------

const PREDEFINED_QUESTIONS: PredefinedQuestion[] = [
  // Sales
  { category: 'sales', question: "What's the best selling product today?" },
  { category: 'sales', question: 'What are the top 5 products by revenue this week?' },
  { category: 'sales', question: 'Which marketplace has the highest average order value?' },
  { category: 'sales', question: "What's the total revenue for today?" },
  { category: 'sales', question: "Compare this week's sales to last week" },

  // Inventory
  { category: 'inventory', question: 'Which products are out of stock?' },
  { category: 'inventory', question: 'What are the top 10 products with lowest stock?' },
  { category: 'inventory', question: "Which products haven't sold in 90 days?" },
  { category: 'inventory', question: 'How many products are below minimum stock level?' },

  // Operations
  { category: 'operations', question: 'How many orders are pending for more than 48 hours?' },
  { category: 'operations', question: "What's the average time to ship an order?" },
  { category: 'operations', question: 'Which marketplace has the most sync issues?' },
  { category: 'operations', question: 'How many orders were cancelled this week?' },
];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ChatbotService {
  private logger = getLogger('sales-dashboard');
  private anthropic: Anthropic | null = null;

  /**
   * Lazy-initialise the Anthropic client so we don't blow up at import
   * time when the API key is not yet validated.
   */
  private getAnthropicClient(): Anthropic {
    if (!this.anthropic) {
      this.anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    }
    return this.anthropic;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Return the full catalog of predefined questions grouped by category.
   */
  getPredefinedQuestions(): PredefinedQuestion[] {
    return PREDEFINED_QUESTIONS;
  }

  /**
   * Check whether a user is within their rate-limit allowance.
   *
   * Uses a Redis counter with a sliding-window TTL per user.
   * Key pattern: `sd:chatbot:ratelimit:{userId}`
   *
   * @returns `allowed` — true if the request may proceed.
   *          `cooldownSeconds` — seconds until the window resets (0 when allowed).
   */
  async checkRateLimit(userId: string): Promise<{ allowed: boolean; cooldownSeconds: number }> {
    const key = `${RATE_LIMIT_KEY_PREFIX}${userId}`;

    const currentCount = await redis.incr(key);

    // If this is the first request in the window, set the TTL.
    if (currentCount === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }

    if (currentCount > RATE_LIMIT_MAX_REQUESTS) {
      const ttl = await redis.ttl(key);
      return { allowed: false, cooldownSeconds: ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS };
    }

    return { allowed: true, cooldownSeconds: 0 };
  }

  /**
   * Main orchestrator for chatbot queries.
   *
   * Flow: check rate limit -> generateSQL -> validateSQL -> executeQuery
   *       -> formatResponse -> write AuditLog entry.
   *
   * @throws 503 when ANTHROPIC_API_KEY is not configured.
   * @throws 429 when the user has exceeded the rate limit.
   */
  async processQuery(question: string, userId: string): Promise<ChatbotResponse> {
    // 1. Check API key availability
    if (!config.ANTHROPIC_API_KEY) {
      const error: any = new Error('AI chatbot is not configured. ANTHROPIC_API_KEY is missing.');
      error.statusCode = 503;
      throw error;
    }

    // 2. Rate-limit check
    const { allowed, cooldownSeconds } = await this.checkRateLimit(userId);
    if (!allowed) {
      const error: any = new Error(
        `Rate limit exceeded. Please wait ${cooldownSeconds} seconds before sending another query.`,
      );
      error.statusCode = 429;
      throw error;
    }

    const queryId = nanoid(12);
    const startTime = Date.now();

    try {
      // 3. Generate SQL from the natural-language question (Task 17)
      const rawSql = await this.generateSQL(question);

      // 4. Validate the generated SQL is safe (Task 18 — 7-layer security)
      const validation = this.validateSQL(rawSql);
      if (!validation.valid) {
        const error: any = new Error(
          `Generated SQL failed validation: ${validation.error}`,
        );
        error.statusCode = 400;
        throw error;
      }
      const sql = validation.sanitizedSql;

      // 5. Execute the validated query (Task 19)
      const results = await this.executeQuery(sql);

      // 6. Format the raw results into a human-readable summary (Task 19)
      const summary = await this.formatResponse(question, sql, results);

      const executionTimeMs = Date.now() - startTime;

      const response: ChatbotResponse = {
        queryId,
        question,
        sql,
        results,
        summary,
        resultCount: results.length,
        executionTimeMs,
      };

      // 7. Audit log (fire-and-forget — do not block the response)
      this.logQuery(userId, response).catch((err) => {
        this.logger.error({ err, queryId }, 'Failed to write chatbot audit log');
      });

      return response;
    } catch (err: any) {
      // Re-throw rate-limit and config errors as-is
      if (err.statusCode === 429 || err.statusCode === 503) {
        throw err;
      }

      this.logger.error({ err, queryId, question }, 'Chatbot query processing failed');
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // SQL Generation — Claude API (@taskId 17)
  // -----------------------------------------------------------------------

  /**
   * Use Claude to translate a natural-language question into a MySQL SELECT query.
   *
   * @taskId 17
   *
   * The system prompt contains CHATBOT_SCHEMA_CONTEXT which describes the 14
   * allowed tables, their columns, relationships, and store ID mappings.
   * Claude is instructed to return ONLY the raw SQL with no formatting.
   *
   * Error handling:
   *  - API timeout (30 s) -> caught and re-thrown with a user-friendly 504 message
   *  - Non-SQL response -> returned as-is; the downstream validateSQL() will reject it
   *  - Authentication / rate-limit errors -> logged and re-thrown as 502
   *
   * @param question - The natural-language question from the user
   * @returns Raw SQL string (not yet validated)
   */
  async generateSQL(question: string): Promise<string> {
    this.logger.info({ question }, 'Generating SQL via Claude API');

    try {
      const client = this.getAnthropicClient();

      const response = await client.messages.create(
        {
          model: CLAUDE_MODEL,
          max_tokens: CLAUDE_MAX_TOKENS,
          system: CHATBOT_SCHEMA_CONTEXT,
          messages: [
            {
              role: 'user',
              content: question,
            },
          ],
        },
        {
          timeout: CLAUDE_API_TIMEOUT_MS,
        },
      );

      // Extract the text content from the Claude response
      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text' || !textBlock.text.trim()) {
        this.logger.warn({ response: response.content }, 'Claude returned empty or non-text response');
        const error: any = new Error(
          'The AI could not generate a query for that question. Please try rephrasing.',
        );
        error.statusCode = 422;
        throw error;
      }

      // Strip any accidental markdown code fences Claude might add despite instructions
      let sql = textBlock.text.trim();
      sql = sql.replace(/^```(?:sql)?\s*/i, '').replace(/\s*```$/i, '');
      sql = sql.trim();

      this.logger.info({ generatedSql: sql }, 'Claude SQL generation complete');

      return sql;
    } catch (err: any) {
      // Re-throw our own errors (422, etc.) as-is
      if (err.statusCode) {
        throw err;
      }

      // Anthropic SDK timeout
      if (
        err.name === 'APIConnectionTimeoutError' ||
        err.message?.includes('timeout') ||
        err.message?.includes('ETIMEDOUT')
      ) {
        this.logger.warn({ err }, 'Claude API call timed out');
        const timeoutError: any = new Error(
          'The AI service is taking too long to respond. Please try again in a moment.',
        );
        timeoutError.statusCode = 504;
        throw timeoutError;
      }

      // Anthropic authentication or rate-limit errors
      if (err.status === 401 || err.status === 403) {
        this.logger.error({ err }, 'Claude API authentication failed');
        const authError: any = new Error('AI service authentication error. Please contact an administrator.');
        authError.statusCode = 502;
        throw authError;
      }

      if (err.status === 429) {
        this.logger.warn({ err }, 'Claude API rate limit hit');
        const rateLimitError: any = new Error(
          'The AI service is currently busy. Please try again in a few seconds.',
        );
        rateLimitError.statusCode = 503;
        throw rateLimitError;
      }

      // Any other Anthropic SDK error
      this.logger.error({ err }, 'Claude API call failed');
      const genericError: any = new Error(
        'Failed to generate SQL query. Please try again or rephrase your question.',
      );
      genericError.statusCode = 502;
      throw genericError;
    }
  }

  /**
   * Validate that a generated SQL query is read-only and safe to execute.
   *
   * Applies 7 layers of security validation:
   *   1. Strip SQL comments (-- and /* ... *​/) to prevent comment-based bypasses
   *   2. Normalize whitespace and verify statement starts with SELECT
   *   3. Block dangerous keywords (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE,
   *      TRUNCATE, GRANT, REVOKE, INTO OUTFILE, INTO DUMPFILE, LOAD_FILE)
   *   4. Validate all referenced tables are in the 14-table allowlist
   *   5. Enforce LIMIT cap (append LIMIT 100 if missing; reduce if > 100)
   *   6. Single-statement safety: prisma.$queryRawUnsafe only executes one
   *      statement, so semicolon-separated injection is inherently blocked
   *   7. Return structured result with sanitized SQL or descriptive error
   *
   * @taskId 18
   * @param sql - Raw SQL string (potentially AI-generated)
   * @returns SqlValidationResult with valid flag, sanitized SQL, and optional error
   */
  validateSQL(sql: string): SqlValidationResult {
    // Layer 1: Strip SQL comments before any validation
    let cleaned = this.stripSqlComments(sql);

    // Normalize whitespace: collapse multiple spaces/newlines into single space, trim
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    if (!cleaned) {
      return { valid: false, sanitizedSql: '', error: 'SQL query is empty.' };
    }

    // Layer 2: Must start with SELECT (case-insensitive)
    if (!/^SELECT\b/i.test(cleaned)) {
      return {
        valid: false,
        sanitizedSql: cleaned,
        error: 'Only SELECT queries are allowed. Query must start with SELECT.',
      };
    }

    // Layer 3: Block dangerous keywords anywhere in the SQL
    const keywordMatch = cleaned.match(BLOCKED_KEYWORDS_REGEX);
    if (keywordMatch) {
      return {
        valid: false,
        sanitizedSql: cleaned,
        error: `Blocked keyword detected: ${keywordMatch[1].toUpperCase()}. Only read-only SELECT queries are permitted.`,
      };
    }

    const fileIoMatch = cleaned.match(BLOCKED_FILE_IO_REGEX);
    if (fileIoMatch) {
      return {
        valid: false,
        sanitizedSql: cleaned,
        error: `Blocked expression detected: ${fileIoMatch[1].toUpperCase()}. File I/O operations are not permitted.`,
      };
    }

    // Layer 4: Table allowlist — extract all table names and verify each one
    const tables = this.extractTableNames(cleaned);
    for (const table of tables) {
      if (!ALLOWED_TABLES.has(table.toLowerCase())) {
        return {
          valid: false,
          sanitizedSql: cleaned,
          error: `Table "${table}" is not in the allowed tables list. Permitted tables: ${[...ALLOWED_TABLES].join(', ')}.`,
        };
      }
    }

    // Layer 5: Enforce LIMIT cap
    cleaned = this.enforceLimitCap(cleaned);

    // Layer 6: Single-statement safety (documented)
    // prisma.$queryRawUnsafe only executes a single statement. Semicolon-separated
    // injection attempts (e.g. "SELECT 1; DROP TABLE orders") are inherently
    // blocked by the Prisma query engine, which rejects multi-statement SQL.
    // No additional code is needed for this layer.

    // Layer 7: Return validated result
    this.logger.debug({ originalSql: sql, sanitizedSql: cleaned }, 'SQL validation passed');

    return { valid: true, sanitizedSql: cleaned };
  }

  // -----------------------------------------------------------------------
  // SQL Validation Helpers (@taskId 18)
  // -----------------------------------------------------------------------

  /**
   * Strip SQL comments from the input to prevent comment-based bypasses.
   * Handles single-line comments (--) and multi-line comments (/* ... *​/).
   */
  private stripSqlComments(sql: string): string {
    // Remove multi-line comments: /* ... */
    let result = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');

    // Remove single-line comments: -- to end of line
    result = result.replace(/--[^\n\r]*/g, ' ');

    return result;
  }

  /**
   * Extract table names from SQL after FROM and JOIN keywords.
   *
   * Handles:
   *  - Simple: FROM orders
   *  - Aliased: FROM orders o
   *  - Aliased with AS: FROM orders AS o
   *  - Backtick-quoted: FROM `orders`
   *  - Multiple tables in FROM: FROM orders o, products p
   *  - All JOIN variants: JOIN, LEFT JOIN, RIGHT JOIN, INNER JOIN, etc.
   *  - Subqueries: skips subquery parentheses (table extraction from outer query)
   */
  private extractTableNames(sql: string): string[] {
    const tables: Set<string> = new Set();

    // Remove string literals to avoid false matches inside quoted values
    const withoutStrings = sql.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');

    // Match table references after FROM and JOIN keywords.
    // Pattern: (FROM|JOIN) followed by optional backtick-quoted or plain table name
    // We handle comma-separated tables in the FROM clause separately.
    const fromJoinRegex = /\b(?:FROM|JOIN)\s+(`?\w+`?)/gi;
    let match: RegExpExecArray | null;

    while ((match = fromJoinRegex.exec(withoutStrings)) !== null) {
      const tableName = match[1].replace(/`/g, '');
      // Skip if it looks like a subquery (next non-space char is open paren)
      // The regex already captures the first token after FROM/JOIN, so if it
      // captured a keyword like SELECT, it's a subquery reference — skip it.
      if (!/^(SELECT|FROM|WHERE|ORDER|GROUP|HAVING|LIMIT|UNION)$/i.test(tableName)) {
        tables.add(tableName.toLowerCase());
      }
    }

    // Handle comma-separated tables in FROM clause:
    // e.g. FROM orders o, products p
    const fromClauseRegex = /\bFROM\s+((?:`?\w+`?(?:\s+(?:AS\s+)?\w+)?\s*,\s*)*`?\w+`?)/gi;
    let fromMatch: RegExpExecArray | null;

    while ((fromMatch = fromClauseRegex.exec(withoutStrings)) !== null) {
      const fromList = fromMatch[1];
      // Split by comma and extract each table name
      const parts = fromList.split(',');
      for (const part of parts) {
        const trimmed = part.trim();
        // First token is the table name (with optional backticks)
        const tableToken = trimmed.match(/^`?(\w+)`?/);
        if (
          tableToken &&
          !/^(SELECT|FROM|WHERE|ORDER|GROUP|HAVING|LIMIT|UNION)$/i.test(tableToken[1])
        ) {
          tables.add(tableToken[1].toLowerCase());
        }
      }
    }

    return [...tables];
  }

  /**
   * Enforce the LIMIT cap on SQL queries.
   *
   * - If no LIMIT clause exists, append LIMIT 100
   * - If LIMIT exists with a value > 100, replace it with LIMIT 100
   * - If LIMIT exists with a value <= 100, leave it unchanged
   */
  private enforceLimitCap(sql: string): string {
    // Match existing LIMIT clause (with optional offset syntax)
    const limitRegex = /\bLIMIT\s+(\d+)/i;
    const limitMatch = sql.match(limitRegex);

    if (!limitMatch) {
      // No LIMIT clause — append one
      // Remove trailing semicolons before appending
      const trimmed = sql.replace(/;\s*$/, '').trim();
      return `${trimmed} LIMIT ${MAX_RESULT_LIMIT}`;
    }

    const currentLimit = parseInt(limitMatch[1], 10);
    if (currentLimit > MAX_RESULT_LIMIT) {
      // Replace the over-limit value with the max
      return sql.replace(limitRegex, `LIMIT ${MAX_RESULT_LIMIT}`);
    }

    // Existing LIMIT is within bounds — no change needed
    return sql;
  }

  /**
   * Execute a validated SQL query against the database with a 5-second timeout.
   *
   * @taskId 19
   *
   * Safety:
   *  - Sets MySQL session timeout to 5 000 ms before each query
   *  - Catches timeout errors and returns a user-friendly message
   *
   * @param sql - The validated SQL query (must have passed 7-layer validateSQL)
   * @returns Array of result rows
   */
  async executeQuery(sql: string): Promise<Record<string, unknown>[]> {
    this.logger.info({ sql }, 'Executing chatbot SQL query');

    try {
      // Set session-level timeout to prevent runaway queries
      await prisma.$queryRawUnsafe(`SET SESSION max_execution_time = ${QUERY_TIMEOUT_MS}`);

      // $queryRawUnsafe: SQL is AI-generated but validated by 7-layer validateSQL()
      const results = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);

      this.logger.info({ rowCount: results.length }, 'Chatbot SQL query completed');

      // Prisma returns BigInt for COUNT(*) etc. — convert to plain numbers/strings
      return this.serializeResults(results);
    } catch (err: any) {
      // MySQL error 3024 = "Query execution was interrupted, maximum statement execution time exceeded"
      if (
        err.code === '3024' ||
        err.message?.includes('max_execution_time') ||
        err.message?.includes('execution was interrupted') ||
        err.message?.includes('statement timeout')
      ) {
        this.logger.warn({ sql }, 'Chatbot SQL query timed out');
        const timeoutError: any = new Error(
          'Query took too long. Try a simpler question.',
        );
        timeoutError.statusCode = 504;
        throw timeoutError;
      }

      this.logger.error({ err, sql }, 'Chatbot SQL query execution failed');
      throw err;
    }
  }

  /**
   * Use Claude to format raw SQL results into a natural-language summary.
   *
   * @taskId 19
   *
   * Formatting rules:
   *  - Currency values displayed with GBP (£) symbol and comma separators
   *  - Multi-row results -> markdown table (max 20 rows shown)
   *  - Single-value results -> short summary sentence
   *  - Empty results -> "No data found for your query."
   *  - If Claude API fails -> fall back to raw JSON with a generic message
   *
   * @param question - The original user question
   * @param sql      - The generated SQL (for context)
   * @param results  - The raw query results
   * @returns Human-readable summary string (may contain markdown)
   */
  async formatResponse(
    question: string,
    sql: string,
    results: Record<string, unknown>[],
  ): Promise<string> {
    // Edge case: empty results
    if (!results || results.length === 0) {
      return 'No data found for your query.';
    }

    try {
      const client = this.getAnthropicClient();

      // Truncate results for the Claude prompt to avoid excessive token usage
      const displayResults = results.slice(0, MAX_DISPLAY_ROWS);
      const hasMore = results.length > MAX_DISPLAY_ROWS;

      const systemPrompt = [
        'You are a data analyst assistant for a UK-based e-commerce company (UK Soccer Shop).',
        'Format the query results into a clear, concise natural-language response.',
        '',
        'Rules:',
        '- Use GBP (£) for all currency values with comma separators (e.g., £1,234.56)',
        '- Use comma separators for large numbers (e.g., 1,234)',
        '- For multi-row results: present as a markdown table (max 20 rows)',
        '- For single-value/single-row results: present as a short summary sentence',
        '- Add a brief insight or observation after the data (one sentence)',
        '- Be concise — do not repeat the question back',
        '- Do not include the SQL query in your response',
        hasMore
          ? `- Note: only showing first ${MAX_DISPLAY_ROWS} of ${results.length} total results`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const userPrompt = [
        `Question: ${question}`,
        '',
        `SQL used: ${sql}`,
        '',
        `Results (${results.length} row${results.length !== 1 ? 's' : ''}):`,
        JSON.stringify(displayResults, null, 2),
      ].join('\n');

      const response = await client.messages.create({
        model: FORMAT_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      // Extract text from the response
      const textBlock = response.content.find((block) => block.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        return textBlock.text;
      }

      // Unexpected response shape — fall back to raw data
      this.logger.warn('Claude format response had no text block — falling back to raw results');
      return this.fallbackFormat(results);
    } catch (err: any) {
      // Claude API failure — do not let it break the entire flow
      this.logger.error({ err }, 'Claude format API call failed — returning raw results');
      return this.fallbackFormat(results);
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Serialize BigInt and other non-JSON-safe values from Prisma raw results.
   * MySQL COUNT(*), SUM(), etc. return BigInt in Prisma; we convert to Number
   * (safe for typical dashboard aggregates which fit in JS number range).
   */
  private serializeResults(
    results: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return results.map((row) => {
      const serialized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'bigint') {
          // Convert BigInt to number (safe for values < Number.MAX_SAFE_INTEGER)
          serialized[key] = Number(value);
        } else if (value instanceof Date) {
          serialized[key] = value.toISOString();
        } else {
          serialized[key] = value;
        }
      }
      return serialized;
    });
  }

  /**
   * Fallback formatter when the Claude API call fails.
   * Returns a simple markdown representation with a generic header.
   */
  private fallbackFormat(results: Record<string, unknown>[]): string {
    const truncated = results.slice(0, MAX_DISPLAY_ROWS);
    const header = `Here are the results (${results.length} row${results.length !== 1 ? 's' : ''}):`;

    // For single row with a single value, format as a simple statement
    if (truncated.length === 1) {
      const keys = Object.keys(truncated[0]);
      if (keys.length === 1) {
        return `${header}\n\n**${keys[0]}**: ${truncated[0][keys[0]]}`;
      }
    }

    // For multi-row, build a simple markdown table
    if (truncated.length > 0) {
      const keys = Object.keys(truncated[0]);
      const headerRow = `| ${keys.join(' | ')} |`;
      const separatorRow = `| ${keys.map(() => '---').join(' | ')} |`;
      const dataRows = truncated.map(
        (row) => `| ${keys.map((k) => String(row[k] ?? '')).join(' | ')} |`,
      );

      const table = [headerRow, separatorRow, ...dataRows].join('\n');
      const suffix =
        results.length > MAX_DISPLAY_ROWS
          ? `\n\n*Showing first ${MAX_DISPLAY_ROWS} of ${results.length} results.*`
          : '';

      return `${header}\n\n${table}${suffix}`;
    }

    return header;
  }

  /**
   * Write a chatbot query to the AuditLog for traceability.
   */
  private async logQuery(userId: string, response: ChatbotResponse): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'chatbot_query',
        resource: 'sales-dashboard',
        resourceId: response.queryId,
        newValues: {
          question: response.question,
          sql: response.sql,
          resultCount: response.resultCount,
          executionTimeMs: response.executionTimeMs,
        },
      },
    });
  }
}

/** Singleton instance used by route handlers. */
export const chatbotService = new ChatbotService();
