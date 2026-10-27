/**
 * AI Generation — shared constants (attribute icons, dropdown config, defaults)
 * for the wizard's AI-driven Steps 3 & 4. Extracted verbatim from
 * AiGenerationPanel.tsx (no behaviour change).
 */

import { Tag, Palette, Trophy, Shirt, Star, ShieldCheck, User, Baby, Ruler } from 'lucide-react';
import type { ExtractedAttribute } from '../utils/difyParse';

export const VISIBLE_SOURCE_TAGS = 4;

/** Icon lookup for known attribute keys. Falls back to Tag in the renderer. */
export const ATTRIBUTE_ICONS: Record<string, typeof Tag> = {
  // Team and Season
  team: Trophy,
  team_name: Trophy,
  season: Tag,
  // Colors
  color: Palette,
  colour: Palette,
  primary_color: Palette,
  // Other attributes
  league: Trophy,
  condition: Star,
  sleeve: Shirt,
  sleeve_length: Shirt,
  brand: Tag,
  manufacturer: Tag,
  material: Shirt,
  authenticity: ShieldCheck,
  category: Tag,
  team_category: Tag,
  sport: Trophy,
  gender: User,
  age_group: Baby,
  size_guide: Ruler,
};

/** Configuration for attribute keys that should use dropdown instead of text input. */
export interface DropdownConfig {
  endpoint: string;
  idField: string;
  labelField: string;
  /** If true, uses SearchableAttributeDropdown with dynamic search (for large datasets) */
  searchable?: boolean;
}

// All constrained-attribute dropdowns are sourced from Typesense — the same
// dataset the Dify description-generator workflow validates LLM picks against.
// Keeps dropdown options and workflow validation in sync, so the user never
// sees a "no match" warning for a value the dropdown actually contains.
// (team_category is the one exception — not a Typesense facet, kept on MySQL.)
const TS_BASE = '/products/typesense';
const TS_FIELDS: DropdownConfig = { endpoint: '', idField: 'id', labelField: 'name' };
export const ATTRIBUTE_DROPDOWNS: Record<string, DropdownConfig> = {
  // Team
  team:           { ...TS_FIELDS, endpoint: `${TS_BASE}/team`, searchable: true },
  team_name:      { ...TS_FIELDS, endpoint: `${TS_BASE}/team`, searchable: true },
  // Season
  season:         { ...TS_FIELDS, endpoint: `${TS_BASE}/season` },
  // Colors
  color:          { ...TS_FIELDS, endpoint: `${TS_BASE}/color` },
  colour:         { ...TS_FIELDS, endpoint: `${TS_BASE}/color` },
  primary_color:  { ...TS_FIELDS, endpoint: `${TS_BASE}/color` },
  // Sleeve Length
  sleeve_length:  { ...TS_FIELDS, endpoint: `${TS_BASE}/sleeve-length` },
  sleeve:         { ...TS_FIELDS, endpoint: `${TS_BASE}/sleeve-length` },
  // Manufacturer / brand
  manufacturer:   { ...TS_FIELDS, endpoint: `${TS_BASE}/brand`, searchable: true },
  brand:          { ...TS_FIELDS, endpoint: `${TS_BASE}/brand`, searchable: true },
  // Gender / age group / size guide
  gender:         { ...TS_FIELDS, endpoint: `${TS_BASE}/gender` },
  age_group:      { ...TS_FIELDS, endpoint: `${TS_BASE}/age-group` },
  size_guide:     { ...TS_FIELDS, endpoint: `${TS_BASE}/size-guide` },
  // Team category — local MySQL (not a Typesense facet)
  team_category:  { endpoint: '/products/team-categories', idField: 'team_categories_id', labelField: 'category_name', searchable: true },
  category:       { endpoint: '/products/team-categories', idField: 'team_categories_id', labelField: 'category_name', searchable: true },
};

/** Default attributes to show when workflow doesn't return any structured attributes */
export const DEFAULT_ATTRIBUTES: ExtractedAttribute[] = [
  { key: 'team', label: 'Team', value: '' },
  { key: 'season', label: 'Season', value: '' },
  { key: 'color', label: 'Primary Color', value: '' },
  { key: 'sleeve_length', label: 'Sleeve Length', value: '' },
  { key: 'manufacturer', label: 'Manufacturer', value: '' },
  { key: 'gender', label: 'Gender', value: '' },
  { key: 'age_group', label: 'Age Group', value: '' },
  { key: 'size_guide', label: 'Size Guide', value: '' },
];
