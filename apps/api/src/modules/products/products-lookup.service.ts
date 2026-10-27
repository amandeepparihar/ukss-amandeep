/**
 * New Product Module — Lookup service (read-only queries + transaction-aware resolve functions).
 * Requirements: REQ-6 (lookup data), REQ-1.3 (product code check), REQ-3.4 (barcode check),
 *   REQ-1.4 (team auto-create), REQ-1.5 (season auto-create), REQ-3.5 (box auto-create)
 *
 * All queries verified against live zenc_main_db column names (CLAUDE.md Rule 6).
 */

import { prisma, Prisma } from '../../lib/prisma';
import { createLogger, type Logger } from '../../lib/logger';
import { toBigIntSafe } from '../../lib/utils/bigint';
import { resolveSavedProductImageUrl } from './products-image.service';
import { executeRawWithLogging } from './products-sql-logger';
import type {
  TxClient,
  Team,
  Season,
  ProductTypeRecord,
  SizeOption,
  SizeGroup,
  Size,
  Box,
  ProductCodeData,
  Color,
  SleeveLength,
  Manufacturer,
  TeamCategory,
  Country,
} from './products.types';

const defaultLogger = createLogger('products-lookup-service');

// ---------------------------------------------------------------------------
// Teams (REQ-6.1)
// ---------------------------------------------------------------------------

export async function searchTeams(search?: string): Promise<Team[]> {
  if (search && search.trim().length > 0) {
    const term = `%${search.trim()}%`;
    return toBigIntSafe(await prisma.$queryRaw<Team[]>(
      Prisma.sql`SELECT teams_id, team_name, team_type FROM teams WHERE team_name LIKE ${term} ORDER BY team_name ASC LIMIT 50`
    ));
  }
  return toBigIntSafe(await prisma.$queryRaw<Team[]>(
    Prisma.sql`SELECT teams_id, team_name, team_type FROM teams ORDER BY team_name ASC LIMIT 50`
  ));
}

// ---------------------------------------------------------------------------
// Seasons (REQ-6.2)
// ---------------------------------------------------------------------------

export async function getSeasons(): Promise<Season[]> {
  return toBigIntSafe(await prisma.$queryRaw<Season[]>(
    Prisma.sql`SELECT seasons_id, season FROM seasons ORDER BY seasons_id DESC`
  ));
}

// ---------------------------------------------------------------------------
// Product Types (REQ-6.3)
// ---------------------------------------------------------------------------

export async function getProductTypes(): Promise<ProductTypeRecord[]> {
  return toBigIntSafe(await prisma.$queryRaw<ProductTypeRecord[]>(
    Prisma.sql`SELECT type_id, type_name FROM product_types ORDER BY type_name ASC`
  ));
}

// ---------------------------------------------------------------------------
// Countries (country of origin) — searchable, ascending by name
// ---------------------------------------------------------------------------

export async function getCountries(search?: string): Promise<Country[]> {
  if (search && search.trim().length > 0) {
    const term = `%${search.trim()}%`;
    return toBigIntSafe(await prisma.$queryRaw<Country[]>(
      Prisma.sql`SELECT countries_id, countries_name FROM countries WHERE countries_name LIKE ${term} ORDER BY countries_name ASC LIMIT 50`
    ));
  }
  return toBigIntSafe(await prisma.$queryRaw<Country[]>(
    Prisma.sql`SELECT countries_id, countries_name FROM countries ORDER BY countries_name ASC LIMIT 50`
  ));
}

/**
 * Resolve a country_of_origin_id to { id, name }. Returns nulls when the id is
 * absent or doesn't match a countries row, so we never write a dangling FK.
 * The name is derived here (not trusted from the client) so the stored
 * product_lists.country_of_origin string can never disagree with the id.
 */
export async function resolveCountryOfOrigin(
  tx: TxClient,
  countryOfOriginId: number | null | undefined,
  logger?: Logger,
): Promise<{ id: number | null; name: string | null }> {
  const log = logger || defaultLogger;
  const id = countryOfOriginId ?? null;
  if (id == null) return { id: null, name: null };

  const rows = await tx.$queryRaw<Array<{ countries_id: number; countries_name: string }>>(
    Prisma.sql`SELECT countries_id, countries_name FROM countries WHERE countries_id = ${id} LIMIT 1`,
  );
  if (rows.length === 0) {
    log.warn({ countryOfOriginId: id }, 'Country of origin id not found in countries table');
    return { id: null, name: null };
  }
  return { id: Number(rows[0].countries_id), name: rows[0].countries_name };
}

