/**
 * New Product Module — SEO slug + on-disk filename builders for saved images.
 * Extracted from products-image.service.ts verbatim (no behaviour change).
 */

import { SLUG_MAX_LEN } from './products-image.constants';

// ---------------------------------------------------------------------------
// Helper: build an SEO-friendly slug from product metadata
// ---------------------------------------------------------------------------
//
// Produces e.g. `arsenal-2025-2026-adidas-home-football-shirt` from
// (team, season, manufacturer, productName). Used as the basename for every
// saved product image so the on-disk filename is descriptive for SEO + CDN
// indexing, instead of carrying through whatever junk slug the source URL
// happened to have.
//
// Rules:
//  - ASCII-fold via NFKD so "Müller" → "muller", "Arsenal FC" → "arsenal-fc"
//  - Replace `&` with `and` before stripping so "Black & White" reads cleanly
//  - Everything not [a-z0-9] collapses to a single `-`
//  - Dedupe consecutive duplicate words ("arsenal-arsenal-home" → "arsenal-home")
//    — covers the common case where productName already starts with team/brand
//  - Cap length so we don't overrun NTFS / ext4 filename limits (255 bytes)
//    once timestamp + role suffix + extension are added
//  - Fall back to productCode (then a literal "product") if every input is empty

export function buildSeoSlug(args: {
  teamName?: string | null;
  season?: string | null;
  manufacturerName?: string | null;
  productName?: string | null;
  productCode: string;
}): string {
  const parts = [args.teamName, args.season, args.manufacturerName, args.productName]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0);
  const joined = parts.length > 0 ? parts.join(' ') : args.productCode;

  let slug = joined
    .normalize('NFKD')
    // Strip combining marks (U+0300–U+036F) — NFKD splits "ü" into "u" + ◌̈;
    // dropping the combining range leaves the ASCII base char.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of slug.split('-')) {
    if (!seg || seen.has(seg)) continue;
    seen.add(seg);
    out.push(seg);
  }
  slug = out.join('-');

  if (slug.length > SLUG_MAX_LEN) {
    slug = slug.slice(0, SLUG_MAX_LEN).replace(/-+$/, '');
  }
  if (!slug) slug = 'product';
  return slug;
}

// ---------------------------------------------------------------------------
// Helper: build the on-disk filename for a saved product image
// ---------------------------------------------------------------------------
//
// Output shape:
//   primary  → `{ts}_{slug}.{ext}`
//   back     → `{ts}_{slug}-back.{ext}`
//   detail i → `{ts}_{slug}-detail-{i}.{ext}`  (i is 1-based)
//
// When `isResave` is true (the product already had a stored image of this
// kind), the filename gains an `re_` prefix to match the legacy SMS pattern
// — that prefix is how the existing CDN cache distinguishes a re-uploaded
// asset from the original. Timestamp is passed in so every image in a single
// save shares the same `re_<ts>_` prefix (see user-provided example URLs).

export function buildImageFilename(args: {
  slug: string;
  role: 'primary' | 'back' | 'detail';
  detailIndex?: number;
  extension: 'jpg' | 'png';
  timestamp: number;
  isResave: boolean;
}): string {
  let suffix = '';
  if (args.role === 'back') suffix = '-back';
  else if (args.role === 'detail') suffix = `-detail-${args.detailIndex ?? 1}`;

  const base = `${args.timestamp}_${args.slug}${suffix}.${args.extension}`;
  return args.isResave ? `re_${base}` : base;
}
