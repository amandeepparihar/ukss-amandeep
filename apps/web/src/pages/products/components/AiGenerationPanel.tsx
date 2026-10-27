/**
 * AI Generation Panel — barrel for the wizard's AI-driven Steps 3 & 4.
 *
 * The implementation was split across sibling files purely to keep each file
 * small (no behaviour change). This barrel re-exports the public surface so
 * `./components/AiGenerationPanel` importers (NewProductPage) keep working
 * unchanged.
 *
 *   aiGeneration.types.ts       — shared types (ProductInfo, ImagesState, …)
 *   aiGeneration.constants.ts   — attribute icons, dropdown config, defaults
 *   AiImagesSection.tsx         — Step 3 component (+ useAiImagesSection hook,
 *                                 useAiImageGallery, useAiImageEditing, and the
 *                                 AiImages* presentational pieces)
 *   AiDescriptionSection.tsx    — Step 4 component (+ Description* panels)
 */

export { AiImagesSection } from './AiImagesSection';
export { AiDescriptionSection } from './AiDescriptionSection';
export type { ProductInfo, ImagesState, DescriptionState } from './aiGeneration.types';
export type { EnhanceImageOption, EnhanceImageRef } from './EnhanceDialog';