// ---------------------------------------------------------------------------
// Size Options / Groups / Sizes (REQ-6.5)
// ---------------------------------------------------------------------------

export async function getSizeOptions(): Promise<SizeOption[]> {
  return toBigIntSafe(await prisma.$queryRaw<SizeOption[]>(
    Prisma.sql`SELECT products_options_id, products_options_name FROM products_options WHERE is_size_option = 1 ORDER BY products_options_name ASC`
  ));
}

export async function getSizeGroups(optionId: number): Promise<SizeGroup[]> {
  return toBigIntSafe(await prisma.$queryRaw<SizeGroup[]>(
    Prisma.sql`SELECT sms_size_groups_id, sms_size_groups_name AS size_group_name, products_options_id FROM sms_size_groups WHERE products_options_id = ${optionId} AND status = 1 ORDER BY sms_size_groups_name ASC`
  ));
}

export async function getSizes(groupId: number): Promise<Size[]> {
  // Legacy SMS: product_quantities.size_id stores manufacturers_options_values_id.
  // The display name comes via a pivot table chain (verified from legacy
  // product_quantities_controller.php lines 3355-3373):
  //   msd.manufacturers_options_values_id
  //     → povtpo.products_options_values_to_products_options_id
  //     → povtpo.products_options_values_id
  //     → pov.products_options_values_name
  return toBigIntSafe(await prisma.$queryRaw<Size[]>(
    Prisma.sql`
      SELECT
        msd.manufacturers_options_values_id AS manufacturers_sizes_to_default_sizes_id,
        COALESCE(pov.products_options_values_name, msd.manufacturer_size_shortname) AS manufacturer_size_shortname,
        msd.default_options_values_id
      FROM manufacturers_sizes_to_default_sizes msd
      LEFT JOIN products_options_values_to_products_options povtpo
        ON msd.manufacturers_options_values_id = povtpo.products_options_values_to_products_options_id
      LEFT JOIN products_options_values pov
        ON povtpo.products_options_values_id = pov.products_options_values_id
      WHERE msd.sms_size_groups_id = ${groupId}
      ORDER BY pov.products_options_values_name ASC
    `
  ));
}

// ---------------------------------------------------------------------------
// Size group consistency check
// Mirrors legacy product_quantities_controller.php::get_mapped_sizes_to_size_groups
// (lines 3290–3380): refuse a size group that conflicts with whatever group
// is already attached to this product's existing inventory.
// ---------------------------------------------------------------------------

export interface SizeGroupCheckResult {
  ok: boolean;
  existingGroupId?: number;
  existingGroupName?: string;
  message?: string;
}

export async function checkSizeGroupForProduct(
  productListsId: number,
  sizeGroupId: number,
): Promise<SizeGroupCheckResult> {
  const rows = await prisma.$queryRaw<Array<{
    existing_group_id: number;
    existing_group_name: string;
  }>>(
    Prisma.sql`
      SELECT
        msd.sms_size_groups_id AS existing_group_id,
        ssg.sms_size_groups_name AS existing_group_name
      FROM product_quantities pq
      INNER JOIN manufacturers_sizes_to_default_sizes msd
        ON pq.size_id = msd.manufacturers_options_values_id
      INNER JOIN sms_size_groups ssg
        ON msd.sms_size_groups_id = ssg.sms_size_groups_id
      WHERE pq.product_lists_id = ${productListsId}
      LIMIT 1
    `,
  );

  if (rows.length === 0) return { ok: true };

  const existingGroupId = Number(rows[0].existing_group_id);
  if (existingGroupId === sizeGroupId) return { ok: true };

  const existingGroupName = rows[0].existing_group_name;
  return {
    ok: false,
    existingGroupId,
    existingGroupName,
    message:
      `Sorry! You can not assign another size group to the same product. ` +
      `${existingGroupName} is already assigned to this product code!`,
  };
}

