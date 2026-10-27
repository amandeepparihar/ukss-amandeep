/**
 * Typesense client (read-only) for the New Product attribute dropdowns.
 *
 * The Dify "Product Description Generator" workflow validates LLM-generated
 * attributes against a Typesense collection of canonical attribute values
 * (e.g. brand, team, season, gender). To keep the JSA admin dropdowns in sync
 * with that validation, we hit the same instance and collection here.
 *
 * Document shape in `staging_ukss_attribute_values_A`:
 *   { attribute_value: string; sort_order: number; attribute_type: string }
 *
 * `attribute_type` is the facet name (e.g. `np_team`, `manufacturers_name`).
 */

import { config } from '../config';
import { logger as rootLogger } from './logger';
import type { CheckDuplicatesInput, DuplicateCandidate, DuplicateStatus } from '../modules/products/products.types';

const log = rootLogger;

/**
 * Public-key → Typesense facet field mapping for the attribute dropdowns the
 * New Product wizard renders. Owned here (not at the route layer) so any future
 * caller — CLI tools, batch enrichment, alternate UIs — picks up the same
 * canonical mapping without re-deriving it.
 *
 * The dropdown values that the Dify "Product Description Generator" workflow
 * validates against are sourced from the SAME Typesense collection, so adding
 * a new facet here is the only step needed to surface it client-side as long
 * as the workflow already accepts it.
 */
export const TYPESENSE_KEY_TO_FACET: Record<string, string> = {
  brand: 'manufacturers_name',
  manufacturer: 'manufacturers_name',
  team: 'np_team',
  season: 'np_season',
  color: 'np_color',
  'sleeve-length': 'np_sleevelength',
  'size-guide': 'np_sizeguide',
  'age-group': 'np_agegroup',
  gender: 'np_gender',
};

/** Resolve a public dropdown key to its Typesense facet field, or null. */
export function resolveTypesenseFacet(key: string): string | null {
  return TYPESENSE_KEY_TO_FACET[key] ?? null;
}

interface MultiSearchHit {
  document: { attribute_value?: string; sort_order?: number };
}

interface MultiSearchResult {
  found: number;
  hits: MultiSearchHit[];
}

interface MultiSearchResponse {
  results: MultiSearchResult[];
}

export class TypesenseError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'TypesenseError';
  }
}

interface FetchOptions {
  /** Optional case-insensitive substring filter applied server-side. */
  search?: string;
  /** Soft cap on returned values. Defaults to 250 (matches the Dify workflow). */
  limit?: number;
}

/**
 * Fetch the canonical attribute values for a single facet, sorted by `sort_order`.
 * Returns plain strings — callers shape them into `{id, name}` for the UI.
 *
 * Returns an empty array when Typesense is not configured or the request fails,
 * so dropdown loads remain non-fatal.
 */
export async function getAttributeValues(
  facetField: string,
  opts: FetchOptions = {},
): Promise<string[]> {
  if (!config.TYPESENSE_API_KEY) {
    log.warn('TYPESENSE_API_KEY not set — attribute dropdown will be empty');
    return [];
  }

  const limit = Math.max(1, Math.min(opts.limit ?? 250, 250));
  const trimmedSearch = opts.search?.trim() ?? '';

  // When a search term is provided, run a real text search with typo tolerance
  // (mirrors the Dify workflow's targeted search). The wildcard fallback only
  // returns the first 250 by sort_order, so high-sort-order matches like
  // "England" (sort_order=357 in np_team) would otherwise be unreachable.
  const search = trimmedSearch
    ? {
        collection: config.TYPESENSE_ATTRIBUTES_COLLECTION,
        q: trimmedSearch,
        query_by: 'attribute_value',
        filter_by: `attribute_type:=${facetField}`,
        infix: 'always',
        num_typos: 2,
        per_page: 50,
        include_fields: 'attribute_value,sort_order',
      }
    : {
        collection: config.TYPESENSE_ATTRIBUTES_COLLECTION,
        q: '*',
        filter_by: `attribute_type:=${facetField}`,
        sort_by: 'sort_order:asc',
        per_page: limit,
        include_fields: 'attribute_value,sort_order',
      };
  const body = { searches: [search] };

  const url = `${config.TYPESENSE_HOST}/multi_search`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.TYPESENSE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-TYPESENSE-API-KEY': config.TYPESENSE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let payload: MultiSearchResponse;
    try {
      payload = JSON.parse(text);
    } catch {
      log.warn({ status: res.status, body: text.slice(0, 200) }, 'Typesense returned non-JSON');
      return [];
    }

    if (!res.ok) {
      log.warn({ status: res.status, body: text.slice(0, 200) }, 'Typesense request failed');
      return [];
    }

    const hits = payload.results?.[0]?.hits ?? [];
    return hits
      .map((h) => h.document?.attribute_value)
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  } catch (err) {
    log.warn(
      { facetField, error: err instanceof Error ? err.message : String(err) },
      'Typesense fetch threw',
    );
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}


