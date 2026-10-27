/**
 * Product Feeds - FIFA World Cup Filter
 *
 * Filters `ProcessedProduct[]` down to products that:
 *   1. have `item_custom_label_4 === "${currentSeason}-${currentSeason+1}"`
 *   2. belong to a team in `FIFA_WORLD_CUP_TEAMS`
 *   3. have a continent that is NOT "club" (national teams only)
 *
 * Used by the orchestrator to produce the 9 `*_fifa-world-cup.xml`
 * feeds for the upcoming World Cup season.
 *
 * PHP source: ukss-feed/build_data.php lines 406-432 (#165022).
 */

import { FIFA_WORLD_CUP_TEAMS } from './product-feeds.constants.js';
import type { ProcessedProduct, ProductTeamInfo } from './product-feeds.types.js';

/**
 * @param products       processed products (post product-builder)
 * @param productTeams   item_group_id -> { team, continent } map built by the product builder
 * @param currentSeason  year used as the first half of the label, e.g. 2026 -> "2026-2027"
 */
export function filterFifaWorldCupProducts(
  products: ProcessedProduct[],
  productTeams: Map<string, ProductTeamInfo>,
  currentSeason: number,
): ProcessedProduct[] {
  const nextSeasonLabel = `${currentSeason}-${currentSeason + 1}`.toLowerCase();
  const fifaSet = new Set(FIFA_WORLD_CUP_TEAMS.map((t) => t.toLowerCase()));

  return products.filter((p) => {
    const label = (p.item_custom_label_4 ?? '').toLowerCase();
    if (label !== nextSeasonLabel) return false;

    const info = productTeams.get(p.item_item_group_id);
    if (!info) return false;

    if (!fifaSet.has(info.team.toLowerCase())) return false;

    // Exclude anything whose continent contains the word "club".
    if (info.continent.toLowerCase().includes('club')) return false;

    return true;
  });
}
