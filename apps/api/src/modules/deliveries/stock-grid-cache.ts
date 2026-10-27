/**
 * stock_home_grid_lists cache contract — shared helpers.
 *
 * Background (see documentation/deliveries-write-path-plan.md §3):
 *
 * `stock_home_grid_lists` is a denormalised cache. Legacy SMS keeps it in sync
 * via two distinct paths:
 *
 *   1. Targeted column UPDATEs — patches one or two columns on rows already
 *      present in the cache (e.g. `map='Mapped'` on link, `option_<N>` + sum
 *      on quantity edit, `season` on season edit). Used for every write
 *      where the column values can be computed without re-deriving the full
 *      size matrix.
 *
 *   2. Delete + rebuild via the legacy `grid_file/updategridlist` endpoint —
 *      used when a column write would invalidate the size matrix or require
 *      joining across `product_quantities`, `manufacturers_sizes_to_default_sizes`,
 *      `sms_size_groups`, etc. (The price branch of inline edits is the only
 *      grid-driven inline edit that triggers this path; everything else
 *      patches in place.)
 *
 * Audited in `app/controllers/app_controller.php:1799-2044` (`addStockGridList`)
 * and `app/controllers/grid_file_controller.php:395` (`updategridlist`). The
 * legacy cron `index/updateStockGridListTable` (every 30 min, 15-min settling
 * window) acts as a safety net: rows with `product_lists.pl_stock_grid_delete_time
 * != '0000-00-00 00:00:00'` get rebuilt automatically. We therefore rely on
 * best-effort invocation here — if the POST fails, the legacy cron heals the
 * grid in the worst case.
 *
 * Both helpers MUST be reused by every write-path module that mutates rows
 * surfaced through the grid (deliveries inline edits, link/unlink quantity,
 * remap size, add-sms-product form Flow B, etc.).
 */

