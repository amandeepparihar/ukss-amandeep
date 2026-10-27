/**
 * New Product Module — Duplicate detection service.
 *
 * Context: Robert's Brazil-kids-shirt case. The wizard's only pre-existing
 * duplicate guards were exact product_code and exact barcode matches, so an
 * item re-listed under a NEW code slipped through and created a duplicate.
 *
 * This service adds two-tier detection, run before Save:
 *   Tier 1 — structured: match on the required key team + season + product type,
 *            scored up by shared colour / age group / gender. Deterministic,
 *            MySQL-only. Labels each hit active / archived / unmapped via the
 *            products.products_model mapping gate.
 *   Tier 2 — fuzzy: typo-tolerant title/description match via Typesense
 *            (searchProducts), merged in and de-duped by product_code.
 *
 * All column names verified against live zenc_main_db (CLAUDE.md Rule 6):
 *   product_lists(teams_id, seasons_id, product_type, product_code, product_name,
 *   products_attributes, front_image_url), products(products_model, products_status),
 *   teams(teams_id, team_name), seasons(seasons_id, season),
 *   product_types(type_id, type_name).
 */

import { prisma, Prisma } from '../../lib/prisma';
import { createLogger, type Logger } from '../../lib/logger';
import { toBigIntSafe } from '../../lib/utils/bigint';
import { searchProducts } from '../../lib/typesense';
import { mergeFuzzy } from './products-duplicates.helpers';
import type {
  CheckDuplicatesInput,
  CheckDuplicatesResult,
  DuplicateCandidate,
  DuplicateStatus,
} from './products.types';

const defaultLogger = createLogger('products-duplicates-service');

// Cap the structured scan. Popular team+season+type triples can have thousands
// of rows; we rank the most-recent slice by attribute overlap and return the
// top few. Recent-first because a freshly re-listed item (the duplicate risk)
// is almost always near the top.
const STRUCTURED_SCAN_LIMIT = 500;
const MAX_CANDIDATES = 15;

// Scoring weights. Colour and age group are Robert's named "key attributes",
// so they carry the most weight and gate the strong/weak classification.
const WEIGHT_COLOR = 40;
const WEIGHT_AGE_GROUP = 40;
const WEIGHT_GENDER = 10;

// Exclude hero shirts — the player-name / "Your Name" variants auto-generated
// from a parent product (e.g. "…(BACCA 7)", "…(J LERMA 16)"). They are not
// distinct products a user could be duplicating. Two markers are needed:
//   - product_lists.parent_product_lists_id > 0 catches variants even when they
//     have no products row (unmapped/archived), which the flag below misses.
//   - products.hero_shirts = 1 catches the ~44 hero rows whose parent id is 0.
// EXISTS (not a JOIN) so a code with multiple products rows can't multiply COUNT.
const HERO_SHIRT_EXCLUSION = Prisma.sql`
  AND COALESCE(pl.parent_product_lists_id, 0) = 0
  AND NOT EXISTS (
    SELECT 1 FROM products hp
    WHERE hp.products_model = pl.product_code AND hp.hero_shirts = 1
  )`;

/** Normalise a free-text attribute for case/space-insensitive comparison. */
function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

interface StructuredRow {
  product_lists_id: number;
  product_code: string;
  product_name: string | null;
  team_name: string | null;
  season: string | null;
  product_type_name: string | null;
  products_attributes: string | null;
  front_image_url: string | null;
  products_status: number | null;
  has_products_row: number;
}

/** Parse the products_attributes JSON blob defensively (legacy rows can hold
 *  malformed JSON). Returns a lowercased-key lookup for the fields we score. */
function parseAttrs(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    /* fall through */
  }
  return {};
}

function deriveStatus(row: StructuredRow): DuplicateStatus {
  if (!row.has_products_row) return 'unmapped';
  return Number(row.products_status) === 1 ? 'active' : 'archived';
}

/**
 * Resolve a team name + season string to their ids WITHOUT creating them
 * (read-only — unlike resolveTeamId/resolveSeasonId which auto-create in the
 * save path). Returns null for either when it doesn't exist yet, in which case
 * the structured tier has nothing to match and only fuzzy matching runs.
 */
async function resolveKeyIds(
  teamName: string,
  season: string,
): Promise<{ teamsId: number | null; seasonsId: number | null }> {
  const [teamRows, seasonRows] = await Promise.all([
    teamName.trim()
      ? prisma.$queryRaw<Array<{ teams_id: number }>>(
          Prisma.sql`SELECT teams_id FROM teams WHERE team_name = ${teamName.trim()} LIMIT 1`,
        )
      : Promise.resolve([]),
    season.trim()
      ? prisma.$queryRaw<Array<{ seasons_id: number }>>(
          Prisma.sql`SELECT seasons_id FROM seasons WHERE season = ${season.trim()} LIMIT 1`,
        )
      : Promise.resolve([]),
  ]);
  return {
    teamsId: teamRows.length ? Number(teamRows[0].teams_id) : null,
    seasonsId: seasonRows.length ? Number(seasonRows[0].seasons_id) : null,
  };
}

/**
 * Tier 1 — structured match on team + season + product type, scored by shared
 * attributes. Returns candidates keyed by product_code plus the total count of
 * matches on the key (which may exceed the returned slice).
 */
