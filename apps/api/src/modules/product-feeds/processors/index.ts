/**
 * Product Feeds - Processors Barrel Export
 *
 * Pure business-logic functions ported from the PHP feed system.
 * All processors are dependency-free (no DB, no filesystem) apart from
 * `color-detector.getColorFromImage` which fetches product image bytes
 * and samples pixels via `sharp`.
 *
 * Each file is independently unit-testable and may be imported in
 * isolation by the product builder or orchestrator.
 */

export { calculatePrice } from './pricing-engine.js';
export {
  fixEncoding,
  standardizeTitle,
  cleanDescription,
  createItemDetails,
  improveTitle,
  checkTitle4Player,
  checkTitle4Team,
} from './title-processor.js';
export { normalizeSize } from './size-normalizer.js';
export {
  findColorInTitle,
  getColorFromImage,
  detectColor,
} from './color-detector.js';
export {
  determineAgeGroup,
  getCustomLabel2,
  getCustomLabel3,
  getCustomLabel4,
  findFirstMatch,
} from './custom-labels.js';
export { getGoogleProductCategory } from './google-product-category.js';
export { isValidGTIN } from './gtin-validator.js';
export { buildProductType } from './product-type-builder.js';
export { resolveImageUrl, getMaterial } from './image-resolver.js';