import { Prisma, prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { getLogger } from '../../lib/logger-context';
import { config } from '../../config';

const logger = createLogger('deliveries.stock-grid-cache');

const REBUILD_ENDPOINT_PATH = '/grid_file/updategridlist';
const ZERO_DATETIME = '0000-00-00 00:00:00';

/**
 * Columns we ever write to `stock_home_grid_lists` directly. Keeping this list
 * narrow forces every new direct-write call site to come back here so reviewers
 * can verify the legacy parity (each entry maps to one or more legacy call sites).
 */
export type DirectWritableColumn =
  | 'map'                            // legacy: add_sms_products L4140, categories L589 etc., link_quantities L4523
  | 'quantity_map'                   // legacy: categories L589 etc., link_quantities L4523
  | 'season'                         // legacy: product_quantities L2538 (season inline edit)
  | 'product_name'                   // legacy: product_lists_controller L4317
  | 'price'                          // legacy: product_lists_controller L4325
  | 'product_code_image'             // legacy: add_new_products add_images L892
  | 'product_code_additional_img'    // legacy: add_new_products add_images L892
  | 'description_notes'              // legacy: add_new_products add_images L892
  // NOTE: `added_product_code_image` was previously listed here but it
  // does NOT exist on stock_home_grid_lists. The flag lives only on
  // product_lists and the grid reads it via the LEFT JOIN in
  // deliveries.query-builder.ts. Do not add it back — writes would fail
  // with "Unknown column" (verified against zenc_main_db).
  | 'assign_font'                    // legacy: app_controller setGridFontAssigned L2074
  | 'modified'                       // legacy: product_quantity model L165
  | 'last_sale_date'                 // legacy: product_quantity model L165, app_controller setGridlastsaledate L2134
  | 'special'                        // legacy: app_controller setGridSpecial L2116
  | 'special_price'                  // legacy: app_controller setGridSpecial L2116
  | 'special_start_date'             // legacy: app_controller setGridSpecial L2116
  | 'special_expiry_date'            // legacy: app_controller setGridSpecial L2116
  | 'percentage_sold';               // legacy: app_controller L1785

/**
 * Identifier predicates the cache supports. Each maps to a single legacy
 * WHERE clause shape — we whitelist them rather than accepting arbitrary
 * WHERE input so SQL injection surface stays minimal.
 */
export type CacheWhere =
  | { byProductCode: string }
  | { byProductListsId: number | number[] }
  | { byProductListsIdAndBoxcode: { productListsId: number; boxcode: string } };

export interface DirectUpdateInput {
  /** Columns to set. Values become parameter binds — never inlined. */
  set: Partial<Record<DirectWritableColumn, string | number | null>>;
  where: CacheWhere;
  /** Free-form description used only for logging; mirrors legacy caller tags. */
  callerTag: string;
}

/**
 * Patch one or more columns on existing `stock_home_grid_lists` rows.
 *
 * Returns the number of rows affected. Does NOT enqueue a rebuild — use
 * `requestGridRebuild` for that. Callers should pick one or the other based
 * on the legacy behaviour for the equivalent write.
 *
 * Implementation detail: we use `$executeRawUnsafe` (with bind parameters)
 * rather than Prisma's typed `update` because `stock_home_grid_lists` is not
 * in our Prisma schema — it's owned by the legacy app.
 *
 * Transaction contract: pass the surrounding `$transaction` client as `client`
 * whenever this patch must be atomic with the source-table writes. If it runs
 * on the module-level `prisma` (the default) from inside a `$transaction`, the
 * UPDATE commits on a SEPARATE connection immediately — so a later rollback of
 * the source writes would leave the cache showing a value the source tables
 * never committed. Every in-transaction caller MUST thread its `tx` here.
 */
export async function directUpdateGridRow(
  input: DirectUpdateInput,
  client: Prisma.TransactionClient = prisma
): Promise<number> {
  const columns = Object.keys(input.set) as DirectWritableColumn[];
  if (columns.length === 0) {
    throw new Error('directUpdateGridRow: set is empty');
  }
  const setSql = columns.map((c) => `${c} = ?`).join(', ');
  const setParams: unknown[] = columns.map((c) => input.set[c] ?? null);

  const where = input.where;
  let whereSql: string;
  const whereParams: unknown[] = [];

  if ('byProductCode' in where) {
    whereSql = 'product_code = ?';
    whereParams.push(where.byProductCode);
  } else if ('byProductListsId' in where) {
    const ids = Array.isArray(where.byProductListsId)
      ? where.byProductListsId
      : [where.byProductListsId];
    if (ids.length === 0) return 0;
    whereSql = `product_lists_id IN (${ids.map(() => '?').join(',')})`;
    whereParams.push(...ids);
  } else {
    whereSql = 'product_lists_id = ? AND boxcode = ?';
    whereParams.push(where.byProductListsIdAndBoxcode.productListsId);
    whereParams.push(where.byProductListsIdAndBoxcode.boxcode);
  }

  const sql = `UPDATE stock_home_grid_lists SET ${setSql} WHERE ${whereSql}`;
  const affected = await client.$executeRawUnsafe(sql, ...setParams, ...whereParams);

  logger.debug(
    { affected, columns, where, callerTag: input.callerTag },
    'directUpdateGridRow'
  );
  return Number(affected);
}

/**
 * Delete + rebuild path. Mirrors `AppController::addStockGridList`:
 *
 *   1. Stamp `product_lists.pl_stock_grid_delete_time = NOW()` for the affected
 *      ids (sentinel: "rebuild in progress" — the legacy cron picks it up if
 *      we never clear it).
 *   2. DELETE the cache rows.
 *   3. POST to `LEGACY_SMS_BASE_URL/grid_file/updategridlist` with form-encoded
 *      `product_lists_ids=<csv>` + `merge_box=<callerTag>`. The legacy receiver
 *      re-INSERTs the rows and clears the sentinel per id.
 *
 * ⚠️ DANGER — read before adding a new caller. ⚠️
 *
 * The DELETE in step 2 runs UNCONDITIONALLY. If the POST in step 3 fails
 * (legacy down, 403, network), every stock_home_grid_lists row for the given
 * product_lists_id is gone until the legacy cron heals — that's a 15-30
 * minute window of missing rows in the deliveries grid. We saw this in
 * production: editing JZ5773 wiped 4 cache rows.
 *
 * For inline edits (price / quantity / season etc.) prefer
 * `directUpdateGridRow` to patch the affected columns in place. Use this
 * function ONLY when a delete-and-rebuild is genuinely required (e.g. map /
 * remap flows where the size matrix is rederived from scratch), and only
 * after confirming the rebuild endpoint is reachable from this host.
 *
 * Failure modes are deliberately tolerant: if the POST 5xx's or times out we
 * log + return — the legacy cron will rebuild the row within ~15-30 minutes.
 *
 * NOTE: This function does NOT propagate session cookies. The legacy receiver
 * is whitelisted from auth (`AppController::beforeFilter` line 45) so no cookie
 * is required. If that ever changes, this function will need to be updated.
 */
export async function requestGridRebuild(
  productListIds: number[],
  callerTag: string,
  options: { timeoutMs?: number } = {}
): Promise<{ ok: boolean; affectedRows: number }> {
  const logger = getLogger();
  const uniqueIds = Array.from(new Set(productListIds)).filter((n) => Number.isFinite(n) && n > 0);
  if (uniqueIds.length === 0) {
    logger.debug({ callerTag }, 'requestGridRebuild: no ids — no-op');
    return { ok: true, affectedRows: 0 };
  }

  // Step 1: stamp the sentinel BEFORE deleting so the cron can recover if step 3 fails.
  const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await prisma.$executeRawUnsafe(
    `UPDATE product_lists SET pl_stock_grid_delete_time = ? WHERE product_lists_id IN (${uniqueIds.map(() => '?').join(',')})`,
    nowIso,
    ...uniqueIds
  );

  // Step 2: delete cache rows.
  const deleted = await prisma.$executeRawUnsafe(
    `DELETE FROM stock_home_grid_lists WHERE product_lists_id IN (${uniqueIds.map(() => '?').join(',')})`,
    ...uniqueIds
  );

  // Step 3: POST to the legacy rebuild endpoint. Best effort.
  const url = `${config.LEGACY_SMS_BASE_URL.replace(/\/$/, '')}${REBUILD_ENDPOINT_PATH}`;
  const body = new URLSearchParams({
    product_lists_ids: uniqueIds.join(','),
    merge_box: callerTag,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      body,
      signal: controller.signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const text = await res.text();
    const durationMs = Date.now() - startedAt;
    const forbidden = text.includes('<title>403 Forbidden</title>');
    logger.debug({ url, status: res.status, forbidden, durationMs, callerTag, ids: uniqueIds, responseBody: text.slice(0, 1000) }, 'requestGridRebuild response');
    if (!res.ok || forbidden) {
      logger.warn(
        { url, status: res.status, forbidden, callerTag, ids: uniqueIds },
        'grid rebuild endpoint returned non-OK — legacy cron will retry within 30 min'
      );
      return { ok: false, affectedRows: Number(deleted) };
    }
    logger.debug({ ids: uniqueIds, callerTag, deleted: Number(deleted) }, 'requestGridRebuild ok');
    return { ok: true, affectedRows: Number(deleted) };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, callerTag, ids: uniqueIds },
      'grid rebuild POST failed — legacy cron will retry within 30 min'
    );
    return { ok: false, affectedRows: Number(deleted) };
  } finally {
    clearTimeout(timer);
  }
}

/** Helper for legacy parity logging — `0000-00-00 00:00:00` clear sentinel. */
export const PL_STOCK_GRID_DELETE_TIME_CLEAR = ZERO_DATETIME;
