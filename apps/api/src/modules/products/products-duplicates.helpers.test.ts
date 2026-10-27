/**
 * Unit tests for the duplicate-detection merge logic (pure — no DB/Typesense).
 * The two tiers are verified end-to-end against live data separately; this
 * pins the merge/de-dup + strength-upgrade behaviour that gates Save.
 */

import { describe, it, expect } from 'vitest';
import { mergeFuzzy } from './products-duplicates.helpers';
import type { DuplicateCandidate } from './products.types';

function candidate(overrides: Partial<DuplicateCandidate>): DuplicateCandidate {
  return {
    productListsId: 1,
    productCode: 'CODE',
    productName: 'A shirt',
    teamName: 'Brazil',
    season: '2024-2025',
    productTypeName: 'Football Shirts',
    ageGroup: null,
    color: null,
    status: 'active',
    frontImageUrl: null,
    matchScore: 30,
    strength: 'weak',
    matchSource: 'structured',
    matchedFields: ['Team', 'Season', 'Type'],
    ...overrides,
  };
}

describe('mergeFuzzy', () => {
  it('upgrades a code found in both tiers to source "both", boosts score, marks strong', () => {
    const structured = [candidate({ productCode: 'JZ100', matchScore: 30, strength: 'weak' })];
    const fuzzy = [candidate({ productCode: 'JZ100', matchSource: 'fuzzy', matchScore: 70, strength: 'strong', matchedFields: ['Title'] })];

    const merged = mergeFuzzy(structured, fuzzy);

    expect(merged).toHaveLength(1);
    expect(merged[0].matchSource).toBe('both');
    expect(merged[0].strength).toBe('strong');
    expect(merged[0].matchScore).toBeGreaterThan(30);
    expect(merged[0].matchedFields).toContain('Title');
  });

  it('appends fuzzy-only codes not present in the structured tier', () => {
    const structured = [candidate({ productCode: 'JZ100' })];
    const fuzzy = [candidate({ productCode: 'FUZZ1', matchSource: 'fuzzy', strength: 'strong' })];

    const merged = mergeFuzzy(structured, fuzzy);

    expect(merged.map((c) => c.productCode).sort()).toEqual(['FUZZ1', 'JZ100']);
    expect(merged.find((c) => c.productCode === 'FUZZ1')?.matchSource).toBe('fuzzy');
  });

  it('caps the merged score at 100', () => {
    const structured = [candidate({ productCode: 'JZ100', matchScore: 95 })];
    const fuzzy = [candidate({ productCode: 'JZ100', matchSource: 'fuzzy', matchScore: 90 })];

    const merged = mergeFuzzy(structured, fuzzy);

    expect(merged[0].matchScore).toBeLessThanOrEqual(100);
  });

  it('returns structured candidates unchanged when there are no fuzzy hits', () => {
    const structured = [candidate({ productCode: 'JZ100' }), candidate({ productCode: 'JZ200' })];

    const merged = mergeFuzzy(structured, []);

    expect(merged).toHaveLength(2);
    expect(merged.every((c) => c.matchSource === 'structured')).toBe(true);
  });
});