// ---------------------------------------------------------------------------
// Boxes (REQ-6.4)
// ---------------------------------------------------------------------------

export async function searchBoxes(search?: string): Promise<Box[]> {
  if (search && search.trim().length > 0) {
    const term = `%${search.trim()}%`;
    return toBigIntSafe(await prisma.$queryRaw<Box[]>(
      Prisma.sql`SELECT box_lists_id, box_code FROM box_lists WHERE box_code LIKE ${term} ORDER BY box_code ASC LIMIT 50`
    ));
  }
  return toBigIntSafe(await prisma.$queryRaw<Box[]>(
    Prisma.sql`SELECT box_lists_id, box_code FROM box_lists ORDER BY box_lists_id DESC LIMIT 50`
  ));
}

// ---------------------------------------------------------------------------
// Product code check (REQ-1.3)
// ---------------------------------------------------------------------------

// Raw row shape for the check-code SELECT, before we parse/resolve the
// saved-detail columns into the public ProductCodeData shape.
interface ProductCodeRawRow {
  product_lists_id: number;
  product_code: string;
  product_name: string;
  teams_id: number;
  team_name: string;
  seasons_id: number;
  season: string;
  price: number;
  product_type: number | null;
  manufacturers_id: number | null;
  manufacturer_name: string | null;
  front_image_url: string | null;
  back_image_url: string | null;
  additional_image_url: string | null;
  map_status: number;
  products_code_type: number;
  description_notes: string | null;
  products_attributes: string | null;
  product_code_image: string | null;
  product_code_additional_img: string | null;
  allows_personalisation: number | null;
  country_of_origin_id: number | null;
  country_of_origin: string | null;
  hs_code: string | null;
}

export async function checkProductCode(code: string): Promise<{ exists: boolean; product?: ProductCodeData }> {
  const rows = await prisma.$queryRaw<ProductCodeRawRow[]>(
    Prisma.sql`
      SELECT
        pl.product_lists_id,
        pl.product_code,
        pl.product_name,
        pl.teams_id,
        t.team_name,
        pl.seasons_id,
        s.season,
        pl.price,
        pl.product_type,
        pl.manufacturers_id,
        m.manufacturers_name AS manufacturer_name,
        pl.front_image_url,
        pl.back_image_url,
        pl.additional_image_url,
        pl.map_status,
        pl.products_code_type,
        pl.description_notes,
        pl.products_attributes,
        pl.product_code_image,
        pl.product_code_additional_img,
        pl.product_code_back_img,
        pl.allows_personalisation,
        pl.country_of_origin_id,
        pl.country_of_origin,
        pl.hs_code
      FROM product_lists pl
      LEFT JOIN teams t ON pl.teams_id = t.teams_id
      LEFT JOIN seasons s ON pl.seasons_id = s.seasons_id
      LEFT JOIN manufacturers m ON pl.manufacturers_id = m.manufacturers_id
      WHERE pl.product_code = ${code}
      LIMIT 1
    `
  );

  if (rows.length === 0) {
    return { exists: false };
  }

  const safeRows = toBigIntSafe(rows);
  const raw = safeRows[0];

  // Parse the JSON attributes column. A non-JSON or NULL value yields {} so
  // the wizard can render the section without conditional emptiness checks.
  let attributes: Record<string, string> = {};
  if (raw.products_attributes) {
    try {
      const parsed = JSON.parse(raw.products_attributes);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        attributes = Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [k, typeof v === 'string' ? v : String(v ?? '')]),
        );
      }
    } catch {
      // legacy rows occasionally contain malformed JSON; fall through to {}
    }
  }

  const additionalFilenames = (raw.product_code_additional_img ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const savedAdditional = additionalFilenames
    .map((f) => resolveSavedProductImageUrl(f, false))
    .filter((u): u is string => u !== null);

  const product: ProductCodeData = {
    product_lists_id: raw.product_lists_id,
    product_code: raw.product_code,
    product_name: raw.product_name,
    teams_id: raw.teams_id,
    team_name: raw.team_name,
    seasons_id: raw.seasons_id,
    season: raw.season,
    price: raw.price,
    product_type: raw.product_type,
    manufacturers_id: raw.manufacturers_id,
    manufacturer_name: raw.manufacturer_name,
    front_image_url: raw.front_image_url,
    back_image_url: raw.back_image_url,
    additional_image_url: raw.additional_image_url,
    map_status: raw.map_status,
    products_code_type: raw.products_code_type,
    description_notes: raw.description_notes,
    products_attributes: attributes,
    saved_primary_image_url: resolveSavedProductImageUrl(raw.product_code_image, true),
    saved_additional_image_urls: savedAdditional,
    saved_back_image_url: resolveSavedProductImageUrl(raw.product_code_back_img, false),
    // TINYINT(1) → boolean. Treat NULL/0 as false.
    allows_personalisation: Number(raw.allows_personalisation ?? 0) === 1,
    country_of_origin_id: raw.country_of_origin_id ?? null,
    country_of_origin: raw.country_of_origin ?? null,
    hs_code: raw.hs_code ?? null,
  };

  return { exists: true, product };
}

