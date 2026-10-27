/**
 * Unit tests for the product-feeds title processor.
 */

import { describe, it, expect } from 'vitest';
import {
  fixEncoding,
  standardizeTitle,
  cleanDescription,
  improveTitle,
  createItemDetails,
  checkTitle4Player,
  checkTitle4Team,
} from './title-processor.js';
import { ENCODING_FIXES } from '../product-feeds.constants.js';

describe('fixEncoding', () => {
  it('replaces known mojibake sequences', () => {
    const input = 'CafÃƒÂ© del Mar';
    expect(fixEncoding(input, ENCODING_FIXES)).toBe('Café del Mar');
  });

  it('returns the input unchanged when no mojibake present', () => {
    expect(fixEncoding('Hello World', ENCODING_FIXES)).toBe('Hello World');
  });

  // Regression: the triple-encoded "i acute" pattern in the live feed data
  // contains U+2019 (RIGHT SINGLE QUOTATION MARK) at codepoint 4. An earlier
  // version of ENCODING_FIXES used U+0092 instead, so the lookup never
  // matched and "Príncipe" leaked through as triple-mojibake. Abhinav Gautam
  it('replaces triple-encoded i-acute (U+2019 variant) seen in São Tomé and Príncipe', () => {
    const tripleI = 'Pr' + 'ÃƒÆ’Ã‚Â­' + 'ncipe';
    expect(fixEncoding(tripleI, ENCODING_FIXES)).toBe('Príncipe');
  });
});

describe('standardizeTitle', () => {
  it('converts 4-digit year pairs to abbreviated prefix', () => {
    expect(standardizeTitle('1986-87 England Home Shirt')).toBe(
      "'86-'87 England Home Shirt",
    );
  });

  it('converts 4-4 pairs to 2-2', () => {
    expect(standardizeTitle('1986-1987 England')).toBe("'86-'87 England");
  });

  it('converts 2-digit pairs', () => {
    expect(standardizeTitle('86-87 England Home Shirt')).toBe(
      "'86-'87 England Home Shirt",
    );
  });

  it('converts slash-separated pairs', () => {
    expect(standardizeTitle('86/87 England Kit')).toBe("'86-'87 England Kit");
  });

  it('skips matches inside parentheses', () => {
    // The 86-87 inside parens is skipped, so no earlier pattern fires;
    // "Retro" has no digits to trigger subsequent patterns.
    expect(standardizeTitle('England Kit (86-87 Edition)')).toBe(
      'England Kit (86-87 Edition)',
    );
  });

  it('returns unchanged when already in canonical form', () => {
    expect(standardizeTitle("'86-'87 England Shirt")).toBe("'86-'87 England Shirt");
  });

  it('returns unchanged when no digits present', () => {
    expect(standardizeTitle('England Kit')).toBe('England Kit');
  });

  it('skips 4-digit years before 1800 (then falls through to 2-digit pattern)', () => {
    // After the 4-digit pattern skips 1492-93 for being pre-1800, the
    // 2-digit /\d{2}-\d{2}/ pattern matches "92-93" and rewrites it.
    // This faithfully mirrors the PHP loop semantics.
    expect(standardizeTitle('1492-93 Title')).toBe("'92-'93 14  Title");
  });
});

describe('cleanDescription', () => {
  it('decodes common HTML entities', () => {
    expect(cleanDescription('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(cleanDescription('&quot;Great&quot;')).toBe('"Great"');
  });

  it('strips HTML tags', () => {
    expect(cleanDescription('<p>Hello <b>World</b></p>')).toBe('Hello World');
  });

  it('collapses whitespace and newlines', () => {
    expect(cleanDescription('Foo\n\nbar\t\tbaz')).toBe('Foo bar baz');
  });

  it('handles empty input', () => {
    expect(cleanDescription('')).toBe('');
  });
});

describe('improveTitle', () => {
  const validSizes: readonly string[] = [];

  it('appends missing gender, mapping male -> Men\'s', () => {
    const details = createItemDetails('Test Shirt', '', '', '', '', '', '', '', 'male');
    expect(improveTitle(details, validSizes)).toBe("Test Shirt Men's");
  });

  it('maps female to Women\'s', () => {
    const details = createItemDetails('Test Shirt', '', '', '', '', '', '', '', 'female');
    expect(improveTitle(details, validSizes)).toBe("Test Shirt Women's");
  });

  it('maps unisex to Kids when agegroup is kids', () => {
    const details = createItemDetails(
      'Test Shirt', '', '', '', '', '', '', 'kids', 'unisex',
    );
    expect(improveTitle(details, validSizes)).toBe('Test Shirt Kids');
  });

  it('prefixes brand with "Made By:" (except UKSoccershop)', () => {
    const details = createItemDetails(
      'Test Shirt', '', '', '', 'Nike', '', '', '', '',
    );
    expect(improveTitle(details, validSizes)).toBe('Test Shirt Made By: Nike');
  });

  it('does not prefix UKSoccershop brand', () => {
    const details = createItemDetails(
      'Test Shirt', '', '', '', 'UKSoccershop', '', '', '', '',
    );
    expect(improveTitle(details, validSizes)).toBe('Test Shirt UKSoccershop');
  });

  it('stops appending when max length (150) would be exceeded', () => {
    const longTitle = 'A'.repeat(140);
    const details = createItemDetails(
      longTitle, '', '', '', 'ReallyLongBrandName', '', '', '', '',
    );
    const out = improveTitle(details, validSizes);
    expect(out.length).toBeLessThanOrEqual(150);
  });

  it('does not append attribute already present in title', () => {
    const details = createItemDetails('Nike Shirt', '', '', '', 'Nike', '', '', '', '');
    expect(improveTitle(details, validSizes)).toBe('Nike Shirt');
  });
});

describe('checkTitle4Player / checkTitle4Team', () => {
  it('returns true when a player word matches whole-word', () => {
    expect(checkTitle4Player('Lionel Messi', 'Messi Jersey')).toBe(true);
  });

  it('returns false when the match is a substring only', () => {
    expect(checkTitle4Player('Mes', 'Messi Jersey')).toBe(false);
  });

  it('returns false when player name is empty', () => {
    expect(checkTitle4Player('', 'Some Title')).toBe(false);
  });

  it('team check mirrors player check', () => {
    expect(checkTitle4Team('Real Madrid', 'Real Madrid Home Kit')).toBe(true);
    expect(checkTitle4Team('Barcelona', 'Real Madrid Kit')).toBe(false);
  });
});
