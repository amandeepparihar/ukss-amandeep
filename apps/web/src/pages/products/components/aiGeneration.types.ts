/**
 * AI Generation — shared types for the wizard's AI-driven Steps 3 & 4.
 * Extracted verbatim from AiGenerationPanel.tsx (no behaviour change).
 */

export type AiState = 'idle' | 'searching' | 'results' | 'error';

// ---------------------------------------------------------------------------
// Shared product context passed in from NewProductPage
// ---------------------------------------------------------------------------

export interface ProductInfo {
  productCode: string;
  productName: string;
  teamName: string;
  season: string;
  price: number;
  productTypeId: string;
  /** Human-readable product type name (e.g. "Football Shirt"). Optional —
   *  populated when ProductDetailsTab knows the productTypesData mapping.
   *  Used by the AI edit prompts builder for context-aware presets. */
  productTypeName?: string;
  /** Manufacturer / brand selected in Step 1. Forwarded to the Dify image-search
   *  workflow as manufacturer_name so the brand site:filter narrows results. */
  manufacturerName?: string;
  frontImage: string;
  backImage: string;
  additionalImage: string;
  // Pre-populated from check-code for existing products. When codeStatus is
  // 'existing' and these are populated, Steps 3 & 4 seed local state from
  // saved data instead of auto-running Dify.
  codeStatus?: 'new' | 'existing';
  descriptionNotes?: string;
  productAttributes?: Record<string, string>;
  savedPrimaryImageUrl?: string | null;
  savedAdditionalImageUrls?: string[];
  savedBackImageUrl?: string | null;
  /** Backed by product_lists.allows_personalisation. When true, runDify forwards
   *  addLegends:true so the workflow weaves a legends/current-stars paragraph
   *  into the description. Forced off Dify-side when teamName is empty. */
  allowsPersonalisation?: boolean;
}

// ---------------------------------------------------------------------------
// Dify response wrapper (workflow-defined output payload)
// ---------------------------------------------------------------------------

export interface DifyApiResponse {
  data: {
    workflowRunId: string;
    status: string;
    outputs: Record<string, unknown>;
    elapsedTime?: number;
  };
}

// ---------------------------------------------------------------------------
// AiImagesSection — state exposed to the parent for the Save Details button.
// ---------------------------------------------------------------------------

export interface ImagesState {
  primaryImageUrl: string | null;
  backImageUrl: string | null;
  additionalImageUrls: string[];
  approvedCount: number;
  // Background removal flags
  removeBackgroundForPrimary: boolean;
  removeBackgroundForBack: boolean;
  removeBackgroundImageUrls: string[];
  // Manual crop flags — cropped tiles carry `data:` URIs whose framing is final
  // (they skip auto-trim + Dify upscale at save time).
  manualCropForPrimary: boolean;
  manualCropForBack: boolean;
  manualCropImageUrls: string[];
  /** Maps each cropped tile URL → its pre-crop source URL, so the backend can
   *  persist the un-cropped original for full-resolution re-crops. */
  manualCropOriginals: Record<string, string>;
  /** Every image currently in the Step 3 gallery (regardless of approve /
   *  primary / back / source-filter state). Surfaced so downstream sections
   *  can offer the full reference-image picker — e.g. the Enhance Description
   *  dialog lets the user pick any gallery shot to feed the vision LLM. */
  galleryImages: Array<{ url: string; label: string; fallbackUrl?: string; source: string }>;
  /** URLs of every image the user uploaded via the toolbar Upload button this
   *  session. Forwarded to /products/save-details so the backend can prune
   *  uploads the user didn't end up selecting. */
  uploadedImageUrls: string[];
}

/** Internal state snapshot for undo/redo tracking. */
export interface ImageSelectionSnapshot {
  approvedIds: number[];
  primaryId: number | null;
  backId: number | null;
  removeBackgroundIds: number[];
}

// ---------------------------------------------------------------------------
// AiDescriptionSection — state exposed to the parent for the Save Details button.
// ---------------------------------------------------------------------------

export interface DescriptionState {
  descriptionText: string;
  descriptionAccepted: boolean;
  acceptedAttributes: Record<string, string>;
}