async function structuredMatches(
  input: CheckDuplicatesInput,
  log: Logger,
): Promise<{ candidates: DuplicateCandidate[]; total: number }> {
  const { teamsId, seasonsId } = await resolveKeyIds(input.teamName, input.season);

  // Both team and season must resolve for a meaningful structured match — the
  // key is team+season+type. A brand-new team or season can't have duplicates.
  if (teamsId === null || seasonsId === null) {
    log.debug({ teamsId, seasonsId }, 'Structured tier skipped — team/season not yet in DB');
    return { candidates: [], total: 0 };
  }

  const excludeCode = input.excludeProductCode?.trim() ?? '';

  const totalRows = await prisma.$queryRaw<Array<{ total: bigint }>>(
    Prisma.sql`
      SELECT COUNT(*) AS total
      FROM product_lists pl
      WHERE pl.teams_id = ${teamsId}
        AND pl.seasons_id = ${seasonsId}
        AND pl.product_type = ${input.productTypeId}
        AND pl.product_code <> ${excludeCode}
        ${HERO_SHIRT_EXCLUSION}
    `,
  );
  const total = Number(totalRows[0]?.total ?? 0);
  if (total === 0) return { candidates: [], total: 0 };

  const rows = toBigIntSafe(
    await prisma.$queryRaw<StructuredRow[]>(
      Prisma.sql`
        SELECT
          pl.product_lists_id,
          pl.product_code,
          pl.product_name,
          t.team_name,
          s.season,
          pt.type_name AS product_type_name,
          pl.products_attributes,
          pl.front_image_url,
          p.products_status,
          (p.products_id IS NOT NULL) AS has_products_row
        FROM product_lists pl
        LEFT JOIN teams t ON pl.teams_id = t.teams_id
        LEFT JOIN seasons s ON pl.seasons_id = s.seasons_id
        LEFT JOIN product_types pt ON pl.product_type = pt.type_id
        LEFT JOIN products p ON p.products_model = pl.product_code
        WHERE pl.teams_id = ${teamsId}
          AND pl.seasons_id = ${seasonsId}
          AND pl.product_type = ${input.productTypeId}
          AND pl.product_code <> ${excludeCode}
          ${HERO_SHIRT_EXCLUSION}
        ORDER BY pl.product_lists_id DESC
        LIMIT ${STRUCTURED_SCAN_LIMIT}
      `,
    ),
  );

  const wantColor = norm(input.color);
  const wantAge = norm(input.ageGroup);
  const wantGender = norm(input.gender);

  const candidates: DuplicateCandidate[] = rows.map((row) => {
    const attrs = parseAttrs(row.products_attributes);
    const rowColor = attrs.color ?? null;
    const rowAge = attrs.age_group ?? null;
    const rowGender = attrs.gender ?? null;

    const matchedFields = ['Team', 'Season', 'Type'];
    let score = 30; // base for the required key match

    const colorMatch = !!wantColor && norm(rowColor) === wantColor;
    const ageMatch = !!wantAge && norm(rowAge) === wantAge;
    const genderMatch = !!wantGender && norm(rowGender) === wantGender;

    if (colorMatch) {
      score += WEIGHT_COLOR;
      matchedFields.push('Colour');
    }
    if (ageMatch) {
      score += WEIGHT_AGE_GROUP;
      matchedFields.push('Age group');
    }
    if (genderMatch) {
      score += WEIGHT_GENDER;
      matchedFields.push('Gender');
    }

    // Strong = shares one of Robert's key attributes (colour or age group).
    const strength: 'strong' | 'weak' = colorMatch || ageMatch ? 'strong' : 'weak';

    return {
      productListsId: Number(row.product_lists_id),
      productCode: row.product_code,
      productName: row.product_name,
      teamName: row.team_name,
      season: row.season,
      productTypeName: row.product_type_name,
      ageGroup: rowAge,
      color: rowColor,
      status: deriveStatus(row),
      frontImageUrl: row.front_image_url,
      matchScore: Math.min(score, 100),
      strength,
      matchSource: 'structured',
      matchedFields,
    };
  });

  return { candidates, total };
}

/**
 * Public entry — run both tiers and return a ranked, capped candidate list.
 * Never throws on the fuzzy tier: a Typesense outage degrades to structured-only.
 */
export async function checkDuplicates(
  input: CheckDuplicatesInput,
  logger?: Logger,
): Promise<CheckDuplicatesResult> {
  const log = logger || defaultLogger;

  const [structured, fuzzy] = await Promise.all([
    structuredMatches(input, log),
    searchProducts(input, log).catch((err) => {
      log.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'Fuzzy (Typesense) duplicate tier failed — degrading to structured-only',
      );
      return [] as DuplicateCandidate[];
    }),
  ]);

  const merged = mergeFuzzy(structured.candidates, fuzzy)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, MAX_CANDIDATES);

  const requiresAcknowledgement = merged.some((c) => c.strength === 'strong');

  // total reflects the structured key count plus any fuzzy-only hits, so the
  // UI's "N possible duplicates" is never smaller than what it lists.
  const fuzzyOnly = merged.filter((c) => c.matchSource === 'fuzzy').length;
  const total = structured.total + fuzzyOnly;

  log.info(
    {
      structuredTotal: structured.total,
      fuzzyHits: fuzzy.length,
      returned: merged.length,
      requiresAcknowledgement,
    },
    'Duplicate check complete',
  );

  return { candidates: merged, total, requiresAcknowledgement };
}