// ---------------------------------------------------------------------------
// Barcode check (REQ-3.4)
// ---------------------------------------------------------------------------

export async function checkBarcode(barcode: string): Promise<{
  exists: boolean;
  productListsId?: number;
  productCode?: string;
}> {
  const rows = await prisma.$queryRaw<Array<{ product_lists_id: number; product_code: string }>>(
    Prisma.sql`
      SELECT pq.product_lists_id, pl.product_code
      FROM product_quantities pq
      JOIN product_lists pl ON pq.product_lists_id = pl.product_lists_id
      WHERE pq.barcode = ${barcode}
      LIMIT 1
    `
  );

  if (rows.length === 0) {
    return { exists: false };
  }
  const safe = toBigIntSafe(rows);
  return {
    exists: true,
    productListsId: Number(safe[0].product_lists_id),
    productCode: safe[0].product_code,
  };
}

// ---------------------------------------------------------------------------
// Attribute lookups for AI Description panel
// Note: These tables only exist in the production MySQL database (zenc_main_db).
// In development with PostgreSQL, these queries will return empty arrays.
// ---------------------------------------------------------------------------

/**
 * Get primary colors from product_extra_info_type_options.
 * id = 3 corresponds to "Color" extra info type.
 * oid is the option identifier, id is the type identifier.
 */
export async function getColors(): Promise<Color[]> {
  try {
    return toBigIntSafe(await prisma.$queryRaw<Color[]>(
      Prisma.sql`
        SELECT
          oid AS attribute_id,
          option_name AS attribute_name
        FROM product_extra_info_type_options
        WHERE id = 3
          AND status = 1
        ORDER BY option_name ASC
      `
    ));
  } catch (error) {
    defaultLogger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch colors - table may not exist');
    return [];
  }
}

/**
 * Get sleeve length options from product_extra_info_type_options.
 * id = 2 corresponds to "Sleeve Length" extra info type.
 * oid is the option identifier, id is the type identifier.
 */
export async function getSleeveLengths(): Promise<SleeveLength[]> {
  try {
    return toBigIntSafe(await prisma.$queryRaw<SleeveLength[]>(
      Prisma.sql`
        SELECT
          oid AS option_id,
          option_name
        FROM product_extra_info_type_options
        WHERE id = 2
          AND status = 1
        ORDER BY option_name ASC
      `
    ));
  } catch (error) {
    defaultLogger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch sleeve lengths - table may not exist');
    return [];
  }
}

/**
 * Get all manufacturers.
 */
export async function getManufacturers(): Promise<Manufacturer[]> {
  try {
    return toBigIntSafe(await prisma.$queryRaw<Manufacturer[]>(
      Prisma.sql`
        SELECT manufacturers_id, manufacturers_name
        FROM manufacturers
        WHERE manufacturers_name IS NOT NULL AND TRIM(manufacturers_name) <> ''
        ORDER BY manufacturers_name ASC
      `
    ));
  } catch (error) {
    defaultLogger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch manufacturers - table may not exist');
    return [];
  }
}

/**
 * Resolve a manufacturer name to its manufacturers_id. Returns null when the
 * name is empty or doesn't match a row — manufacturers is a curated lookup
 * (used by Allegro brand/GPSR mapping, daily-deals filter, etc.), so we never
 * auto-create from a free-text combobox value.
 */
