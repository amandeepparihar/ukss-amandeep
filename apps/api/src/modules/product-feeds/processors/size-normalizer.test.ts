/**
 * Unit tests for the product-feeds size normalizer.
 * Covers the three stages: removeBFromSize, finalSizeClean, and the
 * 12-function fixSize chain.
 */

import { describe, it, expect } from 'vitest';
import { normalizeSize } from './size-normalizer.js';

describe('normalizeSize', () => {
  // removeBFromSize
  it('strips trailing B from XLB, MB, SB, XSB', () => {
    expect(normalizeSize('XLB')).toBe('XL');
    expect(normalizeSize('MB')).toBe('M');
    expect(normalizeSize('SB')).toBe('S');
    expect(normalizeSize('XSB')).toBe('XS');
  });

  // returnRawSizeIfMatched (fixSize chain)
  it('passes through already-valid size codes', () => {
    expect(normalizeSize('M')).toBe('M');
    expect(normalizeSize('XXL')).toBe('XXL');
    expect(normalizeSize('One Size')).toBe('One Size');
  });

  // finalSizeClean
  it('maps full-word size names to codes', () => {
    expect(normalizeSize('Large')).toBe('L');
    expect(normalizeSize('Medium')).toBe('M');
    // PHP quirk faithfully preserved: "Extra Large" matches the word
    // "Large" first (iteration order "L" before "XL") and returns "L".
    expect(normalizeSize('Extra Large')).toBe('L');
  });

  // extractWaistSize
  it('extracts waist sizes', () => {
    expect(normalizeSize('28 Waist')).toBe('28 Waist');
    expect(normalizeSize('28" Waist')).toBe('28 Waist');
    expect(normalizeSize('28-30 Waist')).toBe('28-30 Waist');
  });

  // fix4yr
  it('fixes 4YR -> 4', () => {
    expect(normalizeSize('4YR')).toBe('4');
  });

  // findAgeRange
  it('normalizes month ranges to " Mo" suffix', () => {
    // Inputs without a trailing space before "M" -- otherwise
    // finalSizeClean would catch the standalone "M" as a valid size.
    expect(normalizeSize('6-9 Mth')).toBe('6-9 Mo');
    expect(normalizeSize('6-9M')).toBe('6-9 Mo');
    expect(normalizeSize('6-9Mth')).toBe('6-9 Mo');
  });

  // formatToddlerSize
  it('appends Toddler to 1-3 year style inputs', () => {
    expect(normalizeSize('1-3 years')).toBe('1-3 Toddler');
    expect(normalizeSize('2 years')).toBe('2 Toddler');
  });

  // extractSockShoeSize
  it('extracts UK-prefixed shoe/sock sizes', () => {
    expect(normalizeSize('UK 6-9')).toBe('6-9');
    expect(normalizeSize('UK 8')).toBe('8');
  });

  // replaceMthsWithMo
  it('replaces " mths" with " Mo"', () => {
    expect(normalizeSize('6-9 mths')).toBe('6-9 Mo');
  });

  // convertExtendedSizes
  it('collapses XXXL to 3XL, XXXXL to 4XL', () => {
    expect(normalizeSize('XXXL')).toBe('3XL');
    expect(normalizeSize('XXXXL')).toBe('4XL');
  });

  // transformSize
  it('transforms "N-M Months" to N-M Mo', () => {
    expect(normalizeSize('6-9 Months')).toBe('6-9 Mo');
    expect(normalizeSize('6/9 Months')).toBe('6-9 Mo');
  });

  // transformSizeYears
  it('transforms "N-M Years" to N-M', () => {
    expect(normalizeSize('4-5 Years')).toBe('4-5');
  });

  // extractNumberRange
  it('extracts bare N-M ranges', () => {
    expect(normalizeSize('6-9')).toBe('6-9');
  });

  // extractChestSize
  it('extracts chest sizes', () => {
    expect(normalizeSize('34" Chest')).toBe('34');
  });

  // null / empty fallback
  it('returns empty string for null/empty', () => {
    expect(normalizeSize(null)).toBe('');
    expect(normalizeSize(undefined)).toBe('');
    expect(normalizeSize('')).toBe('');
  });
});
