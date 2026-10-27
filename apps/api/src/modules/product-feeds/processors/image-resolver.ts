/**
 * Product Feeds - Image URL & Material Resolvers
 *
 * resolveImageUrl:
 *   1. main image   -> `${cdn}/images/${file}`
 *   2. fallback to first valid entry in `additional_img` (CSV),
 *      rewriting `.ext` -> `-475x0.ext` and prefixing
 *      `${cdn}/images/cache/adtnl_prodts_img/`
 *   3. '' on no valid image
 *
 * Both the main and additional entries must contain a `.` to be
 * considered valid (matches the PHP `stripos($img, '.') !== false`
 * extension-presence heuristic).
 *
 * getMaterial:
 *   - "Cotton" in title wins (returns "Cotton")
 *   - else if DB material contains "poly" -> "Polyester"
 *   - else passthrough DB material as-is
 *
 * PHP source: ukss-feed/build_data_functions.php::getImageUrl() / getMaterial().
 */

/**
 * Build the feed's `<g:image_link>` value.
 *
 * @param mainImage       `row.main_image` from the view
 * @param additionalImage `row.additional_img` CSV (may be empty)
 * @param cdnUrl          base CDN URL (no trailing slash; configured
 *                        via `PRODUCT_FEED_CDN_URL`)
 */
export function resolveImageUrl(
  mainImage: string | null | undefined,
  additionalImage: string | null | undefined,
  cdnUrl: string,
): string {
  const base = cdnUrl.replace(/\/$/, '');
  const imgRoot = `${base}/images/`;
  const addImgRoot = `${base}/images/cache/adtnl_prodts_img/`;

  if (mainImage && mainImage.length > 0 && mainImage.includes('.')) {
    return imgRoot + mainImage;
  }

  if (additionalImage && additionalImage.length > 0) {
    // Trim leading/trailing commas then split.
    const trimmed = additionalImage.replace(/^,+|,+$/g, '');
    const images = trimmed.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

    for (const img of images) {
      if (img.includes('.')) {
        const modified = img.replace(/(\.\w+)$/, '-475x0$1');
        return addImgRoot + modified;
      }
    }
  }

  return '';
}

/**
 * Normalise the material field. Title-driven "Cotton" wins over DB.
 * A DB value of "polyester" stays; anything containing "poly" (like
 * "poly blend") is canonicalised to "Polyester".
 */
export function getMaterial(
  material: string | null | undefined,
  itemTitle: string,
): string {
  if (itemTitle.toLowerCase().includes('cotton')) {
    return 'Cotton';
  }
  if (material && material.toLowerCase().includes('poly')) {
    return 'Polyester';
  }
  return material ?? '';
}