export async function resolveManufacturerId(
  tx: TxClient,
  manufacturerName: string | null | undefined,
  logger?: Logger,
): Promise<number | null> {
  const log = logger || defaultLogger;
  const name = (manufacturerName ?? '').trim();
  if (!name) return null;

  const rows = await tx.$queryRaw<Array<{ manufacturers_id: number }>>(
    Prisma.sql`SELECT manufacturers_id FROM manufacturers WHERE manufacturers_name = ${name} LIMIT 1`,
  );
  if (rows.length === 0) {
    log.warn({ manufacturerName: name }, 'Manufacturer name not found in manufacturers table');
    return null;
  }
  return Number(rows[0].manufacturers_id);
}

/**
 * Get distinct gender values from new_products.np_gender.
 * Source-of-truth for the Dify Typesense workflow's allowed-value list (np_gender facet).
 */
export async function getGenders(): Promise<{ id: string; name: string }[]> {
  try {
    const rows = await prisma.$queryRaw<{ name: string }[]>(
      Prisma.sql`
        SELECT DISTINCT np_gender AS name
        FROM new_products
        WHERE np_gender IS NOT NULL AND np_gender <> ''
        ORDER BY np_gender ASC
      `
    );
    return rows.map((r) => ({ id: r.name, name: r.name }));
  } catch (error) {
    defaultLogger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch genders - table may not exist');
    return [];
  }
}

/**
 * Get distinct age-group values from new_products.np_agegroup.
 * Source-of-truth for the Dify Typesense workflow's allowed-value list (np_agegroup facet).
 */
export async function getAgeGroups(): Promise<{ id: string; name: string }[]> {
  try {
    const rows = await prisma.$queryRaw<{ name: string }[]>(
      Prisma.sql`
        SELECT DISTINCT np_agegroup AS name
        FROM new_products
        WHERE np_agegroup IS NOT NULL AND np_agegroup <> ''
        ORDER BY np_agegroup ASC
      `
    );
    return rows.map((r) => ({ id: r.name, name: r.name }));
  } catch (error) {
    defaultLogger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch age groups - table may not exist');
    return [];
  }
}

/**
 * Get distinct size-guide values from new_products.np_sizeguide.
 * Source-of-truth for the Dify Typesense workflow's allowed-value list (np_sizeguide facet).
 */
export async function getSizeGuides(): Promise<{ id: string; name: string }[]> {
  try {
    const rows = await prisma.$queryRaw<{ name: string }[]>(
      Prisma.sql`
        SELECT DISTINCT np_sizeguide AS name
        FROM new_products
        WHERE np_sizeguide IS NOT NULL AND np_sizeguide <> ''
        ORDER BY np_sizeguide ASC
      `
    );
    return rows.map((r) => ({ id: r.name, name: r.name }));
  } catch (error) {
    defaultLogger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch size guides - table may not exist');
    return [];
  }
}

/**
 * Search team categories from categories table.
 * Filters by team_category = 1 to get only team-related categories.
 * Supports search parameter for dynamic filtering (required for 1000+ categories).
 */
export async function searchTeamCategories(search?: string): Promise<TeamCategory[]> {
  try {
    defaultLogger.debug({ search }, 'searchTeamCategories called');
    if (search && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      const results = toBigIntSafe(await prisma.$queryRaw<TeamCategory[]>(
        Prisma.sql`
          SELECT
            c.categories_id AS team_categories_id,
            cd.categories_name AS category_name
          FROM categories c
          LEFT JOIN categories_description cd
            ON c.categories_id = cd.categories_id
          WHERE c.team_category = 1
            AND cd.language_id = 1
            AND cd.categories_name LIKE ${term}
          ORDER BY cd.categories_name ASC
          LIMIT 50
        `
      ));
      defaultLogger.debug({ search, resultCount: results.length }, 'searchTeamCategories results');
      return results;
    }
    // Without search, return first 50 alphabetically
    return toBigIntSafe(await prisma.$queryRaw<TeamCategory[]>(
      Prisma.sql`
        SELECT
          c.categories_id AS team_categories_id,
          cd.categories_name AS category_name
        FROM categories c
        LEFT JOIN categories_description cd
          ON c.categories_id = cd.categories_id
        WHERE c.team_category = 1
          AND cd.language_id = 1
        ORDER BY cd.categories_name ASC
        LIMIT 50
      `
    ));
  } catch (error) {
    defaultLogger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch team categories - table may not exist');
    return [];
  }
}

