/**
 * Product Feeds - Marketplace CSV Generator
 *
 * Writes the UK-only `marketplace_UK.csv` feed. Currency is hardcoded
 * to GBP (rate = 1); 23 columns matching the PHP `marketplace.php`
 * output exactly -- column order matters for downstream consumers.
 *
 * PHP source: ukss-feed/marketplace.php::create_marketplace_feed()
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';
import { csvUtils } from '../../marketplaces/utils/csv.utils.js';
import type { ProcessedProduct, FeedFileResult } from '../product-feeds.types.js';

/** Column headers in the exact order the PHP writes them. */
const HEADERS: readonly string[] = [
  'id',
  'title',
  'description',
  'link',
  'image_link',
  'additional_image_link',
  'price',
  'currency',
  'sale_price',
  'sale_price_currency',
  'availability',
  'condition',
  'brand',
  'gtin',
  'mpn',
  'gender',
  'age_group',
  'color',
  'size',
  'item_group_id',
  'product_type',
  'google_product_category',
  'material',
];

const MARKETPLACE_CURRENCY = 'GBP';
const MARKETPLACE_RATE = 1;

/**
 * Generate the `marketplace_UK.csv` file. Always GBP / UK. Returns
 * metadata for the orchestrator's feed-run report.
 *
 * @param products     from `buildProducts(...)`
 * @param outputDir    target directory; file is always `marketplace_UK.csv`
 */
export async function generateMarketplaceCsv(
  products: ProcessedProduct[],
  outputDir: string,
): Promise<FeedFileResult> {
  const filePath = path.join(outputDir, 'marketplace_UK.csv');
  let itemCount = 0;

  await csvUtils.writeFileStreaming(
    filePath,
    [...HEADERS],
    async function* () {
      for (const product of products) {
        if (!product.item_title) continue;

        for (const variant of product.item_variants) {
          const row: string[] = new Array(HEADERS.length).fill('');
          const set = (col: string, val: unknown): void => {
            const idx = HEADERS.indexOf(col);
            if (idx >= 0) row[idx] = val == null ? '' : String(val);
          };

          set('id', variant.item_id);
          set('title', product.item_title);
          set('description', product.item_description);
          set(
            'link',
            `${product.item_link}?currency=${MARKETPLACE_CURRENCY}&gcountry=GB&ovId=${variant.item_varID}`,
          );
          set('image_link', product.item_image_link ?? '');
          // additional_image_link: PHP leaves this blank; ProcessedProduct
          // does not expose the CSV of additional images. Preserved.
          set('additional_image_link', '');
          set('price', (product.item_price * MARKETPLACE_RATE).toFixed(2));
          set('currency', MARKETPLACE_CURRENCY);
          if (product.item_sale_price !== undefined) {
            set('sale_price', (product.item_sale_price * MARKETPLACE_RATE).toFixed(2));
            set('sale_price_currency', MARKETPLACE_CURRENCY);
          }
          set('availability', 'in stock');
          set('condition', product.item_condition);
          set('brand', product.item_brand ?? '');
          set('gtin', variant.item_gtin ?? '');
          set('mpn', product.item_mpn ?? '');
          set('gender', product.item_gender ?? '');
          set('age_group', product.item_age_group ?? '');
          set('color', product.item_color ?? '');
          set('size', variant.item_size ?? '');
          set('item_group_id', product.item_item_group_id);
          set('product_type', product.item_product_type.join(' > '));
          set('google_product_category', product.item_google_product_category);
          set('material', product.item_material ?? '');

          yield row;
          itemCount++;
        }
      }
    },
  );

  const { size } = await stat(filePath);
  return {
    file: path.basename(filePath),
    path: filePath,
    bytes: size,
    itemCount,
    compressed: false,
  };
}
