/**
 * Product Feeds - Product Type Builder
 *
 * Builds the 5-level `<g:product_type>` string:
 *
 *   Sport > Continent > League/"National Team" > Team > Player
 *
 * Each level falls back to a placeholder when its input is empty:
 *   - Continent missing -> "Continent"
 *   - League missing    -> "League"
 *   - Team missing      -> "Team"
 *   - Player omitted entirely when empty
 *
 * Sport is determined by scanning title + team for Racing/cricket/rugby
 * keywords, defaulting to "Football".
 *
 * League override: when continent is "European Clubs" AND the title
 * matches one of the EPL team names, league is forced to "English
 * Premier League" (hand-coded fix for mis-categorised EPL products).
 * Conversely, when the row already says `league = "English Premier
 * League"` but continent is NOT "European Clubs", clear the league.
 *
 * PHP source: ukss-feed/productTypeSet.php, build_data.php lines 189-190.
 */

import type { ProductVariationRow } from '../product-feeds.types.js';

const EPL_TEAMS: readonly string[] = [
  'Arsenal',
  'Aston Villa',
  'Bournemouth',
  'Brentford',
  'Brighton',
  'Chelsea',
  'Crystal Palace',
  'Everton',
  'Fulham',
  'Ipswich',
  'Leicester',
  'Liverpool',
  'Man City',
  'Manchester City',
  'Man United',
  'Man Utd',
  'Manchester United',
  'Newcastle',
  'Nottingham',
  'Southampton',
  'Tottenham',
  'West Ham',
  'Wolves',
  'Wolverhampton',
];

const SPORTS_KEYWORDS: ReadonlyArray<{ sport: string; keywords: readonly string[] }> = [
  {
    sport: 'Racing',
    keywords: [
      'racing', 'formula 1', 'mercedes', 'ferrari', 'red bull', 'bmw',
      'f1', 'aston martin', 'alpine', 'ducati', 'motogp', 'mclaren',
    ],
  },
  { sport: 'Cricket', keywords: ['cricket'] },
  { sport: 'Rugby', keywords: ['rugby'] },
];

function ucFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Title keyword -> sport; falls back to team for rugby then "Football". */
function determineSport(title: string | null, team: string | null | undefined): string {
  if (title === null) {
    return 'Unknown Sport';
  }
  const lowerTitle = title.toLowerCase();
  const lowerTeam = (team ?? '').toLowerCase();

  for (const { sport, keywords } of SPORTS_KEYWORDS) {
    for (const kw of keywords) {
      if (lowerTitle.includes(kw)) {
        return ucFirst(sport);
      }
    }
  }

  // Team-based rugby fallback.
  if (lowerTeam.length > 0) {
    for (const kw of SPORTS_KEYWORDS.find((s) => s.sport === 'Rugby')!.keywords) {
      if (lowerTeam.includes(kw)) return 'Rugby';
    }
  }

  return 'Football';
}

/**
 * Return true iff the title contains every word of at least one EPL
 * team name (case-insensitive, substring word match).
 *
 * Only applicable when continent is "European Clubs" -- always false
 * otherwise (preserving the PHP getLeague gate).
 */
function matchesEpl(title: string, continent: string | null): boolean {
  if (continent !== 'European Clubs') return false;

  const lowerTitle = title.toLowerCase();
  for (const team of EPL_TEAMS) {
    const words = team.toLowerCase().split(' ');
    const allFound = words.every((w) => lowerTitle.includes(w));
    if (allFound) return true;
  }
  return false;
}

/**
 * Build the `League > Team` or `National Team > Team` slice.
 *
 * PHP's `rtrim($team_info, " > ")` strips any trailing run of space or
 * `>` chars (PHP rtrim's second arg is a character set, not a literal
 * substring). The regex below mirrors that exactly so a team value
 * with trailing whitespace (e.g. "Wolves ") doesn't leak into the
 * output. Abhinav Gautam
 */
function getTeamInfo(
  league: string | null,
  team: string | null,
  continent: string | null,
): string {
  let out = '';
  const isClub = continent !== null && continent.toLowerCase().includes('club');
  if (isClub) {
    out += league && league.length > 0 ? `${league} > ` : 'League > ';
  } else {
    out += 'National Team > ';
  }
  out += team && team.length > 0 ? team : 'Team';
  return out.replace(/[ >]+$/, '');
}

/**
 * Entry point for a single row. Returns the full `Sport > Continent >
 * League > Team > Player` string.
 */
export function buildProductType(row: ProductVariationRow): string {
  const title = row.products_name ?? null;
  const continent = row.continent ?? null;
  const team = row.team ?? null;
  const playerName = row.player_name ?? null;

  // League resolution.
  let league: string | null;
  if (title !== null && matchesEpl(title, continent)) {
    league = 'English Premier League';
  } else {
    league = null;
  }
  // PHP bug-compatible: if the row's league says EPL but continent is
  // not "European Clubs", clear it.
  if (continent !== 'European Clubs' && row.league === 'English Premier League') {
    league = null;
  }

  const sport = determineSport(title, team);

  let productType = sport;
  productType += ' > ';
  productType += continent && continent.length > 0 ? continent : 'Continent';
  productType += ' > ';
  productType += getTeamInfo(league, team, continent);

  if (playerName && playerName.length > 0) {
    productType += ' > ' + playerName;
  }

  return productType;
}