// ===========================================================================
// Transaction-aware lookup-or-create functions (REQ-1.4, REQ-1.5, REQ-3.5)
// ===========================================================================

/**
 * Resolve a team name to its ID, creating the team if it doesn't exist (REQ-1.4).
 * Must be called within a transaction to ensure atomicity.
 */
export async function resolveTeamId(tx: TxClient, teamName: string, logger?: Logger): Promise<number> {
  const log = logger || defaultLogger;

  const rows = await tx.$queryRaw<Array<{ teams_id: number }>>(
    Prisma.sql`SELECT teams_id FROM teams WHERE team_name = ${teamName} LIMIT 1`
  );

  if (rows.length > 0) {
    const teamsId = Number(rows[0].teams_id);
    log.debug({ teamName, teamsId, isExisting: true }, 'Team found');
    return teamsId;
  }

  // Auto-create with team_type='Clothing' (most common default)
  await executeRawWithLogging(
    tx,
    Prisma.sql`INSERT INTO teams (team_name, sort, created, team_type) VALUES (${teamName}, 0, NOW(), 'Clothing')`,
    log,
    {
      table: 'teams',
      operation: 'INSERT',
      extra: { columnCount: 4, columns: ['team_name', 'sort', 'created', 'team_type'] },
      values: { team_name: teamName, sort: 0, created: 'NOW()', team_type: 'Clothing' },
    },
  );

  const idRows = await tx.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`SELECT LAST_INSERT_ID() AS id`
  );
  const newTeamsId = Number(idRows[0].id);
  log.info({ teamName, teamsId: newTeamsId, isNew: true }, 'New team created');
  return newTeamsId;
}

/**
 * Resolve a season string to its ID, creating the season if it doesn't exist (REQ-1.5).
 * Must be called within a transaction to ensure atomicity.
 */
export async function resolveSeasonId(tx: TxClient, season: string, logger?: Logger): Promise<number> {
  const log = logger || defaultLogger;

  const rows = await tx.$queryRaw<Array<{ seasons_id: number }>>(
    Prisma.sql`SELECT seasons_id FROM seasons WHERE season = ${season} LIMIT 1`
  );

  if (rows.length > 0) {
    const seasonsId = Number(rows[0].seasons_id);
    log.debug({ season, seasonsId, isExisting: true }, 'Season found');
    return seasonsId;
  }

  await executeRawWithLogging(
    tx,
    Prisma.sql`INSERT INTO seasons (season, tesco_seasons, rueducommerce_season, sort, created) VALUES (${season}, '', '', 0, NOW())`,
    log,
    {
      table: 'seasons',
      operation: 'INSERT',
      extra: { columnCount: 5, columns: ['season', 'tesco_seasons', 'rueducommerce_season', 'sort', 'created'] },
      values: {
        season,
        tesco_seasons: '',
        rueducommerce_season: '',
        sort: 0,
        created: 'NOW()',
      },
    },
  );

  const idRows = await tx.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`SELECT LAST_INSERT_ID() AS id`
  );
  const newSeasonsId = Number(idRows[0].id);
  log.info({ season, seasonsId: newSeasonsId, isNew: true }, 'New season created');
  return newSeasonsId;
}

/**
 * Resolve a box code to its ID, creating the box if it doesn't exist (REQ-3.5).
 * Must be called within a transaction to ensure atomicity.
 */
export async function resolveBoxId(tx: TxClient, boxCode: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ box_lists_id: number }>>(
    Prisma.sql`SELECT box_lists_id FROM box_lists WHERE box_code = ${boxCode} LIMIT 1`
  );

  if (rows.length > 0) {
    return Number(rows[0].box_lists_id);
  }

  await tx.$executeRaw(
    Prisma.sql`INSERT INTO box_lists (box_code, created) VALUES (${boxCode}, NOW())`
  );

  const idRows = await tx.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`SELECT LAST_INSERT_ID() AS id`
  );
  return Number(idRows[0].id);
}