// ===========================================================================
// Product duplicate search (Tier 2) — reuses the storefront products collection
// ===========================================================================
//
// We do NOT maintain our own products index. The storefront already keeps a
// blue-green pair (ukssproductiondata_A/_B) synced with every live product, so
// we search that (config.TYPESENSE_PRODUCTS_COLLECTION) directly. Two
// consequences that shape the code below:
//   1. It holds ACTIVE products only (products_status=1) — archived duplicates
//      are the structured MySQL tier's job, not this search.
//   2. Its fields are the storefront's (products_model, np_team, np_season, …),
//      not our own doc shape, so we map them onto DuplicateCandidate here.

/** Storefront CDN base for the bare `products_image` filename. Matches the
 *  base used across the products-dify service. */
const STOREFRONT_IMAGE_BASE = 'https://cdn1.uksoccershop.com/images/';

interface StorefrontProductDoc {
  products_id?: number;
  products_model?: string;
  products_name?: string;
  np_team?: string;
  np_season?: string;
  np_agegroup?: string;
  np_color?: string;
  products_status?: number;
  products_image?: string;
}

interface ProductSearchHit {
  document: StorefrontProductDoc;
  text_match?: number;
}

function normTeam(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * Tier-2 fuzzy duplicate search. Composes a query from the product name + team
 * + season + colour and searches the storefront products collection with typo
 * tolerance. Catches duplicates the structured tier misses due to a typo or
 * variant spelling in team, season, or title (e.g. "Brasil" vs "Brazil").
 *
 * Returns [] when Typesense is unconfigured or the request fails — the caller
 * degrades to structured-only.
 */
export async function searchProducts(
  input: CheckDuplicatesInput,
  logger = log,
): Promise<DuplicateCandidate[]> {
  const key = config.TYPESENSE_API_KEY;
  if (!key) return [];

  const q = [input.productName, input.teamName, input.season, input.color]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join(' ')
    .trim();
  if (!q) return [];

  // Active products only. The collection is active-only in practice, but filter
  // explicitly so an archived doc slipping in never mislabels as active.
  // hero_shirts:=0 drops the player-name / "Your Name" variants auto-generated
  // from a parent product (~70% of this collection). They are not distinct
  // products a user could be duplicating. Stored as a string ("0"/"1").
  const filterParts = ['products_status:=1', 'hero_shirts:=0'];
  const excludeCode = input.excludeProductCode?.trim() ?? '';
  if (excludeCode) filterParts.push(`products_model:!=${JSON.stringify(excludeCode)}`);

  const body = {
    searches: [
      {
        collection: config.TYPESENSE_PRODUCTS_COLLECTION,
        q,
        query_by: 'products_name,np_team,np_season,products_description',
        filter_by: filterParts.join(' && '),
        num_typos: 2,
        infix: 'fallback',
        per_page: 12,
        include_fields:
          'products_id,products_model,products_name,np_team,np_season,np_agegroup,np_color,products_status,products_image',
      },
    ],
  };

  const url = `${config.TYPESENSE_HOST}/multi_search`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.TYPESENSE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-TYPESENSE-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn({ status: res.status, body: text.slice(0, 200) }, 'Typesense product search failed');
      return [];
    }
    const payload = JSON.parse(text) as { results: Array<{ hits?: ProductSearchHit[] }> };
    const hits = payload.results?.[0]?.hits ?? [];
    const wantTeam = normTeam(input.teamName);

    return hits
      .map((hit, idx): DuplicateCandidate | null => {
        const d = hit.document;
        if (!d.products_model) return null;
        // Precision guard: a fuzzy hit is only a STRONG signal (one that gates
        // Save) when it's the same team as what the operator entered. Cross-team
        // title-token noise stays advisory.
        const sameTeam = !!wantTeam && normTeam(d.np_team) === wantTeam;
        const strength: 'strong' | 'weak' = idx === 0 && sameTeam ? 'strong' : 'weak';
        const matchedFields = ['Title'];
        if (sameTeam) matchedFields.push('Team');
        return {
          productListsId: Number(d.products_id ?? 0),
          productCode: d.products_model,
          productName: d.products_name ?? null,
          teamName: d.np_team ?? null,
          season: d.np_season ?? null,
          productTypeName: null,
          ageGroup: d.np_agegroup || null,
          color: d.np_color || null,
          // Collection is active-only; the filter enforces it.
          status: 'active' as DuplicateStatus,
          frontImageUrl: d.products_image ? `${STOREFRONT_IMAGE_BASE}${d.products_image}` : null,
          matchScore: Math.max(70 - idx * 3, 40),
          strength,
          matchSource: 'fuzzy',
          matchedFields,
        };
      })
      .filter((c): c is DuplicateCandidate => c !== null);
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Typesense product search threw',
    );
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
