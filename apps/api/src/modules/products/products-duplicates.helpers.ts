/**
 * Pure helpers for duplicate detection — no DB / config / Typesense imports, so
 * they're unit-testable in isolation. The service composes these around the two
 * data-fetching tiers.
 */

import type { DuplicateCandidate } from './products.types';

/** Score boost applied when a code surfaces in BOTH tiers (structured + fuzzy). */
export const WEIGHT_FUZZY = 35;

/**
 * Merge Tier-2 fuzzy (Typesense) hits into the structured candidate list.
 * A code present in both tiers is upgraded to matchSource 'both' and given a
 * fuzzy score boost; codes only found by fuzzy search are appended.
 */
export function mergeFuzzy(
  structured: DuplicateCandidate[],
  fuzzy: DuplicateCandidate[],
): DuplicateCandidate[] {
  const byCode = new Map<string, DuplicateCandidate>();
  for (const c of structured) byCode.set(c.productCode, c);

  for (const f of fuzzy) {
    const existing = byCode.get(f.productCode);
    if (existing) {
      existing.matchSource = 'both';
      existing.matchScore = Math.min(existing.matchScore + WEIGHT_FUZZY, 100);
      if (!existing.matchedFields.includes('Title')) existing.matchedFields.push('Title');
      // A close title match is itself a strong signal.
      existing.strength = 'strong';
    } else {
      byCode.set(f.productCode, f);
    }
  }

  return Array.from(byCode.values());
}
